// Package manual は同梱操作マニュアルの配信 API を提供する。
//
// GET /api/manual/{path...} で埋め込み済みマニュアル（Markdown・画像）を返す。
// 実体は docs/manual の go:embed（アプリ内マニュアル表示の読み込み元）。
package manual

import (
	"net/http"
	"strings"

	manualdocs "alslime/docs/manual"
	"alslime/internal/config"
)

// Register はマニュアル配信ルートを mux へ登録する。
func Register(mux *http.ServeMux) {
	mux.HandleFunc(http.MethodGet+" "+config.APIPrefix+"/manual/{path...}", handleManual)
}

// handleManual は埋め込みマニュアルの単一ファイルを返す。
//
// embed.FS の ReadFile は fs.ValidPath を満たさないパス（".." 等）と
// ディレクトリをエラーにするため、パス検証はそれに委ねて 404 に集約する。
func handleManual(w http.ResponseWriter, r *http.Request) {
	data, err := manualdocs.FS.ReadFile(r.PathValue("path"))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set(config.HTTPHeaderContentType, contentTypeFor(r.PathValue("path")))
	_, _ = w.Write(data)
}

// contentTypeFor はマニュアル同梱物の拡張子から Content-Type を決める。
func contentTypeFor(path string) string {
	switch {
	case strings.HasSuffix(path, ".md"):
		return "text/markdown; charset=utf-8"
	case strings.HasSuffix(path, ".png"):
		return "image/png"
	default:
		return "application/octet-stream"
	}
}
