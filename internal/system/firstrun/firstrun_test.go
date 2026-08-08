package firstrun

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"alslime/internal/config"
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
		".claude/system.ja.md",
		".claude/system.en.md",
		"CLAUDE.md",
		"GEMINI.md",
		".agents/rules/AGENTS.md",
		"roleplay/global/ComfyUI/image_gen_directive.md",
		"roleplay/global/ComfyUI/image_gen_directive_natural.md",
		"roleplay/global/ComfyUI/image_gen_directive_third.md",
		"roleplay/global/ComfyUI/image_gen_directive_natural_third.md",
		"roleplay/global/writing_styles/一人称視点_標準.md",
		// openai_compat の API 共通基本指示と固定 3 プリセット基本指示（ja/en）。
		"roleplay/global/prompts/openai-compat/system.ja.md",
		"roleplay/global/prompts/openai-compat/system.en.md",
		"roleplay/global/prompts/openai-compat/presets/openrouter/system.ja.md",
		"roleplay/global/prompts/openai-compat/presets/openrouter/system.en.md",
		"roleplay/global/prompts/openai-compat/presets/deepseek/system.ja.md",
		"roleplay/global/prompts/openai-compat/presets/deepseek/system.en.md",
		"roleplay/global/prompts/openai-compat/presets/opencode-go/system.ja.md",
		"roleplay/global/prompts/openai-compat/presets/opencode-go/system.en.md",
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

func TestEnsure_OpenAICompat指示の生成規則(t *testing.T) {
	root := t.TempDir()
	if err := Ensure(root); err != nil {
		t.Fatalf("Ensure: %v", err)
	}

	// 固定プリセット基本指示は openrouter / deepseek / opencode-go の 3 種のみ。
	// openai / custom には固定プリセット指示ファイルを要求しない。
	for _, preset := range []string{"openai", "custom"} {
		path := filepath.Join(root, filepath.FromSlash("roleplay/global/prompts/openai-compat/presets/"+preset))
		if _, err := os.Stat(path); err == nil {
			t.Errorf("%s には固定プリセット指示を生成しないべき", preset)
		}
	}

	// 固定3種は短い差分ファイルではなく、API共通基本指示を内包した
	// Claude相当の全文として単体で成立する。
	base, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(config.OpenAICompatSystemPromptFile("ja"))))
	if err != nil {
		t.Fatalf("API共通基本指示の読込: %v", err)
	}
	for _, preset := range []string{"openrouter", "deepseek", "opencode-go"} {
		full, readErr := os.ReadFile(filepath.Join(root, filepath.FromSlash(config.OpenAICompatPresetPromptFile(preset, "ja"))))
		if readErr != nil {
			t.Fatalf("%s 基本指示の読込: %v", preset, readErr)
		}
		if !bytes.HasPrefix(full, bytes.TrimSpace(base)) {
			t.Errorf("%s 基本指示が API 共通基本指示全文を内包していない", preset)
		}
	}
}

func TestEnsure_未編集の旧プリセット追加指示だけを全文へ移行する(t *testing.T) {
	root := t.TempDir()
	rel := config.OpenAICompatPresetPromptFile("deepseek", "ja")
	dest := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		t.Fatalf("準備ディレクトリ: %v", err)
	}
	legacy, err := defaultsFS.ReadFile(defaultsRoot + "/" + rel)
	if err != nil {
		t.Fatalf("旧追加指示の読込: %v", err)
	}
	if err := os.WriteFile(dest, legacy, 0o644); err != nil {
		t.Fatalf("旧追加指示の配置: %v", err)
	}

	if err := Ensure(root); err != nil {
		t.Fatalf("Ensure: %v", err)
	}
	got, err := os.ReadFile(dest)
	if err != nil {
		t.Fatalf("移行後の読込: %v", err)
	}
	if bytes.Equal(got, legacy) || !bytes.HasSuffix(bytes.TrimSpace(got), bytes.TrimSpace(legacy)) {
		t.Fatalf("旧追加指示が基本指示全文へ安全移行されていない")
	}
}

func TestEnsure_編集済みAPI指示を上書きしない(t *testing.T) {
	root := t.TempDir()
	if err := Ensure(root); err != nil {
		t.Fatalf("1回目: %v", err)
	}
	// ユーザーが API 共通基本指示・プリセット指示を編集した状態で first-run を
	// 再実行しても上書きされない。
	edited := []byte("ユーザー編集済みの指示")
	targets := []string{
		"roleplay/global/prompts/openai-compat/system.ja.md",
		"roleplay/global/prompts/openai-compat/presets/deepseek/system.en.md",
	}
	for _, rel := range targets {
		abs := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.WriteFile(abs, edited, 0o644); err != nil {
			t.Fatalf("編集の準備 (%s): %v", rel, err)
		}
	}
	if err := Ensure(root); err != nil {
		t.Fatalf("2回目: %v", err)
	}
	for _, rel := range targets {
		got, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(rel)))
		if err != nil || string(got) != string(edited) {
			t.Errorf("編集済み %s が上書きされた: %q err=%v", rel, got, err)
		}
	}
}

func TestDefaultContent_初回書き出しと同一内容を返す(t *testing.T) {
	root := t.TempDir()
	if err := Ensure(root); err != nil {
		t.Fatalf("Ensure: %v", err)
	}
	// 素通しの通常ファイルと、基本指示を合成するプリセット指示の両経路を確認する。
	targets := []string{
		"roleplay/global/ComfyUI/image_gen_directive.md",
		"roleplay/global/prompts/openai-compat/presets/deepseek/system.ja.md",
	}
	for _, rel := range targets {
		got, err := DefaultContent(rel)
		if err != nil {
			t.Errorf("DefaultContent(%s): %v", rel, err)
			continue
		}
		written, readErr := os.ReadFile(filepath.Join(root, filepath.FromSlash(rel)))
		if readErr != nil {
			t.Errorf("読み戻し (%s): %v", rel, readErr)
			continue
		}
		if !bytes.Equal(got, written) {
			t.Errorf("%s の DefaultContent が初回書き出しの内容と一致しない", rel)
		}
	}
}

func TestDefaultContent_未知パスはエラー(t *testing.T) {
	if _, err := DefaultContent("roleplay/global/ComfyUI/no_such_file.md"); err == nil {
		t.Fatal("未知パスでエラーにならなかった")
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
