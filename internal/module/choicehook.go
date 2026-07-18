package module

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"alslime/internal/coreapi"
	"alslime/internal/features"
)

// choiceHookTimeout はフック RPC（テキスト整形のみ）の上限時間。
// チャット全体を待たせないよう短く保つ（超過は素通し扱い）。
const choiceHookTimeout = 3 * time.Second

// ChoiceHook は行動選択肢サイドカーへの ChatHook 委譲クライアント。
//
// 判定は必ずゲートを先に評価し、不通過ならトグル・サイドカーの疎通確認・RPC を
// 一切行わない（無料版に機能の痕跡を露出させない）。その上でトグルOFF・サイドカー
// 不通・エラーは Active=false / 選択肢なしの素通し（フェイルソフト）。
type ChoiceHook struct {
	// Manager は選択肢サイドカーのプロセス管理（ComfyUI と同じ流儀の別インスタンス）。
	Manager *Manager
	// Toggle はユーザー設定の機能ON/OFF（featureToggles.actionChoice）。
	// 都度読みのクロージャで、設定変更が再起動なしで反映される。nil は常に有効。
	Toggle func() bool

	mu   sync.RWMutex
	gate coreapi.FeatureGate

	client *http.Client
}

// NewChoiceHook は ChoiceHook を生成する。toggle は設定の機能ON/OFF読み出し
//（nil 可 = 常に有効）。ゲートは core 組み立て後に SetGate で注入する。
func NewChoiceHook(manager *Manager, toggle func() bool) *ChoiceHook {
	return &ChoiceHook{
		Manager: manager,
		Toggle:  toggle,
		client:  &http.Client{Timeout: choiceHookTimeout},
	}
}

// SetGate は機能ゲートを注入する（core 組み立て後に routes.go が呼ぶ）。
func (h *ChoiceHook) SetGate(gate coreapi.FeatureGate) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.gate = gate
}

// enabled は「支援者ゲート通過 かつ トグルON かつ サイドカー疎通可能」を返す
//（設計 6.2 の判定順: ゲート → トグル → 疎通）。
// ゲート未注入・不通過ならトグル・疎通確認自体を行わない（ゲート先評価）。
func (h *ChoiceHook) enabled() bool {
	h.mu.RLock()
	gate := h.gate
	h.mu.RUnlock()
	if gate == nil || !gate.Enabled(string(features.FeatureActionChoice)) {
		return false
	}
	if h.Toggle != nil && !h.Toggle() {
		return false
	}
	return h.Manager != nil && h.Manager.BaseURL() != nil
}

// PreSend は送信前フックをサイドカーへ委譲する。
func (h *ChoiceHook) PreSend(ctx context.Context, req coreapi.ChatHookPreSendRequest) (coreapi.ChatHookPreSendResult, error) {
	if !h.enabled() {
		return coreapi.ChatHookPreSendResult{}, nil
	}
	var res coreapi.ChatHookPreSendResult
	if err := h.post(ctx, coreapi.ModuleChatPreSendRoute, req, &res); err != nil {
		return coreapi.ChatHookPreSendResult{}, err
	}
	return res, nil
}

// PostReceive は受信後フックをサイドカーへ委譲する。
func (h *ChoiceHook) PostReceive(ctx context.Context, req coreapi.ChatHookPostReceiveRequest) (coreapi.ChatHookPostReceiveResult, error) {
	if !h.enabled() {
		return coreapi.ChatHookPostReceiveResult{}, nil
	}
	var res coreapi.ChatHookPostReceiveResult
	if err := h.post(ctx, coreapi.ModuleChatPostReceiveRoute, req, &res); err != nil {
		return coreapi.ChatHookPostReceiveResult{}, err
	}
	return res, nil
}

// post は共有シークレット付きの内部 RPC POST（JSON in / JSON out）。
func (h *ChoiceHook) post(ctx context.Context, route string, in any, out any) error {
	base := h.Manager.BaseURL()
	if base == nil {
		return fmt.Errorf("choice module is not running")
	}
	body, err := json.Marshal(in)
	if err != nil {
		return err
	}
	callCtx, cancel := context.WithTimeout(ctx, choiceHookTimeout)
	defer cancel()
	httpReq, err := http.NewRequestWithContext(callCtx, http.MethodPost, base.JoinPath(route).String(), bytes.NewReader(body))
	if err != nil {
		return err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set(coreapi.ModuleAuthHeader, h.Manager.Secret())
	resp, err := h.client.Do(httpReq)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("choice module rpc failed: %s (%d)", route, resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}
