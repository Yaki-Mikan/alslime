package entitlement

import (
	"testing"
)

func TestClock_未記録は0(t *testing.T) {
	c := NewClock(t.TempDir())
	if got := c.LastSeen(); got != 0 {
		t.Fatalf("未記録は 0 のはず: got=%d", got)
	}
}

func TestClock_Advanceは単調で永続化される(t *testing.T) {
	root := t.TempDir()
	c := NewClock(root)
	c.Advance(1000)
	if got := c.LastSeen(); got != 1000 {
		t.Fatalf("前進が反映されるはず: got=%d", got)
	}
	// 過去方向へは動かない。
	c.Advance(500)
	if got := c.LastSeen(); got != 1000 {
		t.Fatalf("過去方向へ動いてはいけない: got=%d", got)
	}
	// 初回 Advance（written=0 からの差分が閾値超）は即書き込みされ、別インスタンスでも読める。
	if got := NewClock(root).LastSeen(); got != 1000 {
		t.Fatalf("永続化された値が読めるはず: got=%d", got)
	}
}

func TestClock_書き込みはスロットリングされる(t *testing.T) {
	root := t.TempDir()
	c := NewClock(root)
	c.Advance(1000)
	// 閾値未満の前進はメモリのみ（ファイルは 1000 のまま）。
	c.Advance(1000 + clockWriteIntervalSeconds - 1)
	if got := NewClock(root).LastSeen(); got != 1000 {
		t.Fatalf("閾値未満の前進はファイルへ書かれないはず: got=%d", got)
	}
	// 閾値以上でファイルも追随する。
	c.Advance(1000 + clockWriteIntervalSeconds)
	if got := NewClock(root).LastSeen(); got != 1000+clockWriteIntervalSeconds {
		t.Fatalf("閾値以上の前進は書き込まれるはず: got=%d", got)
	}
}

func TestClock_Resetは過去方向へも強制上書き(t *testing.T) {
	root := t.TempDir()
	c := NewClock(root)
	c.Advance(9999)
	c.Reset(1234)
	if got := c.LastSeen(); got != 1234 {
		t.Fatalf("Reset は過去方向も許すはず: got=%d", got)
	}
	if got := NewClock(root).LastSeen(); got != 1234 {
		t.Fatalf("Reset は即永続化されるはず: got=%d", got)
	}
}
