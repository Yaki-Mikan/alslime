package coreapi

import "testing"

func intPtr(v int) *int { return &v }

func TestImageGenDedupeKey_TURN指定でキーが分かれる(t *testing.T) {
	base := ImageGenDedupeKey("s1", "m1", "", nil)
	byID := ImageGenDedupeKey("s1", "m1", "t_aaaa1111", nil)
	byIndex := ImageGenDedupeKey("s1", "m1", "", intPtr(2))

	if base == byID || base == byIndex || byID == byIndex {
		t.Fatalf("TURN指定なし・ID指定・index指定でキーが分かれるべき: %q %q %q", base, byID, byIndex)
	}
	if got := ImageGenDedupeKey("s1", "m1", "t_aaaa1111", nil); got != byID {
		t.Fatalf("同一TURN IDは同一キー（二重押しは409）になるべき: %q vs %q", got, byID)
	}
	if got := ImageGenDedupeKey("s1", "m1", "t_bbbb2222", nil); got == byID {
		t.Fatal("別TURN IDは別キー（並行投入可）になるべき")
	}
}

func TestImageGenDedupeKey_ID優先(t *testing.T) {
	// ID と index の両方が来た場合は ID を採用する（012 の照合規則と同じ優先度）。
	withBoth := ImageGenDedupeKey("s1", "m1", "t_aaaa1111", intPtr(0))
	byIDOnly := ImageGenDedupeKey("s1", "m1", "t_aaaa1111", nil)
	if withBoth != byIDOnly {
		t.Fatalf("ID指定時は index に依存しないキーになるべき: %q vs %q", withBoth, byIDOnly)
	}
}

func TestImageGenDedupeKey_TURN指定なしは従来キー(t *testing.T) {
	if got := ImageGenDedupeKey("s1", "m1", "", nil); got != "s1\x00m1" {
		t.Fatalf("従来リクエストのキーは互換維持するべき: %q", got)
	}
}

func TestImageGenDedupeKey_index0と未指定を区別する(t *testing.T) {
	if ImageGenDedupeKey("s1", "m1", "", intPtr(0)) == ImageGenDedupeKey("s1", "m1", "", nil) {
		t.Fatal("index=0 と未指定は別キーになるべき")
	}
}
