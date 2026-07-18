package coreapi

import "encoding/json"

// サイドカーモジュール（12番 4章）と本体の間の RPC 契約。
//
// モジュール側（cmd/comfymodule）と本体側（internal/module のクライアント）が
// 共有する定数・型はここに置く。境界を渡る型は JSON シリアライズ可能を保つ。

const (
	// ModuleAuthHeader は本体⇔モジュール間 RPC の共有シークレットヘッダ。
	ModuleAuthHeader = "X-AlSlime-Module-Auth"
	// ModuleSecretEnv はモジュール起動時に共有シークレットを渡す環境変数。
	ModuleSecretEnv = "ALSLIME_MODULE_SECRET"
	// ModulePortPrefix はモジュールが実ポートを stdout の1行目で報告する際の接頭辞。
	ModulePortPrefix = "MODULE_PORT="
	// ModuleHealthzRoute はモジュールの死活確認ルート。
	ModuleHealthzRoute = "/healthz"
	// ModuleImageGenerateRoute は画像生成ジョブ実行の内部 RPC ルート。
	ModuleImageGenerateRoute = "/module/image-generate"
)

// ModuleImageGenerateRequest は画像生成ジョブの RPC リクエスト。
//
// Payload は comfyui ドメインの ImageGeneratePayload の JSON 表現をそのまま持つ
//（本体はジョブ Payload を再解釈せず素通しする）。
type ModuleImageGenerateRequest struct {
	JobID   string          `json:"jobId"`
	Payload json.RawMessage `json:"payload"`
}

// ModuleImageGenerateResponse は画像生成ジョブの RPC レスポンス。
type ModuleImageGenerateResponse struct {
	Success        bool   `json:"success"`
	FinalSessionID string `json:"finalSessionId,omitempty"`
	Output         string `json:"output,omitempty"`
	// Error は失敗時の messageKey（i18n キー方式）。
	Error string `json:"error,omitempty"`
}
