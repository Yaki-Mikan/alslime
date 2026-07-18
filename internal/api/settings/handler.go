// Package settings は設定・リソース系の軽量 API を提供する。
//
// 現行 Node 版 routes/settings.ts のうち、保存先が確定しているものを移植する。
//   - GET  /api/workspace        WORKSPACE_ROOT とプラットフォーム
//   - GET  /api/settings/global  グローバル設定（デフォルト設定.json）
//   - POST /api/settings/global  グローバル設定の部分更新
//   - GET  /api/settings         PWA（アプリ表示）設定
//   - POST /api/settings         PWA 設定の部分更新（パーシャルマージ）
//
// /api/settings（PWA設定）の保存先は WORKSPACE_ROOT 配下のアプリ専用設定
// （ロールプレイ/グローバル/各種設定/pwa-settings.json）に確定済み。
//
// 実装パターンは handler -> service -> storage を踏襲する。
// 本パッケージは handler 層に徹し、値の生成・永続化は service / storage へ委譲する。
package settings

import (
	"encoding/json"
	"errors"
	"net/http"
	"runtime"

	"alslime/internal/api/apierror"
	"alslime/internal/api/apiresponse"
	"alslime/internal/config"
	globalsettingssvc "alslime/internal/domain/globalsettings"
	pwasettingssvc "alslime/internal/domain/pwasettings"
	serversettingssvc "alslime/internal/domain/serversettings"
	ssrpsettingssvc "alslime/internal/domain/ssrpsettings"
)

// Deps はハンドラが必要とする依存。
type Deps struct {
	// WorkspaceRoot は /api/workspace で返す基準パス。
	WorkspaceRoot string
	// GlobalSettings は /api/settings/global の取得・更新を担う service。
	GlobalSettings *globalsettingssvc.Service
	// SSRPSettings は relationships / replacement-config / language / default を担う service。
	SSRPSettings *ssrpsettingssvc.Service
	// PWASettings は /api/settings（PWA アプリ表示設定）の取得・更新を担う service。
	PWASettings *pwasettingssvc.Service
	// ServerSettings は /api/settings/server（次回起動用サーバー設定）を担う service。
	ServerSettings *serversettingssvc.Service
}

// Register は settings 系ルートを mux へ登録する。
//
// 規約案に従い、ルートのマウントは Register(mux, deps) 形式へ集約する。
func Register(mux *http.ServeMux, deps Deps) {
	mux.HandleFunc(http.MethodGet+" "+config.APIPrefix+routeWorkspace, handleWorkspace(deps))
	mux.HandleFunc(http.MethodGet+" "+config.APIPrefix+routeSettingsGlobal, handleGetGlobal(deps))
	mux.HandleFunc(http.MethodPost+" "+config.APIPrefix+routeSettingsGlobal, handlePostGlobal(deps))
	mux.HandleFunc(http.MethodGet+" "+config.APIPrefix+routeSettings, handleGetPWA(deps))
	mux.HandleFunc(http.MethodPost+" "+config.APIPrefix+routeSettings, handlePostPWA(deps))
	mux.HandleFunc(http.MethodGet+" "+config.APIPrefix+routeSettingsServer, handleGetServer(deps))
	mux.HandleFunc(http.MethodPost+" "+config.APIPrefix+routeSettingsServer, handlePostServer(deps))
	registerSSRPSettings(mux, deps)
}

// workspaceResponse は /api/workspace のレスポンス。
// 現行 Node 版（{ root, platform }）と同形を保つ。
type workspaceResponse struct {
	Root     string `json:"root"`
	Platform string `json:"platform"`
}

// handleWorkspace は WORKSPACE_ROOT とプラットフォームを返す。
func handleWorkspace(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, workspaceResponse{
			Root:     deps.WorkspaceRoot,
			Platform: platformName(),
		})
	}
}

// platformName はプラットフォーム名を返す。
//
// 現行 Node 版は process.platform（win32 等）を返していたが、これには合わせない。
// フロントは配布版で同梱・作り直す前提で、合わせる相手は新フロントであり、
// 新フロントは runtime.GOOS（"windows" / "linux" / "darwin"）を前提に作る。
func platformName() string {
	return runtime.GOOS
}

// handleGetGlobal はグローバル設定を返す。未作成なら空オブジェクト。
func handleGetGlobal(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		settings, err := deps.GlobalSettings.Get()
		if err != nil {
			apierror.Write(w, apierror.Internal(err))
			return
		}
		writeJSON(w, settings)
	}
}

// globalUpdateResponse は POST /api/settings/global のレスポンス。
// 現行 Node 版（{ success, settings }）と同形を保つ。
type globalUpdateResponse struct {
	Success  bool           `json:"success"`
	Settings map[string]any `json:"settings"`
}

// handlePostGlobal はグローバル設定を部分更新する。
//
// ボディは任意キーの JSON オブジェクト。既存設定へ浅くマージして保存する。
// Antigravity モード切替の副作用は本移植段階では持たない（値は永続化のみ）。
func handlePostGlobal(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var patch map[string]any
		if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
			apierror.Write(w, apierror.BadRequestKey(errKeyInvalidJSONBody))
			return
		}
		if patch == nil {
			apierror.Write(w, apierror.BadRequestKey(errKeyEmptyJSONBody))
			return
		}

		updated, err := deps.GlobalSettings.Update(patch)
		if err != nil {
			apierror.Write(w, apierror.Internal(err))
			return
		}
		writeJSON(w, globalUpdateResponse{Success: true, Settings: updated})
	}
}

// handleGetPWA は PWA（アプリ表示）設定を返す。既定値補完済み。
func handleGetPWA(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		settings, err := deps.PWASettings.Get()
		if err != nil {
			apierror.Write(w, apierror.Internal(err))
			return
		}
		writeJSON(w, settings)
	}
}

// handlePostPWA は PWA 設定をパーシャルマージして保存する。
//
// 現行 Node 版と同じく、ボディは任意キーの JSON オブジェクト。既存へ浅くマージし、
// レスポンスは { success, settings }（マージ後の全体）を返す。
func handlePostPWA(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var patch map[string]any
		if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
			apierror.Write(w, apierror.BadRequestKey(errKeyInvalidJSONBody))
			return
		}
		updated, err := deps.PWASettings.Update(patch)
		if err != nil {
			apierror.Write(w, apierror.Internal(err))
			return
		}
		writeJSON(w, globalUpdateResponse{Success: true, Settings: updated})
	}
}

// serverSettingsResponse は /api/settings/server のレスポンス。
//
// restartRequired は「保存値は次回起動時に反映」の明示。稼働中プロセスをここでは再起動しない。
type serverSettingsResponse struct {
	Success         bool                       `json:"success,omitempty"`
	Settings        serversettingssvc.Settings `json:"settings"`
	RestartRequired bool                       `json:"restartRequired"`
}

// handleGetServer は次回起動用サーバー設定を返す。
func handleGetServer(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		settings, err := deps.ServerSettings.Get()
		if err != nil {
			apierror.Write(w, apierror.Internal(err))
			return
		}
		writeJSON(w, serverSettingsResponse{
			Settings:        settings,
			RestartRequired: true,
		})
	}
}

// handlePostServer は次回起動用サーバー設定を部分更新して保存する。
func handlePostServer(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var patch serversettingssvc.Patch
		if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
			apierror.Write(w, apierror.BadRequestKey(errKeyInvalidJSONBody))
			return
		}
		updated, err := deps.ServerSettings.Update(patch)
		if err != nil {
			writeServerSettingsError(w, err)
			return
		}
		writeJSON(w, serverSettingsResponse{
			Success:         true,
			Settings:        updated,
			RestartRequired: true,
		})
	}
}

func writeServerSettingsError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, serversettingssvc.ErrInvalidPort):
		apierror.Write(w, apierror.BadRequestKey(errKeyInvalidPort))
	case errors.Is(err, serversettingssvc.ErrInvalidBindAddress):
		apierror.Write(w, apierror.BadRequestKey(errKeyInvalidBind))
	default:
		apierror.Write(w, apierror.Internal(err))
	}
}

// writeJSON は 200 で JSON を書き出す共通処理。
// エンコード失敗時は内部エラーを隠した 500 を返す。
func writeJSON(w http.ResponseWriter, v any) {
	if err := apiresponse.WriteJSON(w, http.StatusOK, v); err != nil {
		apierror.Write(w, apierror.Internal(err))
	}
}
