// Package appearanceprompt はキャラクター容姿プロンプト作成（appearance-prompt）API の入口。
//
// submit / status / cancel を担う。実行本体は ComfyUI 連携の実体（サイドカーモジュール、
// または in-process 供給ビルドの core）で、本体はジョブ管理だけを持つ。
// 汎用のジョブ一覧は結果本文を返さないため、結果（タグ行）はここの status で返す。
package appearanceprompt

import (
	"encoding/json"
	"net/http"
	"strings"

	"alslime/internal/api/apierror"
	"alslime/internal/api/apiresponse"
	"alslime/internal/config"
	"alslime/internal/coreapi"
	"alslime/internal/domain/appearancejobs"
	"alslime/internal/domain/models"
	"alslime/internal/features"
	"alslime/internal/i18n"
	jobsvc "alslime/internal/jobs"
	"alslime/internal/storage/safename"
)

// Deps は appearance-prompt API の依存。
type Deps struct {
	Queue *jobsvc.Queue
	// Gate は画像生成機能の tier 判定（画像生成設定の画面に付く機能のため submit を守る）。
	Gate coreapi.FeatureGate
	// Available は ComfyUI 連携の実体が今使えるかを返す（呼び出しごとに判定する。モジュールの
	// 後付け導入・停止へ本体再起動なしで追随するため）。nil は利用不能として扱う。
	Available func() bool
	// NowUnixMilli はテスト差し替え用（nil なら time.Now 相当）。
	NowUnixMilli func() int64
}

// Register は appearance-prompt API を mux へ登録する。
// 利用可否の確認は submit だけに付ける（実行開始後に実体が止まっても、既存ジョブの
// 状態確認と中止はできるようにする）。
func Register(mux *http.ServeMux, deps Deps) {
	mux.HandleFunc(http.MethodPost+" "+config.APIPrefix+routeSubmit, withImageGenGate(deps.Gate, withComfyAvailable(deps.Available, handleSubmit(deps))))
	mux.HandleFunc(http.MethodGet+" "+config.APIPrefix+routeStatus, handleStatus(deps))
	mux.HandleFunc(http.MethodPost+" "+config.APIPrefix+routeCancel, handleCancel(deps))
}

// withComfyAvailable は ComfyUI 連携の実体が使えなければ 503 を返す（キューへは追加しない）。
func withComfyAvailable(available func() bool, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if available == nil || !available() {
			apierror.Write(w, apierror.NewKey(http.StatusServiceUnavailable, i18n.KeyErrorComfyUIServiceMissing))
			return
		}
		next(w, r)
	}
}

// withImageGenGate は画像生成機能が無効なら 403 を返す。
func withImageGenGate(gate coreapi.FeatureGate, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if gate == nil || !gate.Enabled(string(features.FeatureComfyUI)) {
			apierror.Write(w, apierror.ForbiddenKey(i18n.KeyFeatureTierUnavailable))
			return
		}
		next(w, r)
	}
}

func handleSubmit(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if deps.Queue == nil {
			apierror.Write(w, apierror.NewKey(http.StatusNotImplemented, i18n.KeyErrorJobRunnerMissing))
			return
		}
		var req submitRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorInvalidJSONBody))
			return
		}
		dirName, err := safename.Validate(strings.TrimSpace(req.DirName))
		if err != nil {
			apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorInvalidName))
			return
		}
		fileName, err := safename.Validate(strings.TrimSpace(req.FileName))
		if err != nil {
			apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorInvalidName))
			return
		}
		provider := strings.TrimSpace(req.Provider)
		if !appearancejobs.IsValidProvider(provider) {
			apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorAppearanceInvalidProvider))
			return
		}
		model := strings.TrimSpace(req.Model)
		if model == "" || len([]rune(model)) > modelMaxRunes {
			apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorAppearanceInvalidPayload))
			return
		}
		if len([]rune(req.CurrentCharacterPrompt)) > currentFieldMaxRunes || len([]rune(req.CurrentPhysicalFeatures)) > currentFieldMaxRunes {
			apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorAppearanceInvalidPayload))
			return
		}
		payload := appearancejobs.Payload{
			DirName:                 dirName,
			FileName:                fileName,
			Provider:                provider,
			Model:                   model,
			ClaudeEffort:            strings.TrimSpace(req.ClaudeEffort),
			AntigravityThinking:     strings.TrimSpace(req.AntigravityThinking),
			TimeoutMinutes:          appearancejobs.NormalizeTimeoutMinutes(req.TimeoutMinutes),
			Locale:                  strings.TrimSpace(req.Locale),
			CurrentCharacterPrompt:  req.CurrentCharacterPrompt,
			CurrentPhysicalFeatures: req.CurrentPhysicalFeatures,
		}
		added := deps.Queue.Add(jobsvc.Spec{
			Type:      jobsvc.TypeAppearancePrompt,
			Kind:      models.KindOf(model),
			Label:     i18n.KeyLabelAppearancePrompt,
			DedupeKey: dedupeKey(dirName, fileName),
			Model:     model,
			Payload:   payload,
		})
		if added.MaintenanceRejected {
			apierror.Write(w, apierror.NewKey(http.StatusConflict, i18n.KeyErrorUpdateMaintenance))
			return
		}
		if added.Duplicate {
			_ = apiresponse.WriteJSON(w, http.StatusConflict, duplicateResponse{
				Error:         i18n.KeyErrorAlreadyProcessing,
				MessageKey:    i18n.KeyErrorAlreadyProcessing,
				ExistingJobID: added.ExistingJobID,
			})
			return
		}
		writeJSON(w, submitResponse{JobID: added.JobID, Status: string(jobsvc.StatusPending)})
	}
}

func handleStatus(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		jobID := r.PathValue(pathParamJobID)
		job, ok := deps.Queue.Get(jobID)
		if !ok || job.Type != jobsvc.TypeAppearancePrompt {
			apierror.Write(w, apierror.NotFoundKey(i18n.KeyErrorJobNotFound))
			return
		}
		res := statusResponse{
			JobID:          job.JobID,
			Status:         string(job.Status),
			ElapsedSeconds: elapsedSeconds(deps, job),
		}
		switch job.Status {
		case jobsvc.StatusCompleted:
			res.Result = resultFromOutput(job.Result)
		case jobsvc.StatusError, jobsvc.StatusCanceled:
			res.Error = job.Err
		}
		writeJSON(w, res)
	}
}

func handleCancel(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		jobID := r.PathValue(pathParamJobID)
		if job, ok := deps.Queue.Get(jobID); !ok || job.Type != jobsvc.TypeAppearancePrompt {
			apierror.Write(w, apierror.NotFoundKey(i18n.KeyErrorJobNotFound))
			return
		}
		if !deps.Queue.Cancel(jobID) {
			apierror.Write(w, apierror.NewKey(http.StatusConflict, i18n.KeyErrorJobCancelUnavailable))
			return
		}
		writeJSON(w, map[string]bool{"success": true})
	}
}

func resultFromOutput(raw string) *appearancejobs.Result {
	if raw == "" {
		return nil
	}
	var value appearancejobs.Result
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		return nil
	}
	return &value
}

func elapsedSeconds(deps Deps, job jobsvc.Job) int64 {
	if job.StartedAt <= 0 {
		return 0
	}
	end := job.UpdatedAt
	if job.Status == jobsvc.StatusProcessing {
		if deps.NowUnixMilli != nil {
			end = deps.NowUnixMilli()
		} else {
			end = nowUnixMilli()
		}
	}
	if end < job.StartedAt {
		return 0
	}
	return (end - job.StartedAt) / 1000
}

func dedupeKey(dirName, fileName string) string {
	return "appearance-prompt:" + dirName + "/" + fileName
}

func writeJSON(w http.ResponseWriter, v any) {
	_ = apiresponse.WriteJSON(w, http.StatusOK, v)
}
