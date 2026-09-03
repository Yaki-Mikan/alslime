package characters

import (
	"bytes"
	"net/http"
	"testing"

	charsvc "alslime/internal/domain/characters"
	"alslime/internal/storage/paths"
)

func TestEmotionPromptsRoutes(t *testing.T) {
	mux := http.NewServeMux()
	resolver := paths.NewResolver(t.TempDir())
	RegisterEmotionPrompts(mux, charsvc.NewEmotionPromptsService(resolver))
	// 「/characters/{name}/...」系と同居しても「/characters/emotion-prompts」が勝つこと。
	RegisterLinkedSettings(mux, charsvc.NewLinkedSettingsService(resolver))

	rec := doJSON(mux, http.MethodGet, "/api/characters/emotion-prompts", "")
	if rec.Code != http.StatusOK || !bytes.Contains(rec.Body.Bytes(), []byte(`"emotions":{}`)) {
		t.Fatalf("get default: %d %s", rec.Code, rec.Body.String())
	}
	rec = doJSON(mux, http.MethodPut, "/api/characters/emotion-prompts", `{broken`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("put broken: %d", rec.Code)
	}
	rec = doJSON(mux, http.MethodPut, "/api/characters/emotion-prompts", `{"emotions":{"smile":[{"title":"a","prompt":"p"}]}}`)
	if rec.Code != http.StatusOK || !bytes.Contains(rec.Body.Bytes(), []byte(`"version":1`)) {
		t.Fatalf("put ok: %d %s", rec.Code, rec.Body.String())
	}
	rec = doJSON(mux, http.MethodGet, "/api/characters/emotion-prompts", "")
	if rec.Code != http.StatusOK || !bytes.Contains(rec.Body.Bytes(), []byte(`"title":"a"`)) {
		t.Fatalf("get after put: %d %s", rec.Code, rec.Body.String())
	}
}
