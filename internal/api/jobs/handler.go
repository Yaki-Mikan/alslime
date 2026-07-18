// Package jobs は /api/jobs 系の HTTP ハンドラを提供する。
//
// 重要（交換日記 42）: ジョブ内部構造と API 用 DTO を分ける。
// /api/jobs に user message 本文・SSRP 設定・result・内部 payload を出さない。
// error は短い表示用メッセージ、label は短い表示名のみ。
package jobs

import (
	"encoding/json"
	"net/http"

	"alslime/internal/api/apierror"
	"alslime/internal/api/apiresponse"
	"alslime/internal/config"
	jobsvc "alslime/internal/jobs"
	"alslime/internal/logging"
	"alslime/internal/process"
)

// LimitsStore は limits の永続化先（globalsettings service を抽象化）。
// aiProcessLimits キーで部分マージ保存する。
type LimitsStore interface {
	// Update は patch を既存設定へ浅くマージして保存する。
	Update(patch map[string]any) (map[string]any, error)
}

// Deps は jobs ハンドラの依存。
type Deps struct {
	Queue   *jobsvc.Queue
	Process *process.Manager
	// Limits は limits 永続化先（globalsettings）。nil 可（永続化せずメモリのみ）。
	Limits LimitsStore
}

// Register は /api/jobs 系ルートを mux へ登録する。
func Register(mux *http.ServeMux, deps Deps) {
	mux.HandleFunc(http.MethodGet+" "+config.APIPrefix+routeJobs, handleList(deps))
	mux.HandleFunc(http.MethodPost+" "+config.APIPrefix+routeJobCancel, handleCancel(deps))
	mux.HandleFunc(http.MethodGet+" "+config.APIPrefix+routeJobLimits, handleGetLimits(deps))
	mux.HandleFunc(http.MethodPost+" "+config.APIPrefix+routeJobLimits, handlePostLimits(deps))
}

// jobDTO は API 一覧で返すジョブ表現（内部の Payload/Result は含めない）。
type jobDTO struct {
	JobID     string `json:"jobId"`
	Type      string `json:"type"`
	Kind      string `json:"kind"`
	Label     string `json:"label"`
	SessionID string `json:"sessionId,omitempty"`
	Status    string `json:"status"`
	Error     string `json:"error,omitempty"`
	CreatedAt int64  `json:"createdAt"`
	StartedAt int64  `json:"startedAt,omitempty"`
	UpdatedAt int64  `json:"updatedAt"`
}

func toDTO(j jobsvc.Job) jobDTO {
	return jobDTO{
		JobID:     j.JobID,
		Type:      string(j.Type),
		Kind:      string(j.Kind),
		Label:     j.Label,
		SessionID: j.SessionID,
		Status:    string(j.Status),
		Error:     j.Err,
		CreatedAt: j.CreatedAt,
		StartedAt: j.StartedAt,
		UpdatedAt: j.UpdatedAt,
	}
}

// listResponse は GET /api/jobs のレスポンス（現行 { jobs, inUse, limits }）。
type listResponse struct {
	Jobs   []jobDTO       `json:"jobs"`
	InUse  process.InUse  `json:"inUse"`
	Limits process.Limits `json:"limits"`
}

func handleList(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		jobs := deps.Queue.List()
		dtos := make([]jobDTO, 0, len(jobs))
		for _, j := range jobs {
			dtos = append(dtos, toDTO(j))
		}
		writeJSON(w, listResponse{
			Jobs:   dtos,
			InUse:  deps.Process.InUse(),
			Limits: deps.Process.Limits(),
		})
	}
}

func handleCancel(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		jobID := r.PathValue(pathParamJobID)
		if !deps.Queue.Cancel(jobID) {
			// 終端状態・不存在は現行互換で 409。
			apierror.Write(w, apierror.NewKey(http.StatusConflict, errKeyJobCancelUnavailable))
			return
		}
		writeJSON(w, cancelResponse{Success: true, JobID: jobID})
	}
}

func handleGetLimits(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, deps.Process.Limits())
	}
}

// limitsRequest は POST /api/jobs/limits のボディ。部分指定可（省略は現状維持）。
type limitsRequest struct {
	Global      *int `json:"global"`
	Gemini      *int `json:"gemini"`
	Claude      *int `json:"claude"`
	Antigravity *int `json:"antigravity"`
}

func handlePostLimits(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req limitsRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			apierror.Write(w, apierror.BadRequestKey(errKeyInvalidJSONBody))
			return
		}
		// 指定された値は正の整数であること（クランプは manager 側）。
		for _, v := range []*int{req.Global, req.Gemini, req.Claude, req.Antigravity} {
			if v != nil && *v < 1 {
				apierror.Write(w, apierror.BadRequestKey(errKeyInvalidProcessLimit))
				return
			}
		}

		// 現在値をベースに部分上書き。
		cur := deps.Process.Limits()
		next := cur
		if req.Global != nil {
			next.Global = *req.Global
		}
		if req.Gemini != nil {
			next.Gemini = *req.Gemini
		}
		if req.Claude != nil {
			next.Claude = *req.Claude
		}
		if req.Antigravity != nil {
			next.Antigravity = *req.Antigravity
		}
		updated := deps.Process.UpdateLimits(next)

		// globalsettings へ部分マージ永続化（失敗してもメモリ更新は有効・レスポンスは更新後）。
		if deps.Limits != nil {
			patch := map[string]any{globalSettingsKey: map[string]any{
				"global":      updated.Global,
				"gemini":      updated.Gemini,
				"claude":      updated.Claude,
				"antigravity": updated.Antigravity,
			}}
			if _, err := deps.Limits.Update(patch); err != nil {
				// 保存失敗でもメモリ上の limits は有効・レスポンスは更新後の値。
				// ただし再起動で戻るため、原因調査ができるよう必ずログへ残す。
				logging.Warn("aiProcessLimits の永続化に失敗: %v", err)
			}
		}

		writeJSON(w, updated)
	}
}

func writeJSON(w http.ResponseWriter, v any) {
	if err := apiresponse.WriteJSON(w, http.StatusOK, v); err != nil {
		apierror.Write(w, apierror.Internal(err))
	}
}
