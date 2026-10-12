// Package ssrpsettings は SSRP 単一ファイル設定のユースケースを担う service 層。
//
// 現行 Node 版の以下を移植する（保存先確定済み）:
//   - GET  /api/settings/relationships
//   - GET  /api/settings/replacement-config
//   - POST /api/settings/replacement-config
//   - GET  /api/settings/language/:lang
//   - GET  /api/settings/default
//   - POST /api/settings/default
//
// :lang のようなパス断片を受ける入力の検証もこの層で行う。
package ssrpsettings

import (
	"errors"
	"regexp"
	"time"

	"alslime/internal/i18n"
	storage "alslime/internal/storage/ssrpsettings"
)

// ErrInvalidLang は language コードが不正（パス断片として危険）な場合に返る。
var ErrInvalidLang = errors.New(i18n.KeyErrorInvalidLang)

// Service は SSRP 単一ファイル設定のユースケースを提供する。
type Service struct {
	store *storage.Store
	// messages は現在の表示言語の UI 辞書を返す。nil なら日本語の既定を使う。
	messages func() map[string]string
}

// New は Service を生成する。
func New(store *storage.Store) *Service {
	return &Service{store: store}
}

// WithMessages は、関係性ファイルが無いときの初期の選択肢の名前を引く辞書を返す関数を設定する。
func (s *Service) WithMessages(messages func() map[string]string) *Service {
	s.messages = messages
	return s
}

// defaultRelationships は relation_options.json が無いときに返す初期の関係性オプション
// （現行 Node 版 core/ssrp.ts の後方互換デフォルトと同じ内容・順序）。
// 名前は表示言語の辞書で引き、表示名と保存値の両方に使う（AI へ渡る値も表示言語になる）。
var defaultRelationships = []struct {
	key string
	ja  string
}{
	{"ssrp.relationOption.default.realMother", "実母"},
	{"ssrp.relationOption.default.stepMother", "義母"},
	{"ssrp.relationOption.default.friend", "友人"},
	{"ssrp.relationOption.default.lover", "恋人"},
	{"ssrp.relationOption.default.other", "その他"},
}

// Relationships は関係性オプションを返す。ファイルが無ければ表示言語の初期の選択肢を返す。
func (s *Service) Relationships() ([]any, error) {
	out, found, err := s.store.LoadRelationships()
	if err != nil {
		return nil, err
	}
	if found {
		return out, nil
	}
	var messages map[string]string
	if s.messages != nil {
		messages = s.messages()
	}
	defaults := make([]any, 0, len(defaultRelationships))
	for _, d := range defaultRelationships {
		name := d.ja
		if v := messages[d.key]; v != "" {
			name = v
		}
		defaults = append(defaults, map[string]any{"label": name, "value": name})
	}
	return defaults, nil
}

// ReplacementConfig は置換設定を返す。
func (s *Service) ReplacementConfig() (map[string]any, error) {
	return s.store.LoadReplacementConfig()
}

// isoMillisUTC は現行 Node 版 new Date().toISOString() 互換の時刻形式。
// ミリ秒付き UTC（例: 2026-06-26T13:55:11.123Z）。
const isoMillisUTC = "2006-01-02T15:04:05.000Z07:00"

// SaveReplacementConfig は置換設定を保存する（全置換）。
//
// lastModified はクライアント値を信用せず、サーバー側で現在時刻へ上書きする
// （現行 Node 版 saveReplacementConfig と同じ）。
// cfg が nil の場合は空オブジェクト扱いとし、lastModified のみを持つ設定として保存する。
func (s *Service) SaveReplacementConfig(cfg map[string]any) error {
	if cfg == nil {
		cfg = map[string]any{}
	}
	cfg["lastModified"] = time.Now().UTC().Format(isoMillisUTC)
	return s.store.SaveReplacementConfig(cfg)
}

// Language は lang の言語設定を返す。
//
// lang はファイル名の一部になるため、危険なパス断片を拒否する。
func (s *Service) Language(lang string) (map[string]any, error) {
	if !validLang(lang) {
		return nil, ErrInvalidLang
	}
	return s.store.LoadLanguage(lang)
}

// DefaultSettings はデフォルト設定（SSRPデフォルト）を返す。
func (s *Service) DefaultSettings() (map[string]any, error) {
	return s.store.LoadDefaultSettings()
}

// SaveDefaultSettings はデフォルト設定を保存する（全置換）。
func (s *Service) SaveDefaultSettings(settings map[string]any) error {
	return s.store.SaveDefaultSettings(settings)
}

// langPattern は言語コードに許可する文字（ホワイトリスト）。
// 英数・ハイフン・アンダースコアのみ。ja / en / ja-JP / zh_Hant 等を許容する。
var langPattern = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

// maxLangLen は言語コードの長さ上限。
const maxLangLen = 32

// validLang は言語コードがファイル名断片として安全かを検証する。
//
// 配布版方針としてブラックリストではなくホワイトリストで判定する。
// 許可文字（英数・ハイフン・アンダースコア）以外、空、長さ超過を拒否する。
// これにより ".."・パス区切り・制御文字なども自動的に弾かれる。
// resolver 側の実体境界確認は最終防衛線として別途残る。
func validLang(lang string) bool {
	if lang == "" || len(lang) > maxLangLen {
		return false
	}
	return langPattern.MatchString(lang)
}
