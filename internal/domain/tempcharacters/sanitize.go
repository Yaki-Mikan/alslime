package tempcharacters

import (
	"strings"
	"unicode"

	"alslime/internal/storage/safename"
)

// forbiddenReplacer はフォルダ名・ファイル名に使えない文字を全角の同形文字へ置き換える。
// safename の禁止文字（パス区切りと Windows 禁止文字）と対にする。
var forbiddenReplacer = strings.NewReplacer(
	"/", "／",
	`\`, "＼",
	":", "：",
	"*", "＊",
	"?", "？",
	`"`, "”",
	"<", "＜",
	">", "＞",
	"|", "｜",
	"..", "．．",
)

const fallbackDirName = "character"

// SanitizeForDirName はキャラクター名を、キャラクターのフォルダ名・設定ファイル名として
// 使える形へ置き換える。置き換え後の名前は safename.Validate を通す。
//
// 規則：制御文字は除去、禁止文字は全角へ、先頭末尾の空白とドットは除去、
// Windows 予約名は末尾に "_"、長さ上限を超えた分は切り詰め、空なら "character"。
func SanitizeForDirName(name string) (string, error) {
	var b strings.Builder
	for _, r := range name {
		if r < 0x20 || r == 0x7f {
			continue
		}
		b.WriteRune(r)
	}
	out := forbiddenReplacer.Replace(b.String())
	out = trimEdges(out)
	if runes := []rune(out); len(runes) > safename.MaxLen {
		out = trimEdges(string(runes[:safename.MaxLen]))
	}
	if out == "" {
		out = fallbackDirName
	}
	if _, err := safename.Validate(out); err == safename.ErrReserved {
		out = out + "_"
	}
	validated, err := safename.Validate(out)
	if err != nil {
		return "", err
	}
	return validated, nil
}

// trimEdges は先頭末尾の空白（Unicode 空白を含む）とドットを取り除く。
func trimEdges(s string) string {
	return strings.TrimFunc(s, func(r rune) bool {
		return r == '.' || unicode.IsSpace(r)
	})
}
