// Package chat は chat / regenerate / status / abort の入口を提供する。
//
// Phase 9 初期段階では、外部 CLI の実行本体はまだ扱わない。
// ここでは Queue へジョブを投入し、status / abort の API 契約を固める。
package chat

import (
	"encoding/json"
	"net/http"
	"strings"

	"alslime/internal/api/apierror"
	"alslime/internal/api/apiresponse"
	"alslime/internal/config"
	"alslime/internal/domain/chatjobs"
	"alslime/internal/domain/models"
	"alslime/internal/i18n"
	jobsvc "alslime/internal/jobs"
)

// Deps は chat API の依存。
type Deps struct {
	Queue *jobsvc.Queue
}

// Register は chat 系の最小 API を mux へ登録する。
func Register(mux *http.ServeMux, deps Deps) {
	mux.HandleFunc(http.MethodPost+" "+config.APIPrefix+routeSubmit, handleSubmit(deps))
	mux.HandleFunc(http.MethodGet+" "+config.APIPrefix+routeStatus, handleStatus(deps))
	mux.HandleFunc(http.MethodPost+" "+config.APIPrefix+routeRegenerate, handleRegenerate(deps))
	mux.HandleFunc(http.MethodPost+" "+config.APIPrefix+routeAbort, handleAbort(deps))
}

type submitRequest struct {
	Message                   string   `json:"message"`
	SessionID                 string   `json:"sessionId"`
	Model                     string   `json:"model"`
	Temperature               *float64 `json:"temperature,omitempty"`
	DirectiveMode             string   `json:"directiveMode"`
	SSRPSettings              any      `json:"ssrpSettings,omitempty"`
	AntigravityTempFileMode   bool     `json:"antigravityTempFileMode,omitempty"`
	GeminiTempFileMode        bool     `json:"geminiTempFileMode,omitempty"`
	ClaudeEffort              string   `json:"claudeEffort,omitempty"`
	AntigravityThinking       string   `json:"antigravityThinking,omitempty"`
	AntigravityMaxStreamCalls int      `json:"antigravityMaxStreamCalls,omitempty"`
	EnableResponseBackup      bool     `json:"enableResponseBackup,omitempty"`
}

type regenerateRequest struct {
	SessionID                 string   `json:"sessionId"`
	Model                     string   `json:"model"`
	Temperature               *float64 `json:"temperature,omitempty"`
	SSRPSettings              any      `json:"ssrpSettings,omitempty"`
	AntigravityTempFileMode   bool     `json:"antigravityTempFileMode,omitempty"`
	GeminiTempFileMode        bool     `json:"geminiTempFileMode,omitempty"`
	ClaudeEffort              string   `json:"claudeEffort,omitempty"`
	AntigravityThinking       string   `json:"antigravityThinking,omitempty"`
	AntigravityMaxStreamCalls int      `json:"antigravityMaxStreamCalls,omitempty"`
	EnableResponseBackup      bool     `json:"enableResponseBackup,omitempty"`
}

type submitResponse struct {
	JobID  string `json:"jobId"`
	Status string `json:"status"`
}

type duplicateResponse struct {
	Error         string `json:"error"`
	MessageKey    string `json:"messageKey"`
	ExistingJobID string `json:"existingJobId"`
}

type statusResponse struct {
	JobID           string   `json:"jobId"`
	Status          string   `json:"status"`
	Type            string   `json:"type"`
	SessionID       string   `json:"sessionId,omitempty"`
	Model           string   `json:"model,omitempty"`
	Result          string   `json:"result,omitempty"`
	SessionTime     any      `json:"sessionTime,omitempty"`
	ErrorType       string   `json:"errorType,omitempty"`
	Error           string   `json:"error,omitempty"`
	Message         string   `json:"message,omitempty"`
	ImageAttachment any      `json:"imageAttachment,omitempty"`
	ActionChoices   []string `json:"actionChoices,omitempty"`
	// Stage は画像生成の段階（分析中 / 生成待ち / 生成中）。分離モードのジョブだけが持つ。
	Stage string `json:"stage,omitempty"`
	// NextJobID は分析ジョブ完了時に投入された生成ジョブ（フロントはこちらのポーリングへ乗り換える）。
	NextJobID string `json:"nextJobId,omitempty"`
}

func handleSubmit(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req submitRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			apierror.Write(w, apierror.BadRequestKey(errKeyInvalidJSONBody))
			return
		}
		if strings.TrimSpace(req.Message) == "" {
			apierror.Write(w, apierror.BadRequestKey(errKeyMessageRequired))
			return
		}

		payload := chatjobs.Payload{
			Message:                   req.Message,
			SessionID:                 req.SessionID,
			Model:                     req.Model,
			Temperature:               req.Temperature,
			DirectiveMode:             req.DirectiveMode,
			SSRPSettings:              req.SSRPSettings,
			AntigravityTempFileMode:   req.AntigravityTempFileMode,
			GeminiTempFileMode:        req.GeminiTempFileMode,
			ClaudeEffort:              req.ClaudeEffort,
			AntigravityThinking:       req.AntigravityThinking,
			AntigravityMaxStreamCalls: req.AntigravityMaxStreamCalls,
			EnableResponseBackup:      req.EnableResponseBackup,
		}
		added := deps.Queue.Add(jobsvc.Spec{
			Type:      jobsvc.TypeChat,
			Kind:      models.KindOf(req.Model),
			Label:     makeLabel(jobsvc.TypeChat, req.Message),
			SessionID: req.SessionID,
			Model:     req.Model,
			Payload:   payload,
		})
		if added.MaintenanceRejected {
			apierror.Write(w, apierror.NewKey(http.StatusConflict, i18n.KeyErrorUpdateMaintenance))
			return
		}
		if added.Duplicate {
			writeDuplicate(w, added.ExistingJobID)
			return
		}
		writeJSON(w, submitResponse{JobID: added.JobID, Status: string(jobsvc.StatusPending)})
	}
}

func handleRegenerate(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req regenerateRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			apierror.Write(w, apierror.BadRequestKey(errKeyInvalidJSONBody))
			return
		}
		if strings.TrimSpace(req.SessionID) == "" {
			apierror.Write(w, apierror.BadRequestKey(errKeySessionIDRequired))
			return
		}

		payload := chatjobs.Payload{
			SessionID:                 req.SessionID,
			Model:                     req.Model,
			Temperature:               req.Temperature,
			SSRPSettings:              req.SSRPSettings,
			AntigravityTempFileMode:   req.AntigravityTempFileMode,
			GeminiTempFileMode:        req.GeminiTempFileMode,
			ClaudeEffort:              req.ClaudeEffort,
			AntigravityThinking:       req.AntigravityThinking,
			AntigravityMaxStreamCalls: req.AntigravityMaxStreamCalls,
			EnableResponseBackup:      req.EnableResponseBackup,
		}
		added := deps.Queue.Add(jobsvc.Spec{
			Type:      jobsvc.TypeRegenerate,
			Kind:      models.KindOf(req.Model),
			Label:     makeLabel(jobsvc.TypeRegenerate, ""),
			SessionID: req.SessionID,
			Model:     req.Model,
			Payload:   payload,
		})
		if added.MaintenanceRejected {
			apierror.Write(w, apierror.NewKey(http.StatusConflict, i18n.KeyErrorUpdateMaintenance))
			return
		}
		if added.Duplicate {
			writeDuplicate(w, added.ExistingJobID)
			return
		}
		writeJSON(w, submitResponse{JobID: added.JobID, Status: string(jobsvc.StatusPending)})
	}
}

func handleStatus(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		jobID := r.PathValue(pathParamJobID)
		job, ok := deps.Queue.Get(jobID)
		if !ok {
			apierror.Write(w, apierror.NotFoundKey(errKeyJobNotFound))
			return
		}
		res := statusResponse{
			JobID:     job.JobID,
			Status:    string(job.Status),
			Type:      string(job.Type),
			Model:     modelFromJob(job),
			Stage:     imageStageOf(job),
			NextJobID: job.NextJobID,
		}
		switch job.Status {
		case jobsvc.StatusCompleted:
			res.SessionID = job.SessionID
			res.ErrorType = job.ErrorType
			switch job.Type {
			case jobsvc.TypeImageGen, jobsvc.TypeImageRender:
				res.ImageAttachment = imageAttachmentFromResult(job.Result)
			case jobsvc.TypeImageAnalyze:
				// 分析ジョブの結果本文は無い（後続の生成ジョブが添付を返す）。
			default:
				res.Result = job.Result
				res.SessionTime = job.SessionTime
				res.ActionChoices = job.ActionChoices
			}
		case jobsvc.StatusError:
			res.Error = job.Err
			if job.ErrorType != "" {
				res.SessionID = job.SessionID
				res.ErrorType = job.ErrorType
			}
		case jobsvc.StatusCanceled:
			res.Error = job.Err
		case jobsvc.StatusProcessing:
			res.Message = msgKeyProcessing
		}
		writeJSON(w, res)
	}
}

// imageStageOf は分離モードの画像生成ジョブの段階を返す。統合ジョブと他種別は空。
func imageStageOf(job jobsvc.Job) string {
	switch job.Type {
	case jobsvc.TypeImageAnalyze:
		if job.Status == jobsvc.StatusProcessing {
			return stageAnalyzing
		}
	case jobsvc.TypeImageRender:
		switch job.Status {
		case jobsvc.StatusPending:
			return stageRenderWaiting
		case jobsvc.StatusProcessing:
			return stageRendering
		}
	}
	return ""
}

func imageAttachmentFromResult(raw string) any {
	if raw == "" {
		return nil
	}
	var value any
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		return nil
	}
	return value
}

func handleAbort(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		count := deps.Queue.CancelProcessing()
		if count > 0 {
			writeJSON(w, abortResponse{Success: true, Message: msgKeyProcessAborted, MessageKey: msgKeyProcessAborted, Count: count})
			return
		}
		writeJSON(w, abortResponse{Success: false, Message: msgKeyNoActiveProcess, MessageKey: msgKeyNoActiveProcess})
	}
}

func makeLabel(kind jobsvc.Type, message string) string {
	if kind == jobsvc.TypeRegenerate {
		return labelKeyRegenerate
	}
	line := strings.TrimSpace(strings.Split(message, "\n")[0])
	if line == "" {
		return labelKeyChat
	}
	runes := []rune(line)
	if len(runes) > 40 {
		return string(runes[:40])
	}
	return line
}

func modelFromJob(job jobsvc.Job) string {
	if job.Model != "" {
		return job.Model
	}
	return modelFromPayload(job.Payload)
}

func modelFromPayload(payload any) string {
	switch p := payload.(type) {
	case chatjobs.Payload:
		return p.Model
	case *chatjobs.Payload:
		if p == nil {
			return ""
		}
		return p.Model
	default:
		return ""
	}
}

func writeDuplicate(w http.ResponseWriter, existingJobID string) {
	_ = apiresponse.WriteJSON(w, http.StatusConflict, duplicateResponse{
		Error:         errKeyAlreadyProcessing,
		MessageKey:    errKeyAlreadyProcessing,
		ExistingJobID: existingJobID,
	})
}

func writeJSON(w http.ResponseWriter, v any) {
	_ = apiresponse.WriteJSON(w, http.StatusOK, v)
}
