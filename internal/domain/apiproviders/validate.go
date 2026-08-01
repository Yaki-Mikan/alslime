package apiproviders

import (
	"errors"
	"net/url"
	"strings"
	"unicode"

	"alslime/internal/i18n"
)

// 検証エラー。handler 層で i18n キー付きの BadRequest へ変換する。
var (
	// ErrInvalidBaseURL は baseUrl の形式不正（scheme・userinfo・query・fragment）。
	ErrInvalidBaseURL = errors.New(i18n.KeyAPIProvidersErrorInvalidBaseURL)
	// ErrHTTPNotAllowed は localhost 以外への http 指定。
	ErrHTTPNotAllowed = errors.New(i18n.KeyAPIProvidersErrorHTTPNotAllowed)
	// ErrInvalidAuthScheme は AuthScheme 4 値以外の指定。
	ErrInvalidAuthScheme = errors.New(i18n.KeyAPIProvidersErrorInvalidAuthScheme)
	// ErrInvalidPreset はカタログに無いプリセット指定。
	ErrInvalidPreset = errors.New(i18n.KeyAPIProvidersErrorInvalidPreset)
	// ErrExtraParamsReservedKey は AlSlime が管理する送信キーの上書き。
	ErrExtraParamsReservedKey = errors.New(i18n.KeyAPIProvidersErrorExtraParamsReservedKey)
	// ErrExtraParamsSecretKey は秘密らしき既知キーの設定。
	ErrExtraParamsSecretKey = errors.New(i18n.KeyAPIProvidersErrorExtraParamsSecretKey)
	// ErrExtraParamsEmptyKey は空キー。
	ErrExtraParamsEmptyKey = errors.New(i18n.KeyAPIProvidersErrorExtraParamsEmptyKey)
	// ErrKeyConflict は clearApiKey=true と非空 apiKey の同時指定。
	ErrKeyConflict = errors.New(i18n.KeyAPIProvidersErrorKeyConflict)
	// ErrConnectionNotFound は指定 ID の接続先が存在しない。
	ErrConnectionNotFound = errors.New(i18n.KeyAPIProvidersErrorNotFound)
	// ErrRemoteModelInvalid は RemoteModelID の形式不正（空・制御文字・長さ超過）。
	ErrRemoteModelInvalid = errors.New(i18n.KeyUserModelsErrorRemoteModelInvalid)
	// ErrInstructionTooLarge は接続別追加指示のサイズ上限超過。
	ErrInstructionTooLarge = errors.New(i18n.KeyAPIProvidersErrorSystemPromptTooLarge)
	// ErrInstructionInvalidUTF8 は接続別追加指示の UTF-8 妥当性違反。
	ErrInstructionInvalidUTF8 = errors.New(i18n.KeyAPIProvidersErrorSystemPromptInvalidUTF8)
)

// remoteModelIDMaxLen は RemoteModelID の長さ上限。
const remoteModelIDMaxLen = 256

// reservedExtraParamKeys は AlSlime が管理する送信必須キー・キャッシュ識別子
// （小文字で保持し大小文字無視で照合）。
var reservedExtraParamKeys = map[string]struct{}{
	"model":            {},
	"messages":         {},
	"stream":           {},
	"stream_options":   {},
	"prompt_cache_key": {},
	"session_id":       {},
}

// secretLikeExtraParamKeys は秘密らしき既知キー（大小文字無視）。
var secretLikeExtraParamKeys = map[string]struct{}{
	"api_key":       {},
	"apikey":        {},
	"api-key":       {},
	"authorization": {},
	"token":         {},
	"access_token":  {},
	"secret":        {},
}

// ValidateBaseURL は baseUrl を検証し、末尾スラッシュを除去した正規化値を返す。
func ValidateBaseURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", ErrInvalidBaseURL
	}
	u, err := url.Parse(raw)
	if err != nil {
		return "", ErrInvalidBaseURL
	}
	switch u.Scheme {
	case "https":
		// 常に許可。
	case "http":
		host := strings.ToLower(u.Hostname())
		if host != "localhost" && host != "127.0.0.1" && host != "::1" {
			return "", ErrHTTPNotAllowed
		}
	default:
		return "", ErrInvalidBaseURL
	}
	if u.User != nil {
		return "", ErrInvalidBaseURL
	}
	if u.RawQuery != "" || u.Fragment != "" || u.RawFragment != "" {
		return "", ErrInvalidBaseURL
	}
	if u.Host == "" {
		return "", ErrInvalidBaseURL
	}
	u.Path = strings.TrimRight(u.Path, "/")
	return u.String(), nil
}

// ValidateAuthScheme は AuthScheme 4 値のいずれかであることを検証する。
func ValidateAuthScheme(scheme string) error {
	switch scheme {
	case AuthSchemeBearer, AuthSchemeAPIKeyHeader, AuthSchemeXAPIKeyHeader, AuthSchemeNone:
		return nil
	default:
		return ErrInvalidAuthScheme
	}
}

// ValidateExtraParams は拡張ボディパラメータのキーを検証する。
// 保存時と送出直前（core 側 request.go）の両方でこの規則を適用する。
func ValidateExtraParams(params map[string]any) error {
	for key := range params {
		trimmed := strings.TrimSpace(key)
		if trimmed == "" {
			return ErrExtraParamsEmptyKey
		}
		lower := strings.ToLower(trimmed)
		if _, ok := reservedExtraParamKeys[lower]; ok {
			return ErrExtraParamsReservedKey
		}
		if _, ok := secretLikeExtraParamKeys[lower]; ok {
			return ErrExtraParamsSecretKey
		}
	}
	return nil
}

// ValidateRemoteModelID は RemoteModelID を検証し、前後空白をトリムした値を返す
// （usermodels の openai_compat 行検証からも使う）。
func ValidateRemoteModelID(raw string) (string, error) {
	id := strings.TrimSpace(raw)
	if id == "" || len(id) > remoteModelIDMaxLen {
		return "", ErrRemoteModelInvalid
	}
	for _, r := range id {
		if unicode.IsControl(r) {
			return "", ErrRemoteModelInvalid
		}
	}
	return id, nil
}
