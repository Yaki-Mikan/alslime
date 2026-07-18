package datetimepresets

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"alslime/internal/storage/paths"
	"alslime/internal/storage/presetname"
)

// logical はテスト用の保存先ファイル論理パス（現行と同じ場所）。
const logical = "roleplay/settings/datetime_presets.json"

func newStore(t *testing.T) (*Store, string) {
	t.Helper()
	root := t.TempDir()
	resolver := paths.NewResolver(root)
	return New(resolver, logical), root
}

func TestList_未作成は空(t *testing.T) {
	s, _ := newStore(t)
	got, err := s.List()
	if err != nil {
		t.Fatalf("List 失敗: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("未作成は空一覧であるべき: %#v", got)
	}
}

func TestSaveGetListDelete_一巡(t *testing.T) {
	s, root := newStore(t)

	// 値オブジェクトを 2 件保存（同一ファイル内に共存）。
	morning := map[string]any{"year": 2026.0, "month": 6.0, "day": 27.0, "hour": 7.0, "minute": 0.0}
	night := map[string]any{"year": 2026.0, "month": 6.0, "day": 27.0, "hour": 23.0, "minute": 30.0}
	if err := s.Save("朝", morning); err != nil {
		t.Fatalf("保存失敗(朝): %v", err)
	}
	if err := s.Save("夜", night); err != nil {
		t.Fatalf("保存失敗(夜): %v", err)
	}

	// 単一ファイルに presets キーで両方入っていること。
	raw := filepath.Join(root, filepath.FromSlash(logical))
	if _, statErr := os.Stat(raw); statErr != nil {
		t.Fatalf("保存ファイルが無い: %v", statErr)
	}

	// 一覧（ソート済み）。
	got, err := s.List()
	if err != nil {
		t.Fatalf("List 失敗: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("2 件あるべき: %#v", got)
	}

	// 取得して中身を確認。
	v, err := s.Get("夜")
	if err != nil {
		t.Fatalf("Get 失敗: %v", err)
	}
	m, ok := v.(map[string]any)
	if !ok || m["hour"] != 23.0 {
		t.Fatalf("取得値が想定外: %#v", v)
	}

	// 片方を削除しても、もう片方は残る（同一ファイル内の独立性）。
	if err := s.Delete("夜"); err != nil {
		t.Fatalf("Delete 失敗: %v", err)
	}
	if _, err := s.Get("夜"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("削除後は ErrNotFound: %v", err)
	}
	if _, err := s.Get("朝"); err != nil {
		t.Fatalf("残った方は取得できるべき: %v", err)
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
	if err := s.Save("../etc", map[string]any{}); !errors.Is(err, presetname.ErrReserved) {
		t.Fatalf("不正名は presetname のエラー: %v", err)
	}
}

func TestSave_上書き(t *testing.T) {
	s, _ := newStore(t)
	if err := s.Save("朝", map[string]any{"hour": 7.0}); err != nil {
		t.Fatalf("初回保存失敗: %v", err)
	}
	if err := s.Save("朝", map[string]any{"hour": 8.0}); err != nil {
		t.Fatalf("上書き保存失敗: %v", err)
	}
	v, _ := s.Get("朝")
	m, _ := v.(map[string]any)
	if m["hour"] != 8.0 {
		t.Fatalf("上書きされていない: %#v", v)
	}
	// 件数が増えていないこと。
	got, _ := s.List()
	if len(got) != 1 {
		t.Fatalf("上書きで件数が増えてはいけない: %#v", got)
	}
}

func TestSave_大文字小文字違いは衝突(t *testing.T) {
	s, _ := newStore(t)
	if err := s.Save("Morning", map[string]any{}); err != nil {
		t.Fatalf("初回保存失敗: %v", err)
	}
	if err := s.Save("morning", map[string]any{}); !errors.Is(err, ErrNameConflict) {
		t.Fatalf("大文字小文字違いは ErrNameConflict: %v", err)
	}
}

func TestList_危険キーは除外(t *testing.T) {
	s, root := newStore(t)
	if err := s.Save("正規", map[string]any{}); err != nil {
		t.Fatalf("保存失敗: %v", err)
	}
	// 手で危険キー（".." を含む）を JSON へ差し込む。
	raw := filepath.Join(root, filepath.FromSlash(logical))
	bad := `{"presets":{"正規":{},"a..b":{},"../evil":{}}}`
	if err := os.WriteFile(raw, []byte(bad), 0o644); err != nil {
		t.Fatalf("危険キー注入失敗: %v", err)
	}
	got, err := s.List()
	if err != nil {
		t.Fatalf("List 失敗: %v", err)
	}
	if len(got) != 1 || got[0] != "正規" {
		t.Fatalf("危険キーは除外されるべき: %#v", got)
	}
}

// 値が文字列でも保存・取得できること（data any の単一ファイル型での確認）。
func TestSave_文字列値も扱える(t *testing.T) {
	s, _ := newStore(t)
	if err := s.Save("メモ", "ただの文字列"); err != nil {
		t.Fatalf("文字列値の保存失敗: %v", err)
	}
	v, err := s.Get("メモ")
	if err != nil {
		t.Fatalf("Get 失敗: %v", err)
	}
	if v != "ただの文字列" {
		t.Fatalf("文字列値が取得できない: %#v", v)
	}
}
