// Package apiproviders は openai_compat 接続先の service 層。
//
// 接続先のCRUD・検証・ID採番・カスケード削除・接続テスト・接続別追加指示の
// 管理を担う。永続化は storage/apiproviders（メタ・秘密の分離ストア）へ委譲する。
// プリセット固定情報・固定値定数は本パッケージの catalog を唯一の正本とする
// （文字列直書きの散在禁止）。
package apiproviders

// プリセット ID。
const (
	PresetOpenRouter = "openrouter"
	PresetOpenAI     = "openai"
	PresetDeepSeek   = "deepseek"
	PresetOpenCodeGo = "opencode-go"
	PresetCustom     = "custom"
)

// 認証方式（AuthScheme）。
const (
	AuthSchemeBearer        = "bearer"           // Authorization: Bearer <APIKey>（既定）
	AuthSchemeAPIKeyHeader  = "api-key-header"   // api-key: <APIKey>
	AuthSchemeXAPIKeyHeader = "x-api-key-header" // x-api-key: <APIKey>
	AuthSchemeNone          = "none"             // 認証ヘッダーなし（APIKey 未設定を許容）
)

// キャッシュ識別子の注入先キー。
const (
	CacheKeyParamPromptCacheKey = "prompt_cache_key" // OpenAI
	CacheKeyParamSessionID      = "session_id"       // OpenRouter sticky routing
)

// 接続テストの機械可読な失敗種別（レスポンス failureKind の正本）。
const (
	FailureKindAuth              = "auth"
	FailureKindNetwork           = "network"
	FailureKindModelsUnavailable = "models_unavailable"
	FailureKindInvalidResponse   = "invalid_response"
	FailureKindSaveFailed        = "save_failed"
)

// InstructionLocales は API 指示ファイルが持つ言語。
var InstructionLocales = []string{"ja", "en"}

// Preset はプリセットの固定情報（サーバー側の単一ソース）。
type Preset struct {
	ID       string `json:"id"`
	LabelKey string `json:"labelKey"`
	// BaseURL は既定値（custom は空）。
	BaseURL string `json:"baseUrl"`
	// AuthScheme は既定認証方式（全プリセット bearer。custom は選択可）。
	AuthScheme string `json:"authScheme"`
	// NoticeKeys はフォームに常時表示する注意書きの i18n キー。
	NoticeKeys []string `json:"noticeKeys"`
	// SupportsModelsAPI は GET /models 対応
	//（custom は true 扱いで失敗時に手入力へフォールバック）。
	SupportsModelsAPI bool `json:"supportsModelsApi"`
	// CacheKeyParam はキャッシュ識別子の注入先キー（空 = 注入しない）。
	CacheKeyParam string `json:"cacheKeyParam"`
	// HasPresetInstruction は固定プリセット基本指示（first-run 生成）を持つか。
	HasPresetInstruction bool `json:"-"`
}

// presets はプリセットカタログ（表示順どおり）。
var presets = []Preset{
	{
		ID:                   PresetOpenRouter,
		LabelKey:             "apiProviders.preset.openrouter",
		BaseURL:              "https://openrouter.ai/api/v1",
		AuthScheme:           AuthSchemeBearer,
		NoticeKeys:           []string{"apiProviders.notice.billing", "apiProviders.notice.keyStorage"},
		SupportsModelsAPI:    true,
		CacheKeyParam:        CacheKeyParamSessionID,
		HasPresetInstruction: true,
	},
	{
		ID:                PresetOpenAI,
		LabelKey:          "apiProviders.preset.openai",
		BaseURL:           "https://api.openai.com/v1",
		AuthScheme:        AuthSchemeBearer,
		NoticeKeys:        []string{"apiProviders.notice.billing", "apiProviders.notice.keyStorage", "apiProviders.notice.openai"},
		SupportsModelsAPI: true,
		CacheKeyParam:     CacheKeyParamPromptCacheKey,
	},
	{
		ID:                   PresetDeepSeek,
		LabelKey:             "apiProviders.preset.deepseek",
		BaseURL:              "https://api.deepseek.com",
		AuthScheme:           AuthSchemeBearer,
		NoticeKeys:           []string{"apiProviders.notice.billing", "apiProviders.notice.keyStorage", "apiProviders.notice.deepseek"},
		SupportsModelsAPI:    true,
		CacheKeyParam:        "",
		HasPresetInstruction: true,
	},
	{
		ID:                   PresetOpenCodeGo,
		LabelKey:             "apiProviders.preset.opencodeGo",
		BaseURL:              "https://opencode.ai/zen/go/v1",
		AuthScheme:           AuthSchemeBearer,
		NoticeKeys:           []string{"apiProviders.notice.billing", "apiProviders.notice.keyStorage"},
		SupportsModelsAPI:    true,
		CacheKeyParam:        "",
		HasPresetInstruction: true,
	},
	{
		ID:                PresetCustom,
		LabelKey:          "apiProviders.preset.custom",
		BaseURL:           "",
		AuthScheme:        AuthSchemeBearer,
		NoticeKeys:        []string{"apiProviders.notice.billing", "apiProviders.notice.keyStorage"},
		SupportsModelsAPI: true,
	},
}

// Presets はプリセットカタログを表示順で返す。
func Presets() []Preset {
	out := make([]Preset, len(presets))
	copy(out, presets)
	return out
}

// PresetByID は ID のプリセットを返す（存在しなければ ok=false）。
func PresetByID(id string) (Preset, bool) {
	for _, p := range presets {
		if p.ID == id {
			return p, true
		}
	}
	return Preset{}, false
}

// InstructionPresetIDs は固定プリセット基本指示を持つプリセット ID を返す
// （openrouter / deepseek / opencode-go の3種。first-run・configeditor が参照する）。
func InstructionPresetIDs() []string {
	out := make([]string, 0, 3)
	for _, p := range presets {
		if p.HasPresetInstruction {
			out = append(out, p.ID)
		}
	}
	return out
}
