// Package session はセッション一覧・再開・履歴読み書きの API を提供する。
package session

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"

	"alslime/internal/api/apierror"
	"alslime/internal/api/apiresponse"
	"alslime/internal/config"
	sessiondom "alslime/internal/domain/sessions"
	jobsvc "alslime/internal/jobs"
)

// NativeSessionSweeper は削除されたセッションのネイティブ履歴を即時掃除する境界。
// housekeeping.Sweeper が満たす（具象への依存を避けるためインターフェースで受ける）。
type NativeSessionSweeper interface {
	SweepSessionNatives(geminiID, claudeID, antigravityID string)
}

// SidecarRemover は Antigravity sidecar を削除する境界。
type SidecarRemover interface {
	Remove(sessionID string) error
}

// Deps は session API の依存。
type Deps struct {
	Sessions      *sessiondom.Service
	Queue         *jobsvc.Queue
	NativeSweeper NativeSessionSweeper // nil 可（ネイティブ掃除なし）
	Sidecars      SidecarRemover       // nil 可（sidecar 削除なし）
}

// Register は session / history 系 API を登録する。
func Register(mux *http.ServeMux, deps Deps) {
	mux.HandleFunc(http.MethodGet+" "+config.APIPrefix+routeSessions, handleList(deps))
	mux.HandleFunc(http.MethodPost+" "+config.APIPrefix+routeSessionNew, handleNew(deps))
	mux.HandleFunc(http.MethodPost+" "+config.APIPrefix+routeSessionResume, handleResume(deps))
	mux.HandleFunc(http.MethodPost+" "+config.APIPrefix+routeSessionApplySSRP, handleApplySSRPSettings(deps))
	mux.HandleFunc(http.MethodPost+" "+config.APIPrefix+routeSessionTitle, handleTitle(deps))
	mux.HandleFunc(http.MethodDelete+" "+config.APIPrefix+routeSessionDelete, handleDelete(deps))
	mux.HandleFunc(http.MethodGet+" "+config.APIPrefix+routeChatHistory, handleHistory(deps))
	mux.HandleFunc(http.MethodPost+" "+config.APIPrefix+routeChatHistoryUpdate, handleHistoryUpdate(deps))
}

type listResponse struct {
	Sessions []sessiondom.ListItem `json:"sessions"`
}

type newRequest struct {
	SSRPSettings map[string]any `json:"ssrpSettings,omitempty"`
	ModelType    string         `json:"modelType,omitempty"`
}

type resumeRequest struct {
	SessionIndex any    `json:"sessionIndex"`
	SessionID    string `json:"sessionId"`
	ModelType    string `json:"modelType,omitempty"`
}

type resumeResponse struct {
	Success     bool                 `json:"success"`
	Message     string               `json:"message"`
	MessageKey  string               `json:"messageKey"`
	History     []sessiondom.Message `json:"history"`
	Config      map[string]any       `json:"config,omitempty"`
	UIState     map[string]any       `json:"uiState,omitempty"`
	IsSSRP      bool                 `json:"isSSRP"`
	ModelType   sessiondom.ModelType `json:"modelType"`
	ActiveJobID string               `json:"activeJobId,omitempty"`
}

type historyResponse struct {
	Messages []sessiondom.Message `json:"messages"`
}

type applySSRPRequest struct {
	SessionID       string         `json:"sessionId"`
	SSRPSettings    map[string]any `json:"ssrpSettings,omitempty"`
	SuppressConfirm *bool          `json:"suppressConfirm,omitempty"`
}

type applySSRPResponse struct {
	Success      bool           `json:"success"`
	SSRPSettings map[string]any `json:"ssrpSettings,omitempty"`
	UIState      map[string]any `json:"uiState,omitempty"`
}

type titleRequest struct {
	Title *string `json:"title"`
}

type titleResponse struct {
	Success bool   `json:"success"`
	Title   string `json:"title"`
}

type historyUpdateRequest struct {
	SessionID string  `json:"sessionId"`
	MessageID string  `json:"messageId"`
	Content   *string `json:"content"`
}

func handleList(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		items, err := deps.Sessions.List()
		if err != nil {
			apierror.Write(w, apierror.Internal(err))
			return
		}
		writeJSON(w, listResponse{Sessions: items})
	}
}

func handleNew(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req newRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			apierror.Write(w, apierror.BadRequestKey(errKeyInvalidJSONBody))
			return
		}
		modelType := parseModelType(req.ModelType)
		deps.Sessions.StartNew(modelType, req.SSRPSettings)
		writeJSON(w, messageResponse{Success: true, Message: msgKeyNewSessionNext, MessageKey: msgKeyNewSessionNext})
	}
}

func handleResume(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req resumeRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			apierror.Write(w, apierror.BadRequestKey(errKeyInvalidJSONBody))
			return
		}
		if req.SessionIndex == nil {
			apierror.Write(w, apierror.BadRequestKey(errKeySessionIndexRequired))
			return
		}
		if req.SessionID == "" {
			apierror.Write(w, apierror.BadRequestKey(errKeySessionIDRequired))
			return
		}

		session, err := deps.Sessions.Read(req.SessionID)
		if err != nil {
			writeReadError(w, err)
			return
		}
		// 設定は読み込み済みの session から直接取る
		//（Sessions.Config は内部で同じファイルをもう一度フルパースするため使わない）。
		var config map[string]any
		isSSRP := false
		if session.SSRPSettings != nil {
			config = session.SSRPSettings
			isSSRP = session.IsSSRP
		}
		history := session.Messages
		modelType := session.Bindings.ActiveModelType
		if modelType == "" {
			modelType = parseModelType(req.ModelType)
		}
		res := resumeResponse{
			Success:    true,
			Message:    msgKeyResumeSession,
			MessageKey: msgKeyResumeSession,
			History:    history,
			Config:     config,
			UIState:    session.UIState,
			IsSSRP:     isSSRP,
			ModelType:  modelType,
		}
		if active, ok := deps.Queue.ActiveBySessionID(req.SessionID); ok {
			res.ActiveJobID = active.JobID
		}
		writeJSON(w, res)
	}
}

// handleApplySSRPSettings は SSRP 設定のセッションへの明示反映と、
// 送信時確認モーダルの抑制フラグ保存を担う（どちらも独立指定可）。
func handleApplySSRPSettings(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req applySSRPRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			apierror.Write(w, apierror.BadRequestKey(errKeyInvalidJSONBody))
			return
		}
		if req.SessionID == "" {
			apierror.Write(w, apierror.BadRequestKey(errKeySessionIDRequired))
			return
		}
		session, err := deps.Sessions.ApplySSRPSettings(req.SessionID, req.SSRPSettings, req.SuppressConfirm)
		if err != nil {
			writeReadError(w, err)
			return
		}
		writeJSON(w, applySSRPResponse{
			Success:      true,
			SSRPSettings: session.SSRPSettings,
			UIState:      session.UIState,
		})
	}
}

func handleTitle(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sessionID := r.PathValue(pathParamSessionID)
		var req titleRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			apierror.Write(w, apierror.BadRequestKey(errKeyInvalidJSONBody))
			return
		}
		if sessionID == "" || req.Title == nil {
			apierror.Write(w, apierror.BadRequestKey(errKeySessionTitleRequired))
			return
		}
		title, err := deps.Sessions.UpdateTitle(sessionID, *req.Title)
		if err != nil {
			writeReadError(w, err)
			return
		}
		writeJSON(w, titleResponse{Success: true, Title: title})
	}
}

func handleDelete(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sessionID := r.PathValue(pathParamSessionID)
		if sessionID == "" {
			apierror.Write(w, apierror.BadRequestKey(errKeySessionIDRequired))
			return
		}
		// 正本を削除し、紐づくネイティブ掃除のための binding を受け取る。
		deleted, err := deps.Sessions.Delete(sessionID)
		if err != nil {
			writeReadError(w, err)
			return
		}
		// 中間ファイル正本が消えた＝ネイティブは再生成元を失うため、即時連動掃除する。
		if deps.NativeSweeper != nil {
			geminiID, claudeID, antigravityID := nativeBindingIDs(deleted)
			deps.NativeSweeper.SweepSessionNatives(geminiID, claudeID, antigravityID)
		}
		// Antigravity sidecar も連動削除（存在しなければ無視）。
		if deps.Sidecars != nil {
			_ = deps.Sidecars.Remove(sessionID)
		}
		writeJSON(w, simpleSuccessResponse{Success: true})
	}
}

// nativeBindingIDs は削除セッションの各 provider ネイティブセッションIDを取り出す。
// binding が無いものは空文字（掃除側でスキップされる）。
func nativeBindingIDs(session sessiondom.UnifiedSession) (gemini, claude, antigravity string) {
	if b := session.Bindings.Gemini; b != nil {
		gemini = b.NativeSessionID
	}
	if b := session.Bindings.Claude; b != nil {
		claude = b.NativeSessionID
	}
	if b := session.Bindings.Antigravity; b != nil {
		antigravity = b.NativeSessionID
	}
	return gemini, claude, antigravity
}

func handleHistory(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		messages, err := deps.Sessions.History(r.PathValue(pathParamSessionID))
		if err != nil {
			writeReadError(w, err)
			return
		}
		writeJSON(w, historyResponse{Messages: messages})
	}
}

func handleHistoryUpdate(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req historyUpdateRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			apierror.Write(w, apierror.BadRequestKey(errKeyInvalidJSONBody))
			return
		}
		if req.SessionID == "" || req.MessageID == "" || req.Content == nil {
			apierror.Write(w, apierror.BadRequestKey(errKeyHistoryUpdateRequired))
			return
		}
		if err := deps.Sessions.UpdateMessageContent(req.SessionID, req.MessageID, *req.Content); err != nil {
			writeReadError(w, err)
			return
		}
		writeJSON(w, simpleSuccessResponse{Success: true})
	}
}

func parseModelType(value string) sessiondom.ModelType {
	switch value {
	case string(sessiondom.ModelClaude):
		return sessiondom.ModelClaude
	case string(sessiondom.ModelAntigravity):
		return sessiondom.ModelAntigravity
	default:
		return sessiondom.ModelGemini
	}
}

func writeReadError(w http.ResponseWriter, err error) {
	if errors.Is(err, os.ErrNotExist) {
		apierror.Write(w, apierror.NotFoundKey(errKeySessionNotFound))
		return
	}
	if errors.Is(err, sessiondom.ErrInvalidUnifiedSession) {
		apierror.Write(w, apierror.BadRequestKey(errKeyInvalidUnifiedSession))
		return
	}
	if errors.Is(err, sessiondom.ErrMessageNotFound) {
		apierror.Write(w, apierror.NotFoundKey(errKeyMessageNotFound))
		return
	}
	apierror.Write(w, apierror.Internal(err))
}

func writeJSON(w http.ResponseWriter, v any) {
	_ = apiresponse.WriteJSON(w, http.StatusOK, v)
}
