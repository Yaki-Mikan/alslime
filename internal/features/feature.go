// Package features は機能ゲート対象の Feature 定数（公開側の入口）。
//
// 目的（交換日記 22 の決定）:
// tier 判定を各 handler へ散らさず、handler は coreapi.FeatureGate.Enabled(...)
// だけを見る。tier 名や判定源の解釈は core 側（featuresimpl）に閉じる
// （12番 3.3 の入口/実装分離。旧 gate.go / tier.go の実装は featuresimpl へ移設）。
package features

// Feature は機能ゲートの対象を表す識別子。
//
// handler / service は tier 名や buildMode を直接見ず、Feature 経由で
// coreapi.FeatureGate に問う。ComfyUI は配布 tier gate として実働し、
// 高度連携は将来拡張用として同じ入口に寄せる。
type Feature string

const (
	// FeatureDebugInternalTools は dev 内部診断ツール（内部状態 dump・routing 一覧等）。
	// dev tier かつ dev ビルドでのみ有効。release では handler 自体を登録しない方針と併用する。
	FeatureDebugInternalTools Feature = "debug.internalTools"

	// FeatureComfyUI は ComfyUI 連携機能（supporter 候補）。
	FeatureComfyUI Feature = "comfyui"
	// FeatureAdvancedIntegration は高度連携機能（plus 候補）。
	FeatureAdvancedIntegration Feature = "advancedIntegration"
	// FeatureActionChoice は行動選択肢機能（supporter。選択肢サイドカー連携）。
	FeatureActionChoice Feature = "actionChoice"
)
