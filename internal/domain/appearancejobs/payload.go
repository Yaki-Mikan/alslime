// Package appearancejobs はキャラクター容姿プロンプト作成（appearance-prompt ジョブ）で
// API 層と core 側 Runner が共有するペイロード・結果の契約を定義する。
//
// 設定ファイル本文はジョブ実行時にサーバーが読む（Payload には載せない）。結果は
// タグ行の配列を JSON 化して jobs.Result.Output に載せ、状態取得 API が復号して返す。
package appearancejobs

// Provider は問い合わせ先の種別（タグ判定の provider 値と同じ文字列）。
const (
	ProviderGemini       = "gemini"
	ProviderClaude       = "claude"
	ProviderAntigravity  = "antigravity"
	ProviderOpenAICompat = "openai_compat"
)

// IsValidProvider は対応している provider かを返す。
func IsValidProvider(provider string) bool {
	switch provider {
	case ProviderGemini, ProviderClaude, ProviderAntigravity, ProviderOpenAICompat:
		return true
	}
	return false
}

// CharacterCategoryID はキャラクター設定ファイルのカテゴリ ID（設定ファイルエディタと同じ）。
const CharacterCategoryID = "character"

// タイムアウト（分）の既定・下限・上限。
const (
	DefaultTimeoutMinutes = 5
	MinTimeoutMinutes     = 1
	MaxTimeoutMinutes     = 60
)

// GroupKeys は容姿タグのグループ（順序固定）。AI にはこの key で行を書かせる。
var GroupKeys = []string{"hair", "eyes", "body", "skin", "outfit", "other"}

// Payload は appearance-prompt ジョブの実行指定。
type Payload struct {
	DirName                 string `json:"dirName"`
	FileName                string `json:"fileName"`
	Provider                string `json:"provider"`
	Model                   string `json:"model"`
	ClaudeEffort            string `json:"claudeEffort,omitempty"`
	AntigravityThinking     string `json:"antigravityThinking,omitempty"`
	TimeoutMinutes          int    `json:"timeoutMinutes"`
	Locale                  string `json:"locale"`
	CurrentCharacterPrompt  string `json:"currentCharacterPrompt"`
	CurrentPhysicalFeatures string `json:"currentPhysicalFeatures"`
}

// Group は 1 グループ分のタグ行。
type Group struct {
	Key  string   `json:"key"`
	Tags []string `json:"tags"`
}

// Result は解析済みの結果。All は各グループを順に連結して重複除去した全タグ。
type Result struct {
	DirName  string   `json:"dirName"`
	FileName string   `json:"fileName"`
	Groups   []Group  `json:"groups"`
	All      []string `json:"all"`
}

// SettingReader はキャラクター設定ファイル本文の読み取り口（configeditor.Service が満たす）。
type SettingReader interface {
	ReadFile(categoryID, dirName, fileName string) (string, error)
}

// NormalizeTimeoutMinutes は範囲外の値を既定・下限・上限へ丸める。
func NormalizeTimeoutMinutes(minutes int) int {
	if minutes <= 0 {
		return DefaultTimeoutMinutes
	}
	if minutes < MinTimeoutMinutes {
		return MinTimeoutMinutes
	}
	if minutes > MaxTimeoutMinutes {
		return MaxTimeoutMinutes
	}
	return minutes
}
