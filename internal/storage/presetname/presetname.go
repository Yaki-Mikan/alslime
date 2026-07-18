// Package presetname はプリセット名を保存ファイル名（<name>.json）として
// 安全に扱うための変換を提供する。
//
// 名前そのものの検証（日本語可・危険文字/予約名/末尾/長さ拒否）は汎用の
// safename パッケージへ委譲し、本パッケージは ".json" 拡張子の付与・除去と、
// 既存呼び出し互換のためのエラー再公開・検証委譲だけを担う薄いラッパ。
//
// 共通化の経緯: Config Editor など他機能も同じ名前検証を使うため、検証本体を
// safename へ切り出した（交換日記 32）。preset 固有なのは ".json" を付ける点のみ。
package presetname

import (
	"strings"

	"alslime/internal/storage/safename"
)

// 検証エラーは safename のものを再公開する（既存の errors.Is 参照互換のため）。
var (
	ErrEmpty       = safename.ErrEmpty
	ErrTooLong     = safename.ErrTooLong
	ErrInvalidChar = safename.ErrInvalidChar
	ErrReserved    = safename.ErrReserved
	ErrTrailing    = safename.ErrTrailing
)

// ext は保存ファイルの拡張子。利用者入力には含めさせず、内部で付与する。
const ext = ".json"

// Validate は名前を検証し、trim 済みの正規化名を返す（safename へ委譲）。
func Validate(name string) (string, error) {
	return safename.Validate(name)
}

// FileName は検証済み名を保存ファイル名（<name>.json）へ変換する。
func FileName(name string) (string, error) {
	n, err := safename.Validate(name)
	if err != nil {
		return "", err
	}
	return n + ext, nil
}

// DisplayName はファイル名（<name>.json）から拡張子を除いた表示名を返す。
func DisplayName(fileName string) string {
	return strings.TrimSuffix(fileName, ext)
}

// IsJSON は fileName が .json ファイルかを返す。一覧の絞り込みに使う。
func IsJSON(fileName string) bool {
	return strings.HasSuffix(fileName, ext)
}

// EqualFold は2つの名前が大文字小文字を無視して等しいかを返す（safename へ委譲）。
func EqualFold(a, b string) bool {
	return safename.EqualFold(a, b)
}

// ConflictsWith は newName が existing と大文字小文字無視で衝突するかを返す（safename へ委譲）。
func ConflictsWith(newName string, existing []string) (string, bool) {
	return safename.ConflictsWith(newName, existing)
}
