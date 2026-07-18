package presetstore

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"testing"

	"alslime/internal/storage/paths"
	"alslime/internal/storage/presetname"
)

// baseDir はテスト用のベースディレクトリ論理パス。
// 多階層・日本語混じりで、実運用のpresetsディレクトリ構造に近づけている。
const baseDir = "roleplay/global/presets/SSRP_Mode"

// newStore は一時ワークスペースに紐づく Store を返す。
func newStore(t *testing.T) (*Store, string) {
	t.Helper()
	root := t.TempDir()
	resolver := paths.NewResolver(root)
	return New(resolver, baseDir), root
}

func TestList_未作成ディレクトリは空(t *testing.T) {
	s, _ := newStore(t)
	got, err := s.List()
	if err != nil {
		t.Fatalf("未作成ディレクトリの List でエラー: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("未作成は空一覧であるべき: %#v", got)
	}
}

func TestSaveGetListDelete_一巡(t *testing.T) {
	s, _ := newStore(t)

	// 日本語名で保存できる（交換日記 08 の合意）。
	if err := s.Save("夜の設定", map[string]any{"mood": "夜更かし"}); err != nil {
		t.Fatalf("保存失敗: %v", err)
	}
	if err := s.Save("morning", map[string]any{"mood": "asa"}); err != nil {
		t.Fatalf("保存失敗: %v", err)
	}

	// 一覧に両方出る（表示名・拡張子なし）。
	got, err := s.List()
	if err != nil {
		t.Fatalf("List 失敗: %v", err)
	}
	sort.Strings(got)
	want := []string{"morning", "夜の設定"}
	sort.Strings(want)
	if len(got) != 2 || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("List=%#v want=%#v", got, want)
	}

	// 取得で中身が戻る。
	data, err := s.Get("夜の設定")
	if err != nil {
		t.Fatalf("Get 失敗: %v", err)
	}
	if data["mood"] != "夜更かし" {
		t.Fatalf("Get の中身が想定外: %#v", data)
	}

	// 削除すると一覧から消え、再取得は ErrNotFound。
	if err := s.Delete("夜の設定"); err != nil {
		t.Fatalf("Delete 失敗: %v", err)
	}
	if _, err := s.Get("夜の設定"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("削除後の Get は ErrNotFound であるべき: %v", err)
	}
}

func TestGet_存在しないものはErrNotFound(t *testing.T) {
	s, _ := newStore(t)
	if _, err := s.Get("無い"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("存在しない Get は ErrNotFound: %v", err)
	}
}

func TestDelete_存在しないものはErrNotFound(t *testing.T) {
	s, _ := newStore(t)
	if err := s.Delete("無い"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("存在しない Delete は ErrNotFound: %v", err)
	}
}

func TestSave_不正名は検証エラー(t *testing.T) {
	s, _ := newStore(t)
	// ".." を含む名前は presetname.Validate で ErrReserved。
	if err := s.Save("../etc", map[string]any{}); !errors.Is(err, presetname.ErrReserved) {
		t.Fatalf("不正名の Save は presetname のエラーを返すべき: %v", err)
	}
	// パス区切りは ErrInvalidChar。
	if err := s.Save("a/b", map[string]any{}); !errors.Is(err, presetname.ErrInvalidChar) {
		t.Fatalf("パス区切り名の Save は ErrInvalidChar: %v", err)
	}
}

func TestSave_完全一致は上書き更新(t *testing.T) {
	s, _ := newStore(t)
	if err := s.Save("preset", map[string]any{"v": 1.0}); err != nil {
		t.Fatalf("初回保存失敗: %v", err)
	}
	// 完全一致は衝突ではなく上書き。
	if err := s.Save("preset", map[string]any{"v": 2.0}); err != nil {
		t.Fatalf("上書き保存は成功すべき: %v", err)
	}
	data, err := s.Get("preset")
	if err != nil {
		t.Fatalf("Get 失敗: %v", err)
	}
	if data["v"] != 2.0 {
		t.Fatalf("上書きされていない: %#v", data)
	}
	// 一覧に重複して出ない。
	got, _ := s.List()
	if len(got) != 1 {
		t.Fatalf("上書きで件数が増えてはいけない: %#v", got)
	}
}

func TestSave_大文字小文字違いは衝突(t *testing.T) {
	s, _ := newStore(t)
	if err := s.Save("Test", map[string]any{}); err != nil {
		t.Fatalf("初回保存失敗: %v", err)
	}
	// 既存 "Test" に対し "test" を新規保存しようとすると衝突。
	if err := s.Save("test", map[string]any{}); !errors.Is(err, ErrNameConflict) {
		t.Fatalf("大文字小文字違いは ErrNameConflict であるべき: %v", err)
	}
}

func TestExists(t *testing.T) {
	s, _ := newStore(t)
	if ok, err := s.Exists("preset"); err != nil || ok {
		t.Fatalf("未保存は exists=false: ok=%v err=%v", ok, err)
	}
	if err := s.Save("preset", map[string]any{}); err != nil {
		t.Fatalf("保存失敗: %v", err)
	}
	if ok, err := s.Exists("preset"); err != nil || !ok {
		t.Fatalf("保存後は exists=true: ok=%v err=%v", ok, err)
	}
}

func TestList_危険名ファイルは除外(t *testing.T) {
	s, root := newStore(t)
	// 正規の保存で baseDir を掘る。
	if err := s.Save("正規", map[string]any{}); err != nil {
		t.Fatalf("保存失敗: %v", err)
	}
	// 利用者が手で置いた危険名ファイルを直接作る（".." を含む表示名）。
	absDir := filepath.Join(root, filepath.FromSlash(baseDir))
	bad := filepath.Join(absDir, "a..b.json")
	if err := os.WriteFile(bad, []byte("{}"), 0o644); err != nil {
		t.Fatalf("危険名ファイル作成失敗: %v", err)
	}
	got, err := s.List()
	if err != nil {
		t.Fatalf("List 失敗: %v", err)
	}
	if len(got) != 1 || got[0] != "正規" {
		t.Fatalf("危険名は一覧から除外されるべき: %#v", got)
	}
}

func TestSave_symlink経由のディレクトリ脱出を拒否(t *testing.T) {
	if runtime.GOOS == "windows" {
		// Windows の symlink は管理者権限を要するため、CI 非管理者では skip。
		// 管理者権限 VSCode 環境では実行され、脱出拒否を検証する。
		if _, err := os.Lstat("nonexistent-skip-probe"); err == nil {
			t.Skip("probe")
		}
	}
	root := t.TempDir()
	outside := t.TempDir() // root の外。脱出先。

	resolver := paths.NewResolver(root)
	// baseDir の親までは実在させ、最終ディレクトリ名を outside への symlink にする。
	parent := filepath.Join(root, filepath.FromSlash("roleplay/global/presets"))
	if err := os.MkdirAll(parent, 0o755); err != nil {
		t.Fatalf("親作成失敗: %v", err)
	}
	link := filepath.Join(parent, "SSRP_Mode")
	if err := os.Symlink(outside, link); err != nil {
		t.Skipf("symlink 作成不可（権限など）: %v", err)
	}

	s := New(resolver, baseDir)
	// baseDir 実体が root 外を指すため、保存は境界確認で弾かれる。
	err := s.Save("脱出", map[string]any{"x": 1.0})
	if err == nil {
		t.Fatalf("symlink 経由の脱出保存は拒否されるべき")
	}
	// outside にファイルが作られていないこと。
	if entries, _ := os.ReadDir(outside); len(entries) != 0 {
		t.Fatalf("脱出先にファイルが作られている: %#v", entries)
	}
}
