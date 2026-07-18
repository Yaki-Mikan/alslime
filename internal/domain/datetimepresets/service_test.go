package datetimepresets

import (
	"errors"
	"testing"

	storage "alslime/internal/storage/datetimepresets"
	"alslime/internal/storage/paths"
)

const logical = "roleplay/settings/datetime_presets.json"

func newService(t *testing.T) *Service {
	t.Helper()
	root := t.TempDir()
	resolver := paths.NewResolver(root)
	return New(storage.New(resolver, logical))
}

func TestSaveGet_正規化名を返す(t *testing.T) {
	svc := newService(t)

	// 保存は正規化名を返す。
	saved, err := svc.Save("  朝の時刻  ", map[string]any{"hour": 7.0})
	if err != nil {
		t.Fatalf("保存失敗: %v", err)
	}
	if saved != "朝の時刻" {
		t.Fatalf("Save は正規化名を返すべき: got=%q", saved)
	}

	// 取得も前後空白付きで正規化名を返す。
	normalized, v, err := svc.Get("  朝の時刻  ")
	if err != nil {
		t.Fatalf("取得失敗: %v", err)
	}
	if normalized != "朝の時刻" {
		t.Fatalf("Get は正規化名を返すべき: got=%q", normalized)
	}
	m, _ := v.(map[string]any)
	if m["hour"] != 7.0 {
		t.Fatalf("取得値が想定外: %#v", v)
	}
}

func TestGet_存在しないものはErrNotFound(t *testing.T) {
	svc := newService(t)
	if _, _, err := svc.Get("無い"); !errors.Is(err, storage.ErrNotFound) {
		t.Fatalf("存在しない Get は ErrNotFound: %v", err)
	}
}

func TestSave_不正名はエラー(t *testing.T) {
	svc := newService(t)
	if _, err := svc.Save("../etc", map[string]any{}); err == nil {
		t.Fatalf("不正名の Save はエラーを返すべき")
	}
}

func TestList_保存後に名前が出る(t *testing.T) {
	svc := newService(t)
	if _, err := svc.Save("夜", map[string]any{"hour": 23.0}); err != nil {
		t.Fatalf("保存失敗: %v", err)
	}
	got, err := svc.List()
	if err != nil {
		t.Fatalf("List 失敗: %v", err)
	}
	if len(got) != 1 || got[0] != "夜" {
		t.Fatalf("一覧想定外: %#v", got)
	}
}
