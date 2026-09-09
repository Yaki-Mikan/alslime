package process

import (
	"testing"

	"alslime/internal/domain/models"
)

func TestDefaultLimits(t *testing.T) {
	l := DefaultLimits()
	if l.Global != 1 || l.Gemini != 1 || l.Claude != 1 || l.Antigravity != 1 {
		t.Fatalf("既定は全て1のはず: %#v", l)
	}
}

func TestUpdateLimits_クランプ(t *testing.T) {
	m := NewManager()
	// global=2 に対し各種別は global 以下へクランプ、0以下は1へ。
	got := m.UpdateLimits(Limits{Global: 2, Gemini: 5, Claude: 0, Antigravity: 2})
	if got.Global != 2 {
		t.Fatalf("global=2 のはず: %#v", got)
	}
	if got.Gemini != 2 { // 5 → global(2) へクランプ
		t.Fatalf("gemini は global へクランプされるはず: %#v", got)
	}
	if got.Claude != 1 { // 0 → 1
		t.Fatalf("claude は最低1のはず: %#v", got)
	}
	if got.Antigravity != 2 {
		t.Fatalf("antigravity=2 のはず: %#v", got)
	}

	// global=0 は1へ。
	got = m.UpdateLimits(Limits{Global: 0, Gemini: 1, Claude: 1, Antigravity: 1})
	if got.Global != 1 {
		t.Fatalf("global は最低1のはず: %#v", got)
	}
}

func TestTryAcquireRelease_global上限(t *testing.T) {
	m := NewManager() // global=1
	if !m.TryAcquire(models.KindGemini) {
		t.Fatalf("1つ目は確保できるはず")
	}
	// global=1 なので別種別でも確保できない。
	if m.TryAcquire(models.KindClaude) {
		t.Fatalf("global 上限により確保できないはず")
	}
	if m.GlobalAvailable() {
		t.Fatalf("global 満杯のはず")
	}
	m.Release(models.KindGemini)
	if !m.GlobalAvailable() {
		t.Fatalf("release 後は空きがあるはず")
	}
	if !m.TryAcquire(models.KindClaude) {
		t.Fatalf("release 後は確保できるはず")
	}
}

func TestTryAcquire_種別上限で同種だけ止まる(t *testing.T) {
	m := NewManager()
	// global=3, gemini=1, claude=2。
	m.UpdateLimits(Limits{Global: 3, Gemini: 1, Claude: 2, Antigravity: 3})

	if !m.TryAcquire(models.KindGemini) {
		t.Fatalf("gemini 1つ目 OK")
	}
	// gemini=1 上限 → 2つ目の gemini は不可。
	if m.TryAcquire(models.KindGemini) {
		t.Fatalf("gemini は上限1のため2つ目は不可")
	}
	// 別種別 claude は global に空きがあるので確保できる（追い越し相当）。
	if !m.TryAcquire(models.KindClaude) {
		t.Fatalf("claude は確保できるはず")
	}
	if !m.TryAcquire(models.KindClaude) {
		t.Fatalf("claude 2つ目も確保できるはず")
	}
	// ここで global=3 使用（gemini1 + claude2）→ 満杯。
	if m.GlobalAvailable() {
		t.Fatalf("global 満杯のはず")
	}
}

func TestInUse(t *testing.T) {
	m := NewManager()
	m.UpdateLimits(Limits{Global: 2, Gemini: 2, Claude: 2, Antigravity: 2})
	m.TryAcquire(models.KindGemini)
	m.TryAcquire(models.KindClaude)
	u := m.InUse()
	if u.Global != 2 || u.Gemini != 1 || u.Claude != 1 {
		t.Fatalf("InUse 想定外: %#v", u)
	}
}

func TestRelease_0未満にしない(t *testing.T) {
	m := NewManager()
	m.Release(models.KindGemini) // 確保せず release しても 0 のまま。
	u := m.InUse()
	if u.Global != 0 || u.Gemini != 0 {
		t.Fatalf("負にならないはず: %#v", u)
	}
}

func TestTryAcquire_ComfyUIはglobal枠を消費しない(t *testing.T) {
	m := NewManager() // global=1, comfyui=1
	if !m.TryAcquire(models.KindGemini) {
		t.Fatalf("gemini 1つ目は確保できるはず")
	}
	// global 満杯でも ComfyUI 枠は独立して確保できる。
	if !m.TryAcquire(models.KindComfyUI) {
		t.Fatalf("comfyui は global 枠外なので確保できるはず")
	}
	// comfyui=1 上限 → 2つ目は不可。
	if m.TryAcquire(models.KindComfyUI) {
		t.Fatalf("comfyui は上限1のため2つ目は不可")
	}
	u := m.InUse()
	if u.Global != 1 || u.ComfyUI != 1 {
		t.Fatalf("InUse 想定外: %#v", u)
	}
	// Release しても global は減らない。
	m.Release(models.KindComfyUI)
	u = m.InUse()
	if u.Global != 1 || u.ComfyUI != 0 {
		t.Fatalf("release 後の InUse 想定外: %#v", u)
	}
}

func TestUpdateLimits_ComfyUIは1から4でクランプ(t *testing.T) {
	m := NewManager()
	got := m.UpdateLimits(Limits{Global: 1, ComfyUI: 0})
	if got.ComfyUI != 1 {
		t.Fatalf("0 は 1 へ丸めるはず: %#v", got)
	}
	got = m.UpdateLimits(Limits{Global: 1, ComfyUI: 10})
	if got.ComfyUI != comfyUIMaxLimit {
		t.Fatalf("上限超過は %d へ丸めるはず: %#v", comfyUIMaxLimit, got)
	}
	// global に連動しない（global=1 でも comfyui=3 を保てる）。
	got = m.UpdateLimits(Limits{Global: 1, ComfyUI: 3})
	if got.ComfyUI != 3 {
		t.Fatalf("comfyui は global に連動しないはず: %#v", got)
	}
}
