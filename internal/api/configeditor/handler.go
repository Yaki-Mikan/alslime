// Package configeditor は設定編集 UI 用 API の HTTP ハンドラを提供する。
//
// API 契約は現行 Node 版維持（交換日記 32）。base パスは /api/config-editor。
//
//	GET    /categories
//	GET    /files/{categoryId}
//	GET    /file/{categoryId}/{dirName}/{fileName}
//	GET    /file/{categoryId}/{dirName}/{fileName}/exists
//	POST   /file/{categoryId}/{dirName}/{fileName}     body { content }
//	DELETE /file/{categoryId}/{dirName}/{fileName}
//	GET    /templates/{categoryId}
//	GET    /template/{categoryId}/{name}
//	GET    /template/{categoryId}/{name}/exists
//	POST   /template/{categoryId}/{name}               body { content }
//	DELETE /template/{categoryId}/{name}
//	GET    /defaults
//	POST   /defaults                                   body { categoryId, templateName }
//	GET    /initial-content/{categoryId}
package configeditor

import (
	"encoding/json"
	"errors"
	"io/fs"
	"net/http"

	"alslime/internal/api/apierror"
	"alslime/internal/api/apiresponse"
	"alslime/internal/config"
	"alslime/internal/coreapi"
	domain "alslime/internal/domain/configeditor"
	"alslime/internal/features"
	"alslime/internal/i18n"
	"alslime/internal/storage/paths"
	"alslime/internal/storage/safename"
)

// Register は Config Editor 系ルートを mux へ登録する。
//
// gate はタグ判定指示ファイル（D 分類）の tier 判定に使う。nil は全ゲート無効として扱う。
func Register(mux *http.ServeMux, svc *domain.Service, gate coreapi.FeatureGate) {
	base := config.APIPrefix + routeBase
	mux.HandleFunc(http.MethodGet+" "+base+routeCategories, handleCategories())
	mux.HandleFunc(http.MethodGet+" "+base+routeFiles, handleListFiles(svc))

	mux.HandleFunc(http.MethodGet+" "+base+routeFileExists, handleFileExists(svc))
	mux.HandleFunc(http.MethodGet+" "+base+routeFile, handleGetFile(svc))
	mux.HandleFunc(http.MethodPost+" "+base+routeFile, handleSaveFile(svc))
	mux.HandleFunc(http.MethodDelete+" "+base+routeFile, handleDeleteFile(svc))

	mux.HandleFunc(http.MethodGet+" "+base+routeTemplates, handleListTemplates(svc))
	mux.HandleFunc(http.MethodGet+" "+base+routeTemplateExists, handleTemplateExists(svc))
	mux.HandleFunc(http.MethodGet+" "+base+routeTemplate, handleGetTemplate(svc))
	mux.HandleFunc(http.MethodPost+" "+base+routeTemplate, handleSaveTemplate(svc))
	mux.HandleFunc(http.MethodDelete+" "+base+routeTemplate, handleDeleteTemplate(svc))

	mux.HandleFunc(http.MethodGet+" "+base+routeDefaults, handleGetDefaults(svc))
	mux.HandleFunc(http.MethodPost+" "+base+routeDefaults, handleSaveDefaults(svc))
	mux.HandleFunc(http.MethodGet+" "+base+routeInitialContent, handleInitialContent(svc))

	// AIプロバイダ指示ファイル（設計 §8）。編集のみ許可の固定ファイルのため、
	// GET（一覧・内容）と POST（上書き保存）だけを登録する。DELETE は登録しない。
	mux.HandleFunc(http.MethodGet+" "+base+routeProviderInstructions, handleListProviderInstructions(svc))
	mux.HandleFunc(http.MethodGet+" "+base+routeProviderInstruction, handleGetProviderInstruction(svc))
	mux.HandleFunc(http.MethodPost+" "+base+routeProviderInstruction, handleSaveProviderInstruction(svc))

	// タグ判定指示ファイル（設計 §9）。D 分類のため gate を通す（フロントの
	// 出し分けに頼らず API 側でも tier を判定する）。こちらも GET/POST のみ。
	mux.HandleFunc(http.MethodGet+" "+base+routeComfyDirectives, withImageGenGate(gate, handleListComfyDirectives(svc)))
	mux.HandleFunc(http.MethodGet+" "+base+routeComfyDirective, withImageGenGate(gate, handleGetComfyDirective(svc)))
	mux.HandleFunc(http.MethodPost+" "+base+routeComfyDirective, withImageGenGate(gate, handleSaveComfyDirective(svc)))
}

// withImageGenGate は FeatureComfyUI が無効なら 403 を返すミドルウェア。
func withImageGenGate(gate coreapi.FeatureGate, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if gate == nil || !gate.Enabled(string(features.FeatureComfyUI)) {
			apierror.Write(w, apierror.ForbiddenKey(i18n.KeyFeatureTierUnavailable))
			return
		}
		next(w, r)
	}
}

// ---- categories ----

type categoryJSON struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	IsCharacter bool   `json:"isCharacter"`
}

func handleCategories() http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		cats := domain.Categories()
		out := make([]categoryJSON, 0, len(cats))
		for _, c := range cats {
			out = append(out, categoryJSON{ID: c.ID, Label: c.Label, IsCharacter: c.IsCharacter})
		}
		writeJSON(w, out)
	}
}

// ---- 設定ファイル ----

func handleListFiles(svc *domain.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		entries, err := svc.ListFiles(r.PathValue(pathParamCategoryID))
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, entries)
	}
}

func handleGetFile(svc *domain.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		content, err := svc.ReadFile(r.PathValue(pathParamCategoryID), r.PathValue(pathParamDirName), r.PathValue(pathParamFileName))
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, contentResponse{Content: content})
	}
}

func handleFileExists(svc *domain.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		exists, err := svc.FileExists(r.PathValue(pathParamCategoryID), r.PathValue(pathParamDirName), r.PathValue(pathParamFileName))
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, existsResponse{Exists: exists})
	}
}

func handleSaveFile(svc *domain.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		content, renameIfExists, ok := decodeContentBody(w, r)
		if !ok {
			return
		}
		fileName := r.PathValue(pathParamFileName)
		// renameIfExists は D&D 個別インポート用（設計 §7）: 黙って上書きせず、
		// 同名なら「名前 (2)」形式の空き名で追加し、確定した名前を返す。
		if renameIfExists {
			name, err := svc.WriteFileUnique(r.PathValue(pathParamCategoryID), fileName, content)
			if err != nil {
				writeError(w, err)
				return
			}
			writeJSON(w, savedResponse{Success: true, Name: name})
			return
		}
		if err := svc.WriteFile(r.PathValue(pathParamCategoryID), r.PathValue(pathParamDirName), fileName, content); err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, savedResponse{Success: true, Name: fileName})
	}
}

func handleDeleteFile(svc *domain.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := svc.DeleteFile(r.PathValue(pathParamCategoryID), r.PathValue(pathParamDirName), r.PathValue(pathParamFileName)); err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, successResponse{Success: true})
	}
}

// ---- テンプレート ----

func handleListTemplates(svc *domain.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		names, err := svc.ListTemplates(r.PathValue(pathParamCategoryID))
		if err != nil {
			writeError(w, err)
			return
		}
		if names == nil {
			names = []string{}
		}
		writeJSON(w, names)
	}
}

func handleGetTemplate(svc *domain.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		content, err := svc.ReadTemplate(r.PathValue(pathParamCategoryID), r.PathValue(pathParamTemplateName))
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, contentResponse{Content: content})
	}
}

func handleTemplateExists(svc *domain.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		exists, err := svc.TemplateExists(r.PathValue(pathParamCategoryID), r.PathValue(pathParamTemplateName))
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, existsResponse{Exists: exists})
	}
}

func handleSaveTemplate(svc *domain.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		content, ok := decodeContent(w, r)
		if !ok {
			return
		}
		if err := svc.WriteTemplate(r.PathValue(pathParamCategoryID), r.PathValue(pathParamTemplateName), content); err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, successResponse{Success: true})
	}
}

func handleDeleteTemplate(svc *domain.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := svc.DeleteTemplate(r.PathValue(pathParamCategoryID), r.PathValue(pathParamTemplateName)); err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, successResponse{Success: true})
	}
}

// ---- defaults / 初期本文 ----

func handleGetDefaults(svc *domain.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		defaults, err := svc.Defaults()
		if err != nil {
			writeError(w, err)
			return
		}
		if defaults == nil {
			defaults = map[string]string{}
		}
		writeJSON(w, defaults)
	}
}

type saveDefaultsRequest struct {
	CategoryID   string `json:"categoryId"`
	TemplateName string `json:"templateName"`
}

func handleSaveDefaults(svc *domain.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req saveDefaultsRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			apierror.Write(w, apierror.BadRequestKey(errKeyInvalidJSONBody))
			return
		}
		if req.CategoryID == "" {
			apierror.Write(w, apierror.BadRequestKey(errKeyCategoryRequired))
			return
		}
		if err := svc.SaveDefault(req.CategoryID, req.TemplateName); err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, successResponse{Success: true})
	}
}

func handleInitialContent(svc *domain.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		content, err := svc.InitialContent(r.PathValue(pathParamCategoryID))
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, contentResponse{Content: content})
	}
}

// ---- AIプロバイダ指示ファイル ----

func handleListProviderInstructions(svc *domain.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		list, err := svc.ListProviderInstructions()
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, list)
	}
}

func handleGetProviderInstruction(svc *domain.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		content, err := svc.ReadProviderInstruction(r.PathValue(pathParamProviderID))
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, contentResponse{Content: content})
	}
}

func handleSaveProviderInstruction(svc *domain.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		content, _, ok := decodeContentBody(w, r)
		if !ok {
			return
		}
		if err := svc.WriteProviderInstruction(r.PathValue(pathParamProviderID), content); err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, successResponse{Success: true})
	}
}

// ---- タグ判定指示ファイル ----

func handleListComfyDirectives(svc *domain.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		list, err := svc.ListComfyDirectives()
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, list)
	}
}

func handleGetComfyDirective(svc *domain.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		content, err := svc.ReadComfyDirective(r.PathValue(pathParamDirectiveID))
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, contentResponse{Content: content})
	}
}

func handleSaveComfyDirective(svc *domain.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		content, _, ok := decodeContentBody(w, r)
		if !ok {
			return
		}
		if err := svc.WriteComfyDirective(r.PathValue(pathParamDirectiveID), content); err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, successResponse{Success: true})
	}
}

// ---- 共通 ----

// decodeContent は { content } ボディを読む。キー無し（nil）は 400、空文字は許可。
func decodeContent(w http.ResponseWriter, r *http.Request) (string, bool) {
	content, _, ok := decodeContentBody(w, r)
	return content, ok
}

// decodeContentBody は { content, renameIfExists } ボディを読む。
// renameIfExists 省略は false（現行 API 互換）。
func decodeContentBody(w http.ResponseWriter, r *http.Request) (string, bool, bool) {
	var body struct {
		Content        *string `json:"content"`
		RenameIfExists bool    `json:"renameIfExists"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		apierror.Write(w, apierror.BadRequestKey(errKeyInvalidJSONBody))
		return "", false, false
	}
	if body.Content == nil {
		apierror.Write(w, apierror.BadRequestKey(errKeyContentRequired))
		return "", false, false
	}
	return *body.Content, body.RenameIfExists, true
}

// writeError はドメイン/FS エラーを HTTP ステータスへ変換する。
//   - 未知カテゴリ            -> 400
//   - 名前検証エラー（safename）-> 400
//   - 境界外                  -> 403
//   - 未存在                  -> 404
//   - その他                  -> 500
func writeError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, domain.ErrUnknownCategory):
		apierror.Write(w, apierror.BadRequestKey(errKeyUnknownCategory))
	case errors.Is(err, domain.ErrUnknownProviderInstruction):
		apierror.Write(w, apierror.BadRequestKey(errKeyUnknownCategory))
	case errors.Is(err, domain.ErrUnknownComfyDirective):
		apierror.Write(w, apierror.BadRequestKey(errKeyUnknownCategory))
	case isNameError(err):
		apierror.Write(w, apierror.BadRequestKey(errKeyInvalidName))
	case errors.Is(err, paths.ErrOutsideWorkspace):
		apierror.Write(w, apierror.ForbiddenKey(errKeyPathForbidden))
	case errors.Is(err, fs.ErrNotExist):
		apierror.Write(w, apierror.NotFoundKey(errKeyTargetNotFound))
	default:
		apierror.Write(w, apierror.Internal(err))
	}
}

func isNameError(err error) bool {
	return errors.Is(err, safename.ErrEmpty) ||
		errors.Is(err, safename.ErrTooLong) ||
		errors.Is(err, safename.ErrInvalidChar) ||
		errors.Is(err, safename.ErrReserved) ||
		errors.Is(err, safename.ErrTrailing)
}

func writeJSON(w http.ResponseWriter, v any) {
	if err := apiresponse.WriteJSON(w, http.StatusOK, v); err != nil {
		apierror.Write(w, apierror.Internal(err))
	}
}
