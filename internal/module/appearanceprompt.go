package module

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"alslime/internal/coreapi"
	"alslime/internal/i18n"
	"alslime/internal/jobs"
)

// AppearancePromptRunner はキャラクター容姿プロンプト作成ジョブをサイドカーモジュールへ委譲する jobs.Runner。
//
// ジョブキュー・状態取得・中止は本体に残し、実行本体（設定本文の読み取り・AI への
// 問い合わせ・応答解析）はモジュール側で行う。Payload は JSON で素通しする。
type AppearancePromptRunner struct {
	Manager *Manager
	// HTTP は RPC クライアント。nil なら http.DefaultClient。
	// タイムアウトはジョブの ctx（中止・Payload の制限時間）に委ねる。
	HTTP *http.Client
}

func (r AppearancePromptRunner) Run(ctx context.Context, job jobs.Job) (jobs.Result, error) {
	payload, err := json.Marshal(job.Payload)
	if err != nil {
		return jobs.Result{}, fmt.Errorf("%s: %w", i18n.KeyErrorAppearanceInvalidPayload, err)
	}
	body, err := json.Marshal(coreapi.ModuleAppearancePromptRequest{JobID: job.JobID, Payload: payload})
	if err != nil {
		return jobs.Result{}, err
	}
	var out coreapi.ModuleAppearancePromptResponse
	if err := postModuleJSON(ctx, r.Manager, r.HTTP, coreapi.ModuleAppearancePromptRoute, body, &out); err != nil {
		return jobs.Result{}, err
	}
	if !out.Success {
		if out.Error == "" {
			return jobs.Result{}, errors.New(i18n.KeyErrorComfyUIServiceMissing)
		}
		return jobs.Result{}, errors.New(out.Error)
	}
	return jobs.Result{Output: out.Output}, nil
}
