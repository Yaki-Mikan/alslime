// Package apiproviders は openai_compat 接続先の保存先を担う。
//
// メタデータ（api-providers.json。通常設定領域）と秘密情報（AuthDir 配下の
// secrets.json）を物理的に分離して保存する。検証・CRUD・カスケードは
// domain/apiproviders（service）が担い、本パッケージは storage 層に徹する。
package apiproviders

import (
	"errors"
	"io/fs"
	"os"
	"sync"

	"alslime/internal/config"
	"alslime/internal/storage/jsonstore"
	"alslime/internal/storage/paths"
)

// MetaData は api-providers.json の内容（秘密値を一切含まない）。
type MetaData struct {
	Connections []Connection `json:"connections"`
}

// Connection は openai_compat 接続先 1 件のメタデータ。
type Connection struct {
	// ID はサーバー生成の不変 ID（conn-<英数字>）。
	ID string `json:"id"`
	// Preset は openrouter|openai|deepseek|opencode-go|custom。
	Preset string `json:"preset"`
	Label  string `json:"label"`
	// BaseURL は検証・正規化済み（末尾スラッシュ除去）の値を保存する。
	BaseURL string `json:"baseUrl"`
	// AuthScheme は bearer|api-key-header|x-api-key-header|none。
	AuthScheme string `json:"authScheme"`
	Enabled    bool   `json:"enabled"`
	// ForceNonStreaming は SSE 非対応サーバー向けの非ストリーミング強制。
	ForceNonStreaming bool `json:"forceNonStreaming,omitempty"`
	// ExtraParams は非秘密の拡張ボディパラメータ（予約キー検証は domain 側）。
	ExtraParams map[string]any `json:"extraParams,omitempty"`
}

// MetaStore は api-providers.json への読み書きを担う（パターン1全置換）。
type MetaStore struct {
	resolver *paths.Resolver
	// mu は Save（全置換）の直列化用。操作全体の直列化は domain 側 mutex が担う。
	mu sync.Mutex
}

// NewMetaStore は MetaStore を生成する。
func NewMetaStore(resolver *paths.Resolver) *MetaStore {
	return &MetaStore{resolver: resolver}
}

// Load は現在の接続先メタデータを返す。
//
// ファイルが存在しない場合は空の MetaData を返す（エラーにしない）。
func (s *MetaStore) Load() (MetaData, error) {
	lexical, err := s.resolver.ResolveLexical(config.APIProvidersFile)
	if err != nil {
		return MetaData{}, err
	}
	if _, statErr := os.Lstat(lexical); errors.Is(statErr, fs.ErrNotExist) {
		return MetaData{}, nil
	}

	path, err := s.resolver.ResolveExisting(config.APIProvidersFile)
	if err != nil {
		return MetaData{}, err
	}
	var data MetaData
	if err := jsonstore.ReadJSON(path, &data); err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return MetaData{}, nil
		}
		return MetaData{}, err
	}
	return data, nil
}

// Save は data を全置換保存する。
func (s *MetaStore) Save(data MetaData) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	path, err := s.resolver.ResolveForCreateMkdirAll(config.APIProvidersFile, config.DirPerm)
	if err != nil {
		return err
	}
	return jsonstore.WriteJSON(path, data)
}
