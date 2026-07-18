// Package diagnostics は配布版の自己診断で使う共通型を提供する。
//
// 診断結果は機械的な状態（status）と messageKey を主に返し、
// 表示文言はフロントの i18n 辞書で解決する（交換日記 18 / 22）。
// backend は日本語本文を大量に返さない。
//
// 本パッケージは型と組み立て補助のみを持ち、HTTP や具体的なチェック実装
// （workspace 書き込み可否・CLI 状態など）は上位（api/system, system/checks 等）が担う。
package diagnostics

// CheckStatus は 1 チェックの状態。フロント表示・集約に使う統一語彙。
type CheckStatus string

const (
	// CheckOK は正常。
	CheckOK CheckStatus = "ok"
	// CheckWarning は起動は継続できるが利用者に知らせたい状態（CLI 未認証など）。
	CheckWarning CheckStatus = "warning"
	// CheckError は機能に支障がある状態。
	CheckError CheckStatus = "error"
	// CheckDisabled は tier やビルドで無効化されている状態。
	CheckDisabled CheckStatus = "disabled"
	// CheckUnknown は判定不能。
	CheckUnknown CheckStatus = "unknown"
)

// CheckResult は 1 件の診断結果。
//
// MessageKey はフロント i18n 辞書のキー。Details は機械情報（コマンド名・パス断片など）
// で、認証トークンや内部リクエスト等の秘匿情報を入れてはならない（交換日記 18 注意）。
type CheckResult struct {
	ID         string         `json:"id"`
	Status     CheckStatus    `json:"status"`
	MessageKey string         `json:"messageKey,omitempty"`
	Details    map[string]any `json:"details,omitempty"`
}

// Aggregate は複数チェックの最も重い状態へ集約する。
//
// 重さの順: error > warning > unknown > ok。disabled は集約に影響させない
// （無効化は「異常」ではないため）。チェックが空なら ok。
func Aggregate(results []CheckResult) CheckStatus {
	worst := CheckOK
	for _, r := range results {
		if severity(r.Status) > severity(worst) {
			worst = r.Status
		}
	}
	return worst
}

// severity は集約用の重み。大きいほど重い。
func severity(s CheckStatus) int {
	switch s {
	case CheckError:
		return 3
	case CheckWarning:
		return 2
	case CheckUnknown:
		return 1
	case CheckOK, CheckDisabled:
		return 0
	default:
		return 0
	}
}
