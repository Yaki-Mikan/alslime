// Package apiresponse は API handler 共通のレスポンス書き出しを提供する。
package apiresponse

import (
	"encoding/json"
	"net/http"

	"alslime/internal/config"
)

// WriteJSON は JSON レスポンスを書き出す。
// Content-Type を全 handler で統一し、個別 handler へのヘッダ直書きを避ける。
func WriteJSON(w http.ResponseWriter, status int, value any) error {
	w.Header().Set(config.HTTPHeaderContentType, config.MediaTypeJSONUTF8)
	w.WriteHeader(status)
	return json.NewEncoder(w).Encode(value)
}
