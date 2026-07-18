// Package locations は「論理ロケーションID → WORKSPACE_ROOT 配下の物理パス」を解決する。
//
// 背景（燈レビュー指摘3）:
// これまで各層（routes / store）は config.PresetSSRPModeDir のような日本語物理パス定数を
// 直接参照していた。既存データ互換のため日本語ディレクトリ自体は維持してよいが、
// 「日本語物理パスが論理名なしで各所の正本になっている」状態は多言語対応・将来の
// カスタムパス差し込みと相性が悪い。
//
// そこで本パッケージが論理ID（Location）を入口として物理パスを返す解決層を担う。
// アプリ各層は物理パス文字列ではなく Location を参照し、物理ディレクトリ名を直接持たない。
//
// 初期実装は config の日本語物理パスをそのまま返すだけの薄い解決器。
// 将来の拡張余地（English パス候補・設定ファイル由来のカスタムパス）は
// Resolver にメソッドを足す形で吸収できるよう、入口だけ先に用意する。
package locations

import "alslime/internal/config"

// Location は WORKSPACE_ROOT 配下の論理ロケーションID。
// 物理パスは Resolver.Path 経由で解決し、各層は物理文字列を直接持たない。
type Location int

const (
	// PresetSSRPMode は SSRP_Mode プリセット（/api/presets）。
	PresetSSRPMode Location = iota
	// PresetDateTimeGroup は時刻設定グループプリセット（/api/datetime-group-presets）。
	PresetDateTimeGroup
	// PresetSSRPAll は SSRP 全体プリセット（/api/ssrp-all-presets）。
	PresetSSRPAll
	// PresetSSRPParam は SSRP パラメータプリセット（/api/ssrp-param-presets）。
	PresetSSRPParam
	// DateTimePresetsFile は日付時刻プリセット（/api/datetime-presets）の単一ファイル。
	DateTimePresetsFile
	// ParameterSchemaDefaultDir はデフォルト項目設定の保存ディレクトリ。
	ParameterSchemaDefaultDir
	// ParameterSchemaCustomDir はカスタム項目設定の保存ディレクトリ。
	ParameterSchemaCustomDir
	// ParameterNormalModePresetDir は通常モード用パラメータプリセットのディレクトリ。
	ParameterNormalModePresetDir
	// PWASettingsFile は PWA（アプリ表示）設定の単一ファイル（/api/settings）。
	PWASettingsFile
	// ServerSettingsFile は起動前サーバー設定の単一ファイル（/api/settings/server）。
	ServerSettingsFile
	// UserModelsFile はユーザー編集のモデル一覧設定（/api/models/user）。
	UserModelsFile
	// GlobalSettingsFile はグローバル設定（デフォルト設定.json）。
	GlobalSettingsFile
	// RelationOptionsFile は関係性オプション（relation_options.json）。
	RelationOptionsFile
	// ReplacementConfigFile は置換設定（replacement_config.json）。
	ReplacementConfigFile
	// CharacterFiltersFile はキャラフィルタマスタ（character_filters.json）。
	CharacterFiltersFile
	// CalendarFile は祝日判定用カレンダー（calendar.json）。
	CalendarFile
	// LanguageDir は言語設定のディレクトリ（Language/<lang>.json）。
	LanguageDir
	// I18NDir は配布版 UI 辞書のディレクトリ（i18n/<lang>.json）。
	I18NDir
	// CharacterListDir はキャラクター設定・画像のルート（キャラリスト）。
	CharacterListDir
	// ParameterSchemaDefaultFile はデフォルト項目設定の固定ファイル（config-check 用）。
	ParameterSchemaDefaultFile
	// ConfigEditorDefaultsFile は Config Editor のデフォルトテンプレート設定ファイル（config-check 用）。
	ConfigEditorDefaultsFile
)

// physicalPaths は論理ID → 物理パス（"/" 区切り論理パス）の初期マッピング。
//
// ここでだけ config の物理パス定数へ依存する。各層は本マップを直接見ず、
// Resolver.Path / MustPath を通す。将来カスタムパスを足す場合も差し替え先はここ。
var physicalPaths = map[Location]string{
	PresetSSRPMode:      config.PresetSSRPModeDir,
	PresetDateTimeGroup: config.PresetDateTimeGroupDir,
	PresetSSRPAll:       config.PresetSSRPAllDir,
	PresetSSRPParam:     config.PresetSSRPParamDir,
	DateTimePresetsFile: config.DateTimePresetsFile,

	ParameterSchemaDefaultDir:    config.ParameterSchemaDefaultDir,
	ParameterSchemaCustomDir:     config.ParameterSchemaCustomDir,
	ParameterNormalModePresetDir: config.ParameterNormalModePresetDir,

	PWASettingsFile:    config.PWASettingsFile,
	ServerSettingsFile: config.ServerSettingsFile,
	UserModelsFile:     config.UserModelsFile,

	GlobalSettingsFile:    config.GlobalSettingsFile,
	RelationOptionsFile:   config.RelationOptionsFile,
	ReplacementConfigFile: config.ReplacementConfigFile,
	CharacterFiltersFile:  config.CharacterFiltersFile,
	CalendarFile:          config.CalendarFile,
	LanguageDir:           config.LanguageDir,
	I18NDir:               config.I18NDir,
	CharacterListDir:      config.CharacterListDir,

	ParameterSchemaDefaultFile: config.ParameterSchemaDefaultFile,
	ConfigEditorDefaultsFile:   config.ConfigEditorDefaultsFile,
}

// Resolver は論理ロケーションを物理パスへ解決する。
//
// 現状は固定マッピングのみだが、将来は設定ファイル由来のカスタムパスや
// 言語別パス候補を内部に持たせ、本型のメソッドで吸収できるようにする。
type Resolver struct {
	paths map[Location]string
}

// NewResolver は初期マッピング（config の物理パス）を持つ Resolver を返す。
func NewResolver() *Resolver {
	// 呼び出し側からの書き換えを防ぐため、内部マップへコピーする。
	m := make(map[Location]string, len(physicalPaths))
	for k, v := range physicalPaths {
		m[k] = v
	}
	return &Resolver{paths: m}
}

// Path は loc の物理パス（WORKSPACE_ROOT からの "/" 区切り論理パス）を返す。
// 未登録の loc は ok=false。
func (r *Resolver) Path(loc Location) (string, bool) {
	p, ok := r.paths[loc]
	return p, ok
}

// MustPath は loc の物理パスを返す。未登録なら panic する。
//
// ロケーションIDは定数で全件が初期マッピングに含まれる前提のため、
// 未登録は実装漏れ（プログラミングエラー）として早期に検出する。
func (r *Resolver) MustPath(loc Location) string {
	p, ok := r.Path(loc)
	if !ok {
		panic("locations: 未登録のロケーションID")
	}
	return p
}
