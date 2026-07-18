// Package comfyuigate は ComfyUI 連携の public 側入口（12番 Phase C）。
//
// サイドカーモード時のルート登録を担う:
//   - generate-from-chat: ジョブ投入（本体キューの管轄。comfyui ドメインへは依存しない）
//   - それ以外の /api/comfyui/*: gate 判定 → サイドカーモジュールへリバースプロキシ
//
// in-process モード（モジュール未配置時のフォールバック）のルート登録は
// core 側の coreapi.ComfyProvider.RegisterRoutes が担う。フロントから見た
// API 形状は両モードで完全に同一。
package comfyuigate

import (
	"encoding/json"
	"net/http"
	"net/http/httputil"
	"net/url"

	"alslime/internal/api/apierror"
	"alslime/internal/api/apiresponse"
	"alslime/internal/config"
	"alslime/internal/coreapi"
	"alslime/internal/domain/models"
	"alslime/internal/features"
	"alslime/internal/i18n"
	jobsvc "alslime/internal/jobs"
)

const (
	routeBase             = config.APIPrefix + "/comfyui"
	routeGenerateFromChat = "/generate-from-chat"
)

// ModuleTarget はサイドカーモジュールへの接続先解決（internal/module.Manager が満たす）。
type ModuleTarget interface {
	// BaseURL はモジュールのベース URL。未起動なら nil。
	BaseURL() *url.URL
	// Secret は本体⇔モジュール間 RPC の共有シークレット。
	Secret() string
}

// Deps はサイドカーモードの public 側依存。
type Deps struct {
	// Gate は利用者向け機能ゲート（本体側で判定してからモジュールへ転送する）。
	Gate coreapi.FeatureGate
	// Queue は generate-from-chat のジョブ投入先。
	Queue *jobsvc.Queue
	// TagJudgeKind はタグ判定 provider 種別の解決（core 供給。nil なら Gemini 扱い）。
	TagJudgeKind func() models.Kind
	// Module はモジュールへの接続先解決。
	Module ModuleTarget
}

// RegisterProxy はサイドカーモード時の ComfyUI ルートを登録する。
func RegisterProxy(mux *http.ServeMux, deps Deps) {
	mux.HandleFunc("POST "+routeBase+routeGenerateFromChat,
		requireGate(deps.Gate, handleGenerateFromChat(deps)))

	proxy := &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			// Rewrite 時点で target は確定済み（ハンドラ側で nil を弾いている）。
			pr.SetURL(deps.Module.BaseURL())
			pr.Out.Header.Set(coreapi.ModuleAuthHeader, deps.Module.Secret())
		},
	}
	mux.Handle(routeBase+"/", requireGate(deps.Gate,
		func(w http.ResponseWriter, r *http.Request) {
			if deps.Module == nil || deps.Module.BaseURL() == nil {
				// モジュール未起動（起動待ち・起動失敗）。
				apierror.Write(w, apierror.NewKey(http.StatusServiceUnavailable, i18n.KeyErrorComfyUIServiceMissing))
				return
			}
			proxy.ServeHTTP(w, r)
		}))
}

// requireGate は ComfyUI route 全体を tier gate 配下へ置く。gate 未注入は安全側で全拒否。
func requireGate(gate coreapi.FeatureGate, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if gate == nil || !gate.Enabled(string(features.FeatureComfyUI)) {
			apierror.Write(w, apierror.ForbiddenKey(i18n.KeyFeatureTierUnavailable))
			return
		}
		next(w, r)
	}
}

type generateFromChatRequest struct {
	SessionID     string            `json:"sessionId"`
	MessageID     string            `json:"messageId"`
	CharacterName string            `json:"characterName,omitempty"`
	TemplateName  string            `json:"templateName,omitempty"`
	AITags        map[string]string `json:"aiTags,omitempty"`
	DirectTags    map[string]string `json:"directTags,omitempty"`
	SelectedKeys  map[string]string `json:"selectedKeys,omitempty"`
}

type queuedResponse struct {
	JobID  string `json:"jobId"`
	Status string `json:"status"`
}

type duplicateResponse struct {
	Success       bool   `json:"success"`
	Error         string `json:"error"`
	MessageKey    string `json:"messageKey"`
	ExistingJobID string `json:"existingJobId"`
}

type failureResponse struct {
	Success bool   `json:"success"`
	Error   string `json:"error"`
}

// handleGenerateFromChat はチャットからの画像生成ジョブ投入（api/comfyui の同名
// ハンドラの public 移植。comfyui ドメインへの依存を TagJudgeKind 注入で置き換え、
// レスポンス形は完全互換）。
func handleGenerateFromChat(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if deps.Queue == nil {
			apierror.Write(w, apierror.NewKey(http.StatusNotImplemented, i18n.KeyErrorImageQueueUnavailable))
			return
		}
		var req generateFromChatRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorInvalidJSONBody))
			return
		}
		if req.SessionID == "" || req.MessageID == "" {
			_ = apiresponse.WriteJSON(w, http.StatusBadRequest, failureResponse{
				Success: false, Error: i18n.KeyErrorSessionMessageRequired,
			})
			return
		}
		kind := models.KindGemini
		if deps.TagJudgeKind != nil {
			kind = deps.TagJudgeKind()
		}
		added := deps.Queue.Add(jobsvc.Spec{
			Type:      jobsvc.TypeImageGen,
			Kind:      kind,
			Label:     i18n.KeyLabelImageGeneration,
			SessionID: req.SessionID,
			DedupeKey: req.SessionID + "\x00" + req.MessageID,
			Payload: coreapi.ImageGeneratePayload{
				SessionID:     req.SessionID,
				MessageID:     req.MessageID,
				CharacterName: req.CharacterName,
				TemplateName:  req.TemplateName,
				AITags:        req.AITags,
				DirectTags:    req.DirectTags,
				SelectedKeys:  req.SelectedKeys,
			},
		})
		if added.Duplicate {
			_ = apiresponse.WriteJSON(w, http.StatusConflict, duplicateResponse{
				Success:       false,
				Error:         i18n.KeyErrorAlreadyProcessing,
				MessageKey:    i18n.KeyErrorAlreadyProcessing,
				ExistingJobID: added.ExistingJobID,
			})
			return
		}
		_ = apiresponse.WriteJSON(w, http.StatusOK, queuedResponse{
			JobID: added.JobID, Status: string(jobsvc.StatusPending),
		})
	}
}
