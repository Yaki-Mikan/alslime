package ttsgate

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"

	"alslime/internal/config"
	"alslime/internal/coreapi"
	"alslime/internal/domain/ttsaudio"
	"alslime/internal/i18n"
	jobsvc "alslime/internal/jobs"
	"alslime/internal/process"
	"alslime/internal/storage/paths"
)

type onGate struct{}

func (onGate) Enabled(string) bool             { return true }
func (onGate) PublicSnapshot() map[string]bool { return map[string]bool{} }
func (onGate) Entitlement() coreapi.EntitlementStatus {
	return coreapi.EntitlementStatus{}
}

type offGate struct{}

func (offGate) Enabled(string) bool             { return false }
func (offGate) PublicSnapshot() map[string]bool { return map[string]bool{} }
func (offGate) Entitlement() coreapi.EntitlementStatus {
	return coreapi.EntitlementStatus{}
}

// onceModule は一度目の問い合わせだけ接続先を返し、二度目以降は nil を返す
// （確認の直後にモジュールが終了して接続先が外れた状態の再現）。
type onceModule struct {
	base  *url.URL
	calls atomic.Int32
}

func (m *onceModule) BaseURL() *url.URL {
	if m.calls.Add(1) == 1 {
		return m.base
	}
	return nil
}
func (m *onceModule) Secret() string { return "test-secret" }

// stoppedModule は常に未起動（接続先なし）を返す。
type stoppedModule struct{}

func (stoppedModule) BaseURL() *url.URL { return nil }
func (stoppedModule) Secret() string    { return "test-secret" }

func newReadDeps(t *testing.T, gate coreapi.FeatureGate, module ModuleTarget) Deps {
	t.Helper()
	var n atomic.Int64
	return Deps{
		Gate:   gate,
		Module: module,
		Queue: jobsvc.NewQueue(process.NewManager(), jobsvc.NotImplementedRunner{}, func() string {
			return fmt.Sprintf("job-%d", n.Add(1))
		}),
		Store: ttsaudio.New(paths.NewResolver(t.TempDir())),
	}
}

func postRead(mux *http.ServeMux) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, routeBase+"/read", strings.NewReader(`{"sessionId":"s1","messageId":"m1"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func getProxied(mux *http.ServeMux) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, routeBase+"/voices", nil))
	return rec
}

func moduleServer(t *testing.T, handler http.HandlerFunc) *url.URL {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	u, err := url.Parse(srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	return u
}

func TestTTSGate_権利が無ければ403(t *testing.T) {
	mux := http.NewServeMux()
	deps := newReadDeps(t, offGate{}, stoppedModule{})
	RegisterProxy(mux, deps)
	RegisterReadRoutes(mux, deps)
	for name, rec := range map[string]*httptest.ResponseRecorder{
		"読み上げ開始": postRead(mux),
		"転送":     getProxied(mux),
	} {
		if rec.Code != http.StatusForbidden {
			t.Fatalf("%s: expected 403, got %d: %s", name, rec.Code, rec.Body.String())
		}
	}
}

func TestTTSGate_モジュール停止中で内蔵版も無ければ503(t *testing.T) {
	mux := http.NewServeMux()
	deps := newReadDeps(t, onGate{}, stoppedModule{})
	RegisterProxy(mux, deps)
	RegisterReadRoutes(mux, deps)
	for name, rec := range map[string]*httptest.ResponseRecorder{
		"読み上げ開始": postRead(mux),
		"転送":     getProxied(mux),
	} {
		if rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), i18n.KeyErrorTTSServiceMissing) {
			t.Fatalf("%s: expected 503 with %s, got %d: %s", name, i18n.KeyErrorTTSServiceMissing, rec.Code, rec.Body.String())
		}
	}
}

func TestTTSGate_読み上げ開始は接続先を一度だけ読む(t *testing.T) {
	var gotPath, gotSecret string
	module := &onceModule{base: moduleServer(t, func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotSecret = r.Header.Get(coreapi.ModuleAuthHeader)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{}`))
	})}
	mux := http.NewServeMux()
	RegisterReadRoutes(mux, newReadDeps(t, onGate{}, module))

	rec := postRead(mux)
	// 計画の読み上げ対象が無いので、ジョブは登録せず empty を返す。
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"empty":true`) {
		t.Fatalf("expected 200 empty, got %d: %s", rec.Code, rec.Body.String())
	}
	if gotPath != coreapi.ModuleTTSPlanRoute || gotSecret != "test-secret" {
		t.Fatalf("unexpected plan request: path=%q secret=%q", gotPath, gotSecret)
	}
	if n := module.calls.Load(); n != 1 {
		t.Fatalf("expected BaseURL to be read once, got %d", n)
	}
}

func TestTTSGate_転送は接続先を一度だけ読む(t *testing.T) {
	var gotPath, gotSecret string
	module := &onceModule{base: moduleServer(t, func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotSecret = r.Header.Get(coreapi.ModuleAuthHeader)
		_, _ = w.Write([]byte("ok"))
	})}
	mux := http.NewServeMux()
	RegisterProxy(mux, Deps{Gate: onGate{}, Module: module})

	rec := getProxied(mux)
	if rec.Code != http.StatusOK || rec.Body.String() != "ok" {
		t.Fatalf("expected proxied 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if gotPath != config.APIPrefix+"/tts/voices" || gotSecret != "test-secret" {
		t.Fatalf("unexpected proxied request: path=%q secret=%q", gotPath, gotSecret)
	}
	if n := module.calls.Load(); n != 1 {
		t.Fatalf("expected BaseURL to be read once, got %d", n)
	}
}
