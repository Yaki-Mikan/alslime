package pwasettings

import (
	"os"
	"path/filepath"
	"testing"

	"alslime/internal/config"
	"alslime/internal/storage/paths"
)

func TestLoad_既定でUILanguageを返す(t *testing.T) {
	store := New(paths.NewResolver(t.TempDir()), config.PWASettingsFile)

	got, err := store.Load()
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}
	if got["uiLanguage"] != config.I18NDefaultLang {
		t.Fatalf("uiLanguage default mismatch: %#v", got["uiLanguage"])
	}
}

func TestMerge_UILanguageを保存できる(t *testing.T) {
	root := t.TempDir()
	store := New(paths.NewResolver(root), config.PWASettingsFile)

	got, err := store.Merge(map[string]any{"uiLanguage": "en"})
	if err != nil {
		t.Fatalf("Merge failed: %v", err)
	}
	if got["uiLanguage"] != "en" {
		t.Fatalf("uiLanguage was not saved: %#v", got["uiLanguage"])
	}

	loaded, err := store.Load()
	if err != nil {
		t.Fatalf("Load after merge failed: %v", err)
	}
	if loaded["uiLanguage"] != "en" {
		t.Fatalf("saved uiLanguage was not loaded: %#v", loaded["uiLanguage"])
	}
	newPath := filepath.Join(root, filepath.FromSlash(config.PWASettingsFile))
	if _, err := os.Stat(newPath); err != nil {
		t.Fatalf("new pwa settings path was not created: %v", err)
	}
}

func TestLoad_LegacyPWASettingsFileを読む(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, filepath.FromSlash(config.LegacyPWASettingsFile))
	if err := os.MkdirAll(filepath.Dir(path), config.DirPerm); err != nil {
		t.Fatalf("mkdir failed: %v", err)
	}
	if err := os.WriteFile(path, []byte(`{"uiLanguage":"en"}`), config.FilePerm); err != nil {
		t.Fatalf("write failed: %v", err)
	}

	store := New(paths.NewResolver(root), config.PWASettingsFile)
	got, err := store.Load()
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}
	if got["uiLanguage"] != "en" {
		t.Fatalf("legacy uiLanguage was not loaded: %#v", got["uiLanguage"])
	}
}
