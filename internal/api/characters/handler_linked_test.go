package characters

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"alslime/internal/config"
	charsvc "alslime/internal/domain/characters"
	storage "alslime/internal/storage/charfilters"
	"alslime/internal/storage/paths"
)

func newLinkedTestMux(t *testing.T) (*http.ServeMux, string) {
	t.Helper()
	root := t.TempDir()
	resolver := paths.NewResolver(root)
	mux := http.NewServeMux()
	Register(mux, charsvc.New(storage.New(resolver, config.CharacterListDir, config.CharacterFiltersFile)))
	RegisterLinkedSettings(mux, charsvc.NewLinkedSettingsService(resolver))
	return mux, root
}

func doJSON(mux *http.ServeMux, method, target, body string) *httptest.ResponseRecorder {
	var reader *bytes.Buffer
	if body != "" {
		reader = bytes.NewBufferString(body)
	} else {
		reader = &bytes.Buffer{}
	}
	req := httptest.NewRequest(method, target, reader)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func TestLinkedSettingsRoutes(t *testing.T) {
	mux, root := newLinkedTestMux(t)

	// 未存在キャラの GET は既定値 200。
	rec := doJSON(mux, http.MethodGet, "/api/characters/Alice/linked-settings", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("get default: %d %s", rec.Code, rec.Body.String())
	}
	// 未存在キャラへの PUT は 404。
	rec = doJSON(mux, http.MethodPut, "/api/characters/Alice/linked-settings", `{"version":1}`)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("put missing: %d %s", rec.Code, rec.Body.String())
	}
	// 不正 JSON は 400。
	if err := os.MkdirAll(filepath.Join(root, "roleplay", "characters", "Alice", "settings"), 0o755); err != nil {
		t.Fatal(err)
	}
	rec = doJSON(mux, http.MethodPut, "/api/characters/Alice/linked-settings", `{broken`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("put broken: %d", rec.Code)
	}
	// 正常保存 → 正規化後の値が返る → GET で同じ値。
	rec = doJSON(mux, http.MethodPut, "/api/characters/Alice/linked-settings",
		`{"personalities":{"files":["roleplay/global/personalities/a.md"],"additional":{"mode":"replace","text":"t"}}}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("put ok: %d %s", rec.Code, rec.Body.String())
	}
	var res struct {
		Success bool                   `json:"success"`
		Data    charsvc.LinkedSettings `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil || !res.Success {
		t.Fatalf("decode: %v %s", err, rec.Body.String())
	}
	if res.Data.Version != 1 || res.Data.Personalities.Additional.Mode != "replace" || len(res.Data.Personalities.Files) != 1 {
		t.Fatalf("unexpected data: %+v", res.Data)
	}
	rec = doJSON(mux, http.MethodGet, "/api/characters/Alice/linked-settings", "")
	if rec.Code != http.StatusOK || !bytes.Contains(rec.Body.Bytes(), []byte(`"text":"t"`)) {
		t.Fatalf("get after put: %d %s", rec.Code, rec.Body.String())
	}
}

func TestSaveTagsRoute(t *testing.T) {
	mux, root := newLinkedTestMux(t)

	rec := doJSON(mux, http.MethodPut, "/api/character-tags/Alice", `{"work":"W","tags":["a"]}`)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("missing dir: %d %s", rec.Code, rec.Body.String())
	}
	settings := filepath.Join(root, "roleplay", "characters", "Alice", "settings")
	if err := os.MkdirAll(settings, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(settings, "Alice.md"), []byte("# Alice"), 0o644); err != nil {
		t.Fatal(err)
	}
	rec = doJSON(mux, http.MethodPut, "/api/character-tags/Alice", `{"work":"W","tags":["a","b"]}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("save: %d %s", rec.Code, rec.Body.String())
	}
	var res saveTagsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if res.Work == nil || *res.Work != "W" || len(res.Tags) != 2 {
		t.Fatalf("unexpected: %+v", res)
	}
	// 再構築されたマスタに反映されている。
	rec = doJSON(mux, http.MethodGet, "/api/character-filters", "")
	if rec.Code != http.StatusOK || !bytes.Contains(rec.Body.Bytes(), []byte(`"W"`)) {
		t.Fatalf("filters: %d %s", rec.Code, rec.Body.String())
	}
	// 一覧にも反映されている。
	rec = doJSON(mux, http.MethodGet, "/api/character-tags", "")
	if !bytes.Contains(rec.Body.Bytes(), []byte(`"work":"W"`)) || !bytes.Contains(rec.Body.Bytes(), []byte(`"iconUrl":null`)) {
		t.Fatalf("tags: %s", rec.Body.String())
	}
	// 不正名は 400。
	rec = doJSON(mux, http.MethodPut, "/api/character-tags/a..b", `{"tags":[]}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("bad name: %d", rec.Code)
	}
}
