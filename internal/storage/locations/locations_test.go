package locations

import (
	"testing"

	"alslime/internal/config"
)

// 各論理IDが期待する初期物理パス（config の日本語物理パス）へ解決されること
// （燈レビュー指摘3 のテスト要望）。
func TestPath_初期物理パスへ解決(t *testing.T) {
	r := NewResolver()
	cases := []struct {
		loc  Location
		want string
	}{
		{PresetSSRPMode, config.PresetSSRPModeDir},
		{PresetDateTimeGroup, config.PresetDateTimeGroupDir},
		{PresetSSRPAll, config.PresetSSRPAllDir},
		{PresetSSRPParam, config.PresetSSRPParamDir},
		{DateTimePresetsFile, config.DateTimePresetsFile},
		{ParameterSchemaDefaultDir, config.ParameterSchemaDefaultDir},
		{ParameterSchemaCustomDir, config.ParameterSchemaCustomDir},
		{ParameterNormalModePresetDir, config.ParameterNormalModePresetDir},
		{PWASettingsFile, config.PWASettingsFile},
		{GlobalSettingsFile, config.GlobalSettingsFile},
		{RelationOptionsFile, config.RelationOptionsFile},
		{ReplacementConfigFile, config.ReplacementConfigFile},
		{CharacterFiltersFile, config.CharacterFiltersFile},
		{CalendarFile, config.CalendarFile},
		{LanguageDir, config.LanguageDir},
		{I18NDir, config.I18NDir},
		{CharacterListDir, config.CharacterListDir},
		{ParameterSchemaDefaultFile, config.ParameterSchemaDefaultFile},
		{ConfigEditorDefaultsFile, config.ConfigEditorDefaultsFile},
	}
	for _, c := range cases {
		got, ok := r.Path(c.loc)
		if !ok {
			t.Fatalf("loc=%d は解決できるべき", c.loc)
		}
		if got != c.want {
			t.Fatalf("loc=%d: got=%q want=%q", c.loc, got, c.want)
		}
	}
}

func TestMustPath_未登録はpanic(t *testing.T) {
	r := NewResolver()
	defer func() {
		if recover() == nil {
			t.Fatalf("未登録の MustPath は panic すべき")
		}
	}()
	// 定義外の値を渡すと panic する（実装漏れの早期検出）。
	_ = r.MustPath(Location(9999))
}

// NewResolver の返す解決器が内部マップのコピーを持ち、グローバル定義を
// 共有していないこと（一方を書き換えても他方へ波及しない最低限の隔離確認）。
func TestNewResolver_独立したマップ(t *testing.T) {
	r1 := NewResolver()
	r2 := NewResolver()
	r1.paths[PresetSSRPMode] = "書き換え"
	if got, _ := r2.Path(PresetSSRPMode); got != config.PresetSSRPModeDir {
		t.Fatalf("別インスタンスへ波及した: got=%q", got)
	}
}
