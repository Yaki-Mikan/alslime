// Package semver は本体・モジュールのバージョン文字列比較を担う
// （ファイル自動更新、確認 01番 4.2）。
//
// 対象は "X.Y.Z" または "X.Y.Z-suffix" 形式（先頭の v は除去して扱う）。
// 依存を持たない小道具で、update（本体）と sponsor（モジュール）が共用する。
package semver

import (
	"strconv"
	"strings"
)

// Normalize は比較用の正規化形を返す（先頭の v / V と前後空白を除去）。
func Normalize(version string) string {
	v := strings.TrimSpace(version)
	if len(v) > 0 && (v[0] == 'v' || v[0] == 'V') {
		v = v[1:]
	}
	return v
}

// parsed は数値部とプレリリースサフィックスの分解結果。
type parsed struct {
	nums [3]int
	pre  string
}

// parse は正規化済み文字列を分解する。形式不一致は ok=false。
func parse(version string) (parsed, bool) {
	body := version
	pre := ""
	if i := strings.IndexByte(version, '-'); i >= 0 {
		body, pre = version[:i], version[i+1:]
	}
	parts := strings.Split(body, ".")
	if len(parts) != 3 {
		return parsed{}, false
	}
	var out parsed
	for i, part := range parts {
		n, err := strconv.Atoi(part)
		if err != nil || n < 0 {
			return parsed{}, false
		}
		out.nums[i] = n
	}
	out.pre = pre
	return out, true
}

// Compare は a と b を比較する（-1: a<b / 0: 同値 / 1: a>b）。
// どちらかがパース不能なら ok=false（呼び出し側は「更新なし」へ倒す。
// 誤通知より無通知を優先する）。
// プレリリース（-suffix 付き）は同数値の正式版より古い扱い。
func Compare(a, b string) (result int, ok bool) {
	pa, okA := parse(Normalize(a))
	pb, okB := parse(Normalize(b))
	if !okA || !okB {
		return 0, false
	}
	for i := 0; i < 3; i++ {
		if pa.nums[i] != pb.nums[i] {
			if pa.nums[i] < pb.nums[i] {
				return -1, true
			}
			return 1, true
		}
	}
	if (pa.pre == "") != (pb.pre == "") {
		if pa.pre != "" {
			return -1, true
		}
		return 1, true
	}
	if pa.pre != pb.pre {
		if pa.pre < pb.pre {
			return -1, true
		}
		return 1, true
	}
	return 0, true
}

// IsNewer は candidate が current より新しいかを返す。
// パース不能な組み合わせは false（更新なし扱い）。
func IsNewer(candidate, current string) bool {
	result, ok := Compare(candidate, current)
	return ok && result > 0
}
