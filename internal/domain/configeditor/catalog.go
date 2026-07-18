// Package configeditor は設定編集 UI 用のカテゴリ別ファイル CRUD・テンプレート・
// デフォルトテンプレート・初期本文解決のユースケースを担う。
//
// カテゴリ定義（catalog）はここに置く（交換日記 32）。カテゴリは保存先だけでなく
// API レスポンスの id/label/isCharacter、テンプレート保存先、初期本文解決にも関わるため、
// 低レベル storage ではなく domain に正本を置き、storage は「解決済みカテゴリ」を受け取る。
package configeditor

import "alslime/internal/config"

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
var providerInstructions = []ProviderInstruction{
	{ID: "antigravity", Label: "Antigravity 指示ファイル", File: config.ProviderInstructionAntigravityFile},
	{ID: "claude", Label: "Claude 指示ファイル", File: config.ProviderInstructionClaudeFile},
	{ID: "gemini", Label: "Gemini 指示ファイル", File: config.ProviderInstructionGeminiFile},
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
	ID    string // "danbooru" | "natural"
	Label string
	File  string // WORKSPACE_ROOT 相対の固定ファイル
}

// comfyDirectives はタグ判定指示ファイル定義の正本（順序維持）。
var comfyDirectives = []ComfyDirective{
	{ID: "danbooru", Label: "タグ判定指示（Danbooru形式）", File: config.ComfyUIDirectiveDanbooruFile},
	{ID: "natural", Label: "タグ判定指示（自然文形式）", File: config.ComfyUIDirectiveNaturalFile},
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
