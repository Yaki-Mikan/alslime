package cache

import (
	"os"
	"path/filepath"
	"testing"

	"alslime/internal/config"
	"alslime/internal/storage/paths"
	"alslime/internal/system/diagnostics"
)

func TestStatus_NotCreated(t *testing.T) {
	manager := New(paths.NewResolver(t.TempDir()))

	got, err := manager.Status()
	if err != nil {
		t.Fatalf("Status failed: %v", err)
	}
	if got.Status != diagnostics.CheckOK || got.Exists {
		t.Fatalf("unexpected status: %#v", got)
	}
}

func TestClear_RemovesOnlyAppCacheContents(t *testing.T) {
	root := t.TempDir()
	resolver := paths.NewResolver(root)
	manager := New(resolver)

	cacheDir, err := resolver.ResolveDirForMkdirAll(config.AppCacheDir, config.DirPerm)
	if err != nil {
		t.Fatalf("mkdir cache failed: %v", err)
	}
	if err := os.WriteFile(filepath.Join(cacheDir, "one.txt"), []byte("1234"), config.FilePerm); err != nil {
		t.Fatalf("write cache file failed: %v", err)
	}
	nested := filepath.Join(cacheDir, "nested")
	if err := os.Mkdir(nested, config.DirPerm); err != nil {
		t.Fatalf("mkdir nested failed: %v", err)
	}
	if err := os.WriteFile(filepath.Join(nested, "two.txt"), []byte("56"), config.FilePerm); err != nil {
		t.Fatalf("write nested file failed: %v", err)
	}
	otherRel := config.ReplacementConfigFile
	otherAbs, err := resolver.ResolveForCreateMkdirAll(otherRel, config.DirPerm)
	if err != nil {
		t.Fatalf("resolve other file failed: %v", err)
	}
	if err := os.WriteFile(otherAbs, []byte("keep"), config.FilePerm); err != nil {
		t.Fatalf("write other file failed: %v", err)
	}

	result, err := manager.Clear()
	if err != nil {
		t.Fatalf("Clear failed: %v", err)
	}
	if result.RemovedCount != 2 || result.SizeBytes != 6 {
		t.Fatalf("unexpected clear result: %#v", result)
	}
	if _, err := os.Stat(filepath.Join(cacheDir, "one.txt")); !os.IsNotExist(err) {
		t.Fatalf("cache file still exists or unexpected error: %v", err)
	}
	if _, err := os.Stat(otherAbs); err != nil {
		t.Fatalf("non-cache file was touched: %v", err)
	}
	if !result.After.Exists || result.After.FileCount != 0 || result.After.DirCount != 0 {
		t.Fatalf("unexpected after status: %#v", result.After)
	}
}

func TestClear_RejectsSymlinkEntry(t *testing.T) {
	root := t.TempDir()
	resolver := paths.NewResolver(root)
	manager := New(resolver)

	cacheDir, err := resolver.ResolveDirForMkdirAll(config.AppCacheDir, config.DirPerm)
	if err != nil {
		t.Fatalf("mkdir cache failed: %v", err)
	}
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(cacheDir, "outside-link")); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}

	if _, err := manager.Clear(); err == nil {
		t.Fatal("expected symlink entry to be rejected")
	}
	if _, err := os.Stat(outside); err != nil {
		t.Fatalf("outside target was removed or changed: %v", err)
	}
}
