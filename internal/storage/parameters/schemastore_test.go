package parameters

import (
	"os"
	"path/filepath"
	"testing"

	"alslime/internal/config"
	"alslime/internal/storage/paths"
)

const (
	testDefaultDir = "roleplay/global/settings"
	testCustomDir  = "roleplay/global/parameter_schemas"
)

func newSchemaStore(t *testing.T) (*SchemaStore, string) {
	t.Helper()
	root := t.TempDir()
	resolver := paths.NewResolver(root)
	return NewSchemaStore(resolver, testDefaultDir, testCustomDir), root
}

func schemaJSON(id string) map[string]any {
	return map[string]any{
		"schemaId":   id,
		"schemaName": map[string]any{"ja": "名前"},
		"groups":     []any{},
	}
}

// custom 側に schemaId: "default" のファイルが手で置かれていても、
// 一覧では default ディレクトリの正規 default を優先し、重複は出さない
// （現行の重複スキップ挙動。交換日記17 の指摘）。
func TestList_custom側のdefault重複はスキップ(t *testing.T) {
	s, root := newSchemaStore(t)

	// 正規の default を default ディレクトリへ保存。
	if err := s.Save("default", schemaJSON("default")); err != nil {
		t.Fatalf("default 保存失敗: %v", err)
	}
	// custom ディレクトリに schemaId: default のファイルを手で置く。
	customDirAbs := filepath.Join(root, filepath.FromSlash(testCustomDir))
	if err := os.MkdirAll(customDirAbs, config.DirPerm); err != nil {
		t.Fatalf("custom dir 作成失敗: %v", err)
	}
	bad := filepath.Join(customDirAbs, "parameter-schema-default.json")
	if err := os.WriteFile(bad, []byte(`{"schemaId":"default","schemaName":{"ja":"偽"},"groups":[]}`), 0o644); err != nil {
		t.Fatalf("偽 default 作成失敗: %v", err)
	}

	items, err := s.List()
	if err != nil {
		t.Fatalf("一覧失敗: %v", err)
	}
	// default は 1 件だけ。
	count := 0
	for _, it := range items {
		if it.ID == "default" {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("default は 1 件のみであるべき: items=%#v", items)
	}
}

func TestSave_defaultは固定ファイル名_customはid由来(t *testing.T) {
	s, root := newSchemaStore(t)

	if err := s.Save("default", schemaJSON("default")); err != nil {
		t.Fatalf("default 保存失敗: %v", err)
	}
	if err := s.Save("mycustom", schemaJSON("mycustom")); err != nil {
		t.Fatalf("custom 保存失敗: %v", err)
	}

	// default はsettings/parameter-schema-default.json。
	defaultFile := filepath.Join(root, filepath.FromSlash(testDefaultDir), "parameter-schema-default.json")
	if _, err := os.Stat(defaultFile); err != nil {
		t.Fatalf("default ファイルが想定位置に無い: %v", err)
	}
	// custom は parameter_schemas/parameter-schema-mycustom.json。
	customFile := filepath.Join(root, filepath.FromSlash(testCustomDir), "parameter-schema-mycustom.json")
	if _, err := os.Stat(customFile); err != nil {
		t.Fatalf("custom ファイルが想定位置に無い: %v", err)
	}
}

func TestSave_4スペースインデント(t *testing.T) {
	s, root := newSchemaStore(t)
	if err := s.Save("mycustom", schemaJSON("mycustom")); err != nil {
		t.Fatalf("保存失敗: %v", err)
	}
	customFile := filepath.Join(root, filepath.FromSlash(testCustomDir), "parameter-schema-mycustom.json")
	data, err := os.ReadFile(customFile)
	if err != nil {
		t.Fatalf("読み込み失敗: %v", err)
	}
	// 2 レベル目の "schemaId" 行が 4 スペースで始まること（現行互換）。
	if !containsLine(string(data), "    \"schemaId\": \"mycustom\",") {
		t.Fatalf("4 スペースインデントになっていない:\n%s", data)
	}
}

// containsLine は s に line で始まる行が含まれるかを返す。
func containsLine(s, line string) bool {
	for _, l := range splitLines(s) {
		if l == line {
			return true
		}
	}
	return false
}

func splitLines(s string) []string {
	var out []string
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == '\n' {
			line := s[start:i]
			if len(line) > 0 && line[len(line)-1] == '\r' {
				line = line[:len(line)-1]
			}
			out = append(out, line)
			start = i + 1
		}
	}
	out = append(out, s[start:])
	return out
}
