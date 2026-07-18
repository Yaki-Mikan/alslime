package session

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	sessiondom "alslime/internal/domain/sessions"
	jobsvc "alslime/internal/jobs"
	"alslime/internal/process"
	"alslime/internal/storage/paths"
)

type holdRunner struct {
	started chan string
}

func (r holdRunner) Run(ctx context.Context, job jobsvc.Job) (jobsvc.Result, error) {
	r.started <- job.JobID
	<-ctx.Done()
	return jobsvc.Result{}, ctx.Err()
}

func testDeps(t *testing.T) (Deps, func()) {
	t.Helper()
	root, err := os.MkdirTemp(".", ".session-api-test-*")
	if err != nil {
		t.Fatalf("一時ディレクトリ作成失敗: %v", err)
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		t.Fatalf("一時ディレクトリ絶対パス化失敗: %v", err)
	}
	cleanup := func() { _ = os.RemoveAll(abs) }
	resolver := paths.NewResolver(abs)
	runner := holdRunner{started: make(chan string, 8)}
	q := jobsvc.NewQueue(process.NewManager(), runner, seqID())
	return Deps{Sessions: sessiondom.New(resolver), Queue: q}, cleanup
}

func seqID() func() string {
	var n int64
	return func() string { return fmt.Sprintf("job_%d", atomic.AddInt64(&n, 1)) }
}

func TestSessions_History_Title_Update_Resume(t *testing.T) {
	deps, cleanup := testDeps(t)
	defer cleanup()

	if err := deps.Sessions.Save(sessiondom.UnifiedSession{
		SchemaVersion: 1,
		SessionID:     "s1",
		Title:         "old",
		IsSSRP:        true,
		SSRPSettings:  map[string]any{"directiveMode": "C"},
		Bindings: sessiondom.Bindings{
			ActiveModelType: sessiondom.ModelGemini,
			Gemini:          &sessiondom.Binding{NativeSessionID: "s1"},
		},
		Messages: []sessiondom.Message{
			{ID: "m1", Role: "user", Content: "hello"},
			{ID: "m2", Role: "agent", Content: "world"},
		},
	}); err != nil {
		t.Fatalf("session 保存失敗: %v", err)
	}

	mux := http.NewServeMux()
	Register(mux, deps)

	list := httptest.NewRecorder()
	mux.ServeHTTP(list, httptest.NewRequest(http.MethodGet, "/api/sessions", nil))
	if list.Code != http.StatusOK {
		t.Fatalf("list status=%d body=%s", list.Code, list.Body.String())
	}
	var listBody listResponse
	if err := json.Unmarshal(list.Body.Bytes(), &listBody); err != nil {
		t.Fatalf("list decode: %v", err)
	}
	if len(listBody.Sessions) != 1 || listBody.Sessions[0].ID != "s1" {
		t.Fatalf("list response 想定外: %#v", listBody)
	}

	history := httptest.NewRecorder()
	mux.ServeHTTP(history, httptest.NewRequest(http.MethodGet, "/api/chat/history/s1", nil))
	var historyBody historyResponse
	if err := json.Unmarshal(history.Body.Bytes(), &historyBody); err != nil {
		t.Fatalf("history decode: %v", err)
	}
	if len(historyBody.Messages) != 2 || historyBody.Messages[1].Content != "world" {
		t.Fatalf("history response 想定外: %#v", historyBody)
	}

	update := httptest.NewRecorder()
	mux.ServeHTTP(update, httptest.NewRequest(
		http.MethodPost,
		"/api/chat/history/update",
		strings.NewReader(`{"sessionId":"s1","messageId":"m2","content":""}`),
	))
	if update.Code != http.StatusOK {
		t.Fatalf("update status=%d body=%s", update.Code, update.Body.String())
	}

	title := httptest.NewRecorder()
	mux.ServeHTTP(title, httptest.NewRequest(
		http.MethodPost,
		"/api/session/s1/title",
		strings.NewReader(`{"title":"new title"}`),
	))
	if title.Code != http.StatusOK {
		t.Fatalf("title status=%d body=%s", title.Code, title.Body.String())
	}

	resume := httptest.NewRecorder()
	mux.ServeHTTP(resume, httptest.NewRequest(
		http.MethodPost,
		"/api/sessions/resume",
		strings.NewReader(`{"sessionIndex":0,"sessionId":"s1","modelType":"gemini"}`),
	))
	if resume.Code != http.StatusOK {
		t.Fatalf("resume status=%d body=%s", resume.Code, resume.Body.String())
	}
	var resumeBody resumeResponse
	if err := json.Unmarshal(resume.Body.Bytes(), &resumeBody); err != nil {
		t.Fatalf("resume decode: %v", err)
	}
	if !resumeBody.Success || !resumeBody.IsSSRP || resumeBody.Config["directiveMode"] != "C" {
		t.Fatalf("resume response 想定外: %#v", resumeBody)
	}
	if len(resumeBody.History) != 2 || resumeBody.History[1].Content != "" {
		t.Fatalf("resume history 想定外: %#v", resumeBody.History)
	}
}

func TestNewSession_ResumeRequiresSessionIndex(t *testing.T) {
	deps, cleanup := testDeps(t)
	defer cleanup()

	mux := http.NewServeMux()
	Register(mux, deps)

	newRes := httptest.NewRecorder()
	mux.ServeHTTP(newRes, httptest.NewRequest(
		http.MethodPost,
		"/api/sessions/new",
		strings.NewReader(`{"modelType":"claude","ssrpSettings":{"directiveMode":"C"}}`),
	))
	if newRes.Code != http.StatusOK {
		t.Fatalf("new status=%d body=%s", newRes.Code, newRes.Body.String())
	}

	resume := httptest.NewRecorder()
	mux.ServeHTTP(resume, httptest.NewRequest(
		http.MethodPost,
		"/api/sessions/resume",
		strings.NewReader(`{"sessionId":"s1"}`),
	))
	if resume.Code != http.StatusBadRequest {
		t.Fatalf("resume without index status=%d body=%s", resume.Code, resume.Body.String())
	}
}
