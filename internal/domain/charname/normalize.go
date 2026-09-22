// Package charname はキャラクター名の照合用正規化を提供する。
//
// TURN の話者名・キャラクターディレクトリ名・設定ファイル名の表記揺れ
// （全角半角・区切り記号・大文字小文字）を吸収し、同一人物かどうかを
// 比較するための共通規則。画像生成の話者解決と、セッションからの一時
// キャラクター取り込みの登録済み判定が同じ規則を使う。
// フロントの frontend/src/lib/characterName.ts と同じ規則を維持すること。
package charname

import (
	"path"
	"strings"

	"golang.org/x/text/unicode/norm"
)

// NormalizeMatchName は照合用に名前を正規化する。
// NFKC 正規化 → 拡張子除去 → 区切り記号（_ - 半角空白 全角空白 ・ ー）除去 → 小文字化。
func NormalizeMatchName(value string) string {
	value = norm.NFKC.String(strings.TrimSpace(value))
	value = strings.TrimSuffix(value, path.Ext(value))
	replacer := strings.NewReplacer("_", "", "-", "", " ", "", "　", "", "・", "", "ー", "")
	return strings.ToLower(replacer.Replace(value))
}
