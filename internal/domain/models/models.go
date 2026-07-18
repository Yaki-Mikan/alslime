// Package models はモデル一覧の正本と、モデル種別判定を集中管理する。
//
// 規約案の「モデル分岐は散らさない。中央に model resolver を置く」に従い、
// AVAILABLE_MODELS 相当の一覧と種別判定をここへ集約する。
// 各ハンドラが strings.HasPrefix(model, "claude-") のような判定を散らさないこと。
package models

import "sync"

// Kind はモデルの種別。CLI 連携の分岐に使う。
type Kind string

const (
	// KindGemini は Gemini CLI 経路。
	KindGemini Kind = "gemini"
	// KindClaude は Claude 経路。
	KindClaude Kind = "claude"
	// KindAntigravity は Antigravity 経路。
	KindAntigravity Kind = "antigravity"
)

// ParseKind は provider 指定文字列を Kind へ解決する。
// 空文字・未知の値は ok=false（＝ID からの自動判定に委ねる）。
func ParseKind(s string) (Kind, bool) {
	switch Kind(s) {
	case KindGemini, KindClaude, KindAntigravity:
		return Kind(s), true
	default:
		return "", false
	}
}

// Model は利用者へ提示するモデル定義。
// 現行 Node 版の AVAILABLE_MODELS と同じ形（id / name / description）を保つ。
// Provider は経路種別（マージ時に確定値を埋める。レスポンス互換のため追加のみ）。
type Model struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Provider    Kind   `json:"provider,omitempty"`
}

// available は内蔵デフォルトのモデル一覧。現行 Node 版 AVAILABLE_MODELS と同一順序・同一内容。
//
// 正本は「内蔵デフォルト＋ユーザー設定（user-models.json）のマージ」（Merge）。
// ここはマージの土台となる内蔵分のみを持つ（配布公開準備その2 09番）。
//
// 注意: モデル ID は現行フロントとの互換のため変更しない。
// 追加・更新時は現行版との差分を意識すること。
var available = []Model{
	{ID: "", Name: "Default model config", Description: "Default"},
	{ID: "gemini-2.5-flash", Name: "Fast all-round help", Description: "2.5 Flash"},
	{ID: "gemini-2.5-pro", Name: "Best at reasoning and thinking", Description: "2.5 Pro"},
	{ID: "gemini-3-flash-preview", Name: "The latest flash preview model", Description: "3 Flash Preview"},
	{ID: "gemini-3-pro-preview", Name: "The latest pro preview model", Description: "3 Pro Preview"},
	{ID: "gemini-3.1-pro-preview", Name: "The latest 3.1 pro preview model", Description: "3.1 Pro Preview"},
	{ID: "gemini-3.5-flash", Name: "Fast and efficient 3.5 model", Description: "3.5 Flash"},
	{ID: "flash-thinking-high", Name: "3.5 Flash (Thinking: High)", Description: "3.5 Flash Think High"},
	{ID: "flash-thinking-medium", Name: "3.5 Flash (Thinking: Medium)", Description: "3.5 Flash Think Medium"},
	{ID: "flash-thinking-low", Name: "3.5 Flash (Thinking: Low)", Description: "3.5 Flash Think Low"},
	{ID: "claude-sonnet-4-5", Name: "Claude Sonnet 4.5", Description: "Claude Sonnet 4.5"},
	{ID: "claude-sonnet-4-6", Name: "Claude Sonnet 4.6", Description: "Claude Sonnet 4.6"},
	{ID: "claude-haiku-4-5", Name: "Claude Haiku 4.5", Description: "Claude Haiku 4.5"},
	{ID: "claude-opus-4-6", Name: "Claude Opus 4.6", Description: "Claude Opus 4.6"},
	{ID: "antigravity", Name: "Antigravity CLI default", Description: "Antigravity CLI"},
	{ID: "antigravity:Gemini 3.5 Flash (Medium)", Name: "Antigravity Gemini 3.5 Flash (Medium)", Description: "Antigravity 3.5 Flash Medium"},
	{ID: "antigravity:Gemini 3.5 Flash (High)", Name: "Antigravity Gemini 3.5 Flash (High)", Description: "Antigravity 3.5 Flash High"},
	{ID: "antigravity:Gemini 3.5 Flash (Low)", Name: "Antigravity Gemini 3.5 Flash (Low)", Description: "Antigravity 3.5 Flash Low"},
	{ID: "antigravity:Gemini 3.1 Pro (High)", Name: "Antigravity Gemini 3.1 Pro (High)", Description: "Antigravity 3.1 Pro High"},
	{ID: "antigravity:Gemini 3.1 Pro (Low)", Name: "Antigravity Gemini 3.1 Pro (Low)", Description: "Antigravity 3.1 Pro Low"},
}

const antigravityPrefix = "antigravity"

// BuiltIn は内蔵デフォルトのモデル一覧の複製を返す。内蔵分を呼び出し側で書き換えさせない。
// Provider は ID からの自動判定で埋める（内蔵分に明示指定はない）。
func BuiltIn() []Model {
	out := make([]Model, len(available))
	copy(out, available)
	for i := range out {
		out[i].Provider = KindOf(out[i].ID)
	}
	return out
}

// UserModel はユーザー追加モデル定義（user-models.json の added 行）。
//
// GeminiBase / ThinkingLevel は Gemini 系 Thinking エイリアス用の任意ペア。
// 指定時は ID がエイリアス名となり、providers/gemini が
// .gemini/settings.json の customAliases へ焼き込む（09番 5章）。
// Provider は経路種別の明示指定（"gemini" / "claude" / "antigravity"）。
// 空なら ID プレフィックスからの自動判定（KindOf の既定規則）に従う。
type UserModel struct {
	ID            string `json:"id"`
	Name          string `json:"name,omitempty"`
	Description   string `json:"description,omitempty"`
	Provider      string `json:"provider,omitempty"`
	GeminiBase    string `json:"geminiBase,omitempty"`
	ThinkingLevel string `json:"thinkingLevel,omitempty"`
}

// Kind は経路種別を返す。明示指定があればそれを優先し、なければ ID から自動判定する。
func (u UserModel) Kind() Kind {
	if kind, ok := ParseKind(u.Provider); ok {
		return kind
	}
	return defaultKindOf(u.ID)
}

// Model は UserModel を利用者提示用の Model へ変換する。
// Name / Description が空なら ID を表示に流用する。
func (u UserModel) Model() Model {
	name := u.Name
	if name == "" {
		name = u.ID
	}
	description := u.Description
	if description == "" {
		description = u.ID
	}
	return Model{ID: u.ID, Name: name, Description: description, Provider: u.Kind()}
}

// Merge は「内蔵デフォルト − hidden ＋ added」のマージ結果（モデル一覧の正本）を返す。
//
//   - hidden に含まれる内蔵 ID を除外する。ID 空の既定エントリは除外対象外。
//   - added を内蔵の後ろへ連結する。内蔵と同一 ID の added 行は保存時検証で
//     拒否される前提だが、ファイル直編集への防御として内蔵優先で除外する。
func Merge(added []UserModel, hidden []string) []Model {
	hiddenSet := make(map[string]bool, len(hidden))
	for _, id := range hidden {
		if id != "" {
			hiddenSet[id] = true
		}
	}
	builtinIDs := make(map[string]bool, len(available))
	out := make([]Model, 0, len(available)+len(added))
	for _, m := range available {
		builtinIDs[m.ID] = true
		if hiddenSet[m.ID] {
			continue
		}
		m.Provider = KindOf(m.ID)
		out = append(out, m)
	}
	for _, u := range added {
		if u.ID == "" || builtinIDs[u.ID] {
			continue
		}
		out = append(out, u.Model())
	}
	return out
}

// BuiltInIDs は内蔵デフォルトの ID 集合を返す。追加・非表示の検証に使う。
func BuiltInIDs() map[string]bool {
	out := make(map[string]bool, len(available))
	for _, m := range available {
		out[m.ID] = true
	}
	return out
}

// userKinds はユーザー追加モデルの明示 provider 指定（ID → Kind）。
// usermodels service が保存・起動時に SetUserKinds で同期する。
// KindOf の呼び出しは全域（チャット投入・実行・疎通確認等）に及ぶため、
// ここで一元的に反映することで経路判定の分岐を散らさない。
var (
	userKindsMu sync.RWMutex
	userKinds   map[string]Kind
)

// SetUserKinds はユーザー追加モデルの明示 provider 指定を全置換で登録する。
func SetUserKinds(kinds map[string]Kind) {
	copied := make(map[string]Kind, len(kinds))
	for id, kind := range kinds {
		if id == "" {
			continue
		}
		if _, ok := ParseKind(string(kind)); !ok {
			continue
		}
		copied[id] = kind
	}
	userKindsMu.Lock()
	userKinds = copied
	userKindsMu.Unlock()
}

// KindOf はモデル ID から種別を判定する。
//
// ユーザー追加モデルに明示 provider 指定があればそれを優先し、
// なければ既定規則（現行 Node 版の分岐に合わせる）で判定する:
//   - "antigravity" または "antigravity:..." → KindAntigravity
//   - "claude-..." → KindClaude
//   - それ以外（"", "gemini-...", "flash-thinking-..." 等）→ KindGemini
func KindOf(id string) Kind {
	userKindsMu.RLock()
	kind, ok := userKinds[id]
	userKindsMu.RUnlock()
	if ok {
		return kind
	}
	return defaultKindOf(id)
}

// defaultKindOf は ID プレフィックスによる既定の種別判定。
func defaultKindOf(id string) Kind {
	switch {
	case id == antigravityPrefix || hasPrefix(id, antigravityPrefix+":"):
		return KindAntigravity
	case hasPrefix(id, "claude-"):
		return KindClaude
	default:
		return KindGemini
	}
}

// hasPrefix は strings.HasPrefix の薄いラッパ。
// 種別判定をこのパッケージ内に閉じる意図を明示するために用意する。
func hasPrefix(s, prefix string) bool {
	return len(s) >= len(prefix) && s[:len(prefix)] == prefix
}
