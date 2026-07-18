// Package globalsettings は グローバル設定（デフォルト設定.json）の保存先を担う。
//
// 保存先は WORKSPACE_ROOT 配下で確定済み（config.GlobalSettingsFile）。
// 現行 Node 版の /api/settings/global と同じく、スキーマを固定せず
// 任意キーを保持したまま「読み込み → 部分マージ → 保存」するパーシャル更新を行う。
//
// storage 層に徹し、HTTP やビジネスロジック（Antigravity モード切替等）は持たない。
package globalsettings

import (
	"errors"
	"io/fs"
	"os"
	"sync"

	"alslime/internal/config"
	"alslime/internal/storage/jsonstore"
	"alslime/internal/storage/paths"
)

// Store は グローバル設定ファイルへの読み書きを担う。
type Store struct {
	resolver *paths.Resolver
	// mu は Merge（読み→部分マージ→書き戻し）の直列化用（同時更新の消失防止）。
	mu sync.Mutex
}

// New は Store を生成する。
func New(resolver *paths.Resolver) *Store {
	return &Store{resolver: resolver}
}

// Load は現在のグローバル設定を返す。
//
// ファイルが存在しない場合は、現行 Node 版に合わせて空マップを返す（エラーにしない）。
// 存在するファイルを読むため、symlink 実体まで含めた境界確認（ResolveExisting）を行う。
func (s *Store) Load() (map[string]any, error) {
	// まだ作られていない初回は字句解決でパスだけ得て、非存在として空を返す。
	lexical, err := s.resolver.ResolveLexical(config.GlobalSettingsFile)
	if err != nil {
		return nil, err
	}
	if _, statErr := os.Lstat(lexical); errors.Is(statErr, fs.ErrNotExist) {
		return map[string]any{}, nil
	}

	// 存在する場合は実体境界を確認したうえで読む。
	path, err := s.resolver.ResolveExisting(config.GlobalSettingsFile)
	if err != nil {
		return nil, err
	}
	raw, err := jsonstore.ReadRaw(path)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return map[string]any{}, nil
		}
		return nil, err
	}
	return raw, nil
}

// Merge は patch を既存設定へ部分マージして保存し、保存後の全体を返す。
//
// 現行 Node 版の挙動（{ ...current, ...patch } の浅いマージ）を踏襲する。
// patch のトップレベルキーで既存値を上書きする。
func (s *Store) Merge(patch map[string]any) (map[string]any, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	current, err := s.Load()
	if err != nil {
		return nil, err
	}
	for k, v := range patch {
		current[k] = v
	}

	path, err := s.resolveForWrite()
	if err != nil {
		return nil, err
	}
	if err := jsonstore.WriteJSON(path, current); err != nil {
		return nil, err
	}
	return current, nil
}

// resolveForWrite は書き込み先を解決する。
//
// 保存先は多階層（…/グローバル/デフォルト設定/）配下のため、初回は親ディレクトリが
// 存在しない。親作成＋実体境界確認は resolver の ResolveForCreateMkdirAll に集約する。
func (s *Store) resolveForWrite() (string, error) {
	return s.resolver.ResolveForCreateMkdirAll(config.GlobalSettingsFile, config.DirPerm)
}
