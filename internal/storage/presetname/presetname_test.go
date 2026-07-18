package presetname

import (
	"strings"
	"testing"

	"alslime/internal/storage/safename"
)

func TestValidate_許可される名前(t *testing.T) {
	cases := []string{
		"日本語プリセット", // 日本語名（交換日記 08 の合意で許可）
		"my-preset",
		"my_preset_01",
		"preset name", // 通常スペースは許可
		"夜の設定 v2",     // 日本語＋スペース＋英数の混在
		"a",           // 1 文字
		"ＡＢＣ",         // 全角英数（危険文字でないため許可）
		"😀絵文字",        // 絵文字（制御・危険文字でないため初期は許容）
		"con_fig",     // 予約名 "CON" を含むが基底名は "con_fig" なので許可
		"comic",       // "COM" 始まりだが予約名 COM1〜9 ではない
	}
	for _, name := range cases {
		t.Run(name, func(t *testing.T) {
			got, err := Validate(name)
			if err != nil {
				t.Fatalf("Validate(%q) は許可されるべき: err=%v", name, err)
			}
			if got != name {
				t.Fatalf("Validate(%q)=%q 期待は trim 後同値", name, got)
			}
		})
	}
}

func TestValidate_前後空白はtrim(t *testing.T) {
	got, err := Validate("  夜更かしプリセット  ")
	if err != nil {
		t.Fatalf("trim 後に有効な名前は許可されるべき: %v", err)
	}
	if got != "夜更かしプリセット" {
		t.Fatalf("前後空白が trim されていない: %q", got)
	}
}

func TestValidate_空文字は拒否(t *testing.T) {
	for _, name := range []string{"", "   ", "\t\n"} {
		if _, err := Validate(name); err != ErrEmpty {
			t.Fatalf("Validate(%q) は ErrEmpty を返すべき: err=%v", name, err)
		}
	}
}

func TestValidate_パス区切りとWindows禁止文字は拒否(t *testing.T) {
	// 燈さんのテスト要望: / \ : * ? " < > | を拒否する。
	bad := []string{
		"a/b", "a\\b",
		"a:b", "a*b", "a?b", `a"b`, "a<b", "a>b", "a|b",
		"../etc", "..\\windows",
	}
	for _, name := range bad {
		t.Run(name, func(t *testing.T) {
			if _, err := Validate(name); err == nil {
				t.Fatalf("Validate(%q) は拒否されるべき", name)
			}
		})
	}
}

func TestValidate_ドット系は拒否(t *testing.T) {
	// 燈さんのテスト要望: . .. foo..bar を拒否する。
	bad := []string{".", "..", "foo..bar", "a..", "..a"}
	for _, name := range bad {
		t.Run(name, func(t *testing.T) {
			if _, err := Validate(name); err != ErrReserved {
				t.Fatalf("Validate(%q) は ErrReserved を返すべき: err=%v", name, err)
			}
		})
	}
}

func TestValidate_末尾ドット末尾空白は拒否(t *testing.T) {
	// 燈さんのテスト要望: 末尾ドット・末尾空白を拒否する。
	// 半角末尾空白は trim されるため、ここでは全角空白とドットで検証する。
	bad := []string{"preset.", "preset　"} // 2 つめは全角スペース
	for _, name := range bad {
		t.Run(name, func(t *testing.T) {
			if _, err := Validate(name); err != ErrTrailing {
				t.Fatalf("Validate(%q) は ErrTrailing を返すべき: err=%v", name, err)
			}
		})
	}
}

func TestValidate_Windows予約名は拒否(t *testing.T) {
	// 燈さんのテスト要望: Windows 予約名を拒否する。
	bad := []string{
		"CON", "con", "Con",
		"PRN", "AUX", "NUL",
		"COM1", "com9", "LPT1", "lpt9",
		"CON.json", // 拡張子付きでも基底名で予約名判定
	}
	for _, name := range bad {
		t.Run(name, func(t *testing.T) {
			if _, err := Validate(name); err != ErrReserved {
				t.Fatalf("Validate(%q) は ErrReserved を返すべき: err=%v", name, err)
			}
		})
	}
}

func TestValidate_制御文字は拒否(t *testing.T) {
	bad := []string{"a\x00b", "a\x1fb", "a\x7fb", "tab\there"}
	for _, name := range bad {
		t.Run(strings.ReplaceAll(name, "\x00", "NUL"), func(t *testing.T) {
			if _, err := Validate(name); err != ErrInvalidChar {
				t.Fatalf("制御文字を含む %q は ErrInvalidChar を返すべき: err=%v", name, err)
			}
		})
	}
}

func TestValidate_長さ上限(t *testing.T) {
	// 上限ちょうど（rune 数）は許可、超過は拒否。日本語で数えても rune 単位。
	// 検証本体は safename へ委譲済みのため、上限値も safename.MaxLen を参照する。
	ok := strings.Repeat("あ", safename.MaxLen)
	if _, err := Validate(ok); err != nil {
		t.Fatalf("上限ちょうど(%d文字)は許可すべき: %v", safename.MaxLen, err)
	}
	tooLong := strings.Repeat("あ", safename.MaxLen+1)
	if _, err := Validate(tooLong); err != ErrTooLong {
		t.Fatalf("上限超過(%d文字)は ErrTooLong を返すべき: err=%v", safename.MaxLen+1, err)
	}
}

func TestFileName(t *testing.T) {
	got, err := FileName("夜の設定")
	if err != nil {
		t.Fatalf("有効名の FileName でエラー: %v", err)
	}
	if got != "夜の設定.json" {
		t.Fatalf("FileName=%q 期待は 夜の設定.json", got)
	}

	if _, err := FileName("../etc"); err == nil {
		t.Fatalf("不正名の FileName はエラーを返すべき")
	}
}

func TestDisplayName(t *testing.T) {
	if got := DisplayName("夜の設定.json"); got != "夜の設定" {
		t.Fatalf("DisplayName=%q 期待は 夜の設定", got)
	}
	// 拡張子なしはそのまま。
	if got := DisplayName("noext"); got != "noext" {
		t.Fatalf("DisplayName=%q 期待は noext", got)
	}
}

func TestConflictsWith_大文字小文字違いを検出(t *testing.T) {
	// 燈さんのテスト要望: 大文字小文字違いの重複を検出する。
	existing := []string{"Test", "別設定", "Sample"}

	// fold 一致するが完全一致でない → 衝突。
	if c, ok := ConflictsWith("test", existing); !ok || c != "Test" {
		t.Fatalf("test は Test と衝突すべき: c=%q ok=%v", c, ok)
	}

	// 完全一致は上書き更新であり衝突ではない。
	if _, ok := ConflictsWith("Test", existing); ok {
		t.Fatalf("完全一致 Test は衝突ではない（上書き更新）")
	}

	// どれとも一致しない。
	if _, ok := ConflictsWith("新規", existing); ok {
		t.Fatalf("新規 はどの既存名とも衝突しないべき")
	}
}
