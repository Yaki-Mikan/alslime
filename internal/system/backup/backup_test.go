package backup

import (
	"archive/zip"
	"os"
	"path/filepath"
	"testing"
	"time"

	"alslime/internal/config"
	"alslime/internal/storage/paths"
	"alslime/internal/system/diagnostics"
)

func TestCreate_BackupIncludesSettingsAndExcludesCacheAndBackups(t *testing.T) {
	root := t.TempDir()
	resolver := paths.NewResolver(root)
	manager := New(resolver)
	manager.now = func() time.Time { return time.Date(2026, 6, 29, 12, 34, 56, 0, time.Local) }

	writeFile(t, resolver, config.GlobalSettingsFile, `{"ok":true}`)
	writeFile(t, resolver, "roleplay/settings/datetime_presets.json", `{"presets":[]}`)
	writeFile(t, resolver, config.AppCacheDir+"/temp.txt", "cache")
	writeFile(t, resolver, config.AppBackupDir+"/old.zip", "old")
	writeFile(t, resolver, "roleplay/characters/誰か/settings/main.md", "character")
	writeFile(t, resolver, config.AuthWorkspaceGeminiFile, "SECRET-must-not-be-backed-up")

	result, err := manager.Create()
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}
	if result.Status != diagnostics.CheckOK || result.FileCount != 2 {
		t.Fatalf("unexpected result: %#v", result)
	}

	backupAbs, err := resolver.ResolveExisting(result.Backup.Path)
	if err != nil {
		t.Fatalf("resolve backup failed: %v", err)
	}
	names := zipNames(t, backupAbs)
	assertContains(t, names, config.GlobalSettingsFile)
	assertContains(t, names, "roleplay/settings/datetime_presets.json")
	assertNotContains(t, names, config.AppCacheDir+"/temp.txt")
	assertNotContains(t, names, config.AppBackupDir+"/old.zip")
	assertNotContains(t, names, "roleplay/characters/誰か/settings/main.md")
	// 認証ファイルは秘匿情報のため backup へ含めない（安全要件§8-2）。
	assertNotContains(t, names, config.AuthWorkspaceGeminiFile)
}

func TestList_BackupsNewestFirst(t *testing.T) {
	root := t.TempDir()
	resolver := paths.NewResolver(root)
	manager := New(resolver)
	backupDir, err := resolver.ResolveDirForMkdirAll(config.AppBackupDir, config.DirPerm)
	if err != nil {
		t.Fatalf("mkdir backup failed: %v", err)
	}
	oldPath := filepath.Join(backupDir, "backup-20260629-000000.zip")
	newPath := filepath.Join(backupDir, "backup-20260629-010000.zip")
	if err := os.WriteFile(oldPath, []byte("old"), config.FilePerm); err != nil {
		t.Fatalf("write old failed: %v", err)
	}
	if err := os.WriteFile(newPath, []byte("new"), config.FilePerm); err != nil {
		t.Fatalf("write new failed: %v", err)
	}
	oldTime := time.Date(2026, 6, 29, 0, 0, 0, 0, time.Local)
	newTime := time.Date(2026, 6, 29, 1, 0, 0, 0, time.Local)
	if err := os.Chtimes(oldPath, oldTime, oldTime); err != nil {
		t.Fatalf("chtimes old failed: %v", err)
	}
	if err := os.Chtimes(newPath, newTime, newTime); err != nil {
		t.Fatalf("chtimes new failed: %v", err)
	}

	result, err := manager.List()
	if err != nil {
		t.Fatalf("List failed: %v", err)
	}
	if len(result.Backups) != 2 {
		t.Fatalf("unexpected backups: %#v", result.Backups)
	}
	if result.Backups[0].Name != filepath.Base(newPath) {
		t.Fatalf("backups not sorted newest first: %#v", result.Backups)
	}
}

func writeFile(t *testing.T, resolver *paths.Resolver, rel, body string) {
	t.Helper()
	abs, err := resolver.ResolveForCreateMkdirAll(rel, config.DirPerm)
	if err != nil {
		t.Fatalf("resolve %s failed: %v", rel, err)
	}
	if err := os.WriteFile(abs, []byte(body), config.FilePerm); err != nil {
		t.Fatalf("write %s failed: %v", rel, err)
	}
}

func zipNames(t *testing.T, path string) map[string]bool {
	t.Helper()
	reader, err := zip.OpenReader(path)
	if err != nil {
		t.Fatalf("open zip failed: %v", err)
	}
	defer func() { _ = reader.Close() }()
	names := map[string]bool{}
	for _, file := range reader.File {
		names[file.Name] = true
	}
	return names
}

func assertContains(t *testing.T, names map[string]bool, name string) {
	t.Helper()
	if !names[name] {
		t.Fatalf("zip does not contain %s: %#v", name, names)
	}
}

func assertNotContains(t *testing.T, names map[string]bool, name string) {
	t.Helper()
	if names[name] {
		t.Fatalf("zip contains excluded %s: %#v", name, names)
	}
}
