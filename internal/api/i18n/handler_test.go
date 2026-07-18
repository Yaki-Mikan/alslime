package i18n

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"alslime/internal/config"
	i18nsvc "alslime/internal/i18n"
	"alslime/internal/storage/paths"
)

func TestI18NRoutes(t *testing.T) {
	mux := http.NewServeMux()
	Register(mux, i18nsvc.New(paths.NewResolver(t.TempDir()), config.I18NDir))

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/i18n/ja", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("catalog status=%d body=%s", rec.Code, rec.Body.String())
	}
	var body struct {
		Lang     string            `json:"lang"`
		Messages map[string]string `json:"messages"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if body.Lang != "ja" || body.Messages["app.save"] == "" {
		t.Fatalf("catalog unexpected: %#v", body)
	}

	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/i18n/languages", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("languages status=%d body=%s", rec.Code, rec.Body.String())
	}
}
