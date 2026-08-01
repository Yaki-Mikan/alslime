// Package update はアップデート確認の API（ファイル自動更新、確認 01番 8章）。
//
// 本体の更新確認は domain/update、モジュールの更新確認は domain/sponsor が実体で、
// 本ハンドラが check レスポンスへ合成する（domain 間の依存を作らない）。
package update

import (
	"encoding/json"
	"errors"
	"net/http"

	"alslime/internal/api/apierror"
	"alslime/internal/api/apiresponse"
	"alslime/internal/config"
	sponsorsvc "alslime/internal/domain/sponsor"
	updatesvc "alslime/internal/domain/update"
	"alslime/internal/i18n"
	"alslime/internal/logging"
)

// Deps は update API の依存。
type Deps struct {
	Update *updatesvc.Service
	// Sponsor はモジュール更新確認の実体（nil ならモジュール部分を返さない）。
	Sponsor *sponsorsvc.Service
}

type checkResponse struct {
	App       updatesvc.AppUpdateInfo        `json:"app"`
	AutoCheck bool                           `json:"autoCheck"`
	Modules   []sponsorsvc.ModuleUpdateEntry `json:"modules"`
}

// Register は update 系ルートを mux へ登録する。
func Register(mux *http.ServeMux, deps Deps) {
	mux.HandleFunc("GET "+config.APIPrefix+"/update/check", func(w http.ResponseWriter, r *http.Request) {
		app, err := deps.Update.CheckApp(r.Context())
		if err != nil {
			apierror.Write(w, apierror.Internal(err))
			return
		}
		autoCheck, err := deps.Update.AutoCheckEnabled()
		if err != nil {
			apierror.Write(w, apierror.Internal(err))
			return
		}
		modules := []sponsorsvc.ModuleUpdateEntry{}
		if deps.Sponsor != nil {
			entries, modErr := deps.Sponsor.ModulesUpdateInfo(r.Context(), app.Current)
			switch {
			case modErr == nil:
				modules = entries
			case errors.Is(modErr, sponsorsvc.ErrModuleNoToken):
				// 未ログインはモジュール確認をスキップ（本体分のみで成立させる）。
			default:
				// サーバー到達不能等も本体分は返す（起動時チェックを止めない）。
				logging.Info("update: module check skipped: %v", modErr)
			}
		}
		apiresponse.WriteJSON(w, http.StatusOK, checkResponse{
			App: app, AutoCheck: autoCheck, Modules: modules,
		})
	})

	// 直接アップデート（01番 5章・8章）。開始は前提検査のみ同期で行い、
	// 実処理は goroutine で進む。進捗は GET /api/update/status でポーリングする。
	mux.HandleFunc("POST "+config.APIPrefix+"/update/apply", func(w http.ResponseWriter, r *http.Request) {
		if err := deps.Update.StartApply(r.Context()); err != nil {
			switch {
			case errors.Is(err, updatesvc.ErrJobsRunning):
				apierror.Write(w, apierror.NewKey(http.StatusConflict, i18n.KeyErrorUpdateJobsRunning))
			case errors.Is(err, updatesvc.ErrApplyInProgress):
				apierror.Write(w, apierror.NewKey(http.StatusConflict, i18n.KeyErrorUpdateApplyInProgress))
			case errors.Is(err, updatesvc.ErrApplyUnavailable):
				apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorUpdateApplyUnavailable))
			default:
				apierror.Write(w, apierror.Internal(err))
			}
			return
		}
		apiresponse.WriteJSON(w, http.StatusAccepted, deps.Update.ApplyState())
	})

	mux.HandleFunc("GET "+config.APIPrefix+"/update/status", func(w http.ResponseWriter, _ *http.Request) {
		apiresponse.WriteJSON(w, http.StatusOK, deps.Update.ApplyState())
	})

	mux.HandleFunc("GET "+config.APIPrefix+"/update/settings", func(w http.ResponseWriter, _ *http.Request) {
		view, err := deps.Update.Settings()
		if err != nil {
			apierror.Write(w, apierror.Internal(err))
			return
		}
		apiresponse.WriteJSON(w, http.StatusOK, view)
	})

	mux.HandleFunc("POST "+config.APIPrefix+"/update/settings", func(w http.ResponseWriter, r *http.Request) {
		var patch updatesvc.SettingsPatch
		if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
			apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorInvalidJSONBody))
			return
		}
		view, err := deps.Update.UpdateSettings(patch)
		if err != nil {
			apierror.Write(w, apierror.Internal(err))
			return
		}
		apiresponse.WriteJSON(w, http.StatusOK, view)
	})
}
