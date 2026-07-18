// Package frontend はビルド済みフロントエンドを Go バイナリへ同梱し、静的配信する。
//
// 配布版要件: フロントとバックエンドは分離配布せず、単一バイナリへ同梱する。
// dist/ 配下にビルド済み成果物（index.html・JS・CSS 等）を置き、embed で取り込む。
// source map は配布版に含めない（dist へ出力しない運用とする）。
//
// 骨格段階では dist/index.html はプレースホルダ。実フロントのビルド成果物が
// 用意できたら dist 配下を差し替える。
package frontend

import (
	"bytes"
	"io"
	"io/fs"
	"net/http"
	"strings"
	"time"

	"alslime/internal/config"
)

const indexFile = "index.html"

// Handler は同梱フロントを配信する http.Handler を返す。
//
// /api/* 以外のリクエストはフロントへフォールバックする。
// SPA を想定し、実ファイルが無いパスは index.html を返す。
//
// http.FileServer は index.html への直アクセスを "./" へリダイレクトする癖があり、
// SPA フォールバックと組み合わせるとリダイレクトループを起こす。これを避けるため、
// 実ファイルは自前で配信し、未ヒット時は index.html の中身を直接返す。
func Handler() (http.Handler, error) {
	sub, err := fs.Sub(frontendFS, frontendRoot)
	if err != nil {
		return nil, err
	}

	index, err := fs.ReadFile(sub, indexFile)
	if err != nil {
		return nil, err
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// API パスはここに来ない想定だが、保険として弾く。
		if strings.HasPrefix(r.URL.Path, config.APIPrefix+"/") {
			http.NotFound(w, r)
			return
		}

		name := strings.TrimPrefix(r.URL.Path, "/")
		if name == "" {
			serveIndex(w, r, index)
			return
		}

		data, err := fs.ReadFile(sub, name)
		if err != nil {
			// 実ファイルが無ければ SPA ルートとみなし index.html を返す。
			serveIndex(w, r, index)
			return
		}

		http.ServeContent(w, r, name, time.Time{}, bytes.NewReader(data))
	}), nil
}

// serveIndex は index.html を 200 で返す。
func serveIndex(w http.ResponseWriter, _ *http.Request, index []byte) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, bytes.NewReader(index))
}
