package calendar

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"alslime/internal/storage/paths"
)

func TestStore_HolidayName_JSONの祝日名を返す(t *testing.T) {
	root := t.TempDir()
	logical := "roleplay/global/settings/calendar.json"
	abs := filepath.Join(root, filepath.FromSlash(logical))
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		t.Fatalf("mkdir failed: %v", err)
	}
	if err := os.WriteFile(abs, []byte(`{"2026-01-01":"元日"}`), 0o644); err != nil {
		t.Fatalf("write calendar failed: %v", err)
	}

	store := New(paths.NewResolver(root), logical)
	got, err := store.HolidayName(time.Date(2026, 1, 1, 8, 0, 0, 0, time.Local))
	if err != nil {
		t.Fatalf("HolidayName failed: %v", err)
	}
	if got != "元日" {
		t.Fatalf("got=%q want=%q", got, "元日")
	}
}

func TestStore_HolidayName_未作成なら空文字(t *testing.T) {
	store := New(paths.NewResolver(t.TempDir()), "roleplay/global/settings/calendar.json")

	got, err := store.HolidayName(time.Date(2026, 1, 2, 0, 0, 0, 0, time.Local))
	if err != nil {
		t.Fatalf("HolidayName failed: %v", err)
	}
	if got != "" {
		t.Fatalf("got=%q want empty", got)
	}
}
