// Package corestub は core 未結合ビルド用の coreapi.Core スタブ実装（12番 6章）。
//
// 公開リポジトリ単体ビルド（purepublic）で使う。チャット実行・ネイティブ掃除・
// ComfyUI 連携は無効（機能ゲートは全 false、実行系は未結合エラー）で、
// それ以外の一般機能（設定・プリセット・ファイル操作等）は全て動作する。
package corestub

import (
	"context"
	"errors"
	"net/http"
	"time"

	"alslime/internal/coreapi"
	"alslime/internal/domain/models"
	"alslime/internal/i18n"
	"alslime/internal/jobs"
)

type stub struct{}

// New は corestub 実装を返す。
func New() coreapi.Core { return stub{} }

func (stub) ChatRunner() jobs.Runner                { return jobs.NotImplementedRunner{} }
func (stub) EngineRouter() coreapi.Engine           { return stubEngine{} }
func (stub) NativeSweeper() coreapi.NativeSweeper   { return noopSweeper{} }
func (stub) SidecarRemover() coreapi.SidecarRemover { return noopSidecar{} }
func (stub) Features() coreapi.FeatureGate          { return offGate{} }
func (stub) Comfy() coreapi.ComfyProvider           { return stubComfy{} }
func (stub) VerifyModuleSig([]byte, string) error {
	return errors.New(i18n.KeyErrorJobRunnerNotImplemented)
}

// stubEngine は core 未結合を明示エラーで返す Engine。
type stubEngine struct{}

func (stubEngine) Chat(context.Context, coreapi.Request) (coreapi.Response, error) {
	return coreapi.Response{}, errors.New(i18n.KeyErrorJobRunnerNotImplemented)
}
func (stubEngine) Regenerate(context.Context, coreapi.Request) (coreapi.Response, error) {
	return coreapi.Response{}, errors.New(i18n.KeyErrorJobRunnerNotImplemented)
}

type noopSweeper struct{}

func (noopSweeper) SweepNative(time.Time) (int, int)         { return 0, 0 }
func (noopSweeper) SweepSessionNatives(_, _, _ string)       {}

type noopSidecar struct{}

func (noopSidecar) Remove(string) error { return nil }

// offGate は全機能を無効として返す gate（安全側の既定）。
type offGate struct{}

func (offGate) Enabled(string) bool             { return false }
func (offGate) PublicSnapshot() map[string]bool { return map[string]bool{} }
func (offGate) Entitlement() coreapi.EntitlementStatus {
	return coreapi.EntitlementStatus{State: coreapi.TokenStateNone}
}

// stubComfy は ComfyUI 連携を提供しない（ルート未登録・Runner は未結合エラー）。
type stubComfy struct{}

func (stubComfy) RegisterRoutes(*http.ServeMux, *jobs.Queue, coreapi.FeatureGate) {}
func (stubComfy) ImageRunner() jobs.Runner                                        { return jobs.NotImplementedRunner{} }
func (stubComfy) TagJudgeKind() models.Kind                                       { return models.KindGemini }
