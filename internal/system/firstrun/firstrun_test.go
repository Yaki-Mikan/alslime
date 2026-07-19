package firstrun

import (
	"os"
	"path/filepath"
	"testing"
)

func TestEnsure_空ワークスペースに一式を生成する(t *testing.T) {
	root := t.TempDir()
	if err := Ensure(root); err != nil {
		t.Fatalf("Ensure: %v", err)
	}

	wantDirs := []string{
		"roleplay/characters",
		"roleplay/users",
		"roleplay/global/defaults",
		"roleplay/global/settings",
		"roleplay/global/situations",
		"roleplay/global/personalities",
		"roleplay/global/outfits_hair",
		"roleplay/global/backgrounds/occupations",
		"roleplay/global/worldviews",
		"roleplay/global/stages",
		"roleplay/global/writing_styles",
		"roleplay/global/templates",
		"roleplay/global/parameter_schemas",
		"roleplay/global/presets/SSRP_Mode/SSRP_All",
		"roleplay/global/presets/Normal_Mode",
		"roleplay/global/ComfyUI/templates",
		"roleplay/import_inbox",
		"roleplay/log",
		"roleplay/history/unified_sessions",
		"roleplay/temp",
		"roleplay/auth",
	}
	for _, dir := range wantDirs {
		info, err := os.Stat(filepath.Join(root, filepath.FromSlash(dir)))
		if err != nil {
			t.Errorf("ディレクトリ %s が生成されていない: %v", dir, err)
			continue
		}
		if !info.IsDir() {
			t.Errorf("%s がディレクトリではない", dir)
		}
	}

	wantFiles := []string{
		"CLAUDE.md",
		"GEMINI.md",
		".agents/rules/AGENTS.md",
		"roleplay/global/ComfyUI/image_gen_directive.md",
		"roleplay/global/ComfyUI/image_gen_directive_natural.md",
		"roleplay/global/writing_styles/一人称視点_標準.md",
	}
	for _, file := range wantFiles {
		info, err := os.Stat(filepath.Join(root, filepath.FromSlash(file)))
		if err != nil {
			t.Errorf("同梱デフォルト %s が書き出されていない: %v", file, err)
			continue
		}
		if info.Size() == 0 {
			t.Errorf("%s が空ファイルとして書き出された", file)
		}
	}
}

func TestEnsure_既存ファイルを上書きしない(t *testing.T) {
	root := t.TempDir()
	own := []byte("ユーザーが編集した内容")
	target := filepath.Join(root, "CLAUDE.md")
	if err := os.WriteFile(target, own, 0o644); err != nil {
		t.Fatalf("前提ファイル作成: %v", err)
	}

	if err := Ensure(root); err != nil {
		t.Fatalf("Ensure: %v", err)
	}

	got, err := os.ReadFile(target)
	if err != nil {
		t.Fatalf("読み戻し: %v", err)
	}
	if string(got) != string(own) {
		t.Fatalf("既存の CLAUDE.md が上書きされた: %q", string(got))
	}
}

func TestEnsure_再実行してもエラーにならない(t *testing.T) {
	root := t.TempDir()
	if err := Ensure(root); err != nil {
		t.Fatalf("1回目: %v", err)
	}
	if err := Ensure(root); err != nil {
		t.Fatalf("2回目: %v", err)
	}
}
