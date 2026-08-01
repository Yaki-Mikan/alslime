// Package apiproviders は openai_compat 接続先管理の HTTP ハンドラ。
//
// キー値・マスク派生文字列・物理絶対パスをレスポンスへ出さない。
package apiproviders

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"alslime/internal/api/apierror"
	"alslime/internal/api/apiresponse"
	"alslime/internal/config"
	apiprovsvc "alslime/internal/domain/apiproviders"
	"alslime/internal/i18n"
)

// pathParamID は接続先 ID のパスパラメータ名。
const pathParamID = "id"

// connectionRequest は作成・更新のリクエストボディ。
//
// APIKey は 3 値区別: フィールド省略（nil）= 既存維持／非空 = 上書き。
// ClearAPIKey=true = 削除。同時指定は 400。
type connectionRequest struct {
	Preset            string         `json:"preset"`
	Label             string         `json:"label"`
	BaseURL           string         `json:"baseUrl"`
	AuthScheme        string         `json:"authScheme"`
	Enabled           *bool          `json:"enabled"`
	ForceNonStreaming bool           `json:"forceNonStreaming"`
	ExtraParams       map[string]any `json:"extraParams"`
	APIKey            *string        `json:"apiKey"`
	ClearAPIKey       bool           `json:"clearApiKey"`
}

func (req connectionRequest) input() apiprovsvc.Input {
	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	return apiprovsvc.Input{
		Preset:            req.Preset,
		Label:             req.Label,
		BaseURL:           req.BaseURL,
		AuthScheme:        req.AuthScheme,
		Enabled:           enabled,
		ForceNonStreaming: req.ForceNonStreaming,
		ExtraParams:       req.ExtraParams,
	}
}

// systemPromptResponse は接続別追加指示の応答。
// File は設定ファイルエディタでの表示用論理パスで、物理絶対パスは返さない。
type systemPromptResponse struct {
	Content string `json:"content"`
	Label   string `json:"label"`
	Locale  string `json:"locale"`
	File    string `json:"file"`
}

// Register は接続先管理のルートを登録する。
func Register(mux *http.ServeMux, svc *apiprovsvc.Service) {
	base := config.APIPrefix + "/api-providers"

	mux.HandleFunc("GET "+base, func(w http.ResponseWriter, _ *http.Request) {
		views, err := svc.List()
		if err != nil {
			apierror.Write(w, apierror.WrapKey(http.StatusInternalServerError, i18n.KeyAPIProvidersErrorLoadFailed, err))
			return
		}
		if views == nil {
			views = []apiprovsvc.ConnectionView{}
		}
		_ = apiresponse.WriteJSON(w, http.StatusOK, map[string]any{"connections": views})
	})

	mux.HandleFunc("GET "+base+"/presets", func(w http.ResponseWriter, _ *http.Request) {
		_ = apiresponse.WriteJSON(w, http.StatusOK, map[string]any{"presets": apiprovsvc.Presets()})
	})

	mux.HandleFunc("POST "+base, func(w http.ResponseWriter, r *http.Request) {
		var req connectionRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorInvalidJSONBody))
			return
		}
		apiKey := ""
		if req.APIKey != nil {
			apiKey = *req.APIKey
		}
		view, err := svc.Create(req.input(), apiKey)
		if err != nil {
			writeServiceError(w, err, i18n.KeyAPIProvidersErrorSaveFailed)
			return
		}
		_ = apiresponse.WriteJSON(w, http.StatusOK, view)
	})

	mux.HandleFunc("PUT "+base+"/{"+pathParamID+"}", func(w http.ResponseWriter, r *http.Request) {
		var req connectionRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorInvalidJSONBody))
			return
		}
		view, err := svc.Update(r.PathValue(pathParamID), req.input(), req.APIKey, req.ClearAPIKey)
		if err != nil {
			writeServiceError(w, err, i18n.KeyAPIProvidersErrorSaveFailed)
			return
		}
		_ = apiresponse.WriteJSON(w, http.StatusOK, view)
	})

	mux.HandleFunc("DELETE "+base+"/{"+pathParamID+"}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue(pathParamID)
		// dryRun は既定 true（明示的に false を指定した場合のみ実削除）。
		dryRun := !strings.EqualFold(r.URL.Query().Get("dryRun"), "false")
		if dryRun {
			result, err := svc.DryRunDelete(id)
			if err != nil {
				writeServiceError(w, err, i18n.KeyAPIProvidersErrorDryRunFailed)
				return
			}
			_ = apiresponse.WriteJSON(w, http.StatusOK, result)
			return
		}
		result, err := svc.Delete(id)
		if err != nil {
			var cascade *apiprovsvc.CascadeError
			if errors.As(err, &cascade) {
				// ステップ表示付き診断（{{step}}/{{total}}。再実行で前方回復）。
				apierror.WriteWithDetails(w, http.StatusInternalServerError,
					i18n.KeyAPIProvidersErrorCascadeStepFailed,
					map[string]any{"step": cascade.Step, "total": cascade.Total})
				return
			}
			writeServiceError(w, err, i18n.KeyAPIProvidersErrorDeleteFailed)
			return
		}
		_ = apiresponse.WriteJSON(w, http.StatusOK, result)
	})

	mux.HandleFunc("GET "+base+"/{"+pathParamID+"}/system-prompt", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue(pathParamID)
		locale := r.URL.Query().Get("locale")
		if !apiprovsvc.IsValidInstructionLocale(locale) {
			apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorInvalidLang))
			return
		}
		conn, ok, err := svc.Get(id)
		if err != nil {
			apierror.Write(w, apierror.WrapKey(http.StatusInternalServerError, i18n.KeyAPIProvidersErrorSystemPromptLoad, err))
			return
		}
		if !ok {
			apierror.Write(w, apierror.NotFoundKey(i18n.KeyAPIProvidersErrorNotFound))
			return
		}
		content, err := svc.GetInstruction(id, locale)
		if err != nil {
			apierror.Write(w, apierror.WrapKey(http.StatusInternalServerError, i18n.KeyAPIProvidersErrorSystemPromptLoad, err))
			return
		}
		_ = apiresponse.WriteJSON(w, http.StatusOK, systemPromptResponse{
			Content: content,
			Label:   conn.Label,
			Locale:  locale,
			File:    config.OpenAICompatConnectionPromptFile(id, locale),
		})
	})

	mux.HandleFunc("PUT "+base+"/{"+pathParamID+"}/system-prompt", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue(pathParamID)
		locale := r.URL.Query().Get("locale")
		if !apiprovsvc.IsValidInstructionLocale(locale) {
			apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorInvalidLang))
			return
		}
		if _, ok, err := svc.Get(id); err != nil {
			apierror.Write(w, apierror.WrapKey(http.StatusInternalServerError, i18n.KeyAPIProvidersErrorSystemPromptSave, err))
			return
		} else if !ok {
			apierror.Write(w, apierror.NotFoundKey(i18n.KeyAPIProvidersErrorNotFound))
			return
		}
		var req struct {
			Content string `json:"content"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorInvalidJSONBody))
			return
		}
		if err := svc.PutInstruction(id, locale, req.Content); err != nil {
			writeServiceError(w, err, i18n.KeyAPIProvidersErrorSystemPromptSave)
			return
		}
		_ = apiresponse.WriteJSON(w, http.StatusOK, map[string]any{"success": true})
	})

	mux.HandleFunc("POST "+base+"/{"+pathParamID+"}/test", func(w http.ResponseWriter, r *http.Request) {
		result, err := svc.Test(r.Context(), r.PathValue(pathParamID))
		if err != nil {
			writeServiceError(w, err, i18n.KeyAPIProvidersErrorLoadFailed)
			return
		}
		_ = apiresponse.WriteJSON(w, http.StatusOK, result)
	})
}

// writeServiceError は service 層のエラーを HTTP 応答へ変換する。
func writeServiceError(w http.ResponseWriter, err error, fallbackKey string) {
	if errors.Is(err, apiprovsvc.ErrConnectionNotFound) {
		apierror.Write(w, apierror.NotFoundKey(i18n.KeyAPIProvidersErrorNotFound))
		return
	}
	if apiprovsvc.IsValidationError(err) {
		apierror.Write(w, apierror.BadRequestKey(err.Error()))
		return
	}
	apierror.Write(w, apierror.WrapKey(http.StatusInternalServerError, fallbackKey, err))
}
