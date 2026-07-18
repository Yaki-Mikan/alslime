// Package datetimepresets は単一ファイル型プリセット（日付時刻プリセット）の
// ユースケースを担う service 層。
//
// ディレクトリ列挙型（domain/presets）と API 契約は同一だが、保存先が
// 単一ファイル内のキーである点だけが異なる。api/presets.Service interface を
// 満たすことで、ディレクトリ列挙型と同じ handler に載せられる（交換日記 08 / レビュー10）。
//
// メタ付与（createdAt/updatedAt）は無し。値（DateTimeValue 相当の値オブジェクト）を
// そのまま data として保存・取得する。
package datetimepresets

import (
	storage "alslime/internal/storage/datetimepresets"
	"alslime/internal/storage/presetname"
)

// Service は日付時刻プリセットのユースケースを提供する。
type Service struct {
	store *storage.Store
}

// New は Service を生成する。
func New(store *storage.Store) *Service {
	return &Service{store: store}
}

// List はプリセット名一覧を返す。
func (s *Service) List() ([]string, error) {
	return s.store.List()
}

// Get は name のプリセット値と正規化済み正本名を返す。
//
// ディレクトリ列挙型 service と同じく、入力 name を正規化して正本名を返す
// （統一契約。燈レビュー対応確認）。未存在は storage.ErrNotFound。
func (s *Service) Get(name string) (string, any, error) {
	normalized, err := presetname.Validate(name)
	if err != nil {
		return "", nil, err
	}
	v, err := s.store.Get(normalized)
	if err != nil {
		return "", nil, err
	}
	return normalized, v, nil
}

// Save は name のプリセット値を保存し、正規化済み正本名を返す。
//
// data は値オブジェクト（DateTimeValue 相当）をそのまま保存する。
// ディレクトリ列挙型と違いメタ付与は行わない。
func (s *Service) Save(name string, data any) (string, error) {
	normalized, err := presetname.Validate(name)
	if err != nil {
		return "", err
	}
	if err := s.store.Save(normalized, data); err != nil {
		return "", err
	}
	return normalized, nil
}

// Delete は name のプリセットを削除する。未存在は storage.ErrNotFound。
func (s *Service) Delete(name string) error {
	return s.store.Delete(name)
}
