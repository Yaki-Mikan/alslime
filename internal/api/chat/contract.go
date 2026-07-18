package chat

import "alslime/internal/i18n"

// chat API の route 断片。
const (
	routeSubmit     = "/chat/submit"
	routeStatus     = "/chat/status/{jobId}"
	routeRegenerate = "/regenerate"
	routeAbort      = "/abort"
	pathParamJobID  = "jobId"
)

// chat API が返すエラー・メッセージの i18n キー。
const (
	errKeyInvalidJSONBody   = i18n.KeyErrorInvalidJSONBody
	errKeyMessageRequired   = i18n.KeyErrorMessageRequired
	errKeySessionIDRequired = i18n.KeyErrorSessionIDRequired
	errKeyJobNotFound       = i18n.KeyErrorJobNotFound
	errKeyAlreadyProcessing = i18n.KeyErrorAlreadyProcessing
	msgKeyProcessing        = i18n.KeyMessageProcessing
	msgKeyProcessAborted    = i18n.KeyMessageProcessAborted
	msgKeyNoActiveProcess   = i18n.KeyMessageNoActiveProcess
	labelKeyRegenerate      = i18n.KeyLabelRegenerate
	labelKeyChat            = i18n.KeyLabelChat
)

// abortResponse は /api/abort のレスポンス。
// Message は互換用に i18n キーを入れ、UI は MessageKey を優先する。
type abortResponse struct {
	Success    bool   `json:"success"`
	Message    string `json:"message"`
	MessageKey string `json:"messageKey"`
	Count      int    `json:"count,omitempty"`
}
