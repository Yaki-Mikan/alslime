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
}

// New は Service を生成する。
func New(store *storage.Store) *Service {
	return &Service{store: store}
}

// Relationships は関係性オプションを返す。
func (s *Service) Relationships() ([]any, error) {
	return s.store.LoadRelationships()
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
