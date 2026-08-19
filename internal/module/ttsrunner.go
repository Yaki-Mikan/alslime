package module

// TTSRunner は TypeTTS ジョブ（1読み上げ実行）の実行本体。
//
// 計画（Payload の coreapi.TTSReadPayload）の TURN 列を順に、セグメント一件ずつ
// 合成へ送り（サイドカーにはその時点の一件だけを担当させる。要件9.3）、
// 完成チャンクを ttsaudio ストアへ保存し、TURN ごとに結合して進捗を積む。
// 合成の供給元はサイドカー RPC（Manager）または in-process（Provider）。

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"alslime/internal/coreapi"
	"alslime/internal/domain/ttsaudio"
	"alslime/internal/i18n"
	"alslime/internal/jobs"
)

// TTS 進捗の TextKey（構造情報は Args で搬送。フロントはこのキーで判別する）。
const (
	// TTSProgressChunk は完成チャンク通知。Args: [messageId, turnId, chunkIndex, format]
	TTSProgressChunk = "tts.chunk"
	// TTSProgressMerged は TURN 結合完了通知。Args: [messageId, turnId, durationSeconds]
	TTSProgressMerged = "tts.merged"
	// TTSProgressSkipped はスキップ通知。Args: [turnId, reason]
	TTSProgressSkipped = "tts.skipped"
)

// TTSRunner は jobs.Runner の実装。
type TTSRunner struct {
	Manager  *Manager
	Provider coreapi.TTSProvider
	Store    *ttsaudio.Store
	// HTTP は nil なら http.DefaultClient。Timeout は設定しない
	// （長時間生成のため。キャンセル・タイムアウトはジョブの ctx に一本化）。
	HTTP *http.Client
	// Progress はチャンク完成・結合・スキップの通知先（jobs.Queue.AppendProgress）。
	Progress func(jobID string, entry jobs.ProgressEntry)
}

// Run は1読み上げ実行を処理する。
func (r TTSRunner) Run(ctx context.Context, job jobs.Job) (jobs.Result, error) {
	raw, err := json.Marshal(job.Payload)
	if err != nil {
		return jobs.Result{}, err
	}
	var payload coreapi.TTSReadPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		return jobs.Result{}, err
	}
	completed := 0
	for _, item := range payload.Plan.Items {
		if err := ctx.Err(); err != nil {
			return jobs.Result{}, err
		}
		if item.Skipped {
			r.progress(job.JobID, TTSProgressSkipped, item.TurnID, item.SkipReason)
			continue
		}
		if err := r.runTurn(ctx, job.JobID, payload, item); err != nil {
			// 中止・失敗した TURN の未結合チャンクを残さない
			// （キャンセル後に未再生チャンクが再生されない。要件9.2）。
			r.Store.CleanupTurnTemp(payload.SessionID, payload.MessageID, item.TurnID)
			return jobs.Result{}, err
		}
		completed++
	}
	return jobs.Result{Output: fmt.Sprintf("tts: %d turn(s) completed", completed)}, nil
}

// runTurn は1TURN分（分割済みセグメント列）を合成・保存・結合する。
func (r TTSRunner) runTurn(ctx context.Context, jobID string, payload coreapi.TTSReadPayload, item coreapi.TTSPlanItem) error {
	// 前回実行の一時チャンク残骸を除去してから生成する（正常完了時の .part は
	// 逐次再生の取得猶予のため残す方式になったので、再作成時はここで払拭する）。
	r.Store.CleanupTurnTemp(payload.SessionID, payload.MessageID, item.TurnID)
	chunkCount := 0
	for _, segment := range item.Segments {
		if err := ctx.Err(); err != nil {
			return err
		}
		req := coreapi.TTSSynthesizeRequest{
			Text:            segment.Text,
			VoiceID:         item.VoiceID,
			Caption:         item.Caption,
			CfgScaleCaption: item.CfgScaleCaption,
			CfgScaleSpeaker: item.CfgScaleSpeaker,
			Speed:           payload.Plan.Speed,
			ResponseFormat:  payload.Plan.ResponseFormat,
		}
		// 地の文ナレーター読み（要件4章）: 地の文セグメントはナレーター用Voiceで
		// 合成する。ナレーターはキャラクター単位の設定を持たないため、
		// キャプションとキャラ別CFG上書きは適用しない。
		if segment.Narration && payload.Plan.Narrator != nil {
			req.VoiceID = payload.Plan.Narrator.VoiceID
			req.Caption = ""
			req.CfgScaleCaption = payload.Plan.Narrator.CfgScaleCaption
			req.CfgScaleSpeaker = payload.Plan.Narrator.CfgScaleSpeaker
		}
		err := r.synthesize(ctx, req, func(chunk coreapi.TTSChunk) error {
			// チャンク番号はセグメントを跨いだ TURN 内の通し番号
			// （結合・逐次再生の取得はこの連番が正本）。
			if err := r.Store.SaveChunk(payload.SessionID, payload.MessageID, item.TurnID, chunkCount, chunk.Format, chunk.Audio); err != nil {
				return err
			}
			r.progress(jobID, TTSProgressChunk, payload.MessageID, item.TurnID, strconv.Itoa(chunkCount), chunk.Format)
			chunkCount++
			return nil
		})
		if err != nil {
			return err
		}
	}
	if chunkCount == 0 {
		return errors.New(i18n.KeyErrorTTSHTTPError)
	}
	entry, err := r.Store.MergeTurn(payload.SessionID, payload.MessageID, item.TurnID, chunkCount, payload.Plan.ResponseFormat, item.VoiceID, payload.Plan.ChunkSilenceSeconds)
	if err != nil {
		return err
	}
	r.progress(jobID, TTSProgressMerged, payload.MessageID, item.TurnID, fmt.Sprintf("%.3f", entry.DurationSeconds))
	return nil
}

// progress は TextKey + Args で構造情報を搬送する（既存 ProgressEntry の流儀）。
func (r TTSRunner) progress(jobID, key string, args ...string) {
	if r.Progress == nil {
		return
	}
	r.Progress(jobID, jobs.ProgressEntry{Kind: jobs.ProgressKindText, TextKey: key, Args: args})
}

// synthesize は一件の合成を実行する。サイドカー起動中は RPC、無ければ in-process。
func (r TTSRunner) synthesize(ctx context.Context, req coreapi.TTSSynthesizeRequest, onChunk func(coreapi.TTSChunk) error) error {
	if r.Manager != nil && r.Manager.BaseURL() != nil {
		return r.synthesizeRPC(ctx, req, onChunk)
	}
	if r.Provider != nil && r.Provider.InProcess() {
		return r.Provider.Synthesize(ctx, req, onChunk)
	}
	return errors.New(i18n.KeyErrorTTSServiceMissing)
}

// synthesizeRPC はサイドカーの /module/tts-synthesize（SSE: chunk / done / error）を読む。
func (r TTSRunner) synthesizeRPC(ctx context.Context, req coreapi.TTSSynthesizeRequest, onChunk func(coreapi.TTSChunk) error) error {
	client := r.HTTP
	if client == nil {
		client = http.DefaultClient
	}
	payload, err := json.Marshal(req)
	if err != nil {
		return err
	}
	target := r.Manager.BaseURL().JoinPath(coreapi.ModuleTTSSynthesizeRoute)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, target.String(), bytes.NewReader(payload))
	if err != nil {
		return err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set(coreapi.ModuleAuthHeader, r.Manager.Secret())
	res, err := client.Do(httpReq)
	if err != nil {
		return err
	}
	defer func() { _ = res.Body.Close() }()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("tts module: HTTP %d", res.StatusCode)
	}
	// audio_base64 で数MB級の行が来るためバッファを拡張する。
	scanner := bufio.NewScanner(res.Body)
	scanner.Buffer(make([]byte, 1024*1024), 64*1024*1024)
	event, data := "", ""
	for scanner.Scan() {
		line := scanner.Text()
		switch {
		case line == "":
			done, err := dispatchTTSModuleEvent(event, data, onChunk)
			if err != nil {
				return err
			}
			if done {
				return nil
			}
			event, data = "", ""
		case strings.HasPrefix(line, "event: "):
			event = strings.TrimPrefix(line, "event: ")
		case strings.HasPrefix(line, "data: "):
			data = strings.TrimPrefix(line, "data: ")
		}
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	return errors.New("tts module: stream ended before done")
}

// ttsModuleChunkEvent はサイドカー SSE の chunk イベント data。
type ttsModuleChunkEvent struct {
	Index       int    `json:"index"`
	Format      string `json:"format"`
	AudioBase64 string `json:"audioBase64"`
}

// dispatchTTSModuleEvent は1イベントを処理する。done で (true, nil) を返す。
func dispatchTTSModuleEvent(event, data string, onChunk func(coreapi.TTSChunk) error) (bool, error) {
	switch event {
	case "chunk":
		var ev ttsModuleChunkEvent
		if err := json.Unmarshal([]byte(data), &ev); err != nil {
			return false, fmt.Errorf("tts module: invalid chunk event: %w", err)
		}
		audio, err := base64.StdEncoding.DecodeString(ev.AudioBase64)
		if err != nil {
			return false, fmt.Errorf("tts module: invalid chunk audio: %w", err)
		}
		return false, onChunk(coreapi.TTSChunk{Index: ev.Index, Format: ev.Format, Audio: audio})
	case "error":
		var ev struct {
			Message string `json:"message"`
		}
		if err := json.Unmarshal([]byte(data), &ev); err != nil || ev.Message == "" {
			return false, errors.New("tts module: synthesis failed")
		}
		return false, errors.New(ev.Message)
	case "done":
		return true, nil
	}
	return false, nil
}
