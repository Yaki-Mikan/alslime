package chat

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"alslime/internal/config"
	jobsvc "alslime/internal/jobs"
	"alslime/internal/process"
)

type blockingRunner struct {
	started chan string
	done    chan struct{}
	once    sync.Once
}

func newBlockingRunner() *blockingRunner {
	return &blockingRunner{
		started: make(chan string, 8),
		done:    make(chan struct{}),
	}
}

func (r *blockingRunner) Run(ctx context.Context, job jobsvc.Job) (jobsvc.Result, error) {
	r.started <- job.JobID
	select {
	case <-r.done:
		return jobsvc.Result{Output: "ok", FinalSessionID: job.SessionID}, nil
	case <-ctx.Done():
		return jobsvc.Result{}, ctx.Err()
	}
}

func (r *blockingRunner) complete() {
	r.once.Do(func() { close(r.done) })
}

func newTestMux(runner jobsvc.Runner) *http.ServeMux {
	mux := http.NewServeMux()
	q := jobsvc.NewQueue(process.NewManager(), runner, seqID())
	Register(mux, Deps{Queue: q})
	return mux
}

func seqID() func() string {
	var n int64
	return func() string { return fmt.Sprintf("job_%d", atomic.AddInt64(&n, 1)) }
}

func TestSubmit_Status_Abort(t *testing.T) {
	runner := newBlockingRunner()
	mux := newTestMux(runner)

	body := `{"message":"hello","sessionId":"s1","model":"gemini-3.1-pro-preview"}`
	res := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, config.APIPrefix+"/chat/submit", strings.NewReader(body))
	mux.ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("submit status=%d body=%s", res.Code, res.Body.String())
	}
	var submitted submitResponse
	if err := json.Unmarshal(res.Body.Bytes(), &submitted); err != nil {
		t.Fatalf("submit response decode: %v", err)
	}
	if submitted.JobID == "" || submitted.Status != string(jobsvc.StatusPending) {
		t.Fatalf("submit response 想定外: %#v", submitted)
	}
	<-runner.started

	statusRes := httptest.NewRecorder()
	statusReq := httptest.NewRequest(http.MethodGet, config.APIPrefix+"/chat/status/"+submitted.JobID, nil)
	mux.ServeHTTP(statusRes, statusReq)
	if statusRes.Code != http.StatusOK {
		t.Fatalf("status code=%d body=%s", statusRes.Code, statusRes.Body.String())
	}
	var status statusResponse
	if err := json.Unmarshal(statusRes.Body.Bytes(), &status); err != nil {
		t.Fatalf("status decode: %v", err)
	}
	if status.Status != string(jobsvc.StatusProcessing) || status.Type != string(jobsvc.TypeChat) {
		t.Fatalf("processing status 想定外: %#v", status)
	}

	abortRes := httptest.NewRecorder()
	abortReq := httptest.NewRequest(http.MethodPost, config.APIPrefix+"/abort", nil)
	mux.ServeHTTP(abortRes, abortReq)
	if abortRes.Code != http.StatusOK {
		t.Fatalf("abort code=%d body=%s", abortRes.Code, abortRes.Body.String())
	}

	canceledRes := httptest.NewRecorder()
	canceledReq := httptest.NewRequest(http.MethodGet, config.APIPrefix+"/chat/status/"+submitted.JobID, nil)
	mux.ServeHTTP(canceledRes, canceledReq)
	var canceled statusResponse
	if err := json.Unmarshal(canceledRes.Body.Bytes(), &canceled); err != nil {
		t.Fatalf("canceled decode: %v", err)
	}
	if canceled.Status != string(jobsvc.StatusCanceled) {
		t.Fatalf("abort 後は canceled のはず: %#v", canceled)
	}
}

func TestSubmit_DuplicateSession(t *testing.T) {
	runner := newBlockingRunner()
	mux := newTestMux(runner)

	body := `{"message":"hello","sessionId":"s1","model":"gemini-3.1-pro-preview"}`
	first := httptest.NewRecorder()
	mux.ServeHTTP(first, httptest.NewRequest(http.MethodPost, config.APIPrefix+"/chat/submit", strings.NewReader(body)))
	if first.Code != http.StatusOK {
		t.Fatalf("first submit status=%d body=%s", first.Code, first.Body.String())
	}
	<-runner.started

	second := httptest.NewRecorder()
	mux.ServeHTTP(second, httptest.NewRequest(http.MethodPost, config.APIPrefix+"/chat/submit", strings.NewReader(body)))
	if second.Code != http.StatusConflict {
		t.Fatalf("duplicate status=%d body=%s", second.Code, second.Body.String())
	}
	var dup duplicateResponse
	if err := json.Unmarshal(second.Body.Bytes(), &dup); err != nil {
		t.Fatalf("duplicate decode: %v", err)
	}
	if dup.ExistingJobID == "" {
		t.Fatalf("existingJobId が返るはず: %#v", dup)
	}
}

func TestStatus_CompletedReturnsModel(t *testing.T) {
	runner := newBlockingRunner()
	mux := newTestMux(runner)

	body := `{"message":"hello","sessionId":"s1","model":"gemini-3.1-pro-preview"}`
	res := httptest.NewRecorder()
	mux.ServeHTTP(res, httptest.NewRequest(http.MethodPost, config.APIPrefix+"/chat/submit", strings.NewReader(body)))
	if res.Code != http.StatusOK {
		t.Fatalf("submit status=%d body=%s", res.Code, res.Body.String())
	}
	var submitted submitResponse
	if err := json.Unmarshal(res.Body.Bytes(), &submitted); err != nil {
		t.Fatalf("submit response decode: %v", err)
	}
	<-runner.started
	runner.complete()

	status := waitStatus(t, mux, submitted.JobID, jobsvc.StatusCompleted)
	if status.Result != "ok" {
		t.Fatalf("result 想定外: %#v", status)
	}
	if status.Model != "gemini-3.1-pro-preview" {
		t.Fatalf("model が返っていない: %#v", status)
	}
}

func TestRegenerate_RequiresSessionID(t *testing.T) {
	mux := newTestMux(newBlockingRunner())

	res := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, config.APIPrefix+"/regenerate", strings.NewReader(`{}`))
	mux.ServeHTTP(res, req)
	if res.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", res.Code, res.Body.String())
	}
}

func waitStatus(t *testing.T, mux *http.ServeMux, jobID string, want jobsvc.Status) statusResponse {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		res := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, config.APIPrefix+"/chat/status/"+jobID, nil)
		mux.ServeHTTP(res, req)
		if res.Code != http.StatusOK {
			t.Fatalf("status code=%d body=%s", res.Code, res.Body.String())
		}
		var status statusResponse
		if err := json.Unmarshal(res.Body.Bytes(), &status); err != nil {
			t.Fatalf("status decode: %v", err)
		}
		if status.Status == string(want) {
			return status
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("status did not become %s", want)
	return statusResponse{}
}
