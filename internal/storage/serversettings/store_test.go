package serversettings

import (
	"os"
	"path/filepath"
	"testing"

	"alslime/internal/config"
	"alslime/internal/storage/paths"
)

func TestLoad_LegacyServerSettingsFileを読む(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, filepath.FromSlash(config.LegacyServerSettingsFile))
	if err := os.MkdirAll(filepath.Dir(path), config.DirPerm); err != nil {
		t.Fatalf("mkdir failed: %v", err)
	}
	if err := os.WriteFile(path, []byte(`{"port":3212,"bindAddress":"127.0.0.2"}`), config.FilePerm); err != nil {
		t.Fatalf("write failed: %v", err)
	}

	store := New(paths.NewResolver(root), config.ServerSettingsFile)
	got, err := store.Load()
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}
	if got.Port != 3212 || got.BindAddress != "127.0.0.2" {
		t.Fatalf("legacy server settings were not loaded: %#v", got)
	}
}

func TestSave_ServerSettingsFileへ保存する(t *testing.T) {
	root := t.TempDir()
	store := New(paths.NewResolver(root), config.ServerSettingsFile)

	if _, err := store.Save(Settings{Port: 3213, BindAddress: "127.0.0.3"}); err != nil {
		t.Fatalf("Save failed: %v", err)
	}
	newPath := filepath.Join(root, filepath.FromSlash(config.ServerSettingsFile))
	if _, err := os.Stat(newPath); err != nil {
		t.Fatalf("new server settings path was not created: %v", err)
	}
}
