// Package files は WORKSPACE_ROOT 配下の汎用ファイル操作 HTTP ハンドラを提供する。
//
// API 契約は現行 Node 版維持（交換日記 28）。
//   - GET  /api/files?path=        -> { files: [{name,isDirectory,path}], currentPath }
//   - GET  /api/files/search?q=    -> { files: string[] }
//   - GET  /api/content?path=      -> { content }
//   - POST /api/files/write        body { path, content } -> { success, message }
//   - POST /api/files/mkdir        body { path } -> { success, message }
//
// 非移植: POST /api/files/upload, DELETE /api/files。
// 境界確認は storage/workspacefs（paths.Resolver 正本）に委ね、現行の弱い
// startsWith 判定は使わない。
package files

import (
	"encoding/json"
	"errors"
	"io/fs"
	"net/http"

	"alslime/internal/api/apierror"
	"alslime/internal/api/apiresponse"
	"alslime/internal/config"
	filesvc "alslime/internal/domain/files"
	"alslime/internal/storage/paths"
	storage "alslime/internal/storage/workspacefs"
)

// Register は files 系ルートを mux へ登録する。
func Register(mux *http.ServeMux, svc *filesvc.Service) {
	mux.HandleFunc(http.MethodGet+" "+config.APIPrefix+routeFilesSearch, handleSearch(svc))
	mux.HandleFunc(http.MethodGet+" "+config.APIPrefix+routeFiles, handleList(svc))
	mux.HandleFunc(http.MethodGet+" "+config.APIPrefix+routeContent, handleContent(svc))
	mux.HandleFunc(http.MethodPost+" "+config.APIPrefix+routeFilesWrite, handleWrite(svc))
	mux.HandleFunc(http.MethodPost+" "+config.APIPrefix+routeFilesMkdir, handleMkdir(svc))
}

type listResponse struct {
	Files       []storage.Entry `json:"files"`
	CurrentPath string          `json:"currentPath"`
}

func handleList(svc *filesvc.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rel := r.URL.Query().Get(queryPath)
		entries, current, err := svc.List(rel)
		if err != nil {
			writeFSError(w, err)
			return
		}
		writeJSON(w, listResponse{Files: entries, CurrentPath: current})
	}
}

func handleSearch(svc *filesvc.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query().Get(queryQ)
		files, err := svc.Search(q)
		if err != nil {
			writeFSError(w, err)
			return
		}
		if files == nil {
			files = []string{}
		}
		writeJSON(w, filesResponse{Files: files})
	}
}

func handleContent(svc *filesvc.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rel := r.URL.Query().Get(queryPath)
		if rel == "" {
			apierror.Write(w, apierror.BadRequestKey(errKeyPathRequired))
			return
		}
		content, err := svc.ReadContent(rel)
		if err != nil {
			writeFSError(w, err)
			return
		}
		writeJSON(w, contentResponse{Content: content})
	}
}

// writeRequest は書き込みリクエスト。content はキー無し（nil）と空文字を区別する。
type writeRequest struct {
	Path    string  `json:"path"`
	Content *string `json:"content"`
}

func handleWrite(svc *filesvc.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req writeRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			apierror.Write(w, apierror.BadRequestKey(errKeyInvalidJSONBody))
			return
		}
		// content はキー無し（nil）なら 400、空文字は許可（現行 content === undefined のみ拒否）。
		if req.Path == "" || req.Content == nil {
			apierror.Write(w, apierror.BadRequestKey(errKeyPathContentRequired))
			return
		}
		if err := svc.Write(req.Path, *req.Content); err != nil {
			writeFSError(w, err)
			return
		}
		writeJSON(w, newSuccessMessageResponse(msgKeyFileWritten))
	}
}

type mkdirRequest struct {
	Path string `json:"path"`
}

func handleMkdir(svc *filesvc.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req mkdirRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			apierror.Write(w, apierror.BadRequestKey(errKeyInvalidJSONBody))
			return
		}
		if req.Path == "" {
			apierror.Write(w, apierror.BadRequestKey(errKeyPathRequired))
			return
		}
		if err := svc.Mkdir(req.Path); err != nil {
			writeFSError(w, err)
			return
		}
		writeJSON(w, newSuccessMessageResponse(msgKeyDirectoryCreated))
	}
}

// writeFSError は FS エラーを HTTP ステータスへ変換する。
//   - 境界外（ErrOutsideWorkspace）       -> 403
//   - 未存在（fs.ErrNotExist）             -> 404
//   - それ以外                             -> 500（内部詳細はログのみ）
func writeFSError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, paths.ErrOutsideWorkspace):
		apierror.Write(w, apierror.ForbiddenKey(errKeyPathForbidden))
	case errors.Is(err, fs.ErrNotExist):
		apierror.Write(w, apierror.NotFoundKey(errKeyPathNotFound))
	default:
		apierror.Write(w, apierror.Internal(err))
	}
}

func writeJSON(w http.ResponseWriter, v any) {
	if err := apiresponse.WriteJSON(w, http.StatusOK, v); err != nil {
		apierror.Write(w, apierror.Internal(err))
	}
}
