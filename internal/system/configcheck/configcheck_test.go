package configcheck

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"alslime/internal/storage/locations"
	"alslime/internal/storage/paths"
	"alslime/internal/system/diagnostics"
)

func newChecker(t *testing.T) (*Checker, string) {
	t.Helper()
	root := t.TempDir()
	real, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	return New(paths.NewResolver(real)), real
}

// writeFile は root 相対パスへファイルを書く（親作成）。
func writeFile(t *testing.T, root, rel, content string) {
	t.Helper()
	full := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

// findByLocation は locationName 一致の最初の結果を返す。
func findByLocation(files []FileResult, name string) (FileResult, bool) {
	for _, f := range files {
		if f.LocationID == name {
			return f, true
		}
	}
	return FileResult{}, false
}

func TestScan_全未存在は基本ok(t *testing.T) {
	c, _ := newChecker(t)
	r, err := c.Scan()
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	// 未存在の任意ファイルは error にしない → 全体 ok（workspace 書込も ok のはず）。
	if r.Status != diagnostics.CheckOK {
		t.Fatalf("未存在ばかりなら全体 ok のはず: %#v", r)
	}
	// 単一 JSON 項目は missingOptional になる。
	g, ok := findByLocation(r.Files, "GlobalSettingsFile")
	if !ok || g.Status != diagnostics.CheckOK || g.MessageKey != msgMissingOptional {
		t.Fatalf("未存在の単一JSONは ok/missingOptional のはず: %#v", g)
	}
}

func TestScan_正常JSONはok(t *testing.T) {
	c, root := newChecker(t)
	loc := locations.NewResolver()
	gp, _ := loc.Path(locations.GlobalSettingsFile)
	writeFile(t, root, gp, `{"a":1}`)

	r, _ := c.Scan()
	g, ok := findByLocation(r.Files, "GlobalSettingsFile")
	if !ok || g.Status != diagnostics.CheckOK || g.MessageKey != msgOK {
		t.Fatalf("正常JSONは ok のはず: %#v", g)
	}
}

func TestScan_破損JSONはerror(t *testing.T) {
	c, root := newChecker(t)
	loc := locations.NewResolver()
	rp, _ := loc.Path(locations.ReplacementConfigFile)
	writeFile(t, root, rp, `{ broken json `)

	r, _ := c.Scan()
	if r.Status != diagnostics.CheckError {
		t.Fatalf("破損があれば全体 error のはず: %#v", r.Status)
	}
	f, ok := findByLocation(r.Files, "ReplacementConfigFile")
	if !ok || f.Status != diagnostics.CheckError || f.MessageKey != msgInvalidJSON {
		t.Fatalf("破損JSONは error/invalidJson のはず: %#v", f)
	}
}

func TestScan_ディレクトリ列挙(t *testing.T) {
	c, root := newChecker(t)
	loc := locations.NewResolver()
	dir, _ := loc.Path(locations.ParameterSchemaCustomDir)
	writeFile(t, root, dir+"/parameter-schema-a.json", `{"ok":true}`)
	writeFile(t, root, dir+"/parameter-schema-b.json", `{ broken `)

	r, _ := c.Scan()
	// 列挙された 2 件のうち 1 件が error。
	var okCount, errCount int
	for _, f := range r.Files {
		if f.LocationID != "ParameterSchemaCustomDir" {
			continue
		}
		switch f.Status {
		case diagnostics.CheckOK:
			okCount++
		case diagnostics.CheckError:
			errCount++
		}
	}
	if okCount != 1 || errCount != 1 {
		t.Fatalf("列挙検査想定外: ok=%d err=%d", okCount, errCount)
	}
}

func TestScan_新規対象も検査される(t *testing.T) {
	c, root := newChecker(t)
	loc := locations.NewResolver()

	// ConfigEditor _defaults.json を正常 JSON で置く → ok。
	cd, _ := loc.Path(locations.ConfigEditorDefaultsFile)
	writeFile(t, root, cd, `{"worldview":"ファンタジー"}`)
	// parameter schema default を破損で置く → error。
	pd, _ := loc.Path(locations.ParameterSchemaDefaultFile)
	writeFile(t, root, pd, `{ broken`)
	// i18n 辞書ディレクトリを正常 JSON で置く → ok。
	i18nDir, _ := loc.Path(locations.I18NDir)
	writeFile(t, root, i18nDir+"/ja.json", `{"app.save":"保存"}`)

	r, _ := c.Scan()

	cdRes, ok := findByLocation(r.Files, "ConfigEditorDefaultsFile")
	if !ok || cdRes.Status != diagnostics.CheckOK || cdRes.MessageKey != msgOK {
		t.Fatalf("_defaults.json 正常は ok のはず: %#v", cdRes)
	}
	pdRes, ok := findByLocation(r.Files, "ParameterSchemaDefaultFile")
	if !ok || pdRes.Status != diagnostics.CheckError || pdRes.MessageKey != msgInvalidJSON {
		t.Fatalf("parameter schema default 破損は error のはず: %#v", pdRes)
	}
	i18nRes, ok := findByLocation(r.Files, "I18NDir")
	if !ok || i18nRes.Status != diagnostics.CheckOK || i18nRes.MessageKey != msgOK {
		t.Fatalf("i18n 辞書正常は ok のはず: %#v", i18nRes)
	}
}

func TestScan_workspace書込チェック(t *testing.T) {
	c, _ := newChecker(t)
	r, _ := c.Scan()
	f, ok := findByLocation(r.Files, "WorkspaceRoot")
	if !ok || f.Status != diagnostics.CheckOK || f.MessageKey != msgWorkspaceWritable {
		t.Fatalf("WORKSPACE 書込は ok のはず: %#v", f)
	}
}

func TestScan_破損テンプレ検出(t *testing.T) {
	c, root := newChecker(t)
	// 旧 Node 版の破損 TEMPLATE_ROOT を作る。
	broken := filepath.Join(root, filepath.FromSlash(legacyBrokenTemplateRel()))
	if err := os.MkdirAll(broken, 0o755); err != nil {
		t.Fatal(err)
	}
	r, _ := c.Scan()
	f, ok := findByLocation(r.Files, "LegacyBrokenTemplateDir")
	if !ok || f.Status != diagnostics.CheckWarning || f.MessageKey != msgLegacyBrokenTplDir {
		t.Fatalf("破損テンプレは warning のはず: %#v", f)
	}
}

func TestScan_破損テンプレ無しは項目を出さない(t *testing.T) {
	c, _ := newChecker(t)
	r, _ := c.Scan()
	if _, ok := findByLocation(r.Files, "LegacyBrokenTemplateDir"); ok {
		t.Fatalf("破損テンプレが無ければ項目を出さないはず")
	}
}

func TestScan_絶対パスを出さない(t *testing.T) {
	c, root := newChecker(t)
	r, _ := c.Scan()
	for _, f := range r.Files {
		// path は相対のみ。WORKSPACE_ROOT 絶対パスを含んではならない。
		if strings.Contains(f.Path, root) {
			t.Fatalf("絶対パスが漏れている: %q", f.Path)
		}
	}
}

func TestLatest_未スキャンなら一度スキャン(t *testing.T) {
	c, _ := newChecker(t)
	r, err := c.Latest()
	if err != nil {
		t.Fatalf("Latest: %v", err)
	}
	if len(r.Files) == 0 {
		t.Fatalf("Latest は未スキャンでもスキャンして結果を返すべき")
	}
}
