// Package characters はキャラリスト走査・キャラフィルタのユースケースを担う。
//
// 現行 Node 版 /api/character-tags・/api/character-filters・rebuild を移植する。
// 走査・集約・マスタ書き出しは storage/charfilters に委ねる。
package characters

import storage "alslime/internal/storage/charfilters"

// Service はキャラ系ユースケースを提供する。
type Service struct {
	store *storage.Store
}

// New は Service を生成する。
func New(store *storage.Store) *Service {
	return &Service{store: store}
}

// Tags はキャラ一覧（各 .md = 1 キャラ）+ work/tags を返す。
func (s *Service) Tags() ([]storage.Character, error) {
	return s.store.ListCharacters()
}

// Filters は works/tags マスタを返す。
func (s *Service) Filters() (storage.Filters, error) {
	return s.store.LoadFilters()
}

// RebuildFilters は全キャラ走査でマスタを再構築し、結果と統計を返す。
func (s *Service) RebuildFilters() (storage.Filters, storage.RebuildStats, error) {
	return s.store.Rebuild()
}
