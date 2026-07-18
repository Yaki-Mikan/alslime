package settingspack

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"alslime/internal/config"
	"alslime/internal/coreapi"
	domain "alslime/internal/domain/settingspack"
	"alslime/internal/features"
	"alslime/internal/storage/paths"
	syspack "alslime/internal/system/settingspack"
)

// fakeGate はテスト用の FeatureGate（comfyui のみ切替可能）。
type fakeGate struct {
	comfy bool
}

func (g fakeGate) Enabled(feature string) bool {
	return feature == string(features.FeatureComfyUI) && g.comfy
}
func (g fakeGate) PublicSnapshot() map[string]bool { return map[string]bool{} }
func (g fakeGate) Entitlement() coreapi.EntitlementStatus {
	return coreapi.EntitlementStatus{State: coreapi.TokenStateNone}
}

func newTestServer(t *testing.T, gate coreapi.FeatureGate) (*httptest.Server, string) {
	t.Helper()
	root := t.TempDir()
	real, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatalf("EvalSymlinks 失敗: %v", err)
	}
	mux := http.NewServeMux()
	Register(mux, Deps{Manager: syspack.New(paths.NewResolver(real)), Gate: gate})
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return server, real
}

// buildPackBody はテスト用パック zip の multipart ボディを作る。
func buildPackBody(t *testing.T, entries map[string]string, fields map[string]string) (*bytes.Buffer, string) {
	t.Helper()
	var zipBuf bytes.Buffer
	zw := zip.NewWriter(&zipBuf)
	for name, content := range entries {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatalf("zip Create 失敗: %v", err)
		}
		if _, err := w.Write([]byte(content)); err != nil {
			t.Fatalf("zip Write 失敗: %v", err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("zip Close 失敗: %v", err)
	}

	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	part, err := mw.CreateFormFile("pack", "pack.zip")
	if err != nil {
		t.Fatalf("CreateFormFile 失敗: %v", err)
	}
	if _, err := part.Write(zipBuf.Bytes()); err != nil {
		t.Fatalf("part Write 失敗: %v", err)
	}
	for key, value := range fields {
		if err := mw.WriteField(key, value); err != nil {
			t.Fatalf("WriteField 失敗: %v", err)
		}
	}
	if err := mw.Close(); err != nil {
		t.Fatalf("multipart Close 失敗: %v", err)
	}
	return &body, mw.FormDataContentType()
}

func TestHandleCatalog_tierゲート(t *testing.T) {
	// free（gate 無効）: D 分類は返らない。
	server, _ := newTestServer(t, fakeGate{comfy: false})
	resp, err := http.Get(server.URL + config.APIPrefix + "/settings-pack/catalog")
	if err != nil {
		t.Fatalf("GET catalog 失敗: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	var catalog struct {
		Kinds []struct {
			ID    string `json:"id"`
			Class string `json:"class"`
		} `json:"kinds"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&catalog); err != nil {
		t.Fatalf("decode 失敗: %v", err)
	}
	if len(catalog.Kinds) == 0 {
		t.Fatal("カタログが空")
	}
	for _, k := range catalog.Kinds {
		if k.Class == string(domain.ClassImageGen) {
			t.Fatalf("free で D 分類が返っている: %+v", k)
		}
	}

	// supporter（gate 有効）: D 分類が返る。
	server2, _ := newTestServer(t, fakeGate{comfy: true})
	resp2, err := http.Get(server2.URL + config.APIPrefix + "/settings-pack/catalog")
	if err != nil {
		t.Fatalf("GET catalog 失敗: %v", err)
	}
	defer func() { _ = resp2.Body.Close() }()
	var catalog2 struct {
		Kinds []struct {
			Class string `json:"class"`
		} `json:"kinds"`
	}
	if err := json.NewDecoder(resp2.Body).Decode(&catalog2); err != nil {
		t.Fatalf("decode 失敗: %v", err)
	}
	hasD := false
	for _, k := range catalog2.Kinds {
		if k.Class == string(domain.ClassImageGen) {
			hasD = true
		}
	}
	if !hasD {
		t.Fatal("supporter で D 分類が返らない")
	}
}

func TestHandleInspectAndImport_一連の流れ(t *testing.T) {
	server, root := newTestServer(t, fakeGate{comfy: false})

	// inspect: 書き込みなしでプランが返る。
	body, contentType := buildPackBody(t, map[string]string{
		"roleplay/global/situations/カフェ.md": "内容",
	}, nil)
	resp, err := http.Post(server.URL+config.APIPrefix+"/settings-pack/inspect", contentType, body)
	if err != nil {
		t.Fatalf("POST inspect 失敗: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("inspect status: %d", resp.StatusCode)
	}
	var plan domain.Plan
	if err := json.NewDecoder(resp.Body).Decode(&plan); err != nil {
		t.Fatalf("plan decode 失敗: %v", err)
	}
	if len(plan.Entries) != 1 || plan.Entries[0].Action != domain.ActionNew {
		t.Fatalf("プランが不正: %+v", plan.Entries)
	}
	if _, err := os.Stat(filepath.Join(root, "roleplay", "global", "situations", "カフェ.md")); !os.IsNotExist(err) {
		t.Fatal("inspect で書き込まれている")
	}

	// import: 実際に書き込まれる。
	body2, contentType2 := buildPackBody(t, map[string]string{
		"roleplay/global/situations/カフェ.md": "内容",
	}, map[string]string{"policy": "skip"})
	resp2, err := http.Post(server.URL+config.APIPrefix+"/settings-pack/import", contentType2, body2)
	if err != nil {
		t.Fatalf("POST import 失敗: %v", err)
	}
	defer func() { _ = resp2.Body.Close() }()
	if resp2.StatusCode != http.StatusOK {
		t.Fatalf("import status: %d", resp2.StatusCode)
	}
	data, err := os.ReadFile(filepath.Join(root, "roleplay", "global", "situations", "カフェ.md"))
	if err != nil || string(data) != "内容" {
		t.Fatalf("import で書き込まれていない: %v %q", err, data)
	}
}

func TestHandleImport_認証入りは403(t *testing.T) {
	server, _ := newTestServer(t, fakeGate{comfy: false})
	body, contentType := buildPackBody(t, map[string]string{
		"roleplay/auth/token": "secret",
	}, nil)
	resp, err := http.Post(server.URL+config.APIPrefix+"/settings-pack/import", contentType, body)
	if err != nil {
		t.Fatalf("POST import 失敗: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("auth 入りは 403 になるべき: %d", resp.StatusCode)
	}
}

func TestHandleExport_zipが返る(t *testing.T) {
	server, root := newTestServer(t, fakeGate{comfy: false})
	if err := os.MkdirAll(filepath.Join(root, "roleplay", "global", "situations"), 0o755); err != nil {
		t.Fatalf("MkdirAll 失敗: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, "roleplay", "global", "situations", "カフェ.md"), []byte("内容"), 0o644); err != nil {
		t.Fatalf("WriteFile 失敗: %v", err)
	}

	reqBody := strings.NewReader(`{"kinds":["situation"],"name":"テスト"}`)
	resp, err := http.Post(server.URL+config.APIPrefix+"/settings-pack/export", "application/json", reqBody)
	if err != nil {
		t.Fatalf("POST export 失敗: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("export status: %d", resp.StatusCode)
	}
	if got := resp.Header.Get("Content-Type"); got != "application/zip" {
		t.Fatalf("Content-Type: %q", got)
	}
	var buf bytes.Buffer
	if _, err := buf.ReadFrom(resp.Body); err != nil {
		t.Fatalf("body 読み取り失敗: %v", err)
	}
	zr, err := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err != nil {
		t.Fatalf("zip として読めない: %v", err)
	}
	names := map[string]bool{}
	for _, f := range zr.File {
		names[f.Name] = true
	}
	if !names[config.SettingsPackManifestFileName] || !names["roleplay/global/situations/カフェ.md"] {
		t.Fatalf("zip 内容が不正: %v", names)
	}

	// tier 外の D 分類指定は 403。
	resp2, err := http.Post(server.URL+config.APIPrefix+"/settings-pack/export", "application/json",
		strings.NewReader(`{"kinds":["comfyProfiles"]}`))
	if err != nil {
		t.Fatalf("POST export(D) 失敗: %v", err)
	}
	defer func() { _ = resp2.Body.Close() }()
	if resp2.StatusCode != http.StatusForbidden {
		t.Fatalf("tier 外 D 分類は 403 になるべき: %d", resp2.StatusCode)
	}
}
