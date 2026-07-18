// Package pwasettings は PWA（アプリ表示）設定の保存先を担う。
//
// 現行 Node 版 settings.ts の loadSettings / saveSettings を移植する。
// 保存先は WORKSPACE_ROOT 配下の設定ファイル:
//
//	roleplay/global/settings/pwa-settings.json
//
// 特徴（現行踏襲）:
//   - GET（Load）: 既定値へ実ファイル内容をマージして返す（不足キー補完）。
//   - POST（Merge）: 既存とパーシャルマージして保存し、マージ後の全体を返す。
//
// スキーマは固定構造体に縛らず map[string]any で扱う。現行が `{...DEFAULT, ...parsed}`
// で未知キーも保持するため、未知フィールドを落とさない。
package pwasettings

import (
	"errors"
	"io/fs"
	"os"
	"sync"

	"alslime/internal/config"
	"alslime/internal/storage/jsonstore"
	"alslime/internal/storage/paths"
)

// Store は PWA 設定ファイルの読み書きを担う。
type Store struct {
	resolver *paths.Resolver
	logical  string
	// mu は Merge（読み→部分マージ→書き戻し）の直列化用（同時更新の消失防止）。
	mu sync.Mutex
}

// New は Store を生成する。logical は locations 由来の論理パス。
func New(resolver *paths.Resolver, logical string) *Store {
	return &Store{resolver: resolver, logical: logical}
}

// Load は既定値へ実ファイル内容をマージして返す（不足キー補完）。
//
// ファイルが無い・壊れている場合は既定値をそのまま返す（現行の「無ければ既定」挙動）。
func (s *Store) Load() (map[string]any, error) {
	out := defaultSettings()

	logical, err := s.existingLogical()
	if err != nil {
		return nil, err
	}
	if logical == "" {
		return out, nil
	}

	path, err := s.resolver.ResolveExisting(logical)
	if err != nil {
		return nil, err
	}
	stored, err := jsonstore.ReadRaw(path)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return out, nil
		}
		// 壊れている場合は既定値を返す（現行は console.error して既定にフォールバック）。
		return defaultSettings(), nil
	}

	// 既定値 → 保存値 の順でマージ（保存値が優先・不足キーは既定で補完）。
	for k, v := range stored {
		out[k] = v
	}
	return out, nil
}

// Merge は patch を既存設定へパーシャルマージして保存し、保存後の全体を返す。
//
// 現行 saveSettings の `{ ...current, ...patch }` を踏襲する。
// current は Load 経由のため既定値補完済み。patch のキーで上書きする。
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

	path, err := s.resolver.ResolveForCreateMkdirAll(s.logical, config.DirPerm)
	if err != nil {
		return nil, err
	}
	if err := jsonstore.WriteJSON(path, current); err != nil {
		return nil, err
	}
	return current, nil
}

// Defaults は既定の PWA 設定を返す（参考・テスト用）。
func (s *Store) Defaults() map[string]any {
	return defaultSettings()
}

func (s *Store) existingLogical() (string, error) {
	candidates := []string{s.logical}
	if s.logical == config.PWASettingsFile {
		candidates = append(candidates, config.LegacyPWASettingsFile)
	}
	for _, logical := range candidates {
		lexical, err := s.resolver.ResolveLexical(logical)
		if err != nil {
			return "", err
		}
		if _, statErr := os.Lstat(lexical); statErr == nil {
			return logical, nil
		} else if !errors.Is(statErr, fs.ErrNotExist) {
			return "", statErr
		}
	}
	return "", nil
}
