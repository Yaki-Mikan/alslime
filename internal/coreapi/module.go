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
	// ModuleTokenEnv はモジュール起動時に entitlement トークンを渡す環境変数。
	// release ビルドのモジュールは起動時にこのトークンを検証する（流出対策）。
	ModuleTokenEnv = "ALSLIME_MODULE_TOKEN"
	// ModulePortPrefix はモジュールが実ポートを stdout の1行目で報告する際の接頭辞。
	ModulePortPrefix = "MODULE_PORT="
	// ModuleHealthzRoute はモジュールの死活確認ルート。
	ModuleHealthzRoute = "/healthz"
	// ModuleImageGenerateRoute は画像生成ジョブ実行の内部 RPC ルート。
	ModuleImageGenerateRoute = "/module/image-generate"
	// ModuleImageAnalyzeRoute は画像生成の分析段（タグ判定→タグ解決）だけを実行する内部 RPC ルート。
	ModuleImageAnalyzeRoute = "/module/image-analyze"
	// ModuleAppearancePromptRoute はキャラクター容姿プロンプト作成ジョブ実行の内部 RPC ルート。
	ModuleAppearancePromptRoute = "/module/appearance-prompt"
)

// ModuleImageGenerateRequest は画像生成ジョブの RPC リクエスト。
//
// Payload は comfyui ドメインの ImageGeneratePayload の JSON 表現をそのまま持つ
//（本体はジョブ Payload を再解釈せず素通しする）。
type ModuleImageGenerateRequest struct {
	JobID   string          `json:"jobId"`
	Payload json.RawMessage `json:"payload"`
	// Prepared は分析済みの要求（ImageRenderPayload の JSON 表現）。非 nil なら分析を行わず
	// この内容で生成だけを実行する。nil なら Payload から分析と生成を続けて行う。
	Prepared json.RawMessage `json:"prepared,omitempty"`
}

// ModuleImageGenerateResponse は画像生成ジョブの RPC レスポンス。
type ModuleImageGenerateResponse struct {
	Success        bool   `json:"success"`
	FinalSessionID string `json:"finalSessionId,omitempty"`
	Output         string `json:"output,omitempty"`
	// Error は失敗時の messageKey（i18n キー方式）。
	Error string `json:"error,omitempty"`
}

// ModuleImageAnalyzeRequest は画像生成の分析段の RPC リクエスト。
// Payload は ImageGeneratePayload の JSON 表現をそのまま持つ（本体は再解釈しない）。
type ModuleImageAnalyzeRequest struct {
	JobID   string          `json:"jobId"`
	Payload json.RawMessage `json:"payload"`
}

// ModuleImageAnalyzeResponse は分析段の RPC レスポンス。
// Payload は ImageRenderPayload の JSON 表現（本体はそのまま生成ジョブの Payload に載せる）。
type ModuleImageAnalyzeResponse struct {
	Success bool            `json:"success"`
	Payload json.RawMessage `json:"payload,omitempty"`
	// Error は失敗時の messageKey（i18n キー方式）。
	Error string `json:"error,omitempty"`
}

// ModuleAppearancePromptRequest はキャラクター容姿プロンプト作成ジョブの RPC リクエスト。
// Payload は appearancejobs.Payload の JSON 表現をそのまま持つ（本体は再解釈しない）。
type ModuleAppearancePromptRequest struct {
	JobID   string          `json:"jobId"`
	Payload json.RawMessage `json:"payload"`
}

// ModuleAppearancePromptResponse はキャラクター容姿プロンプト作成ジョブの RPC レスポンス。
// Output は appearancejobs.Result の JSON 表現（本体はそのまま jobs.Result.Output に載せる）。
type ModuleAppearancePromptResponse struct {
	Success bool   `json:"success"`
	Output  string `json:"output,omitempty"`
	// Error は失敗時の messageKey（i18n キー方式）。
	Error string `json:"error,omitempty"`
}
