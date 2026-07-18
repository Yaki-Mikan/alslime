// Package usermodels は ユーザー編集のモデル一覧設定の service 層。
//
// 保存時の検証・正規化と、内蔵デフォルトとのマージ結果（モデル一覧の正本）の
// 提供を担う（配布公開準備その2 09番）。永続化は storage/usermodels へ委譲する。
package usermodels

import (
	"errors"
	"strings"

	"alslime/internal/domain/models"
	"alslime/internal/i18n"
	usermodelsstore "alslime/internal/storage/usermodels"
)

// 検証エラー。handler 層で i18n キー付きの BadRequest へ変換する。
var (
	// ErrModelIDRequired は追加行の ID が空。
	ErrModelIDRequired = errors.New(i18n.KeyErrorModelIDRequired)
	// ErrModelIDDuplicate は追加行同士の ID 重複。
	ErrModelIDDuplicate = errors.New(i18n.KeyErrorModelIDDuplicate)
	// ErrModelIDConflictsBuiltIn は内蔵デフォルトと同一 ID の追加。
	ErrModelIDConflictsBuiltIn = errors.New(i18n.KeyErrorModelIDConflictsBuiltIn)
	// ErrInvalidProvider は gemini / claude / antigravity / 空 以外の provider 指定。
	ErrInvalidProvider = errors.New(i18n.KeyErrorInvalidModelProvider)
	// ErrInvalidThinkingLevel は high / medium / low 以外の Thinking Level。
	ErrInvalidThinkingLevel = errors.New(i18n.KeyErrorInvalidThinkingLevel)
	// ErrThinkingPairIncomplete は geminiBase / thinkingLevel の片方だけの指定。
	ErrThinkingPairIncomplete = errors.New(i18n.KeyErrorThinkingPairIncomplete)
	// ErrThinkingNotGemini は Gemini 経路にならない ID への Thinking 指定。
	ErrThinkingNotGemini = errors.New(i18n.KeyErrorThinkingNotGemini)
)

// IsValidationError は err が保存時検証エラー（BadRequest 相当）かどうかを返す。
func IsValidationError(err error) bool {
	for _, target := range []error{
		ErrModelIDRequired,
		ErrModelIDDuplicate,
		ErrModelIDConflictsBuiltIn,
		ErrInvalidProvider,
		ErrInvalidThinkingLevel,
		ErrThinkingPairIncomplete,
		ErrThinkingNotGemini,
	} {
		if errors.Is(err, target) {
			return true
		}
	}
	return false
}

// ThinkingAlias はユーザー定義 Thinking エイリアスの provider 中立表現。
// Level は "HIGH" / "MEDIUM" / "LOW" へ正規化済み。
// .gemini/settings.json への焼き込み形式の知識は providers/gemini 側に閉じる。
type ThinkingAlias struct {
	BaseModel string
	Level     string
}

// Store は永続化境界。
type Store interface {
	Load() (usermodelsstore.Data, error)
	Save(data usermodelsstore.Data) error
}

// Service は ユーザーモデル設定の取得・更新・マージを担う。
type Service struct {
	store Store
}

// New は Service を生成し、保存済みの明示 provider 指定を種別判定へ反映する。
// 起動直後からチャット投入・疎通確認の経路判定（models.KindOf）が
// ユーザー指定どおりになるよう、ここで一度同期する（読み込み失敗時は既定判定のまま）。
func New(store Store) *Service {
	s := &Service{store: store}
	if data, err := store.Load(); err == nil {
		syncKindOverrides(data.Added)
	}
	return s
}

// syncKindOverrides は added の明示 provider 指定を models.KindOf へ全置換で反映する。
func syncKindOverrides(added []models.UserModel) {
	kinds := map[string]models.Kind{}
	for _, m := range added {
		if kind, ok := models.ParseKind(m.Provider); ok {
			kinds[m.ID] = kind
		}
	}
	models.SetUserKinds(kinds)
}

// Get は現在のユーザーモデル設定を返す。未作成なら空。
func (s *Service) Get() (usermodelsstore.Data, error) {
	data, err := s.store.Load()
	if err != nil {
		return usermodelsstore.Data{}, err
	}
	return normalize(data), nil
}

// Update は data を検証・正規化して全置換保存し、保存後の内容を返す。
func (s *Service) Update(data usermodelsstore.Data) (usermodelsstore.Data, error) {
	validated, err := validate(data)
	if err != nil {
		return usermodelsstore.Data{}, err
	}
	if err := s.store.Save(validated); err != nil {
		return usermodelsstore.Data{}, err
	}
	syncKindOverrides(validated.Added)
	return validated, nil
}

// Merged はモデル一覧の正本（内蔵デフォルト − hidden ＋ added）を返す。
func (s *Service) Merged() ([]models.Model, error) {
	data, err := s.store.Load()
	if err != nil {
		return nil, err
	}
	return models.Merge(data.Added, data.Hidden), nil
}

// GeminiAliases はユーザー定義 Thinking エイリアス（ID → 中立表現）を返す。
// providers/gemini が送信のたびに参照し、customAliases へ焼き込む。
func (s *Service) GeminiAliases() (map[string]ThinkingAlias, error) {
	data, err := s.store.Load()
	if err != nil {
		return nil, err
	}
	out := map[string]ThinkingAlias{}
	for _, m := range data.Added {
		base := strings.TrimSpace(m.GeminiBase)
		level := normalizeLevel(m.ThinkingLevel)
		if m.ID == "" || base == "" || level == "" {
			continue
		}
		out[m.ID] = ThinkingAlias{BaseModel: base, Level: level}
	}
	return out, nil
}

// validate は 09番 3.3 の検証ルールを適用し、正規化済みの Data を返す。
func validate(data usermodelsstore.Data) (usermodelsstore.Data, error) {
	builtin := models.BuiltInIDs()
	seen := map[string]bool{}
	added := make([]models.UserModel, 0, len(data.Added))
	for _, m := range data.Added {
		m.ID = strings.TrimSpace(m.ID)
		m.Name = strings.TrimSpace(m.Name)
		m.Description = strings.TrimSpace(m.Description)
		m.Provider = strings.ToLower(strings.TrimSpace(m.Provider))
		m.GeminiBase = strings.TrimSpace(m.GeminiBase)
		m.ThinkingLevel = strings.ToLower(strings.TrimSpace(m.ThinkingLevel))

		if m.ID == "" {
			return usermodelsstore.Data{}, ErrModelIDRequired
		}
		if m.Provider != "" {
			if _, ok := models.ParseKind(m.Provider); !ok {
				return usermodelsstore.Data{}, ErrInvalidProvider
			}
		}
		if seen[m.ID] {
			return usermodelsstore.Data{}, ErrModelIDDuplicate
		}
		if builtin[m.ID] {
			return usermodelsstore.Data{}, ErrModelIDConflictsBuiltIn
		}
		if err := validateThinking(m); err != nil {
			return usermodelsstore.Data{}, err
		}
		seen[m.ID] = true
		added = append(added, m)
	}

	// hidden は内蔵 ID に実在するものだけ残す（不正値は黙って除去。ID 空は対象外）。
	hidden := make([]string, 0, len(data.Hidden))
	hiddenSeen := map[string]bool{}
	for _, id := range data.Hidden {
		id = strings.TrimSpace(id)
		if id == "" || !builtin[id] || hiddenSeen[id] {
			continue
		}
		hiddenSeen[id] = true
		hidden = append(hidden, id)
	}

	return usermodelsstore.Data{Added: added, Hidden: hidden}, nil
}

func validateThinking(m models.UserModel) error {
	if m.GeminiBase == "" && m.ThinkingLevel == "" {
		return nil
	}
	if m.GeminiBase == "" || m.ThinkingLevel == "" {
		return ErrThinkingPairIncomplete
	}
	if normalizeLevel(m.ThinkingLevel) == "" {
		return ErrInvalidThinkingLevel
	}
	// 明示 provider 指定があればそれを優先して Gemini 経路かどうかを判定する。
	if m.Kind() != models.KindGemini {
		return ErrThinkingNotGemini
	}
	return nil
}

// normalizeLevel は入力の Thinking Level を "HIGH" / "MEDIUM" / "LOW" へ正規化する。
// 不正値は空文字。
func normalizeLevel(level string) string {
	switch strings.ToLower(strings.TrimSpace(level)) {
	case "high":
		return "HIGH"
	case "medium":
		return "MEDIUM"
	case "low":
		return "LOW"
	default:
		return ""
	}
}

// normalize は Load 直後の nil スライスを空スライスへ寄せる（JSON レスポンスの null 回避）。
func normalize(data usermodelsstore.Data) usermodelsstore.Data {
	if data.Added == nil {
		data.Added = []models.UserModel{}
	}
	if data.Hidden == nil {
		data.Hidden = []string{}
	}
	return data
}
