package models

import "testing"

func TestKindOf(t *testing.T) {
	cases := map[string]Kind{
		"":                                    KindGemini,
		"gemini-2.5-flash":                    KindGemini,
		"flash-thinking-high":                 KindGemini,
		"claude-sonnet-4-5":                   KindClaude,
		"antigravity":                         KindAntigravity,
		"antigravity:Gemini 3.5 Flash (High)": KindAntigravity,
	}
	for id, want := range cases {
		if got := KindOf(id); got != want {
			t.Errorf("KindOf(%q) = %q, want %q", id, got, want)
		}
	}
}

func TestKindOfUserOverride(t *testing.T) {
	SetUserKinds(map[string]Kind{
		"opus-latest":     KindClaude,
		"my-agent":        KindAntigravity,
		"":                KindClaude,       // ID 空は登録されない
		"broken-provider": Kind("invalid"), // 未知の Kind は登録されない
	})
	defer SetUserKinds(nil)

	cases := map[string]Kind{
		"opus-latest":       KindClaude,      // 指定優先（既定判定では Gemini になる ID）
		"my-agent":          KindAntigravity, // 指定優先
		"broken-provider":   KindGemini,      // 不正値は既定判定
		"claude-sonnet-4-5": KindClaude,      // 未登録 ID は既定判定のまま
		"":                  KindGemini,
	}
	for id, want := range cases {
		if got := KindOf(id); got != want {
			t.Errorf("KindOf(%q) = %q, want %q", id, got, want)
		}
	}
}

func TestUserModelKind(t *testing.T) {
	cases := []struct {
		model UserModel
		want  Kind
	}{
		{UserModel{ID: "opus-latest", Provider: "claude"}, KindClaude},
		{UserModel{ID: "claude-x", Provider: "gemini"}, KindGemini},
		{UserModel{ID: "opus-latest"}, KindGemini},
		{UserModel{ID: "opus-latest", Provider: "unknown"}, KindGemini},
	}
	for _, c := range cases {
		if got := c.model.Kind(); got != c.want {
			t.Errorf("UserModel{ID:%q, Provider:%q}.Kind() = %q, want %q", c.model.ID, c.model.Provider, got, c.want)
		}
	}
}

func TestMergeAddsUserModels(t *testing.T) {
	added := []UserModel{
		{ID: "gemini-4.0-pro", Name: "Gemini 4.0 Pro", Description: "4.0 Pro"},
		{ID: "my-alias"},
	}
	merged := Merge(added, nil)

	if len(merged) != len(available)+2 {
		t.Fatalf("merged length = %d, want %d", len(merged), len(available)+2)
	}
	last := merged[len(merged)-1]
	if last.ID != "my-alias" || last.Name != "my-alias" || last.Description != "my-alias" {
		t.Errorf("Name/Description 未指定時は ID を流用するはず: %+v", last)
	}
	if last.Provider != KindGemini {
		t.Errorf("provider 未指定の added は既定判定（Gemini）のはず: %q", last.Provider)
	}
}

func TestMergeCarriesExplicitProvider(t *testing.T) {
	merged := Merge([]UserModel{{ID: "opus-latest", Provider: "claude"}}, nil)
	last := merged[len(merged)-1]
	if last.ID != "opus-latest" || last.Provider != KindClaude {
		t.Errorf("明示 provider がマージ結果へ載るはず: %+v", last)
	}
	for _, m := range merged[:len(merged)-1] {
		if m.Provider != KindOf(m.ID) {
			t.Errorf("内蔵分の provider は自動判定で埋まるはず: %+v", m)
		}
	}
}

func TestMergeHidesBuiltIn(t *testing.T) {
	merged := Merge(nil, []string{"gemini-2.5-flash", "", "unknown-id"})
	if len(merged) != len(available)-1 {
		t.Fatalf("merged length = %d, want %d", len(merged), len(available)-1)
	}
	for _, m := range merged {
		if m.ID == "gemini-2.5-flash" {
			t.Error("hidden 指定した内蔵モデルが残っている")
		}
	}
	// ID 空の既定エントリは hidden の空文字で消えないこと。
	if merged[0].ID != "" {
		t.Error("ID 空の既定エントリが除外されている")
	}
}

func TestMergeSkipsDuplicateOfBuiltIn(t *testing.T) {
	merged := Merge([]UserModel{{ID: "gemini-2.5-flash", Name: "重複"}}, nil)
	if len(merged) != len(available) {
		t.Fatalf("内蔵と重複する added は除外されるはず: length = %d, want %d", len(merged), len(available))
	}
}

func TestBuiltInReturnsCopy(t *testing.T) {
	got := BuiltIn()
	got[0].ID = "mutated"
	if available[0].ID == "mutated" {
		t.Error("BuiltIn() の返り値変更が正本へ波及している")
	}
}
