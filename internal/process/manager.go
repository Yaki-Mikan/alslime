// Package process は AI プロセスの同時実行数を 2 軸（全体 + 種別）で制御する。
//
// 現行 Node 版 ai-process-manager.ts の移植。全体の同時実行上限と、種別
// （gemini / claude / antigravity）ごとの上限の 2 軸でスロットを管理する。
// すべての AI 要求（チャット・再生成等）はこのマネージャでスロットを確保してから起動する。
//
// 種別の正本は domain/models.Kind。本パッケージは models.Kind を受け取る側に徹し、
// modelId からの種別判定（KindOf）は呼び出し側（API / service）が行う。
package process

import (
	"sync"

	"alslime/internal/domain/models"
)

// Limits は同時実行数の上限。global と各種別。
// TTS は AI CLI を使わない外部サーバー送信のため global 枠から独立した専用枠
// （global の消費なしで TTS 上限のみで制御）。
type Limits struct {
	Global       int `json:"global"`
	Gemini       int `json:"gemini"`
	Claude       int `json:"claude"`
	Antigravity  int `json:"antigravity"`
	OpenAICompat int `json:"openai_compat"`
	TTS          int `json:"tts"`
}

// InUse は現在の使用中スロット数。
type InUse struct {
	Global       int `json:"global"`
	Gemini       int `json:"gemini"`
	Claude       int `json:"claude"`
	Antigravity  int `json:"antigravity"`
	OpenAICompat int `json:"openai_compat"`
	TTS          int `json:"tts"`
}

// DefaultLimits は既定の上限（現行 Node 版と同じく全て 1）。
func DefaultLimits() Limits {
	return Limits{Global: 1, Gemini: 1, Claude: 1, Antigravity: 1, OpenAICompat: 1, TTS: 1}
}

// Manager は 2 軸セマフォ。sync.Mutex でカウンタを保護する。
type Manager struct {
	mu          sync.Mutex
	limits      Limits
	globalInUse int
	kindInUse   map[models.Kind]int
}

// NewManager は既定上限の Manager を生成する。
func NewManager() *Manager {
	return &Manager{
		limits: DefaultLimits(),
		kindInUse: map[models.Kind]int{
			models.KindGemini:       0,
			models.KindClaude:       0,
			models.KindAntigravity:  0,
			models.KindOpenAICompat: 0,
			models.KindTTS:          0,
		},
	}
}

// TryAcquire は kind のスロットを確保する。
//
// global 空き > 0 かつ 種別空き > 0 の場合のみ確保して true を返す。
// 確保したら呼び出し側は必ず Release(kind) すること（defer 推奨）。
func (m *Manager) TryAcquire(kind models.Kind) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	// TTS は AI CLI を使わないため global 枠を消費しない（TTS 上限のみで制御）。
	usesGlobal := kind != models.KindTTS
	if usesGlobal && m.globalInUse >= m.limits.Global {
		return false
	}
	if m.kindInUse[kind] >= m.limitOf(kind) {
		return false
	}
	if usesGlobal {
		m.globalInUse++
	}
	m.kindInUse[kind]++
	return true
}

// Release は kind のスロットを解放する。0 未満にはしない。
func (m *Manager) Release(kind models.Kind) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if kind != models.KindTTS && m.globalInUse > 0 {
		m.globalInUse--
	}
	if m.kindInUse[kind] > 0 {
		m.kindInUse[kind]--
	}
}

// Limits は現在の上限の複製を返す。
func (m *Manager) Limits() Limits {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.limits
}

// InUse は現在の使用中スロット数を返す。
func (m *Manager) InUse() InUse {
	m.mu.Lock()
	defer m.mu.Unlock()
	return InUse{
		Global:       m.globalInUse,
		Gemini:       m.kindInUse[models.KindGemini],
		Claude:       m.kindInUse[models.KindClaude],
		Antigravity:  m.kindInUse[models.KindAntigravity],
		OpenAICompat: m.kindInUse[models.KindOpenAICompat],
		TTS:          m.kindInUse[models.KindTTS],
	}
}

// GlobalAvailable は global スロットに空きがあるかを返す
// （TTS は global 枠外のため本判定の対象外）。
func (m *Manager) GlobalAvailable() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.globalInUse < m.limits.Global
}

// UpdateLimits は上限を更新し、適用後の上限を返す。
//
// クランプ: global は最低 1。各種別は 1 以上かつ global 以下。
// 現在実行中のスロットには影響しない（次回 TryAcquire から反映）。
func (m *Manager) UpdateLimits(next Limits) Limits {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.limits = clampLimits(next)
	return m.limits
}

// limitOf は kind の上限を返す。
func (m *Manager) limitOf(kind models.Kind) int {
	switch kind {
	case models.KindClaude:
		return m.limits.Claude
	case models.KindAntigravity:
		return m.limits.Antigravity
	case models.KindOpenAICompat:
		return m.limits.OpenAICompat
	case models.KindTTS:
		return m.limits.TTS
	default:
		return m.limits.Gemini
	}
}

// clampLimits は上限値をクランプする（global 最低 1・各種別 1〜global。
// TTS は global 枠外のため最低 1 のみでクランプする）。
func clampLimits(l Limits) Limits {
	global := l.Global
	if global < 1 {
		global = 1
	}
	clamp := func(v int) int {
		if v < 1 {
			v = 1
		}
		if v > global {
			v = global
		}
		return v
	}
	tts := l.TTS
	if tts < 1 {
		tts = 1
	}
	return Limits{
		Global:       global,
		Gemini:       clamp(l.Gemini),
		Claude:       clamp(l.Claude),
		Antigravity:  clamp(l.Antigravity),
		OpenAICompat: clamp(l.OpenAICompat),
		TTS:          tts,
	}
}
