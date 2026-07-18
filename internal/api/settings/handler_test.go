package settings

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	globalsettingssvc "alslime/internal/domain/globalsettings"
	pwasettingssvc "alslime/internal/domain/pwasettings"
	serversettingssvc "alslime/internal/domain/serversettings"
	ssrpsettingssvc "alslime/internal/domain/ssrpsettings"
	"alslime/internal/storage/globalsettings"
	"alslime/internal/storage/locations"
	"alslime/internal/storage/paths"
	"alslime/internal/storage/pwasettings"
	"alslime/internal/storage/serversettings"
	"alslime/internal/storage/ssrpsettings"
)

// newSettingsTestMux は settings API 一式を持つ mux を返す。
func newSettingsTestMux(t *testing.T) *http.ServeMux {
	t.Helper()
	resolver := paths.NewResolver(t.TempDir())
	locs := locations.NewResolver()
	mux := http.NewServeMux()
	Register(mux, Deps{
		WorkspaceRoot: resolver.Root(),
		GlobalSettings: globalsettingssvc.New(
			globalsettings.New(resolver),
		),
		SSRPSettings: ssrpsettingssvc.New(
			ssrpsettings.New(resolver),
		),
		PWASettings: pwasettingssvc.New(
			pwasettings.New(resolver, locs.MustPath(locations.PWASettingsFile)),
		),
		ServerSettings: serversettingssvc.New(
			serversettings.New(resolver, locs.MustPath(locations.ServerSettingsFile)),
		),
	})
	return mux
}

func doSettings(t *testing.T, mux *http.ServeMux, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			t.Fatalf("request encode failed: %v", err)
		}
	}
	req := httptest.NewRequest(method, path, &buf)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func TestServerSettingsGet_未作成なら既定値を返す(t *testing.T) {
	mux := newSettingsTestMux(t)

	rec := doSettings(t, mux, http.MethodGet, "/api/settings/server", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d want 200 body=%s", rec.Code, rec.Body.String())
	}
	var resp serverSettingsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode failed: %v body=%s", err, rec.Body.String())
	}
	if resp.Settings.Port == 0 || resp.Settings.BindAddress == "" {
		t.Fatalf("default server settings missing: %#v", resp)
	}
	if !resp.RestartRequired {
		t.Fatalf("restartRequired should be true: %#v", resp)
	}
}

func TestServerSettingsPost_保存して再取得できる(t *testing.T) {
	mux := newSettingsTestMux(t)
	patch := map[string]any{
		"port":        3100,
		"bindAddress": "0.0.0.0",
		"lanPublic":   true,
	}

	rec := doSettings(t, mux, http.MethodPost, "/api/settings/server", patch)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d want 200 body=%s", rec.Code, rec.Body.String())
	}
	var postResp serverSettingsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &postResp); err != nil {
		t.Fatalf("decode post failed: %v body=%s", err, rec.Body.String())
	}
	if !postResp.Success || postResp.Settings.Port != 3100 || postResp.Settings.BindAddress != "0.0.0.0" || !postResp.Settings.LANPublic {
		t.Fatalf("post response mismatch: %#v", postResp)
	}

	rec = doSettings(t, mux, http.MethodGet, "/api/settings/server", nil)
	var getResp serverSettingsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &getResp); err != nil {
		t.Fatalf("decode get failed: %v body=%s", err, rec.Body.String())
	}
	if getResp.Settings != postResp.Settings {
		t.Fatalf("saved settings mismatch: got=%#v want=%#v", getResp.Settings, postResp.Settings)
	}
}

func TestServerSettingsPost_不正ポートは400(t *testing.T) {
	mux := newSettingsTestMux(t)
	rec := doSettings(t, mux, http.MethodPost, "/api/settings/server", map[string]any{"port": 70000})

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status=%d want 400 body=%s", rec.Code, rec.Body.String())
	}
	var resp struct {
		MessageKey string `json:"messageKey"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode failed: %v body=%s", err, rec.Body.String())
	}
	if resp.MessageKey != errKeyInvalidPort {
		t.Fatalf("messageKey=%q want %q", resp.MessageKey, errKeyInvalidPort)
	}
}
