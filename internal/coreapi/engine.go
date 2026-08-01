// Package coreapi は public / core の境界契約（型・インターフェース）の正本。
//
// 12_インターフェース設計_サイドカー分離.md 3章に基づく。core 行きパッケージ
// （providers / chatflow / nativehistory 等）が公開側から呼ばれる入口の型は
// 全てここに置き、core 側はこれを実装する。リポジトリ分割（Phase C）後も
// 本パッケージは公開側に残り、core は公開側を参照する（core→public の一方向）。
//
// 方針: 境界を渡る型は全て JSON シリアライズ可能な構造を保つこと
// （サイドカー RPC・トークンと表現を共有するため）。
package coreapi

import (
	"context"

	"alslime/internal/domain/chatjobs"
	"alslime/internal/domain/sessions"
)

// Engine is the provider boundary used by chatflow.
//
// Provider packages own CLI/native details. chatflow owns the shared ordering,
// unified-session writes, prompt assembly, and post-processing.
// （旧 chatflow.Engine。chatflow 側はエイリアスで互換を保つ。）
type Engine interface {
	Chat(ctx context.Context, req Request) (Response, error)
	Regenerate(ctx context.Context, req Request) (Response, error)
}

// Request is the provider-agnostic request passed to Gemini/Claude/Antigravity.
type Request struct {
	Payload        chatjobs.Payload
	Session        sessions.UnifiedSession
	UserMessage    string
	Prompt         string
	ModelType      sessions.ModelType
	Locale         PromptLocale
	IsNewSession   bool
	MethodCContext []string
	MethodCHistory []MethodCHistoryMessage
	// Messages / APITarget は openai_compat 専用（MethodC系と同じ
	// プロバイダ専用フィールドのパターン）。
	Messages  []ChatMessage     `json:"messages,omitempty"`
	APITarget *APIRequestTarget `json:"apiTarget,omitempty"`
}

// ChatMessage は openai_compat の messages 配列 1 要素。
type ChatMessage struct {
	Role    string `json:"role"` // "system" | "user" | "assistant"
	Content string `json:"content"`
}

// APIRequestTarget は openai_compat の送信先（サーバー側で UserModel 正本から
// 解決する。秘密値は含まない）。
type APIRequestTarget struct {
	ConnectionID  string `json:"connectionId"`
	RemoteModelID string `json:"remoteModelId"` // 送信時 model フィールドへそのまま入る文字列
	// Preset は接続先のプリセット ID（openrouter|openai|deepseek|opencode-go|custom）。
	// chatflow が固定プリセット基本指示ファイルのパスを解決するために持つ
	// （秘密を含まないサーバー解決情報）。
	Preset string `json:"preset,omitempty"`
}

// Response is the provider result after CLI/native execution.
type Response struct {
	Output          string
	NativeSessionID string
	ModelLabel      string
	ProviderError   bool
	ErrorType       string
	// Usage は openai_compat の使用量回収結果（nil = なし）。
	Usage *Usage
	// RequestSent は HTTP リクエストが実際に送出されたか（httptrace の
	// WroteHeaders 基準）。chatflow が EffectiveContent 保存可否を判定する
	// 唯一の信号。正常受理時は常に true。
	RequestSent bool
}

// MethodCHistoryMessage is the provider-neutral history used when recreating a
// send-only Antigravity conversation from the unified session.
type MethodCHistoryMessage struct {
	Role      string
	Content   string
	Timestamp string
}
