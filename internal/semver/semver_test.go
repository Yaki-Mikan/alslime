package semver

import "testing"

func TestCompare_境界と形式(t *testing.T) {
	cases := []struct {
		name   string
		a, b   string
		want   int
		wantOK bool
	}{
		{name: "等値", a: "0.1.4", b: "0.1.4", want: 0, wantOK: true},
		{name: "patch差", a: "0.1.5", b: "0.1.4", want: 1, wantOK: true},
		{name: "minor差はpatchより優先", a: "0.2.0", b: "0.1.9", want: 1, wantOK: true},
		{name: "major差", a: "1.0.0", b: "0.9.9", want: 1, wantOK: true},
		{name: "vプレフィックス", a: "v0.1.5", b: "0.1.4", want: 1, wantOK: true},
		{name: "プレリリースは正式版より古い", a: "0.1.5-dev", b: "0.1.5", want: -1, wantOK: true},
		{name: "プレリリース同士は文字列比較", a: "0.1.5-beta", b: "0.1.5-alpha", want: 1, wantOK: true},
		{name: "パース不能", a: "0.1", b: "0.1.4", wantOK: false},
		{name: "非数値", a: "0.1.x", b: "0.1.4", wantOK: false},
		{name: "空文字", a: "", b: "0.1.4", wantOK: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := Compare(tc.a, tc.b)
			if ok != tc.wantOK || (ok && got != tc.want) {
				t.Fatalf("Compare(%q, %q) = %d, %v / want %d, %v", tc.a, tc.b, got, ok, tc.want, tc.wantOK)
			}
		})
	}
}

func TestIsNewer_パース不能は更新なし扱い(t *testing.T) {
	if !IsNewer("0.1.5", "0.1.4") {
		t.Fatal("0.1.5 は 0.1.4 より新しいはず")
	}
	if IsNewer("0.1.4", "0.1.4") {
		t.Fatal("同値は更新なし")
	}
	if IsNewer("broken", "0.1.4") {
		t.Fatal("パース不能は更新なし扱い")
	}
	if !IsNewer("0.1.5", "0.0.0-dev") {
		t.Fatal("dev 版（0.0.0-dev）もパース対象で、0.1.5 が新しい判定になるはず")
	}
}
