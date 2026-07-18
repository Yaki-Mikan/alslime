// Package sponsor は支援者機能の API（Phase D-3）。
//
// ログイン開始（認可 URL の払い出し）・状態取得・refresh・ログアウトを提供する。
// フロー実体は domain/sponsor、トークンの署名検証は core 側 gate に閉じる。
package sponsor

import (
	"encoding/json"
	"errors"
	"net/http"

	"alslime/internal/api/apierror"
	"alslime/internal/api/apiresponse"
	"alslime/internal/config"
	sponsorsvc "alslime/internal/domain/sponsor"
	"alslime/internal/i18n"
)

// Register は sponsor 系ルートを mux へ登録する。
func Register(mux *http.ServeMux, svc *sponsorsvc.Service) {
	mux.HandleFunc("GET "+config.APIPrefix+"/sponsor/status", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, svc.Status())
	})

	mux.HandleFunc("POST "+config.APIPrefix+"/sponsor/login", func(w http.ResponseWriter, _ *http.Request) {
		authURL, err := svc.StartLogin()
		if err != nil {
			apierror.Write(w, apierror.Internal(err))
			return
		}
		writeJSON(w, map[string]string{"authUrl": authURL})
	})

	mux.HandleFunc("POST "+config.APIPrefix+"/sponsor/logout", func(w http.ResponseWriter, _ *http.Request) {
		if err := svc.Logout(); err != nil {
			apierror.Write(w, apierror.Internal(err))
			return
		}
		writeJSON(w, svc.Status())
	})

	mux.HandleFunc("POST "+config.APIPrefix+"/sponsor/refresh", func(w http.ResponseWriter, r *http.Request) {
		if err := svc.Refresh(r.Context()); err != nil {
			switch {
			case errors.Is(err, sponsorsvc.ErrNoToken):
				apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorSponsorNoToken))
			case errors.Is(err, sponsorsvc.ErrRefreshRejected):
				apierror.Write(w, apierror.ForbiddenKey(i18n.KeyErrorSponsorRefreshRejected))
			default:
				apierror.Write(w, apierror.WrapKey(http.StatusBadGateway, i18n.KeyErrorSponsorRefreshFailed, err))
			}
			return
		}
		writeJSON(w, svc.Status())
	})

	// サイドカーモジュールの配置状態と取得（14番 6章の本体側受け口。複数モジュール対応）。
	mux.HandleFunc("GET "+config.APIPrefix+"/sponsor/modules", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, map[string]any{"modules": svc.ModulesStatus()})
	})

	mux.HandleFunc("POST "+config.APIPrefix+"/sponsor/module/install", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Module string `json:"module"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Module == "" {
			apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorInvalidJSONBody))
			return
		}
		version, err := svc.InstallModule(r.Context(), req.Module)
		if err != nil {
			switch {
			case errors.Is(err, sponsorsvc.ErrModuleUnknown):
				apierror.Write(w, apierror.NotFoundKey(i18n.KeyErrorSponsorModuleUnavailable))
			case errors.Is(err, sponsorsvc.ErrModuleNoToken):
				apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorSponsorNoToken))
			case errors.Is(err, sponsorsvc.ErrModuleRejected):
				apierror.Write(w, apierror.ForbiddenKey(i18n.KeyErrorSponsorModuleRejected))
			case errors.Is(err, sponsorsvc.ErrModuleUnavailable):
				apierror.Write(w, apierror.NotFoundKey(i18n.KeyErrorSponsorModuleUnavailable))
			default:
				apierror.Write(w, apierror.WrapKey(http.StatusBadGateway, i18n.KeyErrorSponsorModuleInstallFailed, err))
			}
			return
		}
		writeJSON(w, map[string]any{
			"success":         true,
			"version":         version,
			"restartRequired": true,
			"modules":         svc.ModulesStatus(),
		})
	})
}

// writeJSON は 200 で JSON を書き出す。
func writeJSON(w http.ResponseWriter, v any) {
	if err := apiresponse.WriteJSON(w, http.StatusOK, v); err != nil {
		apierror.Write(w, apierror.Internal(err))
	}
}
