package settings

import "alslime/internal/i18n"

// settings API の route 断片。
const (
	routeWorkspace         = "/workspace"
	routeSettingsGlobal    = "/settings/global"
	routeSettings          = "/settings"
	routeSettingsServer    = "/settings/server"
	routeRelationships     = "/settings/relationships"
	routeReplacementConfig = "/settings/replacement-config"
	routeLanguage          = "/settings/language/{lang}"
	routeSettingsDefault   = "/settings/default"
	pathParamLang          = "lang"
)

// settings API が返す利用者向けエラーの i18n キー。
const (
	errKeyInvalidJSONBody = i18n.KeyErrorInvalidJSONBody
	errKeyEmptyJSONBody   = i18n.KeyErrorEmptyJSONBody
	errKeyInvalidLang     = i18n.KeyErrorInvalidLang
	errKeyInvalidPort     = i18n.KeyErrorInvalidServerPort
	errKeyInvalidBind     = i18n.KeyErrorInvalidBindAddress
)
