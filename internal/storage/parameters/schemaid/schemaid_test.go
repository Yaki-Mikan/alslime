package schemaid

import (
	"strings"
	"testing"
)

func TestValidate_許可される(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"default", "default"},
		{"my-schema", "my-schema"},
		{"my_schema_01", "my_schema_01"},
		{"ABC123", "ABC123"},
		{"  trimmed  ", "trimmed"}, // 前後空白は trim
		{"a", "a"},
	}
	for _, c := range cases {
		got, err := Validate(c.in)
		if err != nil {
			t.Fatalf("Validate(%q) は許可されるべき: err=%v", c.in, err)
		}
		if got != c.want {
			t.Fatalf("Validate(%q)=%q want=%q", c.in, got, c.want)
		}
	}
}

func TestValidate_空は拒否(t *testing.T) {
	for _, in := range []string{"", "   ", "\t"} {
		if _, err := Validate(in); err != ErrEmpty {
			t.Fatalf("Validate(%q) は ErrEmpty: err=%v", in, err)
		}
	}
}

func TestValidate_許可外文字は拒否(t *testing.T) {
	// 日本語・空白・記号・パス区切りは不可（ホワイトリスト方式）。
	bad := []string{"日本語", "a b", "a/b", "a\\b", "a.b", "a:b", "../etc", "a@b", "あ"}
	for _, in := range bad {
		if _, err := Validate(in); err != ErrInvalidChar {
			t.Fatalf("Validate(%q) は ErrInvalidChar: err=%v", in, err)
		}
	}
}

func TestValidate_長さ上限(t *testing.T) {
	ok := strings.Repeat("a", MaxLen)
	if _, err := Validate(ok); err != nil {
		t.Fatalf("上限ちょうど(%d)は許可すべき: %v", MaxLen, err)
	}
	tooLong := strings.Repeat("a", MaxLen+1)
	if _, err := Validate(tooLong); err != ErrTooLong {
		t.Fatalf("上限超過(%d)は ErrTooLong: err=%v", MaxLen+1, err)
	}
}

func TestIsDefault(t *testing.T) {
	if !IsDefault("default") {
		t.Fatalf("default は IsDefault=true であるべき")
	}
	if IsDefault("custom") {
		t.Fatalf("custom は IsDefault=false であるべき")
	}
}

func TestSchemaFileName(t *testing.T) {
	got, err := SchemaFileName("my-schema")
	if err != nil {
		t.Fatalf("予期しないエラー: %v", err)
	}
	if got != "parameter-schema-my-schema.json" {
		t.Fatalf("got=%q", got)
	}
	if _, err := SchemaFileName("../etc"); err == nil {
		t.Fatalf("不正 id はエラーを返すべき")
	}
}

func TestPresetFileName(t *testing.T) {
	got, err := PresetFileName("default")
	if err != nil {
		t.Fatalf("予期しないエラー: %v", err)
	}
	if got != "parameter-presets-default.json" {
		t.Fatalf("got=%q", got)
	}
}
