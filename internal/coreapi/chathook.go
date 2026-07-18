package coreapi

import "context"

// ChatHook はチャット送受信の汎用加工フック境界。
//
// chatflow の送信直前（プロバイダ呼び出し前）と応答確定後（保存前）に呼ばれる。
// 実装（行動選択肢サイドカー等）は公開側 internal/module に置き、機能ゲートの
// 先評価・サイドカー疎通もフック実装側の責務とする。chatflow はゲートを知らない。
//
// フェイルソフト方針: フック実装のエラー・Active=false は「素通し」を意味し、
// チャット本体を失敗させてはならない（呼び出し側はエラーを握って続行する）。
// 境界を渡る型は JSON シリアライズ可能を保つ（サイドカー RPC と表現を共有）。
type ChatHook interface {
	// PreSend は組み立て済みプロンプトの送信直前加工。
	// Active=false のときは何も適用しない（ゲート不通過・サイドカー不通など）。
	PreSend(ctx context.Context, req ChatHookPreSendRequest) (ChatHookPreSendResult, error)
	// PostReceive は応答確定後の付加データ収集（行動選択肢の回収等）。
	// PreSend が返した Token で相関付ける。
	PostReceive(ctx context.Context, req ChatHookPostReceiveRequest) (ChatHookPostReceiveResult, error)
}

// ChatHookPreSendRequest は送信前フックへの入力。
type ChatHookPreSendRequest struct {
	// SessionID は統一セッション ID。
	SessionID string `json:"sessionId"`
	// ModelType はプロバイダ種別（gemini / claude / antigravity）。
	ModelType string `json:"modelType"`
	// UserMessage は生のユーザー入力（保存される正本。フックは参照のみ）。
	UserMessage string `json:"userMessage"`
	// Prompt は組み立て済みの送信プロンプト（フックはこれを加工して返す）。
	Prompt string `json:"prompt"`
}

// ChatHookPreSendResult は送信前フックの結果。
type ChatHookPreSendResult struct {
	// Active はフックが実際に作用したか。false なら他フィールドは無視する。
	Active bool `json:"active"`
	// Prompt は加工後プロンプト。空なら無加工扱い。
	Prompt string `json:"prompt,omitempty"`
	// Token は PostReceive との相関キー（フック実装が払い出す不透明値）。
	Token string `json:"token,omitempty"`
}

// ChatHookPostReceiveRequest は受信後フックへの入力。
type ChatHookPostReceiveRequest struct {
	// Token は PreSend が払い出した相関キー。
	Token string `json:"token"`
	// Output は後処理済みの応答本文（参照のみ。加工はしない）。
	Output string `json:"output"`
}

// ChatHookPostReceiveResult は受信後フックの結果。
type ChatHookPostReceiveResult struct {
	// ActionChoices は行動選択肢（無ければ nil / 空）。
	ActionChoices []string `json:"actionChoices,omitempty"`
}
