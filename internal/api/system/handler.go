// Package system は配布版の運用支援 API（診断・ヘルスチェック等）を提供する。
//
// 最初の最小実装は GET /api/system/health（交換日記 22 Stage 1）。
// 軽量で壊れにくいことを優先し、外部 CLI や ComfyUI へ深く触らない。
// レスポンスは機械的な状態 + messageKey を返し、表示文言はフロント i18n が解決する。
package system

import (
	"net/http"
	"os"
	"path/filepath"
	"runtime"

	"alslime/internal/api/apierror"
	"alslime/internal/api/apiresponse"
	"alslime/internal/buildinfo"
	"alslime/internal/config"
	"alslime/internal/coreapi"
	"alslime/internal/system/backup"
	"alslime/internal/system/cache"
	"alslime/internal/system/clistatus"
	"alslime/internal/system/configcheck"
	"alslime/internal/system/diagnostics"
)

// Deps は system ハンドラの依存。
type Deps struct {
	// WorkspaceRoot は WORKSPACE_ROOT 絶対パス。
	WorkspaceRoot string
	// Host は HTTP サーバーのバインドアドレス。
	Host string
	// Port は HTTP サーバーのリッスンポート。
	Port int
	// ChatCLITimeoutSeconds は外部AI CLIを待つ最大秒数。
	ChatCLITimeoutSeconds int
	// ConfigCheck は設定ファイル検査を担う（config-check / diagnostics で使う）。
	ConfigCheck *configcheck.Checker
	// CLIStatus は外部 CLI の軽量検査を担う。
	CLIStatus clistatus.Checker
	// Cache はアプリ管理 cache の状態確認・削除を担う。
	Cache *cache.Manager
	// Backup は設定バックアップの作成・一覧取得を担う。
	Backup *backup.Manager
	// Features は機能ゲートの判定境界（12番 3.3。実装は core 側）。
	// nil の場合は空スナップショット（全機能無効表示）。
	Features coreapi.FeatureGate
}

// Register は system 系ルートを mux へ登録する。
func Register(mux *http.ServeMux, deps Deps) {
	mux.HandleFunc("GET "+config.APIPrefix+"/system/health", handleHealth(deps))
	mux.HandleFunc("GET "+config.APIPrefix+"/system/config-check", handleConfigCheckGet(deps))
	mux.HandleFunc("POST "+config.APIPrefix+"/system/config-check", handleConfigCheckPost(deps))
	mux.HandleFunc("GET "+config.APIPrefix+"/system/cli-status", handleCLIStatus(deps))
	mux.HandleFunc("GET "+config.APIPrefix+"/system/cache", handleCacheStatus(deps))
	mux.HandleFunc("POST "+config.APIPrefix+"/system/cache/clear", handleCacheClear(deps))
	mux.HandleFunc("POST "+config.APIPrefix+"/system/backup", handleBackupCreate(deps))
	mux.HandleFunc("GET "+config.APIPrefix+"/system/backups", handleBackupList(deps))
	mux.HandleFunc("GET "+config.APIPrefix+"/system/diagnostics", handleDiagnostics(deps))
}

// healthResponse は GET /api/system/health のレスポンス。
//
// version / buildMode は buildinfo（ldflags 正本）から。支援状態（entitlement）は
// gate（トークン検証。12番 3.3）から。status は checks の集約。
// 文言はフロント i18n が messageKey で解決する。
type healthResponse struct {
	Status                diagnostics.CheckStatus   `json:"status"`
	Version               string                    `json:"version"`
	BuildMode             string                    `json:"buildMode"`
	OS                    string                    `json:"os"`
	Arch                  string                    `json:"arch"`
	WorkspaceRoot         string                    `json:"workspaceRoot"`
	Host                  string                    `json:"host"`
	Port                  int                       `json:"port"`
	ChatCLITimeoutSeconds int                       `json:"chatCliTimeoutSeconds"`
	Features              map[string]bool           `json:"features"`
	Entitlement           coreapi.EntitlementStatus `json:"entitlement"`
	Checks                []diagnostics.CheckResult `json:"checks"`
}

// handleHealth は軽量ヘルスチェックを返す。
//
// 現段階のチェックは「WORKSPACE_ROOT への書き込み可否」のみ。
// 外部 CLI・ComfyUI・設定全走査などの重い検査はここでは行わない。
func handleHealth(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, buildHealth(deps))
	}
}

// buildHealth は health レスポンスを組み立てる（health / diagnostics で共用）。
func buildHealth(deps Deps) healthResponse {
	info := buildinfo.Snapshot()
	checks := []diagnostics.CheckResult{
		workspaceWritableCheck(deps.WorkspaceRoot),
	}
	return healthResponse{
		Status:                diagnostics.Aggregate(checks),
		Version:               info.Version,
		BuildMode:             info.BuildMode,
		OS:                    runtime.GOOS,
		Arch:                  runtime.GOARCH,
		WorkspaceRoot:         deps.WorkspaceRoot,
		Host:                  deps.Host,
		Port:                  deps.Port,
		ChatCLITimeoutSeconds: deps.ChatCLITimeoutSeconds,
		Features:              featureSnapshot(deps.Features),
		Entitlement:           entitlementSnapshot(deps.Features),
		Checks:                checks,
	}
}

// featureSnapshot は gate 未注入（テスト等）でも安全に空スナップショットを返す。
func featureSnapshot(gate coreapi.FeatureGate) map[string]bool {
	if gate == nil {
		return map[string]bool{}
	}
	return gate.PublicSnapshot()
}

// entitlementSnapshot は gate 未注入でも安全に「トークン無し」を返す。
func entitlementSnapshot(gate coreapi.FeatureGate) coreapi.EntitlementStatus {
	if gate == nil {
		return coreapi.EntitlementStatus{State: coreapi.TokenStateNone}
	}
	return gate.Entitlement()
}

// handleConfigCheckGet は直近の config-check 結果を返す（未スキャンなら一度スキャン）。
func handleConfigCheckGet(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		result, err := deps.ConfigCheck.Latest()
		if err != nil {
			apierror.Write(w, apierror.Internal(err))
			return
		}
		writeJSON(w, result)
	}
}

// handleConfigCheckPost は再スキャンして config-check 結果を返す。
func handleConfigCheckPost(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		result, err := deps.ConfigCheck.Scan()
		if err != nil {
			apierror.Write(w, apierror.Internal(err))
			return
		}
		writeJSON(w, result)
	}
}

// diagnosticsResponse は GET /api/system/diagnostics のレスポンス。
//
// health 相当 + config-check + cli-status を束ねる総合診断。
type diagnosticsResponse struct {
	Status      diagnostics.CheckStatus `json:"status"`
	Health      healthResponse          `json:"health"`
	ConfigCheck configcheck.Result      `json:"configCheck"`
	CLIStatus   clistatus.Status        `json:"cliStatus"`
	Cache       cache.Status            `json:"cache"`
	Backups     backup.ListResult       `json:"backups"`
}

// handleCLIStatus は外部 CLI の存在確認を返す。CLI は実行しない。
func handleCLIStatus(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, deps.CLIStatus.Check())
	}
}

// handleCacheStatus はアプリ管理 cache の状態を返す。
func handleCacheStatus(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		status, err := deps.Cache.Status()
		if err != nil {
			apierror.Write(w, apierror.Internal(err))
			return
		}
		writeJSON(w, status)
	}
}

// handleCacheClear はアプリ管理 cache 配下だけを削除する。
func handleCacheClear(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		result, err := deps.Cache.Clear()
		if err != nil {
			apierror.Write(w, apierror.Internal(err))
			return
		}
		writeJSON(w, result)
	}
}

// handleBackupCreate は設定バックアップ zip を作成する。
func handleBackupCreate(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		result, err := deps.Backup.Create()
		if err != nil {
			apierror.Write(w, apierror.Internal(err))
			return
		}
		writeJSON(w, result)
	}
}

// handleBackupList は作成済みバックアップ一覧を返す。
func handleBackupList(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		result, err := deps.Backup.List()
		if err != nil {
			apierror.Write(w, apierror.Internal(err))
			return
		}
		writeJSON(w, result)
	}
}

// handleDiagnostics は health + config-check + cli-status + cache + backups を束ねた総合診断を返す。
func handleDiagnostics(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		health := buildHealth(deps)
		cc, err := deps.ConfigCheck.Latest()
		if err != nil {
			apierror.Write(w, apierror.Internal(err))
			return
		}
		cli := deps.CLIStatus.Check()
		cacheStatus, err := deps.Cache.Status()
		if err != nil {
			apierror.Write(w, apierror.Internal(err))
			return
		}
		backups, err := deps.Backup.List()
		if err != nil {
			apierror.Write(w, apierror.Internal(err))
			return
		}
		// 総合 status は health と config-check の重い方へ集約する。
		overall := diagnostics.Aggregate([]diagnostics.CheckResult{
			{ID: "health", Status: health.Status},
			{ID: "configCheck", Status: cc.Status},
			{ID: "cliStatus", Status: cli.Status},
			{ID: "cache", Status: cacheStatus.Status},
			{ID: "backups", Status: backups.Status},
		})
		writeJSON(w, diagnosticsResponse{
			Status:      overall,
			Health:      health,
			ConfigCheck: cc,
			CLIStatus:   cli,
			Cache:       cacheStatus,
			Backups:     backups,
		})
	}
}

// workspaceWritableCheck は WORKSPACE_ROOT に書き込めるかを確認する。
//
// 一時ファイルを作って即削除する。成功なら ok、失敗なら error。
// details には機械情報（試行パス断片）のみを入れ、秘匿情報は入れない。
func workspaceWritableCheck(root string) diagnostics.CheckResult {
	const id = "workspace.writable"

	probe, err := os.CreateTemp(root, ".health-*.tmp")
	if err != nil {
		return diagnostics.CheckResult{
			ID:         id,
			Status:     diagnostics.CheckError,
			MessageKey: "diagnostics.workspaceNotWritable",
		}
	}
	name := probe.Name()
	_ = probe.Close()
	_ = os.Remove(name)

	return diagnostics.CheckResult{
		ID:         id,
		Status:     diagnostics.CheckOK,
		MessageKey: "diagnostics.workspaceWritable",
		Details:    map[string]any{"dir": filepath.Base(root)},
	}
}

// writeJSON は 200 で JSON を書き出す。
func writeJSON(w http.ResponseWriter, v any) {
	if err := apiresponse.WriteJSON(w, http.StatusOK, v); err != nil {
		apierror.Write(w, apierror.Internal(err))
	}
}
