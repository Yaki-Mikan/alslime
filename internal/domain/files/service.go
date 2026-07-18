// Package files は WORKSPACE_ROOT 配下の汎用ファイル操作のユースケースを担う。
//
// 現行 Node 版 /api/files・/api/content・write・mkdir・search を移植する。
// ビジネスロジックは薄く、境界確認・FS 操作は storage/workspacefs に委ねる。
package files

import (
	"strings"

	storage "alslime/internal/storage/workspacefs"
)

// Service は files 系ユースケースを提供する。
type Service struct {
	store *storage.Store
}

// New は Service を生成する。
func New(store *storage.Store) *Service {
	return &Service{store: store}
}

// List は rel ディレクトリの一覧と currentPath を返す。
func (s *Service) List(rel string) ([]storage.Entry, string, error) {
	return s.store.List(rel)
}

// ReadContent は rel ファイルの内容を返す。
func (s *Service) ReadContent(rel string) (string, error) {
	return s.store.ReadContent(rel)
}

// Write は rel へ content を書き込む。
func (s *Service) Write(rel, content string) error {
	return s.store.Write(rel, content)
}

// Mkdir は rel ディレクトリを作成する。
func (s *Service) Mkdir(rel string) error {
	return s.store.Mkdir(rel)
}

// Search は query（部分一致）でファイルを検索する。query は内部で小文字化する。
func (s *Service) Search(query string) ([]string, error) {
	return s.store.Search(strings.ToLower(query))
}
