package module

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"alslime/internal/coreapi"
	"alslime/internal/i18n"
	"alslime/internal/jobs"
)

// ImageRunner は ImageGen ジョブをサイドカーモジュールへ委譲する jobs.Runner（12番 4.3）。
//
// ジョブキュー・プロセス制御・進捗 UI は本体に残し、実行本体（タグ判定・生成・
// 保存・添付書き込み）はモジュール側で行う。Payload は JSON で素通しする。
type ImageRunner struct {
	Manager *Manager
	// HTTP は RPC クライアント。nil なら http.DefaultClient。
	// 生成はタグ判定 AI + ComfyUI 生成で長時間かかるため、タイムアウトは
	// ジョブの ctx（キャンセル・本体側タイムアウト）に委ねる。
	HTTP *http.Client
}

func (r ImageRunner) Run(ctx context.Context, job jobs.Job) (jobs.Result, error) {
	if r.Manager == nil {
		return jobs.Result{}, errors.New(i18n.KeyErrorComfyUIServiceMissing)
	}
	base := r.Manager.BaseURL()
	if base == nil {
		return jobs.Result{}, errors.New(i18n.KeyErrorComfyUIServiceMissing)
	}
	payload, err := json.Marshal(job.Payload)
	if err != nil {
		return jobs.Result{}, fmt.Errorf("%s: %w", i18n.KeyErrorImagePayloadInvalid, err)
	}
	body, err := json.Marshal(coreapi.ModuleImageGenerateRequest{
		JobID:   job.JobID,
		Payload: payload,
	})
	if err != nil {
		return jobs.Result{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		base.JoinPath(coreapi.ModuleImageGenerateRoute).String(), bytes.NewReader(body))
	if err != nil {
		return jobs.Result{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(coreapi.ModuleAuthHeader, r.Manager.Secret())

	client := r.HTTP
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return jobs.Result{}, err
	}
	defer func() { _ = resp.Body.Close() }()

	var out coreapi.ModuleImageGenerateResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return jobs.Result{}, fmt.Errorf("module image-generate: decode failed (status=%d): %w", resp.StatusCode, err)
	}
	if !out.Success {
		if out.Error == "" {
			return jobs.Result{}, errors.New(i18n.KeyErrorImageGenerateFailed)
		}
		return jobs.Result{}, errors.New(out.Error)
	}
	return jobs.Result{FinalSessionID: out.FinalSessionID, Output: out.Output}, nil
}
