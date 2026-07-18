package settings

import (
	"encoding/json"
	"errors"
	"net/http"

	"alslime/internal/api/apierror"
	"alslime/internal/config"
	ssrpsettingssvc "alslime/internal/domain/ssrpsettings"
)

// registerSSRPSettings は SSRP 単一ファイル設定系のルートを登録する。
//
// handler.go の Register から呼ぶ。handler.go の肥大化を避けるため別ファイルへ分けた。
func registerSSRPSettings(mux *http.ServeMux, deps Deps) {
	mux.HandleFunc(http.MethodGet+" "+config.APIPrefix+routeRelationships, handleRelationships(deps))
	mux.HandleFunc(http.MethodGet+" "+config.APIPrefix+routeReplacementConfig, handleGetReplacementConfig(deps))
	mux.HandleFunc(http.MethodPost+" "+config.APIPrefix+routeReplacementConfig, handlePostReplacementConfig(deps))
	mux.HandleFunc(http.MethodGet+" "+config.APIPrefix+routeLanguage, handleLanguage(deps))
	mux.HandleFunc(http.MethodGet+" "+config.APIPrefix+routeSettingsDefault, handleGetDefault(deps))
	mux.HandleFunc(http.MethodPost+" "+config.APIPrefix+routeSettingsDefault, handlePostDefault(deps))
}

// handleRelationships は関係性オプションを返す（現行は配列をそのまま返す）。
func handleRelationships(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		rels, err := deps.SSRPSettings.Relationships()
		if err != nil {
			apierror.Write(w, apierror.Internal(err))
			return
		}
		writeJSON(w, rels)
	}
}

// handleGetReplacementConfig は置換設定を返す（現行はオブジェクトをそのまま返す）。
func handleGetReplacementConfig(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		cfg, err := deps.SSRPSettings.ReplacementConfig()
		if err != nil {
			apierror.Write(w, apierror.Internal(err))
			return
		}
		writeJSON(w, cfg)
	}
}

// successResponse は保存系の現行レスポンス（{ success: true }）と同形。
type successResponse struct {
	Success bool `json:"success"`
}

// handlePostReplacementConfig は置換設定を保存する（全置換）。
func handlePostReplacementConfig(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var cfg map[string]any
		if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
			apierror.Write(w, apierror.BadRequestKey(errKeyInvalidJSONBody))
			return
		}
		if err := deps.SSRPSettings.SaveReplacementConfig(cfg); err != nil {
			apierror.Write(w, apierror.Internal(err))
			return
		}
		writeJSON(w, successResponse{Success: true})
	}
}

// handleLanguage は :lang の言語設定を返す。未存在なら空オブジェクト。
func handleLanguage(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		lang := r.PathValue(pathParamLang)
		settings, err := deps.SSRPSettings.Language(lang)
		if err != nil {
			if errors.Is(err, ssrpsettingssvc.ErrInvalidLang) {
				apierror.Write(w, apierror.BadRequestKey(errKeyInvalidLang))
				return
			}
			apierror.Write(w, apierror.Internal(err))
			return
		}
		writeJSON(w, settings)
	}
}

// handleGetDefault はデフォルト設定（SSRPデフォルト）を返す。未存在なら空オブジェクト。
func handleGetDefault(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		settings, err := deps.SSRPSettings.DefaultSettings()
		if err != nil {
			apierror.Write(w, apierror.Internal(err))
			return
		}
		writeJSON(w, settings)
	}
}

// handlePostDefault はデフォルト設定を保存する（全置換）。
//
// /api/settings/global（マージ）とは意味が異なり、こちらは受け取った内容で全置換する。
func handlePostDefault(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var settings map[string]any
		if err := json.NewDecoder(r.Body).Decode(&settings); err != nil {
			apierror.Write(w, apierror.BadRequestKey(errKeyInvalidJSONBody))
			return
		}
		if err := deps.SSRPSettings.SaveDefaultSettings(settings); err != nil {
			apierror.Write(w, apierror.Internal(err))
			return
		}
		writeJSON(w, successResponse{Success: true})
	}
}
