package session

import "alslime/internal/i18n"

// session / history API の route 断片。
const (
	routeSessions          = "/sessions"
	routeSessionNew        = "/sessions/new"
	routeSessionResume     = "/sessions/resume"
	routeSessionApplySSRP  = "/session/apply-ssrp-settings"
	routeSessionTitle      = "/session/{sessionId}/title"
	routeSessionDelete     = "/session/{sessionId}"
	routeChatHistory       = "/chat/history/{sessionId}"
	routeChatHistoryUpdate = "/chat/history/update"
	pathParamSessionID     = "sessionId"
)

// session API が返すエラー・メッセージの i18n キー。
const (
	errKeyInvalidJSONBody       = i18n.KeyErrorInvalidJSONBody
	errKeySessionIndexRequired  = i18n.KeyErrorSessionIndexRequired
	errKeySessionIDRequired     = i18n.KeyErrorSessionIDRequired
	errKeySessionTitleRequired  = i18n.KeyErrorSessionTitleRequired
	errKeyHistoryUpdateRequired = i18n.KeyErrorHistoryUpdateRequired
	errKeySessionNotFound       = i18n.KeyErrorSessionNotFound
	errKeyInvalidUnifiedSession = i18n.KeyErrorInvalidUnifiedSession
	errKeyMessageNotFound       = i18n.KeyErrorMessageNotFound
	msgKeyNewSessionNext        = i18n.KeyMessageNewSessionNext
	msgKeyResumeSession         = i18n.KeyMessageResumeSession
)

// simpleSuccessResponse は { success } だけを返す操作の共通レスポンス。
type simpleSuccessResponse struct {
	Success bool `json:"success"`
}

// messageResponse は成功時に messageKey を伴うレスポンス。
// Message は旧フロント互換として同じキーを入れる。
type messageResponse struct {
	Success    bool   `json:"success"`
	Message    string `json:"message"`
	MessageKey string `json:"messageKey"`
}
