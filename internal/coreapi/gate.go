package coreapi

// FeatureGate は機能ゲートの判定境界。
//
// 実装（tier 序列・判定源）は core 側（featuresimpl）に閉じ、公開側の handler は
// この境界だけを見る。判定源は署名付き entitlement トークン（Phase D・12番 3.3）。
type FeatureGate interface {
	// Enabled は feature ID（features パッケージの定数値）が有効かを返す。
	Enabled(feature string) bool
	// PublicSnapshot はフロントへ返してよい利用者向け feature 有効状態を返す。
	// tier 名そのものではなく、機能IDごとの真偽だけを返す。
	PublicSnapshot() map[string]bool
	// Entitlement は支援状態のスナップショット（health / 設定画面表示用）を返す。
	Entitlement() EntitlementStatus
}
