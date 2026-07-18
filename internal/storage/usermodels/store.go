// Package usermodels は ユーザー編集のモデル一覧設定（user-models.json）の保存先を担う。
//
// モデル一覧の正本は「内蔵デフォルト（models.BuiltIn）＋本ファイルのマージ」
// （配布公開準備その2 09番）。本パッケージは storage 層に徹し、
// 検証・マージは domain/usermodels（service）と domain/models が担う。
package usermodels

import (
	"errors"
	"io/fs"
	"os"
	"sync"

	"alslime/internal/config"
	"alslime/internal/domain/models"
	"alslime/internal/storage/jsonstore"
	"alslime/internal/storage/paths"
)

// Data は user-models.json の内容。
type Data struct {
	// Added はユーザー追加モデル。
	Added []models.UserModel `json:"added"`
	// Hidden は一覧から外す内蔵デフォルトの ID。
	Hidden []string `json:"hidden"`
}

// Store は user-models.json への読み書きを担う。
type Store struct {
	resolver *paths.Resolver
	// mu は Save（読み書きの突き合わせなしの全置換）の直列化用。
	mu sync.Mutex
}

// New は Store を生成する。
func New(resolver *paths.Resolver) *Store {
	return &Store{resolver: resolver}
}

// Load は現在のユーザーモデル設定を返す。
//
// ファイルが存在しない場合は空の Data を返す（エラーにしない）。
// 存在するファイルを読むため、symlink 実体まで含めた境界確認（ResolveExisting）を行う。
func (s *Store) Load() (Data, error) {
	// まだ作られていない初回は字句解決でパスだけ得て、非存在として空を返す。
	lexical, err := s.resolver.ResolveLexical(config.UserModelsFile)
	if err != nil {
		return Data{}, err
	}
	if _, statErr := os.Lstat(lexical); errors.Is(statErr, fs.ErrNotExist) {
		return Data{}, nil
	}

	path, err := s.resolver.ResolveExisting(config.UserModelsFile)
	if err != nil {
		return Data{}, err
	}
	var data Data
	if err := jsonstore.ReadJSON(path, &data); err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return Data{}, nil
		}
		return Data{}, err
	}
	return data, nil
}

// Save は data を全置換保存する。
func (s *Store) Save(data Data) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	path, err := s.resolver.ResolveForCreateMkdirAll(config.UserModelsFile, config.DirPerm)
	if err != nil {
		return err
	}
	return jsonstore.WriteJSON(path, data)
}
