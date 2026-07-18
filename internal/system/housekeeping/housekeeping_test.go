package housekeeping

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"alslime/internal/config"
	"alslime/internal/storage/paths"
)

// writeFileWithMTime は指定 mtime で相対パスのファイルを作る。
func writeFileWithMTime(t *testing.T, root, rel string, mtime time.Time) string {
	t.Helper()
	abs := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(abs), config.DirPerm); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(abs, []byte("x"), config.FilePerm); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := os.Chtimes(abs, mtime, mtime); err != nil {
		t.Fatalf("chtimes: %v", err)
	}
	return abs
}

func TestSweepRemovesOldFilesKeepsNew(t *testing.T) {
	root := t.TempDir()
	now := time.Date(2026, 6, 30, 12, 0, 0, 0, time.UTC)

	oldLog := writeFileWithMTime(t, root, config.AntigravityLogDir+"/agy-old.log", now.Add(-48*time.Hour))
	newLog := writeFileWithMTime(t, root, config.AntigravityLogDir+"/agy-new.log", now.Add(-1*time.Hour))
	oldOut := writeFileWithMTime(t, root, config.AntigravityTempOutputDir+"/out-old.md", now.Add(-48*time.Hour))

	sweeper := New(paths.NewResolver(root), nil).
		WithMaxAge(24 * time.Hour).
		WithNow(func() time.Time { return now })

	res := sweeper.Sweep()
	if res.RemovedFiles != 2 {
		t.Fatalf("removed files = %d, want 2", res.RemovedFiles)
	}
	if _, err := os.Stat(oldLog); !os.IsNotExist(err) {
		t.Errorf("old log should be removed")
	}
	if _, err := os.Stat(oldOut); !os.IsNotExist(err) {
		t.Errorf("old output should be removed")
	}
	if _, err := os.Stat(newLog); err != nil {
		t.Errorf("new log should remain: %v", err)
	}
}

func TestSweepDoesNotTouchOutsideWhitelist(t *testing.T) {
	root := t.TempDir()
	now := time.Date(2026, 6, 30, 12, 0, 0, 0, time.UTC)

	// 正本相当（履歴）。古くても触れてはいけない。
	canonical := writeFileWithMTime(t, root, config.UnifiedSessionsDir+"/session.json", now.Add(-100*time.Hour))
	// キャッシュ正本。掃除対象外。
	cacheFile := writeFileWithMTime(t, root, config.AppCacheDir+"/cached.bin", now.Add(-100*time.Hour))
	// sidecar。掃除対象外。
	sidecar := writeFileWithMTime(t, root, config.AntigravitySidecarDir+"/sidecar.json", now.Add(-100*time.Hour))

	sweeper := New(paths.NewResolver(root), nil).
		WithMaxAge(24 * time.Hour).
		WithNow(func() time.Time { return now })

	sweeper.Sweep()

	for _, p := range []string{canonical, cacheFile, sidecar} {
		if _, err := os.Stat(p); err != nil {
			t.Errorf("non-target file must survive: %s (%v)", p, err)
		}
	}
}

func TestSweepPrunesEmptyContextDirs(t *testing.T) {
	root := t.TempDir()
	now := time.Date(2026, 6, 30, 12, 0, 0, 0, time.UTC)

	// Antigravity コンテキストは cascadeID ごとのサブディレクトリに一時ファイルを作る。
	writeFileWithMTime(t, root, config.AntigravityContextTempDir+"/cascade-1/method_c_context_001.md", now.Add(-48*time.Hour))

	sweeper := New(paths.NewResolver(root), nil).
		WithMaxAge(24 * time.Hour).
		WithNow(func() time.Time { return now })

	res := sweeper.Sweep()
	if res.RemovedFiles != 1 {
		t.Fatalf("removed files = %d, want 1", res.RemovedFiles)
	}
	if res.RemovedDirs < 1 {
		t.Errorf("empty cascade dir should be pruned, removedDirs = %d", res.RemovedDirs)
	}
	// ルートの一時ディレクトリ自体は残す。
	rootDir := filepath.Join(root, filepath.FromSlash(config.AntigravityContextTempDir))
	if _, err := os.Stat(rootDir); err != nil {
		t.Errorf("context root dir must survive: %v", err)
	}
	cascadeDir := filepath.Join(rootDir, "cascade-1")
	if _, err := os.Stat(cascadeDir); !os.IsNotExist(err) {
		t.Errorf("empty cascade subdir should be removed")
	}
}

func TestSweepNoTempDirIsNoop(t *testing.T) {
	root := t.TempDir()
	sweeper := New(paths.NewResolver(root), nil)
	res := sweeper.Sweep()
	if res.RemovedFiles != 0 || res.RemovedDirs != 0 {
		t.Fatalf("expected noop on empty workspace, got %+v", res)
	}
}
