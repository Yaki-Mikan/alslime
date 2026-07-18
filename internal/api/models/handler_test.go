package modelsapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	chatflow "alslime/internal/coreapi"
	"alslime/internal/domain/models"
	usermodelssvc "alslime/internal/domain/usermodels"
	usermodelsstore "alslime/internal/storage/usermodels"
)

type fakeStore struct {
	data usermodelsstore.Data
}

func (f *fakeStore) Load() (usermodelsstore.Data, error) { return f.data, nil }
func (f *fakeStore) Save(data usermodelsstore.Data) error {
	f.data = data
	return nil
}

type fakeEngine struct {
	lastReq chatflow.Request
	res     chatflow.Response
	err     error
}

func (f *fakeEngine) Chat(_ context.Context, req chatflow.Request) (chatflow.Response, error) {
	f.lastReq = req
	return f.res, f.err
}

func (f *fakeEngine) Regenerate(_ context.Context, req chatflow.Request) (chatflow.Response, error) {
	return f.Chat(context.Background(), req)
}

func newTestMux(store *fakeStore, engine *fakeEngine) *http.ServeMux {
	mux := http.NewServeMux()
	Register(mux, Deps{
		UserModels:       usermodelssvc.New(store),
		Checker:          engine,
		Timeout:          5 * time.Second,
		NewPingSessionID: func() string { return "ping_session" },
	})
	return mux
}

func TestGetModelsReturnsMerged(t *testing.T) {
	store := &fakeStore{data: usermodelsstore.Data{
		Added:  []models.UserModel{{ID: "my-model"}},
		Hidden: []string{"gemini-2.5-flash"},
	}}
	mux := newTestMux(store, &fakeEngine{})

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/models", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	var body struct {
		Models []models.Model `json:"models"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	var hasAdded, hasHidden bool
	for _, m := range body.Models {
		if m.ID == "my-model" {
			hasAdded = true
		}
		if m.ID == "gemini-2.5-flash" {
			hasHidden = true
		}
	}
	if !hasAdded || hasHidden {
		t.Errorf("マージ結果が不正: hasAdded=%v hasHidden=%v", hasAdded, hasHidden)
	}
}

func TestPostUserValidatesAndSaves(t *testing.T) {
	store := &fakeStore{}
	mux := newTestMux(store, &fakeEngine{})

	body := strings.NewReader(`{"added":[{"id":"my-model"}],"hidden":["gemini-2.5-flash","bogus"]}`)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/models/user", body))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body = %s", rec.Code, rec.Body.String())
	}
	if len(store.data.Added) != 1 || store.data.Added[0].ID != "my-model" {
		t.Errorf("保存内容が不正: %+v", store.data)
	}
	if len(store.data.Hidden) != 1 || store.data.Hidden[0] != "gemini-2.5-flash" {
		t.Errorf("hidden の正規化が不正: %v", store.data.Hidden)
	}
}

func TestPostUserRejectsBuiltInConflict(t *testing.T) {
	mux := newTestMux(&fakeStore{}, &fakeEngine{})

	body := strings.NewReader(`{"added":[{"id":"gemini-2.5-flash"}]}`)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/models/user", body))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestPingSuccess(t *testing.T) {
	engine := &fakeEngine{res: chatflow.Response{Output: "OK"}}
	mux := newTestMux(&fakeStore{}, engine)

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/models/ping", strings.NewReader(`{"model":"claude-sonnet-4-5"}`)))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	var body struct {
		Success bool   `json:"success"`
		Output  string `json:"output"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if !body.Success || body.Output != "OK" {
		t.Errorf("ping 結果が不正: %+v", body)
	}
	// Claude 経路は resume 回避のため SessionID 空・新規セッション扱いであること。
	if engine.lastReq.Session.SessionID != "" || !engine.lastReq.IsNewSession {
		t.Errorf("Claude ping の Request が不正: %+v", engine.lastReq.Session)
	}
}

func TestPingAntigravityGetsSessionID(t *testing.T) {
	engine := &fakeEngine{res: chatflow.Response{Output: "OK"}}
	mux := newTestMux(&fakeStore{}, engine)

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/models/ping", strings.NewReader(`{"model":"antigravity:Gemini 3.5 Flash (High)"}`)))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	// Antigravity は --conversation 必須のため新規 ID が払い出されること。
	if engine.lastReq.Session.SessionID != "ping_session" {
		t.Errorf("Antigravity ping に SessionID が無い: %+v", engine.lastReq.Session)
	}
}

func TestPingProviderErrorReportsFailure(t *testing.T) {
	engine := &fakeEngine{res: chatflow.Response{Output: "quota exceeded", ProviderError: true}}
	mux := newTestMux(&fakeStore{}, engine)

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/models/ping", strings.NewReader(`{"model":"gemini-2.5-flash"}`)))
	var body struct {
		Success bool   `json:"success"`
		Error   string `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if body.Success || body.Error != "quota exceeded" {
		t.Errorf("provider error が失敗として返らない: %+v", body)
	}
}
