package safename

import (
	"strings"
	"testing"
)

func TestValidate_許可(t *testing.T) {
	for _, name := range []string{
		"日本語名", "my-name", "my_name_01", "name with space",
		"夜の設定 v2", "a", "ＡＢＣ", "😀絵文字", "con_fig", "comic",
	} {
		got, err := Validate(name)
		if err != nil {
			t.Fatalf("Validate(%q) は許可すべき: %v", name, err)
		}
		if got != name {
			t.Fatalf("Validate(%q)=%q（trim 後同値のはず）", name, got)
		}
	}
}

func TestValidate_trim(t *testing.T) {
	got, err := Validate("  名前  ")
	if err != nil || got != "名前" {
		t.Fatalf("前後空白 trim 失敗: got=%q err=%v", got, err)
	}
}

func TestValidate_空(t *testing.T) {
	for _, n := range []string{"", "   ", "\t\n"} {
		if _, err := Validate(n); err != ErrEmpty {
			t.Fatalf("Validate(%q) は ErrEmpty: %v", n, err)
		}
	}
}

func TestValidate_禁止文字(t *testing.T) {
	for _, n := range []string{"a/b", "a\\b", "a:b", "a*b", "a?b", `a"b`, "a<b", "a>b", "a|b"} {
		if _, err := Validate(n); err != ErrInvalidChar {
			t.Fatalf("Validate(%q) は ErrInvalidChar: %v", n, err)
		}
	}
}

func TestValidate_制御文字(t *testing.T) {
	for _, n := range []string{"a\x00b", "a\x1fb", "a\x7fb", "tab\there"} {
		if _, err := Validate(n); err != ErrInvalidChar {
			t.Fatalf("制御文字 %q は ErrInvalidChar: %v", n, err)
		}
	}
}

func TestValidate_ドット系(t *testing.T) {
	for _, n := range []string{".", "..", "foo..bar", "a..", "..a"} {
		if _, err := Validate(n); err != ErrReserved {
			t.Fatalf("Validate(%q) は ErrReserved: %v", n, err)
		}
	}
}

func TestValidate_末尾ドット末尾空白(t *testing.T) {
	for _, n := range []string{"name.", "name　"} { // 2 つめは全角空白
		if _, err := Validate(n); err != ErrTrailing {
			t.Fatalf("Validate(%q) は ErrTrailing: %v", n, err)
		}
	}
}

func TestValidate_Windows予約名(t *testing.T) {
	for _, n := range []string{"CON", "con", "Con", "PRN", "AUX", "NUL", "COM1", "lpt9", "CON.json"} {
		if _, err := Validate(n); err != ErrReserved {
			t.Fatalf("Validate(%q) は ErrReserved: %v", n, err)
		}
	}
}

func TestValidate_長さ上限(t *testing.T) {
	ok := strings.Repeat("あ", MaxLen)
	if _, err := Validate(ok); err != nil {
		t.Fatalf("上限ちょうど(%d)は許可すべき: %v", MaxLen, err)
	}
	if _, err := Validate(strings.Repeat("あ", MaxLen+1)); err != ErrTooLong {
		t.Fatalf("上限超過は ErrTooLong")
	}
}

func TestConflictsWith(t *testing.T) {
	existing := []string{"Test", "別設定"}
	if c, ok := ConflictsWith("test", existing); !ok || c != "Test" {
		t.Fatalf("test は Test と衝突すべき: c=%q ok=%v", c, ok)
	}
	if _, ok := ConflictsWith("Test", existing); ok {
		t.Fatalf("完全一致は衝突ではない")
	}
	if _, ok := ConflictsWith("新規", existing); ok {
		t.Fatalf("新規は衝突しない")
	}
}
