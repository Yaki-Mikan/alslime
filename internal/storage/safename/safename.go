// Package safename は利用者が付ける名前（プリセット名・設定ファイル名・テンプレート名等）を
// ファイル名・パス断片として安全に扱うための検証を共通化する。
//
// 背景:
// 現行 Node 版は名前を ${name}.json / ${name}.md などへ直結合し、`../` や
// Windows 禁止文字を弾いていなかった（パストラバーサルの穴）。配布版では
// プリセット・Config Editor など複数機能が同じ規則で名前を扱うため、ここへ集約する。
//
// 方針（交換日記 08 / 32 の合意）:
//   - 日本語名は許可する（利用者が画面で見る名前）。
//   - ファイル名として直接信用せず、危険文字・予約名・末尾・長さを必ず確認する。
//   - resolver の実体境界確認（EvalSymlinks）は最終防衛線として別途残る（多段防御）。
//
// 本パッケージは拡張子を扱わない（.json / .md などの付与は呼び出し側の責務）。
// presetname は本パッケージを使い、.json 付与の薄いラッパを提供する。
package safename

import (
	"errors"
	"strings"
	"unicode"
	"unicode/utf8"
)

const errKeyInvalidName = "error.invalidName"

// 検証エラー。呼び出し側（service / handler）は 400 へマッピングする。
var (
	// ErrEmpty は trim 後に空文字になった場合。
	ErrEmpty = errors.New(errKeyInvalidName)
	// ErrTooLong は長さ上限を超えた場合。
	ErrTooLong = errors.New(errKeyInvalidName)
	// ErrInvalidChar は禁止文字（パス区切り・Windows 禁止文字・制御文字）を含む場合。
	ErrInvalidChar = errors.New(errKeyInvalidName)
	// ErrReserved は予約名（"."・".." や Windows 予約名）に該当する場合。
	ErrReserved = errors.New(errKeyInvalidName)
	// ErrTrailing は末尾がドットまたは空白の場合（Windows で問題になる）。
	ErrTrailing = errors.New(errKeyInvalidName)
)

// MaxLen は名前の長さ上限（rune 数）。交換日記 08 の合意で 64。
const MaxLen = 64

// forbiddenChars は名前に含めてはならない文字集合。
//   - "/" "\" : パス区切り（ディレクトリ脱出・サブディレクトリ作成の防止）。
//   - ":" "*" "?" "\"" "<" ">" "|" : Windows のファイル名禁止文字。
//
// 制御文字（U+0000〜U+001F, U+007F）は範囲で別途弾く。
const forbiddenChars = `/\:*?"<>|`

// asciiSpace は Normalize で trim する空白集合（ASCII 空白のみ）。
// strings.TrimSpace は全角空白(U+3000)等の Unicode 空白も削るが、それだと
// 末尾全角空白が黙って消えて別名と衝突し得る。ここでは ASCII 空白だけを
// 寛容に trim し、全角等の空白は「末尾にあれば拒否」（ErrTrailing）へ回す。
const asciiSpace = " \t\n\v\f\r"

// windowsReserved は Windows の予約デバイス名。大文字小文字を無視して判定する。
// 拡張子付き（例: "CON.json"）でも OS によっては予約名扱いになるため、
// 拡張子を除いた基底名で判定する。
var windowsReserved = map[string]struct{}{
	"CON": {}, "PRN": {}, "AUX": {}, "NUL": {},
	"COM1": {}, "COM2": {}, "COM3": {}, "COM4": {}, "COM5": {},
	"COM6": {}, "COM7": {}, "COM8": {}, "COM9": {},
	"LPT1": {}, "LPT2": {}, "LPT3": {}, "LPT4": {}, "LPT5": {},
	"LPT6": {}, "LPT7": {}, "LPT8": {}, "LPT9": {},
}

// Normalize は入力名の前後の ASCII 空白を trim して返す。
//
// Unicode 正規化（NFC 等）は初期実装では行わない（交換日記 08 の合意）。
func Normalize(name string) string {
	return strings.Trim(name, asciiSpace)
}

// Validate は生の入力名を検証し、trim 済みの正規化名を返す。
//
// 空・長さ・禁止文字・予約名（"." ".." ".." 含み・Windows 予約名）・末尾ドット/空白を確認する。
// 拡張子は扱わない（呼び出し側で付与する）。
func Validate(name string) (string, error) {
	n := Normalize(name)
	if n == "" {
		return "", ErrEmpty
	}
	if len([]rune(n)) > MaxLen {
		return "", ErrTooLong
	}
	// "." と ".." そのもの、および ".." を含む名前を拒否する。
	if n == "." || n == ".." || strings.Contains(n, "..") {
		return "", ErrReserved
	}
	if err := checkChars(n); err != nil {
		return "", err
	}
	// 末尾のドット・空白は Windows で暗黙に削られ、別名と衝突し得るため拒否する。
	if r := lastRune(n); r == '.' || unicode.IsSpace(r) {
		return "", ErrTrailing
	}
	if isReservedBase(n) {
		return "", ErrReserved
	}
	return n, nil
}

// lastRune は文字列末尾の rune を返す。空文字なら utf8.RuneError。
func lastRune(s string) rune {
	r, _ := utf8.DecodeLastRuneInString(s)
	return r
}

// checkChars は禁止文字・制御文字が含まれていないかを確認する。
func checkChars(n string) error {
	for _, r := range n {
		if r < 0x20 || r == 0x7f {
			return ErrInvalidChar
		}
		if strings.ContainsRune(forbiddenChars, r) {
			return ErrInvalidChar
		}
	}
	return nil
}

// isReservedBase は名前が Windows 予約名に該当するかを判定する。
// 拡張子があってもなくても基底名（最初のドットより前）で照合する。
func isReservedBase(n string) bool {
	base := n
	if i := strings.IndexByte(base, '.'); i >= 0 {
		base = base[:i]
	}
	_, ok := windowsReserved[strings.ToUpper(base)]
	return ok
}

// EqualFold は2つの名前が大文字小文字を無視して等しいかを返す。
//
// Windows は大文字小文字を区別しないため、"Test" と "test" は同じファイルを指す。
// 配布版は両 OS で動くため、保存時は case-insensitive で既存名との衝突を検出する。
func EqualFold(a, b string) bool {
	return strings.EqualFold(a, b)
}

// ConflictsWith は newName が existing のいずれかと大文字小文字無視で衝突するかを返す。
//
// 衝突した既存名を返す（無ければ空文字, false）。完全一致は上書き更新とみなし衝突にしない。
func ConflictsWith(newName string, existing []string) (string, bool) {
	for _, e := range existing {
		if e == newName {
			continue
		}
		if EqualFold(newName, e) {
			return e, true
		}
	}
	return "", false
}
