// Package configeditor は設定編集 UI 用のカテゴリ別ファイル CRUD・テンプレート・
// デフォルトテンプレート・初期本文解決のユースケースを担う。
//
// カテゴリ定義（catalog）はここに置く（交換日記 32）。カテゴリは保存先だけでなく
// API レスポンスの id/label/isCharacter、テンプレート保存先、初期本文解決にも関わるため、
// 低レベル storage ではなく domain に正本を置き、storage は「解決済みカテゴリ」を受け取る。
package configeditor

import (
	"alslime/internal/config"
	"alslime/internal/domain/apiproviders"
)

// Category はカテゴリ定義。
//
// Label と TemplateDirName を分離するのが重要（交換日記 32）。
//   - Label: API レスポンスの表示名。将来 i18n 対象（英語等に変わり得る）。
//   - TemplateDirName: テンプレート保存先のディレクトリ名（物理パス。英語 snake_case）。
type Category struct {
	ID              string
	Label           string // 現行 API 互換の表示名。将来 i18n 対象。
	Dir             string // 設定ファイル保存先（WORKSPACE_ROOT 相対）。
	TemplateDirName string // テンプレート保存先のディレクトリ名（物理パス）。
	IsCharacter     bool   // true: <Dir>/<dirName>/settings/<fileName>.md 形式。
}

// categories はカテゴリ定義の正本（順序維持）。
// 物理パスはワークスペース英語化（設定設定大設定/ワークスペース英語化_設計.md）に従う。
var categories = []Category{
	{ID: "character", Label: "キャラクター", Dir: "roleplay/characters", TemplateDirName: "characters", IsCharacter: true},
	{ID: "situation", Label: "シチュエーション", Dir: "roleplay/global/situations", TemplateDirName: "situations"},
	{ID: "personality", Label: "個別性格設定", Dir: "roleplay/global/personalities", TemplateDirName: "personalities"},
	{ID: "outfit", Label: "個別服装・髪型", Dir: "roleplay/global/outfits_hair", TemplateDirName: "outfits_hair"},
	{ID: "background", Label: "個別背景", Dir: "roleplay/global/backgrounds", TemplateDirName: "backgrounds"},
	{ID: "worldview", Label: "世界観", Dir: "roleplay/global/worldviews", TemplateDirName: "worldviews"},
	{ID: "stage", Label: "舞台", Dir: "roleplay/global/stages", TemplateDirName: "stages"},
	{ID: "user", Label: "ユーザーの設定", Dir: "roleplay/users", TemplateDirName: "users"},
	{ID: "occupation", Label: "職業設定", Dir: "roleplay/global/backgrounds/occupations", TemplateDirName: "occupations"},
	// ID "writingStyle" は settingspack の既存種別 ID・エクスポート済みパックとの互換のため変更しない。
	{ID: "writingStyle", Label: "文体設定", Dir: config.WritingStylesDir, TemplateDirName: "writing_styles"},
}

// Categories は全カテゴリ定義を順序どおり返す（一覧 API 用）。
func Categories() []Category {
	out := make([]Category, len(categories))
	copy(out, categories)
	return out
}

// FindCategory は id に一致するカテゴリを返す。未知は ok=false。
func FindCategory(id string) (Category, bool) {
	for _, c := range categories {
		if c.ID == id {
			return c, true
		}
	}
	return Category{}, false
}

// ProviderInstruction は AIプロバイダ指示ファイルの定義
// （設定インポートエクスポート_設計.md §8 の固定ファイル種別）。
//
// 各 CLI が WORKSPACE_ROOT（CLI の作業ディレクトリ）から自動で読むファイルで、
// 設定ファイルエディタからは「書き換えのみ」可能。新規作成・削除・リネームは
// API 層で受け付けない（ルート自体を登録しない）。
type ProviderInstruction struct {
	ID    string // "antigravity" | "claude" | "gemini"
	Label string // 表示名（カテゴリ Label と同じく現状は日本語 literal）
	File  string // WORKSPACE_ROOT 相対の固定ファイル名
}

// providerInstructions は AIプロバイダ指示ファイル定義の正本（順序維持）。
//
// openai_compat の API 共通基本指示・固定3プリセット基本指示（ja/en）も
// 固定 ProviderInstruction として書き換え可能にする。接続別追加指示は動的なため
// ここには置かず、api/apiproviders の専用 API を使う。
var providerInstructions = []ProviderInstruction{
	{ID: "antigravity", Label: "Antigravity 指示ファイル", File: config.ProviderInstructionAntigravityFile},
	{ID: "claude", Label: "Claude 指示ファイル", File: config.ProviderInstructionClaudeFile},
	{ID: "gemini", Label: "Gemini 指示ファイル", File: config.ProviderInstructionGeminiFile},
	{ID: "openai-compat-ja", Label: "API共通基本指示（日本語）", File: config.OpenAICompatSystemPromptFile("ja")},
	{ID: "openai-compat-en", Label: "API共通基本指示（英語）", File: config.OpenAICompatSystemPromptFile("en")},
	{ID: "openai-compat-openrouter-ja", Label: "OpenRouter基本指示（日本語）", File: config.OpenAICompatPresetPromptFile(apiproviders.PresetOpenRouter, "ja")},
	{ID: "openai-compat-openrouter-en", Label: "OpenRouter基本指示（英語）", File: config.OpenAICompatPresetPromptFile(apiproviders.PresetOpenRouter, "en")},
	{ID: "openai-compat-deepseek-ja", Label: "DeepSeek基本指示（日本語）", File: config.OpenAICompatPresetPromptFile(apiproviders.PresetDeepSeek, "ja")},
	{ID: "openai-compat-deepseek-en", Label: "DeepSeek基本指示（英語）", File: config.OpenAICompatPresetPromptFile(apiproviders.PresetDeepSeek, "en")},
	{ID: "openai-compat-opencode-go-ja", Label: "OpenCode Go基本指示（日本語）", File: config.OpenAICompatPresetPromptFile(apiproviders.PresetOpenCodeGo, "ja")},
	{ID: "openai-compat-opencode-go-en", Label: "OpenCode Go基本指示（英語）", File: config.OpenAICompatPresetPromptFile(apiproviders.PresetOpenCodeGo, "en")},
}

// ProviderInstructions は全定義を順序どおり返す（一覧 API 用）。
func ProviderInstructions() []ProviderInstruction {
	out := make([]ProviderInstruction, len(providerInstructions))
	copy(out, providerInstructions)
	return out
}

// FindProviderInstruction は id に一致する定義を返す。未知は ok=false。
func FindProviderInstruction(id string) (ProviderInstruction, bool) {
	for _, p := range providerInstructions {
		if p.ID == id {
			return p, true
		}
	}
	return ProviderInstruction{}, false
}

// ComfyDirective はタグ判定指示ファイルの定義（設計 §9。§8 の固定ファイル機構を流用）。
//
// 画像生成統合設定からの編集導線用。D 分類（supporter tier ゲート対象）のため、
// API 層は FeatureComfyUI の gate を通す。provider 指示と違いパック対象でもある
// （settingspack の comfyDirectives 種別と同じ実体を指す）。
type ComfyDirective struct {
	ID    string // "danbooru" | "natural" | "danbooru_third" | "natural_third" | "natural_short" | "natural_third_short"
	Label string
	File  string // WORKSPACE_ROOT 相対の固定ファイル
}

// comfyDirectives はタグ判定指示ファイル定義の正本（順序維持。一覧 API と
// UI のプルダウンはこの順で表示される）。並びは自然文 → Danbooru、
// それぞれ一人称 → 三人称の順で、自然文は各視点の直後に短縮版を置く。
// ID は互換のため変更しない。
var comfyDirectives = []ComfyDirective{
	{ID: "natural", Label: "タグ判定指示（自然文形式・一人称視点）", File: config.ComfyUIDirectiveNaturalFile},
	{ID: "natural_short", Label: "タグ判定指示（自然文形式・一人称視点・短縮版）", File: config.ComfyUIDirectiveNaturalShortFile},
	{ID: "natural_third", Label: "タグ判定指示（自然文形式・三人称視点）", File: config.ComfyUIDirectiveNaturalThirdFile},
	{ID: "natural_third_short", Label: "タグ判定指示（自然文形式・三人称視点・短縮版）", File: config.ComfyUIDirectiveNaturalThirdShortFile},
	{ID: "danbooru", Label: "タグ判定指示（Danbooru形式・一人称視点）", File: config.ComfyUIDirectiveDanbooruFile},
	{ID: "danbooru_third", Label: "タグ判定指示（Danbooru形式・三人称視点）", File: config.ComfyUIDirectiveDanbooruThirdFile},
}

// ComfyDirectives は全定義を順序どおり返す（一覧 API 用）。
func ComfyDirectives() []ComfyDirective {
	out := make([]ComfyDirective, len(comfyDirectives))
	copy(out, comfyDirectives)
	return out
}

// FindComfyDirective は id に一致する定義を返す。未知は ok=false。
func FindComfyDirective(id string) (ComfyDirective, bool) {
	for _, d := range comfyDirectives {
		if d.ID == id {
			return d, true
		}
	}
	return ComfyDirective{}, false
}

// ConfigGenInstruction は設定自動生成（config-generate）の指示ファイル定義
// （固定ファイル機構の流用。設定ファイルエディタから書き換えのみ可能）。
//
// core 側の Runner はワークスペース上のこのファイルを読み、無ければ同梱
// デフォルト（firstrun の defaults）へ戻る。ロケール別に別ファイル・別 ID とし、
// 実行時は UI 言語に一致するファイルが使われる。
type ConfigGenInstruction struct {
	ID     string // "<Target>-<Method>-<Locale>"（例 "character-two_step_1-ja"）
	Label  string // 表示名（フロントの i18n が無い場合の予備。日本語 literal）
	Kind   string // ConfigGenKindInstruction | ConfigGenKindTemplate
	Target string // 対象種別 ID（カテゴリ ID と同じ。現状 "character" のみ）
	Method string // 方式 ID（ConfigGenMethod* 定数）
	Locale string // "ja" | "en"
	File   string // WORKSPACE_ROOT 相対の固定ファイル名
}

// 設定自動生成の指示ファイルの種類。
//   - instruction: 作成指示（手順・出力先の指定を含む。編集非推奨として UI が警告する）
//   - template:    作成指示へ差し込まれるテンプレート（調査項目・設定ファイル形式。利用者が編集する主対象）
const (
	ConfigGenKindInstruction = "instruction"
	ConfigGenKindTemplate    = "template"
)

// 設定自動生成の方式 ID（指示ファイル名・ID の構成要素。互換のため変更しない）。
const (
	ConfigGenMethodTwoStep1        = "two_step_1"       // じっくり作成 1段階目（調査）
	ConfigGenMethodTwoStep2        = "two_step_2"       // じっくり作成 2段階目（設定作成）
	ConfigGenMethodOneShot         = "one_shot"         // 一括作成
	ConfigGenMethodSearchTemplate  = "search_template"  // 調査項目テンプレート（{{SEARCH_TEMPLATE_CONTENT}} へ差し込み）
	ConfigGenMethodSettingTemplate = "setting_template" // 設定ファイルテンプレート（{{SETTING_TEMPLATE_CONTENT}} へ差し込み）
)

// ConfigGenInstructionLocales は指示ファイルを持つロケール（先頭がフォールバック）。
var ConfigGenInstructionLocales = []string{"ja", "en"}

// ConfigGenInstructionID は ID の組み立て規則（フロントも同じ規則で組む）。
func ConfigGenInstructionID(target, method, locale string) string {
	return target + "-" + method + "-" + locale
}

// configGenInstructions は指示ファイル定義の正本（順序維持。一覧 API と UI の
// プルダウンはこの順で表示される）。並びは方式順 → ロケール順。
var configGenInstructions = buildConfigGenInstructions()

func buildConfigGenInstructions() []ConfigGenInstruction {
	// 並びは UI のプルダウン順。利用者が編集する主対象（テンプレート）を先に置く。
	methods := []struct{ id, kind, label string }{
		{ConfigGenMethodSearchTemplate, ConfigGenKindTemplate, "調査項目テンプレート"},
		{ConfigGenMethodSettingTemplate, ConfigGenKindTemplate, "設定ファイルテンプレート"},
		{ConfigGenMethodTwoStep1, ConfigGenKindInstruction, "作成指示：じっくり作成 1段階目・調査"},
		{ConfigGenMethodTwoStep2, ConfigGenKindInstruction, "作成指示：じっくり作成 2段階目・設定作成"},
		{ConfigGenMethodOneShot, ConfigGenKindInstruction, "作成指示：一括作成"},
	}
	out := make([]ConfigGenInstruction, 0, len(methods)*len(ConfigGenInstructionLocales))
	for _, c := range categories {
		if !c.IsCharacter {
			continue // 現状はキャラクターのみ対象（他種別は今後拡張）
		}
		for _, m := range methods {
			for _, locale := range ConfigGenInstructionLocales {
				out = append(out, ConfigGenInstruction{
					ID:     ConfigGenInstructionID(c.ID, m.id, locale),
					Label:  m.label,
					Kind:   m.kind,
					Target: c.ID,
					Method: m.id,
					Locale: locale,
					File:   config.ConfigGenInstructionFile(c.ID, m.id, locale),
				})
			}
		}
	}
	return out
}

// ConfigGenInstructions は全定義を順序どおり返す（一覧 API 用）。
func ConfigGenInstructions() []ConfigGenInstruction {
	out := make([]ConfigGenInstruction, len(configGenInstructions))
	copy(out, configGenInstructions)
	return out
}

// FindConfigGenInstruction は id に一致する定義を返す。未知は ok=false。
func FindConfigGenInstruction(id string) (ConfigGenInstruction, bool) {
	for _, d := range configGenInstructions {
		if d.ID == id {
			return d, true
		}
	}
	return ConfigGenInstruction{}, false
}

// FindConfigGenInstructionBy は対象・方式・ロケールから定義を返す（core Runner 用）。
// 未対応ロケールは先頭ロケールへ戻す。
func FindConfigGenInstructionBy(target, method, locale string) (ConfigGenInstruction, bool) {
	if d, ok := FindConfigGenInstruction(ConfigGenInstructionID(target, method, locale)); ok {
		return d, true
	}
	return FindConfigGenInstruction(ConfigGenInstructionID(target, method, ConfigGenInstructionLocales[0]))
}
