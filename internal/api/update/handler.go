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

// statusResponse は本体適用の進捗に、承認済みモジュール更新の適用進行を同梱する
// （本体更新後の起動時にフロントが「サイドカー更新中／完了」を表示するため）。
type statusResponse struct {
	updatesvc.ApplyStatus
	ModuleApply updatesvc.ModuleApplyStatus `json:"moduleApply"`
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
				if err := annotateModuleNotices(deps.Update, modules); err != nil {
					apierror.Write(w, apierror.Internal(err))
					return
				}
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
		apiresponse.WriteJSON(w, http.StatusOK, statusResponse{
			ApplyStatus: deps.Update.ApplyState(),
			ModuleApply: deps.Update.ModuleApplyState(),
		})
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

// annotateModuleNotices は各モジュールに告知抑止状態（スキップ済み・「後で」当日）を
// 付与する。判定は更新確認設定側（domain/update）で行い、ここでは結果を書き戻すだけ
// にする（sponsor 側に設定依存を持ち込まない）。
func annotateModuleNotices(svc *updatesvc.Service, entries []sponsorsvc.ModuleUpdateEntry) error {
	queries := make([]updatesvc.ModuleNoticeQuery, 0, len(entries))
	for _, entry := range entries {
		queries = append(queries, updatesvc.ModuleNoticeQuery{
			ID:                   entry.ID,
			Version:              entry.LatestVersion,
			CompanionPackVersion: entry.LatestCompanionPackVersion,
		})
	}
	flags, err := svc.ModuleNoticeFlags(queries)
	if err != nil {
		return err
	}
	for i := range entries {
		flag := flags[entries[i].ID]
		entries[i].Skipped = flag.Skipped
		entries[i].PostponedToday = flag.PostponedToday
	}
	return nil
}
