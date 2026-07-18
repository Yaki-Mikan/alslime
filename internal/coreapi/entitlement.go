package coreapi

// TokenState は entitlement トークンの検証状態（12番 3.3・14番 4章）。
//
// 判定源（署名検証・grace 判定）は core 側（featuresimpl）に閉じ、公開側は
// この状態値だけを見る。health / 設定画面のフロント表示にそのまま使う。
type TokenState string

const (
	// TokenStateNone はトークン未保存（未認証＝free 動作）。
	TokenStateNone TokenState = "none"
	// TokenStateValid は署名検証 OK かつ exp 内。
	TokenStateValid TokenState = "valid"
	// TokenStateGrace は exp 切れだが grace 内（オフライン猶予中。機能は有効のまま、
	// バックグラウンド再取得を促す状態）。
	TokenStateGrace TokenState = "grace"
	// TokenStateExpired は grace も過ぎた失効（free 動作へ戻る）。
	TokenStateExpired TokenState = "expired"
	// TokenStateInvalid は形式不正・署名不一致・未知 kid（free 動作）。
	TokenStateInvalid TokenState = "invalid"
)

// EntitlementStatus は支援状態のスナップショット。
//
// tier 名は valid / grace のときだけ入る（失効・不正トークンの中身は信用しない）。
// ExpiresAt / GraceUntil は unix 秒。フロントは表示のみに使い、最終判定は
// backend gate（FeatureGate.Enabled）が担う。
type EntitlementStatus struct {
	State      TokenState `json:"state"`
	Tier       string     `json:"tier,omitempty"`
	Channel    string     `json:"channel,omitempty"`
	ExpiresAt  int64      `json:"expiresAt,omitempty"`
	GraceUntil int64      `json:"graceUntil,omitempty"`
}

// EntitlementClock は時刻巻き戻し検出用の最終検証時刻の記録境界（17番の緩和策）。
//
// 保存の管理は公開側（storage/entitlement）、巻き戻り判定は core 側（featuresimpl）。
// 実装は単調（Advance で過去方向へ動かない）であること。
type EntitlementClock interface {
	// LastSeen は記録済みの最終検証時刻（unix 秒。未記録は 0）を返す。
	LastSeen() int64
	// Advance は現在時刻で記録を前進させる（過去方向へは動かない）。
	Advance(now int64)
}
