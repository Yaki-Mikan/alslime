package tempcharacters

import (
	"strings"
	"testing"
)

func TestSanitizeForDirName(t *testing.T) {
	cases := map[string]string{
		"雪":             "雪",
		"A/B:C":         "A／B：C",
		"  name.  ":     "name",
		"con":           "con_",
		"a..b":          "a．．b",
		"\x01x\x7f":     "x",
		"":              "character",
		"   ":           "character",
		`q"uo<te>|pi*?`: "q”uo＜te＞｜pi＊？",
	}
	for in, want := range cases {
		got, err := SanitizeForDirName(in)
		if err != nil {
			t.Fatalf("%q: unexpected error %v", in, err)
		}
		if got != want {
			t.Fatalf("%q: got %q want %q", in, got, want)
		}
	}
	long := strings.Repeat("あ", 100)
	got, err := SanitizeForDirName(long)
	if err != nil || len([]rune(got)) != 64 {
		t.Fatalf("long name: got %q (%v)", got, err)
	}
}

func TestIsTempCharacterPath(t *testing.T) {
	if !IsTempCharacterPath("roleplay/temp_characters/tmp_abc/settings/雪.md") {
		t.Fatal("expected temp path")
	}
	if IsTempCharacterPath("roleplay/characters/雪/settings/雪.md") {
		t.Fatal("expected registered path")
	}
	if IsTempCharacterPath("") {
		t.Fatal("empty is not temp")
	}
}

func TestVirtualPathAndID(t *testing.T) {
	id := NewID()
	if !strings.HasPrefix(id, IDPrefix) || len(id) != len(IDPrefix)+12 {
		t.Fatalf("unexpected id %q", id)
	}
	vp := VirtualPath(id, "燈")
	if vp != "roleplay/temp_characters/"+id+"/settings/燈.md" {
		t.Fatalf("unexpected virtual path %q", vp)
	}
	if !IsTempCharacterPath(vp) {
		t.Fatal("virtual path must be temp")
	}
}

func sampleSSRP(vp string) map[string]any {
	return map[string]any{
		"characters": []any{"roleplay/characters/雪/settings/雪.md", vp},
		"characterDetails": map[string]any{
			vp: map[string]any{"isOpen": true},
		},
		"voiceDesignByCharacter": map[string]any{
			vp: map[string]any{"mode": "append", "text": "低い声"},
		},
		SSRPKey: map[string]any{
			vp: map[string]any{
				"id": "tmp_000000000001", "name": "燈", "content": "本文",
				"createdAt": "2026-09-13T00:00:00Z", "sourceSessionId": "s1",
			},
		},
	}
}

func TestRewriteForRegistered(t *testing.T) {
	vp := VirtualPath("tmp_000000000001", "燈")
	reg := "roleplay/characters/燈/settings/燈.md"
	ssrp := sampleSSRP(vp)
	if !RewriteForRegistered(ssrp, vp, reg) {
		t.Fatal("expected change")
	}
	chars := ssrp["characters"].([]any)
	if len(chars) != 2 || chars[1] != reg {
		t.Fatalf("characters not rewritten: %v", chars)
	}
	details := ssrp["characterDetails"].(map[string]any)
	if _, ok := details[reg]; !ok {
		t.Fatal("characterDetails key not moved")
	}
	if _, ok := details[vp]; ok {
		t.Fatal("characterDetails old key remains")
	}
	voice := ssrp["voiceDesignByCharacter"].(map[string]any)
	if _, ok := voice[reg]; !ok {
		t.Fatal("voiceDesignByCharacter key not moved")
	}
	tc, ok := Get(ssrp, vp)
	if !ok || tc.RegisteredPath != reg {
		t.Fatalf("registeredPath not recorded: %+v", tc)
	}
	if RewriteForRegistered(ssrp, vp, reg) {
		t.Fatal("second call must be no-op")
	}
}

func TestRewriteForRegistered_DedupeWhenRegisteredAlreadyPresent(t *testing.T) {
	vp := VirtualPath("tmp_000000000001", "燈")
	reg := "roleplay/characters/燈/settings/燈.md"
	ssrp := sampleSSRP(vp)
	ssrp["characters"] = []any{reg, vp}
	RewriteForRegistered(ssrp, vp, reg)
	chars := ssrp["characters"].([]any)
	if len(chars) != 1 || chars[0] != reg {
		t.Fatalf("expected dedupe, got %v", chars)
	}
}

func TestReconcile(t *testing.T) {
	vp := VirtualPath("tmp_000000000001", "燈")
	reg := "roleplay/characters/燈/settings/燈.md"
	ssrp := sampleSSRP(vp)
	if Reconcile(ssrp, map[string]string{"tmp_other": reg}) {
		t.Fatal("unrelated id must not change")
	}
	if !Reconcile(ssrp, map[string]string{"tmp_000000000001": reg}) {
		t.Fatal("expected change")
	}
	if Reconcile(ssrp, map[string]string{"tmp_000000000001": reg}) {
		t.Fatal("already registered must not change")
	}
}

func TestFindByNameAndDelete(t *testing.T) {
	vp := VirtualPath("tmp_000000000001", "燈")
	ssrp := sampleSSRP(vp)
	key, tc, ok := FindByName(ssrp, " 燈 ")
	if !ok || key != vp || tc.Name != "燈" {
		t.Fatalf("FindByName failed: %v %v %+v", ok, key, tc)
	}
	if _, _, ok := FindByName(ssrp, "雪"); ok {
		t.Fatal("unexpected match")
	}
	if !Delete(ssrp, vp) {
		t.Fatal("expected delete")
	}
	if _, ok := Get(ssrp, vp); ok {
		t.Fatal("still present after delete")
	}
	if len(ContentMap(ssrp)) != 0 {
		t.Fatal("content map must be empty")
	}
}
