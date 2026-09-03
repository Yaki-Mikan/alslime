package characters

import (
	"os"
	"path/filepath"
	"testing"

	"alslime/internal/storage/paths"
)

func TestEmotionPromptsService_未存在は既定値(t *testing.T) {
	svc := NewEmotionPromptsService(paths.NewResolver(t.TempDir()))
	got, err := svc.Get()
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.Version != EmotionPromptsVersion || len(got.Emotions) != 0 {
		t.Fatalf("unexpected default: %+v", got)
	}
}

func TestEmotionPromptsService_往復と正規化(t *testing.T) {
	root := t.TempDir()
	svc := NewEmotionPromptsService(paths.NewResolver(root))
	in := EmotionPrompts{
		Version: 99,
		Emotions: map[string][]EmotionPromptEntry{
			"smile": {
				{Title: " にっこり ", Prompt: " smile, closed mouth "},
				{Title: "", Prompt: "dropped"},
				{Title: "にっこり", Prompt: "grin"}, // 同名は後勝ち
				{Title: "歯を見せて", Prompt: "teeth"},
			},
			"":       {{Title: "x", Prompt: "y"}}, // 表情名が空は捨てる
			"../bad": {{Title: "x", Prompt: "y"}}, // 親参照は除去され "bad" として残る
			"empty":  {{Title: "  ", Prompt: "y"}},
		},
	}
	saved, err := svc.Save(in)
	if err != nil {
		t.Fatalf("Save: %v", err)
	}
	if saved.Version != EmotionPromptsVersion {
		t.Fatalf("version: %d", saved.Version)
	}
	smile := saved.Emotions["smile"]
	if len(smile) != 2 || smile[0].Title != "にっこり" || smile[0].Prompt != "grin" || smile[1].Title != "歯を見せて" {
		t.Fatalf("smile: %+v", smile)
	}
	if _, ok := saved.Emotions[""]; ok {
		t.Fatalf("empty name should be dropped")
	}
	if _, ok := saved.Emotions["empty"]; ok {
		t.Fatalf("all-empty titles should drop the emotion")
	}
	if _, ok := saved.Emotions["bad"]; !ok {
		t.Fatalf("sanitized name expected: %v", saved.Emotions)
	}

	loaded, err := svc.Get()
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if loaded.Emotions["smile"][0].Prompt != "grin" {
		t.Fatalf("round trip: %+v", loaded)
	}

	if err := os.WriteFile(filepath.Join(root, "roleplay", "global", "settings", "emotion_prompts.json"), []byte("{broken"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Get(); err == nil {
		t.Fatalf("broken json should fail")
	}
}
