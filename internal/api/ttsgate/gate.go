// Package ttsgate は音声読み上げ（Irodori-TTS連携）の public 側入口。
//
// サイドカーモード時のルート登録を担う:
//   - /api/tts/*: gate 判定 → TTS サイドカーモジュールへリバースプロキシ
//
// in-process モード（モジュール未配置時のフォールバック）のルート登録は
// core 側の coreapi.TTSProvider.RegisterRoutes が担う。フロントから見た
// API 形状は両モードで完全に同一（comfyuigate と同じ役割分担）。
package ttsgate

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"net/http/httputil"
	"net/url"

	"alslime/internal/api/apierror"
	"alslime/internal/api/apiresponse"
	"alslime/internal/config"
	"alslime/internal/coreapi"
	"alslime/internal/domain/models"
	"alslime/internal/domain/ttsaudio"
	"alslime/internal/features"
	"alslime/internal/i18n"
	jobsvc "alslime/internal/jobs"
)

const routeBase = config.APIPrefix + "/tts"

// ModuleTarget はサイドカーモジュールへの接続先解決（internal/module.Manager が満たす）。
type ModuleTarget interface {
	// BaseURL はモジュールのベース URL。未起動なら nil。
	BaseURL() *url.URL
	// Secret は本体⇔モジュール間 RPC の共有シークレット。
	Secret() string
}

// Deps は public 側依存。
type Deps struct {
	// Gate は利用者向け機能ゲート（本体側で判定してからモジュールへ転送する）。
	Gate coreapi.FeatureGate
	// Module はモジュールへの接続先解決。
	Module ModuleTarget
	// Provider は in-process 供給（サイドカー未起動時のフォールバック）。
	Provider coreapi.TTSProvider
	// Queue は読み上げ実行（TypeTTS）のジョブ投入先。
	Queue *jobsvc.Queue
	// Store は生成音声の保存・取得。
	Store *ttsaudio.Store
	// HTTP は plan RPC 用（nil なら http.DefaultClient）。
	HTTP *http.Client
}

// RegisterProxy はサイドカーモード時の TTS ルートを登録する。
func RegisterProxy(mux *http.ServeMux, deps Deps) {
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
				apierror.Write(w, apierror.NewKey(http.StatusServiceUnavailable, i18n.KeyErrorTTSServiceMissing))
				return
			}
			proxy.ServeHTTP(w, r)
		}))
}

// requireGate は TTS route 全体を tier gate 配下へ置く。gate 未注入は安全側で全拒否。
func requireGate(gate coreapi.FeatureGate, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if gate == nil || !gate.Enabled(string(features.FeatureTTS)) {
			apierror.Write(w, apierror.ForbiddenKey(i18n.KeyFeatureTierUnavailable))
			return
		}
		next(w, r)
	}
}

// RegisterReadRoutes は読み上げ実行と音声取得のルートを登録する。
//
// これらは本体管轄のためサイドカー／in-process のどちらのモードでも常時登録する
// （プロキシの routeBase+"/" より具体的なパターンが優先されるため共存できる）。
func RegisterReadRoutes(mux *http.ServeMux, deps Deps) {
	mux.HandleFunc("POST "+routeBase+"/read", requireGate(deps.Gate, handleRead(deps)))
	mux.HandleFunc("GET "+routeBase+"/status/{jobId}", requireGate(deps.Gate, handleStatus(deps)))
	mux.HandleFunc("GET "+routeBase+"/audio-index/{sessionId}", requireGate(deps.Gate, handleAudioIndex(deps)))
	mux.HandleFunc("GET "+routeBase+"/audio/{sessionId}/{messageId}/{turnId}", requireGate(deps.Gate, handleAudioFinal(deps)))
	mux.HandleFunc("GET "+routeBase+"/audio/{sessionId}/{messageId}/{turnId}/chunks/{index}", requireGate(deps.Gate, handleAudioChunk(deps)))
	mux.HandleFunc("DELETE "+routeBase+"/audio/{sessionId}/{messageId}", requireGate(deps.Gate, handleAudioDeleteMessage(deps)))
}

// readRequest は読み上げ実行の開始要求（設計03の2章）。
type readRequest struct {
	SessionID string `json:"sessionId"`
	MessageID string `json:"messageId"`
	// TurnID 指定時は TURN 単位実行（再作成を含む）。空は1応答全体。
	TurnID            string                                  `json:"turnId,omitempty"`
	PresetVoiceDesign map[string]coreapi.TTSPresetVoiceDesign `json:"presetVoiceDesign,omitempty"`
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

// emptyResponse は読み上げ対象が無い（ジョブを登録しない）応答。
// TURN 単位の Voice 未解決エラー表示（要件9.3）はこの応答で行う。
type emptyResponse struct {
	Empty  bool   `json:"empty"`
	Reason string `json:"reason,omitempty"`
}

// handleRead は読み上げ実行のジョブ投入（設計03の2章）。
func handleRead(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if deps.Queue == nil || deps.Store == nil {
			apierror.Write(w, apierror.NewKey(http.StatusNotImplemented, i18n.KeyErrorTTSServiceMissing))
			return
		}
		var req readRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorInvalidJSONBody))
			return
		}
		if req.SessionID == "" || req.MessageID == "" {
			apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorInvalidJSONBody))
			return
		}
		plan, err := fetchPlan(r.Context(), deps, coreapi.TTSPlanRequest{
			SessionID:         req.SessionID,
			MessageID:         req.MessageID,
			TurnID:            req.TurnID,
			PresetVoiceDesign: req.PresetVoiceDesign,
		})
		if err != nil {
			apierror.Write(w, apierror.NewKey(http.StatusServiceUnavailable, i18n.KeyErrorTTSServiceMissing))
			return
		}
		// 1応答全体では生成済み TURN を飛ばす（要件9.3。TURN 単位は再作成のため除外しない）。
		if req.TurnID == "" {
			index, err := deps.Store.ReadIndex(req.SessionID)
			if err == nil {
				for i, item := range plan.Items {
					if item.Skipped {
						continue
					}
					key := ttsaudio.TurnKey(req.MessageID, item.TurnID)
					if _, ok := index.Entries[key]; ok {
						plan.Items[i].Skipped = true
						plan.Items[i].SkipReason = coreapi.TTSSkipReasonAlreadyGenerated
						plan.Items[i].Segments = nil
					}
				}
			}
		}
		runnable := 0
		for _, item := range plan.Items {
			if !item.Skipped {
				runnable++
			}
		}
		if runnable == 0 {
			_ = apiresponse.WriteJSON(w, http.StatusOK, emptyResponse{Empty: true, Reason: emptyReason(plan.Items)})
			return
		}
		added := deps.Queue.Add(jobsvc.Spec{
			Type:      jobsvc.TypeTTS,
			Kind:      models.KindTTS,
			Label:     i18n.KeyLabelTTSReading,
			SessionID: req.SessionID,
			DedupeKey: coreapi.TTSDedupeKey(req.SessionID, req.MessageID, req.TurnID),
			Payload: coreapi.TTSReadPayload{
				SessionID: req.SessionID,
				MessageID: req.MessageID,
				TurnID:    req.TurnID,
				Plan:      plan,
			},
		})
		if added.MaintenanceRejected {
			apierror.Write(w, apierror.NewKey(http.StatusConflict, i18n.KeyErrorUpdateMaintenance))
			return
		}
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

// ttsStatusResponse は読み上げ実行の状態（チャンク進捗込み。逐次再生のポーリング用）。
// MessageID / TurnID は画面更新後のボタン状態復元に使う（要件10章）。
type ttsStatusResponse struct {
	JobID     string                 `json:"jobId"`
	Status    string                 `json:"status"`
	MessageID string                 `json:"messageId,omitempty"`
	TurnID    string                 `json:"turnId,omitempty"`
	Error     string                 `json:"error,omitempty"`
	Progress  []jobsvc.ProgressEntry `json:"progress,omitempty"`
}

// handleStatus は TypeTTS ジョブの状態と進捗を返す。
func handleStatus(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if deps.Queue == nil {
			apierror.Write(w, apierror.NewKey(http.StatusNotImplemented, i18n.KeyErrorTTSServiceMissing))
			return
		}
		job, ok := deps.Queue.Get(r.PathValue("jobId"))
		if !ok || job.Type != jobsvc.TypeTTS {
			apierror.Write(w, apierror.NewKey(http.StatusNotFound, i18n.KeyErrorTTSServiceMissing))
			return
		}
		res := ttsStatusResponse{
			JobID:    job.JobID,
			Status:   string(job.Status),
			Error:    job.Err,
			Progress: job.Progress,
		}
		// 終端後は Payload が解放されるため、取り出せる場合のみ載せる。
		if raw, err := json.Marshal(job.Payload); err == nil {
			var payload coreapi.TTSReadPayload
			if json.Unmarshal(raw, &payload) == nil {
				res.MessageID = payload.MessageID
				res.TurnID = payload.TurnID
			}
		}
		_ = apiresponse.WriteJSON(w, http.StatusOK, res)
	}
}

// emptyReason は実行対象ゼロ時の代表理由（Voice 未解決を最優先で伝える）。
func emptyReason(items []coreapi.TTSPlanItem) string {
	priority := []string{
		coreapi.TTSSkipReasonVoiceUnresolved,
		coreapi.TTSSkipReasonReadDisabled,
		coreapi.TTSSkipReasonAlreadyGenerated,
		coreapi.TTSSkipReasonEmpty,
	}
	for _, reason := range priority {
		for _, item := range items {
			if item.SkipReason == reason {
				return reason
			}
		}
	}
	return coreapi.TTSSkipReasonEmpty
}

// fetchPlan は読み上げ計画を取得する。サイドカー起動中は RPC、無ければ in-process。
func fetchPlan(ctx context.Context, deps Deps, req coreapi.TTSPlanRequest) (coreapi.TTSPlanResponse, error) {
	if deps.Module != nil && deps.Module.BaseURL() != nil {
		client := deps.HTTP
		if client == nil {
			client = http.DefaultClient
		}
		payload, err := json.Marshal(req)
		if err != nil {
			return coreapi.TTSPlanResponse{}, err
		}
		target := deps.Module.BaseURL().JoinPath(coreapi.ModuleTTSPlanRoute)
		httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, target.String(), bytes.NewReader(payload))
		if err != nil {
			return coreapi.TTSPlanResponse{}, err
		}
		httpReq.Header.Set("Content-Type", "application/json")
		httpReq.Header.Set(coreapi.ModuleAuthHeader, deps.Module.Secret())
		res, err := client.Do(httpReq)
		if err != nil {
			return coreapi.TTSPlanResponse{}, err
		}
		defer func() { _ = res.Body.Close() }()
		if res.StatusCode != http.StatusOK {
			return coreapi.TTSPlanResponse{}, fmt.Errorf("tts module: HTTP %d", res.StatusCode)
		}
		var out coreapi.TTSPlanResponse
		if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
			return coreapi.TTSPlanResponse{}, err
		}
		return out, nil
	}
	if deps.Provider != nil && deps.Provider.InProcess() {
		return deps.Provider.Plan(ctx, req)
	}
	return coreapi.TTSPlanResponse{}, errors.New(i18n.KeyErrorTTSServiceMissing)
}

// handleAudioIndex は作成済み音声の一覧（作成済み判定・再生ボタン表示用）。
func handleAudioIndex(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if deps.Store == nil {
			apierror.Write(w, apierror.NewKey(http.StatusNotImplemented, i18n.KeyErrorTTSServiceMissing))
			return
		}
		index, err := deps.Store.ReadIndex(r.PathValue("sessionId"))
		if err != nil {
			apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorInvalidJSONBody))
			return
		}
		_ = apiresponse.WriteJSON(w, http.StatusOK, index)
	}
}

// handleAudioFinal は TURN の最終音声を返す。
func handleAudioFinal(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if deps.Store == nil {
			apierror.Write(w, apierror.NewKey(http.StatusNotImplemented, i18n.KeyErrorTTSServiceMissing))
			return
		}
		key := ttsaudio.TurnKey(r.PathValue("messageId"), r.PathValue("turnId"))
		path, _, err := deps.Store.FinalPath(r.PathValue("sessionId"), key)
		if err != nil {
			status := http.StatusInternalServerError
			if errors.Is(err, fs.ErrNotExist) || errors.Is(err, ttsaudio.ErrBadID) {
				status = http.StatusNotFound
			}
			apierror.Write(w, apierror.NewKey(status, i18n.KeyErrorTTSServiceMissing))
			return
		}
		serveAudioNoStore(w, r, path)
	}
}

// serveAudioNoStore は音声ファイルをキャッシュ禁止で返す。
// 再作成で同じURLの中身が差し替わるため、Last-Modified だけの応答だと
// ブラウザの経験的キャッシュが差し替え前の音声を返すことがある（no-store で封じる）。
func serveAudioNoStore(w http.ResponseWriter, r *http.Request, path string) {
	w.Header().Set("Cache-Control", "no-store")
	http.ServeFile(w, r, path)
}

// handleAudioChunk は逐次再生用の完成チャンクを返す（実行終端後は掃除済みで404）。
func handleAudioChunk(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if deps.Store == nil {
			apierror.Write(w, apierror.NewKey(http.StatusNotImplemented, i18n.KeyErrorTTSServiceMissing))
			return
		}
		index := 0
		if _, err := fmt.Sscanf(r.PathValue("index"), "%d", &index); err != nil || index < 0 {
			apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorInvalidJSONBody))
			return
		}
		format := r.URL.Query().Get("format")
		if format == "" {
			format = "wav"
		}
		path, err := deps.Store.ChunkPath(r.PathValue("sessionId"), r.PathValue("messageId"), r.PathValue("turnId"), index, format)
		if err != nil {
			apierror.Write(w, apierror.NewKey(http.StatusNotFound, i18n.KeyErrorTTSServiceMissing))
			return
		}
		serveAudioNoStore(w, r, path)
	}
}

// handleAudioDeleteMessage は1応答（メッセージ）分の生成音声を削除する（要件10章）。
func handleAudioDeleteMessage(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if deps.Store == nil {
			apierror.Write(w, apierror.NewKey(http.StatusNotImplemented, i18n.KeyErrorTTSServiceMissing))
			return
		}
		if err := deps.Store.DeleteMessage(r.PathValue("sessionId"), r.PathValue("messageId")); err != nil {
			status := http.StatusInternalServerError
			if errors.Is(err, ttsaudio.ErrBadID) {
				status = http.StatusBadRequest
			}
			apierror.Write(w, apierror.NewKey(status, i18n.KeyErrorTTSServiceMissing))
			return
		}
		_ = apiresponse.WriteJSON(w, http.StatusOK, map[string]bool{"success": true})
	}
}
