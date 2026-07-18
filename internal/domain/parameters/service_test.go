package parameters

import (
	"errors"
	"testing"

	storage "alslime/internal/storage/parameters"
	"alslime/internal/storage/paths"
)

const (
	defaultDir = "roleplay/global/settings"
	customDir  = "roleplay/global/parameter_schemas"
	presetDir  = "roleplay/global/presets/Normal_Mode"
)

func newService(t *testing.T) *Service {
	t.Helper()
	root := t.TempDir()
	resolver := paths.NewResolver(root)
	schemas := storage.NewSchemaStore(resolver, defaultDir, customDir)
	presets := storage.NewPresetStore(resolver, presetDir)
	return New(schemas, presets)
}

// schemaWith は schemaId を持つ最小妥当スキーマを返す。
func schemaWith(id string) map[string]any {
	return map[string]any{
		"schemaId":   id,
		"schemaName": map[string]any{"ja": "名前"},
		"groups": []any{
			map[string]any{
				"id":             "g1",
				"displayName":    map[string]any{"ja": "グループ"},
				"isFixed":        false,
				"defaultOpen":    true,
				"defaultEnabled": true,
				"elements":       []any{},
			},
		},
	}
}

func TestSchema_作成_取得_一覧(t *testing.T) {
	svc := newService(t)

	id, err := svc.CreateSchema(schemaWith("default"))
	if err != nil {
		t.Fatalf("default 作成失敗: %v", err)
	}
	if id != "default" {
		t.Fatalf("作成 id=%q", id)
	}
	if _, err := svc.CreateSchema(schemaWith("custom1")); err != nil {
		t.Fatalf("custom 作成失敗: %v", err)
	}

	// 一覧は {id, name} のみ。
	items, err := svc.ListSchemas()
	if err != nil {
		t.Fatalf("一覧失敗: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("2 件あるべき: %#v", items)
	}

	// default を取得できる。
	if _, err := svc.GetSchema("default"); err != nil {
		t.Fatalf("default 取得失敗: %v", err)
	}
	// custom を取得できる。
	if _, err := svc.GetSchema("custom1"); err != nil {
		t.Fatalf("custom 取得失敗: %v", err)
	}
}

func TestSchema_存在しないIDは404相当(t *testing.T) {
	svc := newService(t)
	if _, err := svc.GetSchema("nope"); !errors.Is(err, ErrSchemaNotFound) {
		t.Fatalf("存在しない取得は ErrSchemaNotFound: %v", err)
	}
}

func TestSchema_不正IDは400相当(t *testing.T) {
	svc := newService(t)
	if _, err := svc.GetSchema("../etc"); !errors.Is(err, ErrSchemaIDInvalid) {
		t.Fatalf("不正 id は ErrSchemaIDInvalid: %v", err)
	}
}

func TestSchema_作成時の重複は409相当(t *testing.T) {
	svc := newService(t)
	if _, err := svc.CreateSchema(schemaWith("dup")); err != nil {
		t.Fatalf("初回作成失敗: %v", err)
	}
	if _, err := svc.CreateSchema(schemaWith("dup")); !errors.Is(err, ErrSchemaIDConflict) {
		t.Fatalf("重複作成は ErrSchemaIDConflict: %v", err)
	}
}

func TestSchema_更新_pathとbody不一致は400相当(t *testing.T) {
	svc := newService(t)
	if _, err := svc.CreateSchema(schemaWith("c1")); err != nil {
		t.Fatalf("作成失敗: %v", err)
	}
	// path は c1 だが body は c2。
	if _, err := svc.UpdateSchema("c1", schemaWith("c2")); !errors.Is(err, ErrSchemaIDMismatch) {
		t.Fatalf("path/body 不一致は ErrSchemaIDMismatch: %v", err)
	}
}

func TestSchema_更新_既存を上書き(t *testing.T) {
	svc := newService(t)
	if _, err := svc.CreateSchema(schemaWith("c1")); err != nil {
		t.Fatalf("作成失敗: %v", err)
	}
	updated := schemaWith("c1")
	updated["schemaName"] = map[string]any{"ja": "更新後"}
	if _, err := svc.UpdateSchema("c1", updated); err != nil {
		t.Fatalf("更新失敗: %v", err)
	}
	got, err := svc.GetSchema("c1")
	if err != nil {
		t.Fatalf("取得失敗: %v", err)
	}
	name, _ := got["schemaName"].(map[string]any)
	if name["ja"] != "更新後" {
		t.Fatalf("更新が反映されていない: %#v", got)
	}
}

func TestSchema_default削除は403相当(t *testing.T) {
	svc := newService(t)
	if _, err := svc.CreateSchema(schemaWith("default")); err != nil {
		t.Fatalf("default 作成失敗: %v", err)
	}
	if err := svc.DeleteSchema("default"); !errors.Is(err, ErrDefaultNotDeletable) {
		t.Fatalf("default 削除は ErrDefaultNotDeletable: %v", err)
	}
}

func TestSchema_custom削除は成功(t *testing.T) {
	svc := newService(t)
	if _, err := svc.CreateSchema(schemaWith("c1")); err != nil {
		t.Fatalf("作成失敗: %v", err)
	}
	if err := svc.DeleteSchema("c1"); err != nil {
		t.Fatalf("custom 削除失敗: %v", err)
	}
	if _, err := svc.GetSchema("c1"); !errors.Is(err, ErrSchemaNotFound) {
		t.Fatalf("削除後は ErrSchemaNotFound: %v", err)
	}
}

func TestSchema_存在しないcustom削除は404相当(t *testing.T) {
	svc := newService(t)
	if err := svc.DeleteSchema("nope"); !errors.Is(err, ErrSchemaNotFound) {
		t.Fatalf("存在しない削除は ErrSchemaNotFound: %v", err)
	}
}

// ---- preset ----

func TestPreset_CRUD一巡(t *testing.T) {
	svc := newService(t)

	groups := []any{map[string]any{"id": "g1", "enabled": true, "values": map[string]any{}}}
	if _, err := svc.SavePreset("default", "朝", groups); err != nil {
		t.Fatalf("保存失敗: %v", err)
	}
	names, err := svc.ListPresets("default")
	if err != nil {
		t.Fatalf("一覧失敗: %v", err)
	}
	if len(names) != 1 || names[0] != "朝" {
		t.Fatalf("一覧想定外: %#v", names)
	}
	preset, err := svc.GetPreset("default", "朝")
	if err != nil {
		t.Fatalf("取得失敗: %v", err)
	}
	if preset["name"] != "朝" {
		t.Fatalf("取得想定外: %#v", preset)
	}
	if err := svc.DeletePreset("default", "朝"); err != nil {
		t.Fatalf("削除失敗: %v", err)
	}
	if _, err := svc.GetPreset("default", "朝"); !errors.Is(err, storage.ErrPresetNotFound) {
		t.Fatalf("削除後は ErrPresetNotFound: %v", err)
	}
}

func TestPreset_不正名は拒否(t *testing.T) {
	svc := newService(t)
	groups := []any{}
	if _, err := svc.SavePreset("default", "../etc", groups); err == nil {
		t.Fatalf("不正名は拒否すべき")
	}
}

func TestPreset_同名上書き(t *testing.T) {
	svc := newService(t)
	if _, err := svc.SavePreset("default", "朝", []any{map[string]any{"v": 1.0}}); err != nil {
		t.Fatalf("初回保存失敗: %v", err)
	}
	if _, err := svc.SavePreset("default", "朝", []any{map[string]any{"v": 2.0}}); err != nil {
		t.Fatalf("上書き保存失敗: %v", err)
	}
	names, _ := svc.ListPresets("default")
	if len(names) != 1 {
		t.Fatalf("上書きで件数が増えてはいけない: %#v", names)
	}
}

func TestPreset_保存は正規化名を返す(t *testing.T) {
	svc := newService(t)
	// 前後空白つきで保存すると、正本名（trim 後）が返る（レビュー20 指摘1）。
	saved, err := svc.SavePreset("default", "  朝  ", []any{})
	if err != nil {
		t.Fatalf("保存失敗: %v", err)
	}
	if saved != "朝" {
		t.Fatalf("正規化名を返すべき: got=%q", saved)
	}
	// ファイル上も正本名で取得できる。
	if _, err := svc.GetPreset("default", "朝"); err != nil {
		t.Fatalf("正本名で取得できるべき: %v", err)
	}
}

func TestPreset_大小衝突(t *testing.T) {
	svc := newService(t)
	if _, err := svc.SavePreset("default", "Morning", []any{}); err != nil {
		t.Fatalf("初回保存失敗: %v", err)
	}
	if _, err := svc.SavePreset("default", "morning", []any{}); !errors.Is(err, storage.ErrNameConflict) {
		t.Fatalf("大小違いは ErrNameConflict: %v", err)
	}
}
