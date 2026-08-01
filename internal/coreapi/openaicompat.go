package coreapi

import "strings"

// 本ファイルは openai_compat プロバイダの共有契約。
//
// - Usage / ProviderFailure / APIConnectionInfo の型正本
// - AlSlime が管理するヘッダー名の予約集合と照合関数の正本
//
// 予約集合を core 具体実装（providers/openaicompat）に置くと、public 側の
// 保存検証（domain/apiproviders）から参照できず依存方向が逆転するため、
// 境界契約であるここを唯一の正本とする。

// Usage は openai_compat の使用量の境界 DTO（エンジン→chatflow）。
// 統一セッションへの保存は chatflow の usageToSession が sessions.Usage へ
// 変換して行う（この型を直接永続化しない）。
type Usage struct {
	InputTokens       int64            `json:"inputTokens"`
	OutputTokens      int64            `json:"outputTokens"`
	CachedInputTokens int64            `json:"cachedInputTokens"` // OpenAI: cached_tokens / DeepSeek: prompt_cache_hit_tokens
	CacheWriteTokens  int64            `json:"cacheWriteTokens"`
	Extra             map[string]int64 `json:"extra,omitempty"` // プロバイダ固有の未知フィールドの逃がし先
}

// openai_compat の ErrorType 値の正本（文字列直書きの散在禁止）。
const (
	APIErrorConnectionUnavailable = "api_connection_unavailable"
	APIErrorKeyMissing            = "api_key_missing"
	APIErrorAuthError             = "api_auth_error"
	APIErrorRequestError          = "api_request_error"
	APIErrorRateLimited           = "api_rate_limited"
	APIErrorServerError           = "api_server_error"
	APIErrorNetworkError          = "api_network_error"
	APIErrorStreamInterrupted     = "api_stream_interrupted"
	APIErrorIdleTimeout           = "api_idle_timeout"
	APIErrorContentFiltered       = "api_content_filtered"
	APIErrorInvalidResponse       = "api_invalid_response"
	APIErrorInternalError         = "api_internal_error"
)

// ProviderFailure は Target/Connection 解決などの失敗を ErrorType 付きで
// 伝搬する型付きエラー。通常の error で伝搬すると chatflow で
// 一律 provider_execution_error に潰れるため、呼び出し側が errors.As で
// 判定して ProviderError Response へ変換する（変換主体：Target 解決失敗は
// chatflow、Connection 解決失敗は openaicompat Engine）。
type ProviderFailure struct {
	Type       string // api_* の ErrorType 値
	MessageKey string // 表示用 i18n キー（非空）。ローカライズ済み文言は持たせない
}

func (f *ProviderFailure) Error() string { return f.MessageKey }

// APIConnectionInfo は openaicompat エンジンが実行直前に
// CoreDeps.ResolveAPIConnection で取得する接続情報。
//
// APIKey / ExtraHeaders は秘密値を含む。ログ・Response・エラーメッセージ・
// ジョブ進捗・responsebackup の生成経路へこの型（および取得値）を渡さないこと
// （秘密の構造的排除）。
type APIConnectionInfo struct {
	BaseURL           string
	AuthScheme        string // bearer|api-key-header|x-api-key-header|none
	APIKey            string
	ExtraHeaders      map[string]string // SecretHeaders 含む解決済みヘッダー（フェーズ1では常に空）
	ExtraParams       map[string]any
	ForceNonStreaming bool
	CacheKeyParam     string // プリセットカタログ由来（"prompt_cache_key"｜"session_id"｜""）
}

// managedHeaderNames は AlSlime が管理するヘッダー名の予約集合（正本）。
// AuthScheme 4 方式が生成し得る認証ヘッダーを全て含む。
// 照合は IsManagedOpenAICompatHeader のみが行う（小文字キーで保持）。
var managedHeaderNames = map[string]struct{}{
	"authorization":     {},
	"host":              {},
	"content-length":    {},
	"transfer-encoding": {},
	"content-type":      {},
	"accept":            {},
	"api-key":           {},
	"x-api-key":         {},
}

// IsManagedOpenAICompatHeader は name が予約集合に含まれるかを大文字小文字を
// 無視して判定する。public 側の保存検証（domain/apiproviders）と core 側の
// 送出直前検証（providers/openaicompat client）の両方がこの関数を使う。
func IsManagedOpenAICompatHeader(name string) bool {
	_, ok := managedHeaderNames[strings.ToLower(strings.TrimSpace(name))]
	return ok
}
