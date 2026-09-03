package characters

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"alslime/internal/storage/paths"
)

func TestLinkedSettingsService_未存在は既定値(t *testing.T) {
	svc := NewLinkedSettingsService(paths.NewResolver(t.TempDir()))
	got, err := svc.Get("Alice")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.Version != LinkedSettingsVersion || len(got.Personalities.Files) != 0 || got.Outfits.Additional.Mode != LinkedModeAppend {
		t.Fatalf("unexpected default: %+v", got)
	}
	if _, err := svc.Get(""); !errors.Is(err, ErrInvalidName) {
		t.Fatalf("empty name should be invalid: %v", err)
	}
}

func TestLinkedSettingsService_往復と正規化(t *testing.T) {
	root := t.TempDir()
	svc := NewLinkedSettingsService(paths.NewResolver(root))

	// キャラディレクトリ未存在は 404 相当。
	if _, err := svc.Save("Alice", DefaultLinkedSettings()); !errors.Is(err, ErrCharacterNotFound) {
		t.Fatalf("missing dir should fail: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(root, "roleplay", "characters", "Alice", "settings"), 0o755); err != nil {
		t.Fatal(err)
	}
	in := LinkedSettings{
		Version: 99,
		Personalities: LinkedGroup{
			Files:      []string{" roleplay/global/personalities/a.md ", `roleplay\characters\Alice\personalities\b.md`, "", "roleplay/global/personalities/a.md"},
			Additional: LinkedAdditional{Mode: "bogus", Text: "hello"},
		},
		Outfits: LinkedGroup{Additional: LinkedAdditional{Mode: "replace", Text: "x"}},
	}
	saved, err := svc.Save("Alice", in)
	if err != nil {
		t.Fatalf("Save: %v", err)
	}
	if saved.Version != LinkedSettingsVersion {
		t.Fatalf("version should be fixed: %d", saved.Version)
	}
	wantFiles := []string{"roleplay/global/personalities/a.md", "roleplay/characters/Alice/personalities/b.md"}
	if len(saved.Personalities.Files) != len(wantFiles) {
		t.Fatalf("files: %v", saved.Personalities.Files)
	}
	for i, f := range wantFiles {
		if saved.Personalities.Files[i] != f {
			t.Fatalf("files[%d]: %q", i, saved.Personalities.Files[i])
		}
	}
	if saved.Personalities.Additional.Mode != LinkedModeAppend || saved.Personalities.Additional.Text != "hello" {
		t.Fatalf("mode should default to append: %+v", saved.Personalities.Additional)
	}
	if saved.Outfits.Additional.Mode != LinkedModeReplace || saved.Backgrounds.Files == nil {
		t.Fatalf("outfits/backgrounds: %+v", saved)
	}

	loaded, err := svc.Get("Alice")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if loaded.Personalities.Additional.Text != "hello" || loaded.Outfits.Additional.Mode != LinkedModeReplace {
		t.Fatalf("round trip mismatch: %+v", loaded)
	}

	// 破損 JSON はエラー。
	if err := os.WriteFile(filepath.Join(root, "roleplay", "characters", "Alice", "settings", "linked_settings.json"), []byte("{broken"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Get("Alice"); err == nil {
		t.Fatalf("broken json should fail")
	}
}
