// Package apierror は API 全体で共通のエラー応答を提供する。
//
// 現行 Node 版は {"error": err.message} で内部メッセージをそのまま返しており、
// 配布版要件の「内部処理・スタックトレースを利用者へ出さない」に反していた。
// 本パッケージでは、利用者向けの安全なメッセージと HTTP ステータスのみを返し、
// 内部詳細はログ側（logging）に閉じる方針を型で強制する。
package apierror

import (
	"net/http"

	"alslime/internal/api/apiresponse"
	"alslime/internal/i18n"
	"alslime/internal/logging"
)

// defaultMessage は Message が空のときに返す汎用 i18n キー。
const defaultMessage = i18n.KeyErrorInternal

// Response は API が返すエラー本文。利用者に見せてよい情報だけを持つ。
type Response struct {
	// Error は利用者向けの簡潔なメッセージ。「次に何をすべきか」を優先する。
	Error string `json:"error"`
	// MessageKey は多言語辞書で解決するためのキー。
	MessageKey string `json:"messageKey,omitempty"`
	// Code は機械可読なエラーコード（任意）。フロントの分岐用。
	Code string `json:"code,omitempty"`
	// Details は構造化された付帯情報（任意）。バリデーション失敗箇所など、
	// 内部スタックトレースではなく「利用者が修正に使える情報」に限る。
	Details any `json:"details,omitempty"`
}

// Error は HTTP ステータス・利用者向けメッセージ・内部エラーを束ねる。
// internal は利用者へ返さず、ログにのみ記録する。
type Error struct {
	Status     int
	Message    string
	MessageKey string
	Code       string
	Internal   error
}

func (e *Error) Error() string {
	if e.Internal != nil {
		return e.Internal.Error()
	}
	return e.Message
}

// New は利用者向けメッセージのみのエラーを作る。
func New(status int, message string) *Error {
	return &Error{Status: status, Message: message}
}

// NewKey は i18n キーを利用するエラーを作る。
// Error 互換フィールドにも同じキーを入れ、表示側は MessageKey を優先する。
func NewKey(status int, messageKey string) *Error {
	return &Error{Status: status, Message: messageKey, MessageKey: messageKey}
}

// Wrap は内部エラーを隠したまま、利用者向けメッセージを添えたエラーを作る。
func Wrap(status int, message string, internal error) *Error {
	return &Error{Status: status, Message: message, Internal: internal}
}

// WrapKey は内部エラーを隠し、i18n キーを利用するエラーを作る。
func WrapKey(status int, messageKey string, internal error) *Error {
	return &Error{Status: status, Message: messageKey, MessageKey: messageKey, Internal: internal}
}

// safeStatus は HTTP ステータスを 4xx/5xx の範囲へ丸める。
// ハンドラ実装の事故（Status: 0 や範囲外）でレスポンスが壊れるのを防ぐ。
func safeStatus(status int) int {
	if status < 400 || status > 599 {
		return http.StatusInternalServerError
	}
	return status
}

// safeMessage は空メッセージを汎用キーへ丸める。
func safeMessage(message string) string {
	if message == "" {
		return defaultMessage
	}
	return message
}

// Write はエラーを HTTP レスポンスへ書き出す。
// 内部エラーがあればログにのみ残し、本文には安全な情報だけを返す。
// Status / Message は安全側に丸め、後続実装の事故でレスポンスが壊れないようにする。
func Write(w http.ResponseWriter, e *Error) {
	status := safeStatus(e.Status)
	message := safeMessage(e.Message)

	if e.Internal != nil {
		logging.Error("api error (status=%d): %v", status, e.Internal)
	}

	_ = apiresponse.WriteJSON(w, status, Response{Error: message, MessageKey: e.MessageKey, Code: e.Code})
}

// WriteWithDetails は付帯情報（details）付きでエラーを書き出す。
//
// バリデーション失敗箇所のような「利用者が修正に使える構造化情報」を返す用途に限る。
// details に内部スタックトレースや内部パス等を入れてはならない（呼び出し側の責務）。
// status / message は Write と同様に安全側へ丸める。
func WriteWithDetails(w http.ResponseWriter, status int, message string, details any) {
	message = safeMessage(message)
	_ = apiresponse.WriteJSON(w, safeStatus(status), Response{Error: message, MessageKey: message, Details: details})
}

// 代表的なエラーの簡易コンストラクタ。

// BadRequest は 400。リクエストの不備を伝える。
func BadRequest(message string) *Error {
	return New(http.StatusBadRequest, message)
}

// BadRequestKey は 400。i18n キーを返す。
func BadRequestKey(messageKey string) *Error {
	return NewKey(http.StatusBadRequest, messageKey)
}

// Forbidden は 403。境界外アクセスなどに使う。
func Forbidden(message string) *Error {
	return New(http.StatusForbidden, message)
}

// ForbiddenKey は 403。i18n キーを返す。
func ForbiddenKey(messageKey string) *Error {
	return NewKey(http.StatusForbidden, messageKey)
}

// NotFound は 404。
func NotFound(message string) *Error {
	return New(http.StatusNotFound, message)
}

// NotFoundKey は 404。i18n キーを返す。
func NotFoundKey(messageKey string) *Error {
	return NewKey(http.StatusNotFound, messageKey)
}

// Internal は 500。内部エラーは隠し、利用者には汎用メッセージを返す。
func Internal(internal error) *Error {
	return WrapKey(http.StatusInternalServerError, defaultMessage, internal)
}
