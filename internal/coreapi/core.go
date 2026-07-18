package coreapi

import (
	"net/http"
	"time"

	"alslime/internal/domain/models"
	"alslime/internal/domain/sessions"
	"alslime/internal/jobs"
	"alslime/internal/storage/paths"
)

// NativeSweeper は各 CLI ネイティブ履歴の掃除境界。
//
// 配置規則（CLI 解析結果）は core 側（housekeepingnative）に閉じる。
// 公開側は housekeeping（定期掃除）と sessionapi（削除連動掃除）から使う。
type NativeSweeper interface {
	// SweepNative は正本から到達できず古いネイティブ履歴を削除する（定期掃除用）。
	SweepNative(cutoff time.Time) (removedFiles int, removedDirs int)
	// SweepSessionNatives は削除された 1 セッションのネイティブを即時掃除する。
	SweepSessionNatives(geminiID, claudeID, antigravityID string)
}

// SidecarRemover はセッション削除時の sidecar 連動削除境界（sessionapi と同形）。
type SidecarRemover interface {
	Remove(sessionID string) error
}

// CoreDeps は core ファクトリへ渡す公開側依存の束（12番 3.2）。
//
// 公開側 service は具象型ではなく、必要メソッドだけの小さい境界
// （SchemaProvider 等）で渡す。関数値の注入点は将来のサイドカー/DLL 分離時に
// 呼び出し口を差し替えられる形を保つ。
type CoreDeps struct {
	// Cwd は WORKSPACE_ROOT（providers の作業ディレクトリ・ネイティブ履歴解決に使う）。
	Cwd string
	// Resolver は WORKSPACE_ROOT 配下の安全なパス解決。
	Resolver *paths.Resolver
	// Sessions は統一セッション正本の読み書き。
	Sessions *sessions.Service
	// Schemas / Replacements / Files / Calendar はプロンプト組み立ての読み取り境界。
	Schemas      SchemaProvider
	Replacements ReplacementProvider
	Files        ContentReader
	Calendar     HolidayLookup
	// PromptLocale は送信のたびに現在の uiLanguage でカタログを解決するクロージャ。
	PromptLocale func() PromptLocale
	// DefaultModel はプロバイダ種別ごとのデフォルトモデルID解決（未設定は空）。
	DefaultModel func(modelType sessions.ModelType) string
	// ResolveGeminiExe / ResolveClaudeExe / ResolveAntigravityExe は各 CLI の
	// 実行パス解決（設定優先→フォールバック探索。都度読み）。
	ResolveGeminiExe      func() (string, error)
	ResolveClaudeExe      func() (string, error)
	ResolveAntigravityExe func() (string, error)
	// ExtraAliases はユーザー定義 Gemini Thinking エイリアス（nil 可）。
	ExtraAliases func() map[string]ThinkingAlias
	// NewID はセッション/ジョブ ID の払い出し。
	NewID func() string
	// CLITimeout は外部 CLI 実行の上限時間。
	CLITimeout time.Duration
	// EntitlementToken は保存済み entitlement トークンの読み出し
	//（未保存は空文字。nil の場合はトークン無し扱い）。保存・取得の管理は
	// 公開側（storage/entitlement）、署名検証・tier 判定は core 側（featuresimpl）。
	EntitlementToken func() string
	// EntitlementClock は時刻巻き戻し検出用の記録（nil の場合は検出を行わない）。
	EntitlementClock EntitlementClock
	// ChatHook はチャット送受信の汎用加工フック（nil 可 = フックなし）。
	// 実装は公開側（internal/module の行動選択肢サイドカークライアント等）。
	ChatHook ChatHook
}

// ComfyProvider は ComfyUI 連携の in-process 供給境界（12番 Phase C）。
//
// サイドカーモジュール未配置時のフォールバック経路。実装（comfyui ドメイン・
// tagjudge・API ハンドラ群）は core に閉じ、公開側の routes.go はこの境界だけを見る。
type ComfyProvider interface {
	// RegisterRoutes は in-process モードの ComfyUI 全ルートを登録する
	// （generate-from-chat 含む。gate 適用込み）。
	RegisterRoutes(mux *http.ServeMux, queue *jobs.Queue, gate FeatureGate)
	// ImageRunner は in-process モードの ImageGen ジョブ実行本体。
	ImageRunner() jobs.Runner
	// TagJudgeKind はタグ判定に使う provider 種別（ジョブの同時実行制御用。
	// generate-from-chat がジョブ投入時に参照する）。
	TagJudgeKind() models.Kind
}

// Core は core 側ファクトリが公開側へ返す実装束（12番 3.2）。
type Core interface {
	// ChatRunner は chat / regenerate ジョブの実行本体。
	ChatRunner() jobs.Runner
	// EngineRouter は modelType で provider を振り分ける Engine（疎通確認にも使う）。
	EngineRouter() Engine
	// NativeSweeper はネイティブ履歴掃除の実装。
	NativeSweeper() NativeSweeper
	// SidecarRemover はセッション削除時の Antigravity sidecar 連動削除。
	SidecarRemover() SidecarRemover
	// Features は機能ゲートの実装。
	Features() FeatureGate
	// Comfy は ComfyUI 連携の in-process 供給（サイドカー未配置時のフォールバック）。
	Comfy() ComfyProvider
	// VerifyModuleSig はサイドカーモジュールの署名付きマニフェスト検証。
	// payload は Sig を除いた正規化 JSON、sigB64 は base64url 署名。
	// entitlement トークンと同じ埋め込み公開鍵系で検証する（鍵は core に閉じる）。
	VerifyModuleSig(payload []byte, sigB64 string) error
}
