package entitlement

import (
	"os"
	"path/filepath"
	"testing"

	"alslime/internal/config"
)

func TestCurrent_未保存は空文字(t *testing.T) {
	s := New(t.TempDir())
	if got := s.Current(); got != "" {
		t.Fatalf("未保存のトークンは空のはず: got=%q", got)
	}
}

func TestSaveとCurrent_保存後は読み出せる(t *testing.T) {
	root := t.TempDir()
	s := New(root)
	if err := s.Save("abc.def"); err != nil {
		t.Fatalf("Save 失敗: %v", err)
	}
	if got := s.Current(); got != "abc.def" {
		t.Fatalf("保存したトークンが読めない: got=%q", got)
	}

	// 別インスタンス（再起動相当）でもファイルから読める。
	if got := New(root).Current(); got != "abc.def" {
		t.Fatalf("再読込で一致しない: got=%q", got)
	}
}

func TestSave_前後空白と改行はトリムされる(t *testing.T) {
	root := t.TempDir()
	s := New(root)
	if err := s.Save("  tok.sig\n"); err != nil {
		t.Fatalf("Save 失敗: %v", err)
	}
	if got := New(root).Current(); got != "tok.sig" {
		t.Fatalf("トリムされていない: got=%q", got)
	}
}

func TestClear_削除後は空でファイルも無い(t *testing.T) {
	root := t.TempDir()
	s := New(root)
	if err := s.Save("tok.sig"); err != nil {
		t.Fatalf("Save 失敗: %v", err)
	}
	if err := s.Clear(); err != nil {
		t.Fatalf("Clear 失敗: %v", err)
	}
	if got := s.Current(); got != "" {
		t.Fatalf("Clear 後は空のはず: got=%q", got)
	}
	path := filepath.Join(root, filepath.FromSlash(config.EntitlementTokenFile))
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("トークンファイルが残っている: %v", err)
	}
	// 未保存状態での Clear は成功扱い（冪等）。
	if err := s.Clear(); err != nil {
		t.Fatalf("冪等な Clear が失敗: %v", err)
	}
}

func TestCurrent_ファイル直接配置でも読める(t *testing.T) {
	// 利用者が手動でトークンファイルを配置した場合（配置運用）も読める。
	root := t.TempDir()
	path := filepath.Join(root, filepath.FromSlash(config.EntitlementTokenFile))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("manual.tok\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := New(root).Current(); got != "manual.tok" {
		t.Fatalf("配置済みトークンが読めない: got=%q", got)
	}
}
