package charname

import "testing"

func TestNormalizeMatchName(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"前後の半角空白", "  Alice  ", "alice"},
		{"前後の全角空白", "　Alice　", "alice"},
		{"全角英数", "ＡＬＩＣＥ１２", "alice12"},
		{"半角カナ", "ｱｶﾘ", "アカリ"},
		{"拡張子", "Alice.md", "alice"},
		{"最後の拡張子だけ外れる", "Alice.v2.md", "alice.v2"},
		{"全角ドットの拡張子はNFKC後に外れる", "Alice．ｍｄ", "alice"},
		{"区切り記号", "A_l-i c　e・ー", "alice"},
		{"大文字", "ALICE", "alice"},
		{"大文字小文字混在", "aLiCe", "alice"},
		{"空文字", "", ""},
		{"半角空白のみ", "   ", ""},
		{"全角空白のみ", "　　", ""},
		{"日本語名", "燈", "燈"},
		{"日本語名と前後空白", " 燈 ", "燈"},
		{"日本語名と拡張子", "陽森いろは.md", "陽森いろは"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := NormalizeMatchName(tc.in); got != tc.want {
				t.Fatalf("NormalizeMatchName(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}
