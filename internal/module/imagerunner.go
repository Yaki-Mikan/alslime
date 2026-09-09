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

// ImageRunner は ImageGen ジョブ（統合。分析→生成）をサイドカーモジュールへ委譲する jobs.Runner。
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
	payload, err := json.Marshal(job.Payload)
	if err != nil {
		return jobs.Result{}, fmt.Errorf("%s: %w", i18n.KeyErrorImagePayloadInvalid, err)
	}
	return callImageGenerate(ctx, r.Manager, r.HTTP, coreapi.ModuleImageGenerateRequest{
		JobID:   job.JobID,
		Payload: payload,
	})
}

// ImageAnalyzeRunner は分析ジョブ（タグ判定→タグ解決）をサイドカーモジュールへ委譲する。
// 返った分析済み要求をそのまま生成ジョブの Payload に載せ、後続ジョブとして返す。
type ImageAnalyzeRunner struct {
	Manager *Manager
	HTTP    *http.Client
}

func (r ImageAnalyzeRunner) Run(ctx context.Context, job jobs.Job) (jobs.Result, error) {
	payload, err := json.Marshal(job.Payload)
	if err != nil {
		return jobs.Result{}, fmt.Errorf("%s: %w", i18n.KeyErrorImagePayloadInvalid, err)
	}
	body, err := json.Marshal(coreapi.ModuleImageAnalyzeRequest{JobID: job.JobID, Payload: payload})
	if err != nil {
		return jobs.Result{}, err
	}
	var out coreapi.ModuleImageAnalyzeResponse
	if err := postModuleJSON(ctx, r.Manager, r.HTTP, coreapi.ModuleImageAnalyzeRoute, body, &out); err != nil {
		return jobs.Result{}, err
	}
	if !out.Success {
		if out.Error == "" {
			return jobs.Result{}, errors.New(i18n.KeyErrorImageGenerateFailed)
		}
		return jobs.Result{}, errors.New(out.Error)
	}
	var prepared coreapi.ImageRenderPayload
	if err := json.Unmarshal(out.Payload, &prepared); err != nil {
		return jobs.Result{}, fmt.Errorf("%s: %w", i18n.KeyErrorImagePayloadInvalid, err)
	}
	spec := coreapi.ImageRenderSpec(prepared)
	return jobs.Result{FinalSessionID: prepared.SessionID, Next: &spec}, nil
}

// ImageRenderRunner は生成ジョブ（ComfyUI 投入→保存→添付）をサイドカーモジュールへ委譲する。
// 分析済み要求を Prepared に載せるため、モジュール側はタグ判定を行わない。
type ImageRenderRunner struct {
	Manager *Manager
	HTTP    *http.Client
}

func (r ImageRenderRunner) Run(ctx context.Context, job jobs.Job) (jobs.Result, error) {
	prepared, err := json.Marshal(job.Payload)
	if err != nil {
		return jobs.Result{}, fmt.Errorf("%s: %w", i18n.KeyErrorImagePayloadInvalid, err)
	}
	return callImageGenerate(ctx, r.Manager, r.HTTP, coreapi.ModuleImageGenerateRequest{
		JobID:    job.JobID,
		Prepared: prepared,
	})
}

// callImageGenerate は /module/image-generate を呼び、応答を jobs.Result へ写す。
func callImageGenerate(ctx context.Context, mgr *Manager, client *http.Client, req coreapi.ModuleImageGenerateRequest) (jobs.Result, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return jobs.Result{}, err
	}
	var out coreapi.ModuleImageGenerateResponse
	if err := postModuleJSON(ctx, mgr, client, coreapi.ModuleImageGenerateRoute, body, &out); err != nil {
		return jobs.Result{}, err
	}
	if !out.Success {
		if out.Error == "" {
			return jobs.Result{}, errors.New(i18n.KeyErrorImageGenerateFailed)
		}
		return jobs.Result{}, errors.New(out.Error)
	}
	return jobs.Result{FinalSessionID: out.FinalSessionID, Output: out.Output}, nil
}

// postModuleJSON はモジュールの内部 RPC へ JSON を POST し、応答を out へ復元する。
// 接続先未解決（モジュール未起動）はサービス未結合エラーとして返す。
func postModuleJSON(ctx context.Context, mgr *Manager, client *http.Client, route string, body []byte, out any) error {
	if mgr == nil {
		return errors.New(i18n.KeyErrorComfyUIServiceMissing)
	}
	base := mgr.BaseURL()
	if base == nil {
		return errors.New(i18n.KeyErrorComfyUIServiceMissing)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base.JoinPath(route).String(), bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(coreapi.ModuleAuthHeader, mgr.Secret())

	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		return fmt.Errorf("module %s: decode failed (status=%d): %w", route, resp.StatusCode, err)
	}
	return nil
}
