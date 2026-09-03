package characters

import (
	"archive/zip"
	"os"
	"path/filepath"
	"testing"

	"alslime/internal/storage/paths"
)

func writeZip(t *testing.T, dir string, entries map[string]string) string {
	t.Helper()
	p := filepath.Join(dir, "pack.zip")
	f, err := os.Create(p)
	if err != nil {
		t.Fatal(err)
	}
	zw := zip.NewWriter(f)
	for name, body := range entries {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte(body)); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestEmotionPromptsService_MergeFromZip(t *testing.T) {
	root := t.TempDir()
	svc := NewEmotionPromptsService(paths.NewResolver(root))
	if _, err := svc.Save(EmotionPrompts{
		Workflow: "my-workflow",
		Emotions: map[string][]EmotionPromptEntry{"smile": {{Title: "にっこり", Prompt: "user edited"}}},
	}); err != nil {
		t.Fatal(err)
	}

	pack := writeZip(t, t.TempDir(), map[string]string{
		"README.txt": "ignored",
		"sample/emotion_prompts.json": `{"workflow":"pack-workflow","emotions":{
			"smile":[{"title":"にっこり","prompt":"from pack"},{"title":"歯を見せて","prompt":"teeth"}],
			"angry":[{"title":"怒り","prompt":"angry"}]}}`,
	})
	res, err := svc.MergeFromZip(pack)
	if err != nil {
		t.Fatalf("MergeFromZip: %v", err)
	}
	if res.Added != 2 || res.Skipped != 1 {
		t.Fatalf("added/skipped: %d/%d", res.Added, res.Skipped)
	}
	if res.Prompts.Workflow != "my-workflow" {
		t.Fatalf("workflow must not be imported: %q", res.Prompts.Workflow)
	}
	smile := res.Prompts.Emotions["smile"]
	if len(smile) != 2 || smile[0].Prompt != "user edited" || smile[1].Title != "歯を見せて" {
		t.Fatalf("smile: %+v", smile)
	}
	if len(res.Prompts.Emotions["angry"]) != 1 {
		t.Fatalf("angry: %+v", res.Prompts.Emotions["angry"])
	}

	// 再取り込みは全件スキップ。
	res, err = svc.MergeFromZip(pack)
	if err != nil || res.Added != 0 || res.Skipped != 3 {
		t.Fatalf("re-merge: %v %+v", err, res)
	}

	// 対象ファイル無し・親参照のみは ErrEmotionPromptsPackMissing。
	bad := writeZip(t, t.TempDir(), map[string]string{"../emotion_prompts.json": `{"emotions":{}}`, "other.json": "{}"})
	if _, err := svc.MergeFromZip(bad); err == nil {
		t.Fatalf("missing target should fail")
	}
}
