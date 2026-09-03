package firstrun

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// writeRel は base 配下へ "/" 区切りの相対パスでファイルを書くテスト用ヘルパー。
func writeRel(t *testing.T, base, rel, content string) {
	t.Helper()
	abs := filepath.Join(base, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		t.Fatalf("前提ディレクトリ作成 %s: %v", rel, err)
	}
	if err := os.WriteFile(abs, []byte(content), 0o644); err != nil {
		t.Fatalf("前提ファイル作成 %s: %v", rel, err)
	}
}

// readRel は base 配下の相対パスを読むテスト用ヘルパー（無ければ ok=false）。
func readRel(t *testing.T, base, rel string) (string, bool) {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(base, filepath.FromSlash(rel)))
	if os.IsNotExist(err) {
		return "", false
	}
	if err != nil {
		t.Fatalf("読み戻し %s: %v", rel, err)
	}
	return string(data), true
}

func configGenBase(root string) string {
	return filepath.Join(root, "roleplay", "global", "prompts", "configgen")
}

func TestMigrateConfigGenLayout_旧構成を新構成へ転置(t *testing.T) {
	root := t.TempDir()
	base := configGenBase(root)
	writeRel(t, base, "character/ja/search_templates/標準.md", "入力ja")
	writeRel(t, base, "character/ja/setting_templates/自作.md", "設定ja")
	writeRel(t, base, "character/en/search_templates/standard.md", "入力en")
	writeRel(t, base, "character/one_shot.ja.md", "一括ja")
	writeRel(t, base, "character/two_step_1.en.md", "調査en")
	writeRel(t, base, "situation/dialog.en.md", "対話en")
	writeRel(t, base, "situation/search_template.ja.md", "固定ja")
	writeRel(t, base, "_defaults.json", `{"character":{"ja":{"search":"標準","setting":"自作"},"en":{"search":"standard"}}}`)

	if err := MigrateConfigGenLayout(root); err != nil {
		t.Fatalf("MigrateConfigGenLayout: %v", err)
	}

	wants := map[string]string{
		"ja/character/search_templates/標準.md":       "入力ja",
		"ja/character/setting_templates/自作.md":      "設定ja",
		"en/character/search_templates/standard.md": "入力en",
		"ja/character/one_shot.md":                  "一括ja",
		"en/character/two_step_1.md":                "調査en",
		"en/situation/dialog.md":                    "対話en",
		"ja/situation/search_template.md":           "固定ja",
	}
	for rel, want := range wants {
		got, ok := readRel(t, base, rel)
		if !ok || got != want {
			t.Errorf("新位置 %s: got=%q ok=%v want=%q", rel, got, ok, want)
		}
	}
	for _, old := range []string{"character", "situation"} {
		if _, err := os.Stat(filepath.Join(base, old)); !os.IsNotExist(err) {
			t.Errorf("旧ディレクトリ %s が残っている: %v", old, err)
		}
	}

	raw, ok := readRel(t, base, "_defaults.json")
	if !ok {
		t.Fatalf("_defaults.json が無い")
	}
	var defaults map[string]map[string]map[string]string
	if err := json.Unmarshal([]byte(raw), &defaults); err != nil {
		t.Fatalf("_defaults.json 解析: %v (%s)", err, raw)
	}
	if defaults["ja"]["character"]["search"] != "標準" ||
		defaults["ja"]["character"]["setting"] != "自作" ||
		defaults["en"]["character"]["search"] != "standard" {
		t.Errorf("_defaults.json の転置が不正: %s", raw)
	}
}

func TestMigrateConfigGenLayout_移動先に既存があれば旧を残す(t *testing.T) {
	root := t.TempDir()
	base := configGenBase(root)
	writeRel(t, base, "character/ja/search_templates/標準.md", "旧内容")
	writeRel(t, base, "ja/character/search_templates/標準.md", "新内容")

	if err := MigrateConfigGenLayout(root); err != nil {
		t.Fatalf("MigrateConfigGenLayout: %v", err)
	}

	if got, ok := readRel(t, base, "ja/character/search_templates/標準.md"); !ok || got != "新内容" {
		t.Errorf("新位置が上書きされた: got=%q ok=%v", got, ok)
	}
	if got, ok := readRel(t, base, "character/ja/search_templates/標準.md"); !ok || got != "旧内容" {
		t.Errorf("旧位置のファイルが消えた: got=%q ok=%v", got, ok)
	}
}

func TestMigrateConfigGenLayout_未知のファイルは触らない(t *testing.T) {
	root := t.TempDir()
	base := configGenBase(root)
	writeRel(t, base, "character/ja/search_templates/標準.md", "移す")
	writeRel(t, base, "character/メモ.md", "利用者の無関係ファイル")
	writeRel(t, base, "character/fr/search_templates/libre.md", "未知ロケール")
	writeRel(t, base, "custom_target/one_shot.ja.md", "未知対象")

	if err := MigrateConfigGenLayout(root); err != nil {
		t.Fatalf("MigrateConfigGenLayout: %v", err)
	}

	for _, rel := range []string{
		"character/メモ.md",
		"character/fr/search_templates/libre.md",
		"custom_target/one_shot.ja.md",
	} {
		if _, ok := readRel(t, base, rel); !ok {
			t.Errorf("未知ファイル %s が移動または削除された", rel)
		}
	}
	if _, ok := readRel(t, base, "ja/character/search_templates/標準.md"); !ok {
		t.Errorf("既知ファイルは移動されるはず")
	}
}

func TestMigrateConfigGenLayout_冪等(t *testing.T) {
	root := t.TempDir()
	base := configGenBase(root)
	writeRel(t, base, "character/ja/search_templates/標準.md", "内容")
	writeRel(t, base, "_defaults.json", `{"character":{"ja":{"search":"標準"}}}`)

	if err := MigrateConfigGenLayout(root); err != nil {
		t.Fatalf("1回目: %v", err)
	}
	first, _ := readRel(t, base, "_defaults.json")
	if err := MigrateConfigGenLayout(root); err != nil {
		t.Fatalf("2回目: %v", err)
	}
	second, _ := readRel(t, base, "_defaults.json")
	if first != second {
		t.Errorf("2回目の実行で _defaults.json が変わった:\n1回目=%s\n2回目=%s", first, second)
	}
	if got, ok := readRel(t, base, "ja/character/search_templates/標準.md"); !ok || got != "内容" {
		t.Errorf("2回目の実行後に内容が変わった: got=%q ok=%v", got, ok)
	}
}

func TestEnsure_旧構成があれば移行してから同梱を書き出す(t *testing.T) {
	root := t.TempDir()
	base := configGenBase(root)
	writeRel(t, base, "character/one_shot.ja.md", "利用者編集済み")

	if err := Ensure(root); err != nil {
		t.Fatalf("Ensure: %v", err)
	}

	if got, ok := readRel(t, base, "ja/character/one_shot.md"); !ok || got != "利用者編集済み" {
		t.Errorf("移行後の内容が同梱で上書きされた: got=%q ok=%v", got, ok)
	}
	if _, err := os.Stat(filepath.Join(base, "character")); !os.IsNotExist(err) {
		t.Errorf("旧ディレクトリが残っている（旧位置へ同梱が書かれた可能性）: %v", err)
	}
}
