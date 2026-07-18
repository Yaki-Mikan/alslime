// Package schemaid は Parameters 項目設定の schemaId を検証・ファイル名化する。
//
// schemaId はプリセット名（presetname）と性質が異なる:
//   - 利用者が画面で見る「表示名」ではなく、ファイル名・論理 ID に近い。
//   - 現行 Node 版も `^[a-zA-Z0-9_-]+$` の機械的 ID として扱い、日本語を許さない。
//
// そのため presetname（日本語可・危険文字ブラックリスト）とは別の、
// ホワイトリスト方式の検証をここに分離する（交換日記 17 の合意）。
//
// ファイル名生成にも使うため storage 配下に置く。
package schemaid

import (
	"errors"
	"regexp"
	"strings"
)

const errKeySchemaIDInvalid = "error.schemaIdInvalid"

// 検証エラー。呼び出し側（service / handler）は 400 へマッピングする。
var (
	// ErrEmpty は trim 後に空文字になった場合。
	ErrEmpty = errors.New(errKeySchemaIDInvalid)
	// ErrTooLong は長さ上限を超えた場合。
	ErrTooLong = errors.New(errKeySchemaIDInvalid)
	// ErrInvalidChar は許可文字（英数・ハイフン・アンダースコア）以外を含む場合。
	ErrInvalidChar = errors.New(errKeySchemaIDInvalid)
)

// MaxLen は schemaId の長さ上限。
// 現行に明確な値が無いため、ファイル名 ID として十分な 64 を初期値とする（交換日記 17）。
const MaxLen = 64

// DefaultID はデフォルト項目設定の schemaId。固定ファイル名・削除不可の判定に使う。
const DefaultID = "default"

// pattern は schemaId に許可する文字（ホワイトリスト）。現行 Node 版と揃える。
var pattern = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

// Validate は schemaId を検証し、trim 済みの正規化値を返す。
//
// 前後空白を trim → 空・長さ・許可文字を確認する。日本語・空白・記号は拒否される。
func Validate(id string) (string, error) {
	n := strings.TrimSpace(id)
	if n == "" {
		return "", ErrEmpty
	}
	if len(n) > MaxLen {
		return "", ErrTooLong
	}
	if !pattern.MatchString(n) {
		return "", ErrInvalidChar
	}
	return n, nil
}

// IsDefault は id がデフォルト項目設定（削除不可・固定ファイル名）かを返す。
// 呼び出し側は Validate 済みの値を渡すこと。
func IsDefault(id string) bool {
	return id == DefaultID
}

// SchemaFileName は custom 項目設定のファイル名（parameter-schema-<id>.json）を返す。
//
// 内部で Validate を通すため、未検証の id を渡しても安全。
// default は固定ファイル名（config 側の定数）を使うため、本関数の対象は custom。
func SchemaFileName(id string) (string, error) {
	n, err := Validate(id)
	if err != nil {
		return "", err
	}
	return "parameter-schema-" + n + ".json", nil
}

// PresetFileName は schemaId に対応するパラメータプリセットファイル名
// （parameter-presets-<id>.json）を返す。
func PresetFileName(id string) (string, error) {
	n, err := Validate(id)
	if err != nil {
		return "", err
	}
	return "parameter-presets-" + n + ".json", nil
}
