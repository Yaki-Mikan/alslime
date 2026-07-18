package i18n

import i18nkeys "alslime/internal/i18n"

// i18n API の route / path 断片。
const (
	routeLanguages = "/i18n/languages"
	routeCatalog   = "/i18n/{lang}"
	pathParamLang  = "lang"
)

// i18n API が返す利用者向けエラーの i18n キー。
const errKeyInvalidLang = i18nkeys.KeyErrorInvalidLang

// languagesResponse は利用可能言語一覧レスポンス。
type languagesResponse struct {
	DefaultLang  string   `json:"defaultLang"`
	FallbackLang string   `json:"fallbackLang"`
	Languages    []string `json:"languages"`
}
