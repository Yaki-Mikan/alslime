package settingspack

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"alslime/internal/config"
	domain "alslime/internal/domain/settingspack"
	"alslime/internal/storage/paths"
)

// newTestManager は一時 WORKSPACE_ROOT に束縛された Manager を返す。
func newTestManager(t *testing.T) (*Manager, string) {
	t.Helper()
	root := t.TempDir()
	real, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatalf("EvalSymlinks 失敗: %v", err)
	}
	return New(paths.NewResolver(real)), real
}

// writeZip はテスト用パック zip を作る。entries は「zip 内パス → 内容」。
func writeZip(t *testing.T, dir string, entries map[string]string) string {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, body := range entries {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatalf("zip Create 失敗: %v", err)
		}
		if _, err := w.Write([]byte(body)); err != nil {
			t.Fatalf("zip Write 失敗: %v", err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("zip Close 失敗: %v", err)
	}
	path := filepath.Join(dir, "pack.zip")
	if err := os.WriteFile(path, buf.Bytes(), 0o644); err != nil {
		t.Fatalf("zip 書き出し失敗: %v", err)
	}
	return path
}

// writeWorkspaceFile は WORKSPACE_ROOT 配下へ既存ファイルを用意する。
func writeWorkspaceFile(t *testing.T, root, rel, body string) {
	t.Helper()
	abs := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		t.Fatalf("MkdirAll 失敗: %v", err)
	}
	if err := os.WriteFile(abs, []byte(body), 0o644); err != nil {
		t.Fatalf("WriteFile 失敗: %v", err)
	}
}

func readWorkspaceFile(t *testing.T, root, rel string) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(rel)))
	if err != nil {
		t.Fatalf("ReadFile(%s) 失敗: %v", rel, err)
	}
	return string(data)
}

func TestInspect_正準形式とマニフェスト(t *testing.T) {
	m, dir := newTestManager(t)
	pack := writeZip(t, t.TempDir(), map[string]string{
		config.SettingsPackManifestFileName: `{"packFormat":1,"name":"テストパック"}`,
		"roleplay/global/situations/カフェ.md": "内容",
		"roleplay/auth/gemini/creds.json":   "{}",
		config.ServerSettingsFile:           "{}",
	})
	_ = dir

	plan, err := m.Inspect(pack, false)
	if err != nil {
		t.Fatalf("Inspect 失敗: %v", err)
	}
	if plan.Manifest == nil || plan.Manifest.Name != "テストパック" {
		t.Fatalf("マニフェストが読めていない: %+v", plan.Manifest)
	}
	if !plan.Blocked || plan.BlockedKey != domain.BlockedAuth {
		t.Fatalf("auth 入りパックはブロックされるべき: %+v", plan)
	}
}

func TestInspect_ゆるい形式のエイリアス解決(t *testing.T) {
	m, _ := newTestManager(t)
	pack := writeZip(t, t.TempDir(), map[string]string{
		"シチュエーション/学校.md":             "内容",
		"キャラクター/明乃/settings/base.md": "内容",
		"謎ディレクトリ/謎.md":               "内容",
	})

	plan, err := m.Inspect(pack, false)
	if err != nil {
		t.Fatalf("Inspect 失敗: %v", err)
	}
	got := map[string]domain.Action{}
	for _, e := range plan.Entries {
		got[e.Path] = e.Action
	}
	if got["roleplay/global/situations/学校.md"] != domain.ActionNew {
		t.Fatalf("シチュエーションのエイリアス解決に失敗: %+v", got)
	}
	if got["roleplay/characters/明乃/settings/base.md"] != domain.ActionNew {
		t.Fatalf("キャラクターのエイリアス解決に失敗: %+v", got)
	}
	if got["謎ディレクトリ/謎.md"] != domain.ActionSkip {
		t.Fatalf("未認識ディレクトリはスキップされるべき: %+v", got)
	}
}

func TestInspect_脱出パスは無効エントリ(t *testing.T) {
	m, _ := newTestManager(t)
	pack := writeZip(t, t.TempDir(), map[string]string{
		"../escape.md":              "evil",
		"roleplay/../../escape2.md": "evil",
	})

	plan, err := m.Inspect(pack, false)
	if err != nil {
		t.Fatalf("Inspect 失敗: %v", err)
	}
	for _, e := range plan.Entries {
		if e.Action != domain.ActionSkip || e.ReasonKey != domain.ReasonInvalidPath {
			t.Fatalf("脱出パスは invalidPath スキップになるべき: %+v", e)
		}
	}
}

func TestImport_新規と衝突ポリシー(t *testing.T) {
	m, root := newTestManager(t)
	writeWorkspaceFile(t, root, "roleplay/global/situations/既存.md", "古い内容")

	packDir := t.TempDir()
	pack := writeZip(t, packDir, map[string]string{
		"roleplay/global/situations/新規.md": "新規内容",
		"roleplay/global/situations/既存.md": "パック内容",
	})

	// 既定（skip）: 既存は残る。
	result, err := m.Import(pack, ImportOptions{Policy: PolicySkip})
	if err != nil {
		t.Fatalf("Import 失敗: %v", err)
	}
	if len(result.Written) != 1 || result.Written[0].Path != "roleplay/global/situations/新規.md" {
		t.Fatalf("新規のみ書かれるべき: %+v", result.Written)
	}
	if got := readWorkspaceFile(t, root, "roleplay/global/situations/既存.md"); got != "古い内容" {
		t.Fatalf("skip なのに上書きされた: %q", got)
	}
	if got := readWorkspaceFile(t, root, "roleplay/global/situations/新規.md"); got != "新規内容" {
		t.Fatalf("新規の内容が不正: %q", got)
	}

	// overwrite: 既存が置き換わる。
	if _, err := m.Import(pack, ImportOptions{Policy: PolicyOverwrite}); err != nil {
		t.Fatalf("Import(overwrite) 失敗: %v", err)
	}
	if got := readWorkspaceFile(t, root, "roleplay/global/situations/既存.md"); got != "パック内容" {
		t.Fatalf("overwrite が効いていない: %q", got)
	}
}

func TestImport_リネームポリシー(t *testing.T) {
	m, root := newTestManager(t)
	writeWorkspaceFile(t, root, "roleplay/global/situations/既存.md", "古い内容")

	pack := writeZip(t, t.TempDir(), map[string]string{
		"roleplay/global/situations/既存.md": "パック内容",
	})
	result, err := m.Import(pack, ImportOptions{Policy: PolicyRename})
	if err != nil {
		t.Fatalf("Import(rename) 失敗: %v", err)
	}
	if len(result.Written) != 1 || result.Written[0].WrittenAs != "roleplay/global/situations/既存 (2).md" {
		t.Fatalf("リネーム先が不正: %+v", result.Written)
	}
	if got := readWorkspaceFile(t, root, "roleplay/global/situations/既存 (2).md"); got != "パック内容" {
		t.Fatalf("リネーム書き込み内容が不正: %q", got)
	}
	if got := readWorkspaceFile(t, root, "roleplay/global/situations/既存.md"); got != "古い内容" {
		t.Fatalf("rename なのに元が変わった: %q", got)
	}
}

func TestImport_個別ポリシー上書き(t *testing.T) {
	m, root := newTestManager(t)
	writeWorkspaceFile(t, root, "roleplay/global/situations/A.md", "古いA")
	writeWorkspaceFile(t, root, "roleplay/global/situations/B.md", "古いB")

	pack := writeZip(t, t.TempDir(), map[string]string{
		"roleplay/global/situations/A.md": "新しいA",
		"roleplay/global/situations/B.md": "新しいB",
	})
	result, err := m.Import(pack, ImportOptions{
		Policy:    PolicySkip,
		Overrides: map[string]ImportPolicy{"roleplay/global/situations/B.md": PolicyOverwrite},
	})
	if err != nil {
		t.Fatalf("Import 失敗: %v", err)
	}
	if got := readWorkspaceFile(t, root, "roleplay/global/situations/A.md"); got != "古いA" {
		t.Fatalf("A は skip されるべき: %q", got)
	}
	if got := readWorkspaceFile(t, root, "roleplay/global/situations/B.md"); got != "新しいB" {
		t.Fatalf("B は個別 overwrite されるべき: %q", got)
	}
	if len(result.Skipped) != 1 || result.Skipped[0].Path != "roleplay/global/situations/A.md" {
		t.Fatalf("Skipped が不正: %+v", result.Skipped)
	}
}

func TestImport_認証入りパックは一切書かない(t *testing.T) {
	m, root := newTestManager(t)
	pack := writeZip(t, t.TempDir(), map[string]string{
		"roleplay/global/situations/ok.md": "内容",
		"roleplay/auth/token":              "secret",
	})
	if _, err := m.Import(pack, ImportOptions{Policy: PolicySkip}); err == nil {
		t.Fatal("auth 入りパックはエラーになるべき")
	}
	if _, err := os.Stat(filepath.Join(root, "roleplay", "global", "situations", "ok.md")); !os.IsNotExist(err) {
		t.Fatal("ブロック時は一切書き込まれないべき")
	}
	if _, err := os.Stat(filepath.Join(root, "roleplay", "auth", "token")); !os.IsNotExist(err) {
		t.Fatal("auth 配下が書かれている")
	}
}

func TestImport_tier外のD分類はスキップ(t *testing.T) {
	m, root := newTestManager(t)
	pack := writeZip(t, t.TempDir(), map[string]string{
		config.ComfyUIProfileDir + "/p.json": "{}",
	})
	result, err := m.Import(pack, ImportOptions{Policy: PolicySkip, ImageGenAllowed: false})
	if err != nil {
		t.Fatalf("Import 失敗: %v", err)
	}
	if len(result.Written) != 0 || len(result.Skipped) != 1 || result.Skipped[0].ReasonKey != domain.ReasonTier {
		t.Fatalf("tier 外 D 分類はスキップされるべき: %+v", result)
	}
	if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(config.ComfyUIProfileDir), "p.json")); !os.IsNotExist(err) {
		t.Fatal("tier 外なのに書き込まれた")
	}

	// tier 許可なら書き込まれる。
	result, err = m.Import(pack, ImportOptions{Policy: PolicySkip, ImageGenAllowed: true})
	if err != nil {
		t.Fatalf("Import(許可) 失敗: %v", err)
	}
	if len(result.Written) != 1 {
		t.Fatalf("tier 許可時は書かれるべき: %+v", result)
	}
}

func TestExport_選択種別と除外(t *testing.T) {
	m, root := newTestManager(t)
	writeWorkspaceFile(t, root, "roleplay/global/situations/カフェ.md", "内容")
	writeWorkspaceFile(t, root, "roleplay/global/worldviews/世界.md", "内容")
	writeWorkspaceFile(t, root, "roleplay/characters/雪/settings/base.md", "内容")
	writeWorkspaceFile(t, root, "roleplay/characters/雪/internal/image_hashes.json", "{}")
	writeWorkspaceFile(t, root, "roleplay/characters/雪/images/originals/a.png", "png")

	var buf bytes.Buffer
	summary, err := m.Export(&buf, ExportSelection{
		KindIDs: []string{"situation", "character"},
		Name:    "テスト",
	}, false)
	if err != nil {
		t.Fatalf("Export 失敗: %v", err)
	}

	zr, err := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err != nil {
		t.Fatalf("zip 読み戻し失敗: %v", err)
	}
	names := map[string]bool{}
	for _, f := range zr.File {
		names[f.Name] = true
	}
	if !names[config.SettingsPackManifestFileName] {
		t.Fatal("マニフェストが無い")
	}
	if !names["roleplay/global/situations/カフェ.md"] || !names["roleplay/characters/雪/settings/base.md"] {
		t.Fatalf("選択種別のファイルが無い: %v", names)
	}
	if names["roleplay/global/worldviews/世界.md"] {
		t.Fatal("未選択種別が混入")
	}
	if names["roleplay/characters/雪/internal/image_hashes.json"] {
		t.Fatal("キャラ internal が混入")
	}
	if names["roleplay/characters/雪/images/originals/a.png"] {
		t.Fatal("images は既定 OFF なのに混入")
	}
	if summary.FileCount != 2 {
		t.Fatalf("FileCount: got=%d want=2", summary.FileCount)
	}
}

func TestExport_画像込みと認証除外(t *testing.T) {
	m, root := newTestManager(t)
	writeWorkspaceFile(t, root, "roleplay/characters/雪/settings/base.md", "内容")
	writeWorkspaceFile(t, root, "roleplay/characters/雪/images/originals/a.png", "png")
	// AuthDir はキャラ root 外だが、防御の確認として置いておく。
	writeWorkspaceFile(t, root, config.AuthDir+"/token", "secret")

	var buf bytes.Buffer
	if _, err := m.Export(&buf, ExportSelection{
		KindIDs:                []string{"character"},
		IncludeCharacterImages: true,
	}, false); err != nil {
		t.Fatalf("Export 失敗: %v", err)
	}
	zr, err := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err != nil {
		t.Fatalf("zip 読み戻し失敗: %v", err)
	}
	var hasImage, hasAuth bool
	for _, f := range zr.File {
		if f.Name == "roleplay/characters/雪/images/originals/a.png" {
			hasImage = true
		}
		if strings.Contains(f.Name, "auth") {
			hasAuth = true
		}
	}
	if !hasImage {
		t.Fatal("IncludeCharacterImages=true なのに画像が無い")
	}
	if hasAuth {
		t.Fatal("認証ファイルが混入")
	}
}

func TestExport_tier外のD分類はエラー(t *testing.T) {
	m, _ := newTestManager(t)
	var buf bytes.Buffer
	if _, err := m.Export(&buf, ExportSelection{KindIDs: []string{"comfyProfiles"}}, false); err == nil {
		t.Fatal("tier 外の D 分類エクスポートはエラーになるべき")
	}
	if _, err := m.Export(&buf, ExportSelection{KindIDs: []string{"unknown-kind"}}, false); err == nil {
		t.Fatal("未知の種別はエラーになるべき")
	}
}

func TestExport_インポートとの往復(t *testing.T) {
	// エクスポート → 別ワークスペースへインポートで内容が再現されること。
	src, srcRoot := newTestManager(t)
	writeWorkspaceFile(t, srcRoot, "roleplay/global/situations/カフェ.md", "往復内容")

	var buf bytes.Buffer
	if _, err := src.Export(&buf, ExportSelection{KindIDs: []string{"situation"}}, false); err != nil {
		t.Fatalf("Export 失敗: %v", err)
	}
	packPath := filepath.Join(t.TempDir(), "roundtrip.zip")
	if err := os.WriteFile(packPath, buf.Bytes(), 0o644); err != nil {
		t.Fatalf("zip 保存失敗: %v", err)
	}

	dst, dstRoot := newTestManager(t)
	plan, err := dst.Inspect(packPath, false)
	if err != nil {
		t.Fatalf("Inspect 失敗: %v", err)
	}
	if plan.Manifest == nil || plan.Manifest.PackFormat != config.SettingsPackFormat {
		t.Fatalf("往復マニフェストが不正: %+v", plan.Manifest)
	}
	if _, err := dst.Import(packPath, ImportOptions{Policy: PolicySkip}); err != nil {
		t.Fatalf("Import 失敗: %v", err)
	}
	if got := readWorkspaceFile(t, dstRoot, "roleplay/global/situations/カフェ.md"); got != "往復内容" {
		t.Fatalf("往復で内容が再現されない: %q", got)
	}
}
