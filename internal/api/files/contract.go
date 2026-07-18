package files

import "alslime/internal/i18n"

// files / content API の route 断片。
// config.APIPrefix と組み合わせて登録し、handler 内に URL を直書きしない。
const (
	routeFilesSearch = "/files/search"
	routeFiles       = "/files"
	routeContent     = "/content"
	routeFilesWrite  = "/files/write"
	routeFilesMkdir  = "/files/mkdir"
)

// query parameter 名。
const (
	queryPath = "path"
	queryQ    = "q"
)

// files API が返す利用者向けエラーの i18n キー。
const (
	errKeyPathRequired        = i18n.KeyErrorPathRequired
	errKeyInvalidJSONBody     = i18n.KeyErrorInvalidJSONBody
	errKeyPathContentRequired = i18n.KeyErrorPathContentRequired
	errKeyPathForbidden       = i18n.KeyErrorPathForbidden
	errKeyPathNotFound        = i18n.KeyErrorPathNotFound
)

// files API が返す成功メッセージの i18n キー。
const (
	msgKeyFileWritten      = i18n.KeyMessageFileWritten
	msgKeyDirectoryCreated = i18n.KeyMessageDirectoryCreated
)

// filesResponse は検索結果など { files } だけを返すレスポンス。
type filesResponse struct {
	Files any `json:"files"`
}

// contentResponse は /api/content のレスポンス。
type contentResponse struct {
	Content string `json:"content"`
}

// successMessageResponse は write / mkdir の成功レスポンス。
// Message は当面の互換用に i18n キーを入れ、UI 表示は MessageKey を辞書解決する。
type successMessageResponse struct {
	Success    bool   `json:"success"`
	Message    string `json:"message"`
	MessageKey string `json:"messageKey"`
}

// newSuccessMessageResponse は互換用 message と i18n 用 messageKey を同じキーで埋める。
func newSuccessMessageResponse(messageKey string) successMessageResponse {
	return successMessageResponse{Success: true, Message: messageKey, MessageKey: messageKey}
}
