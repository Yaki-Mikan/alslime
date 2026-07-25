package entitlement

import (
	"os"
	"path/filepath"
	"testing"

	"alslime/internal/config"
)

func TestNoticeCurrent_未保存は空文字(t *testing.T) {
	s := NewNoticeStore(t.TempDir())
	if got := s.Current(); got != "" {
		t.Fatalf("未保存のお知らせは空のはず: got=%q", got)
	}
}

func TestNoticeSaveとCurrent_再起動相当でも保持される(t *testing.T) {
	root := t.TempDir()
	s := NewNoticeStore(root)
	if err := s.Save("ja", "お知らせです"); err != nil {
		t.Fatalf("Save 失敗: %v", err)
	}
	if got := s.Current(); got != "お知らせです" {
		t.Fatalf("保存した文言が読めない: got=%q", got)
	}

	// 別インスタンス（再起動相当）でもファイルから読める＝「取り直すまで保持」。
	if got := NewNoticeStore(root).Current(); got != "お知らせです" {
		t.Fatalf("再読込で一致しない: got=%q", got)
	}
}

func TestNoticeSave_空文字は取り下げとしてファイルごと消える(t *testing.T) {
	root := t.TempDir()
	s := NewNoticeStore(root)
	if err := s.Save("ja", "掲示中"); err != nil {
		t.Fatalf("Save 失敗: %v", err)
	}
	if err := s.Save("ja", ""); err != nil {
		t.Fatalf("空文字 Save 失敗: %v", err)
	}
	if got := s.Current(); got != "" {
		t.Fatalf("取り下げ後は空のはず: got=%q", got)
	}
	path := filepath.Join(root, filepath.FromSlash(config.EntitlementNoticeFile))
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("お知らせファイルが残っている: %v", err)
	}
}

func TestNoticeClear_削除後は空でファイルも無い(t *testing.T) {
	root := t.TempDir()
	s := NewNoticeStore(root)
	if err := s.Save("en", "notice"); err != nil {
		t.Fatalf("Save 失敗: %v", err)
	}
	if err := s.Clear(); err != nil {
		t.Fatalf("Clear 失敗: %v", err)
	}
	if got := s.Current(); got != "" {
		t.Fatalf("Clear 後は空のはず: got=%q", got)
	}
	// 未保存状態での Clear は成功扱い（冪等）。
	if err := s.Clear(); err != nil {
		t.Fatalf("冪等な Clear が失敗: %v", err)
	}
}

func TestNoticeCurrent_壊れたファイルは空扱い(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, filepath.FromSlash(config.EntitlementNoticeFile))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("{broken"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := NewNoticeStore(root).Current(); got != "" {
		t.Fatalf("壊れたファイルは空扱いのはず: got=%q", got)
	}
}
