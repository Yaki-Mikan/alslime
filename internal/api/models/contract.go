package modelsapi

import "alslime/internal/i18n"

// models API の route 断片。
const (
	routeModels     = "/models"
	routeModelsUser = "/models/user"
	routeModelsPing = "/models/ping"
)

// models API が返す利用者向けエラーの i18n キー。
const (
	errKeyInvalidJSONBody   = i18n.KeyErrorInvalidJSONBody
	errKeyPingBusy          = i18n.KeyErrorModelPingBusy
	errKeyPingEmptyResponse = i18n.KeyErrorModelPingEmptyResponse
)
