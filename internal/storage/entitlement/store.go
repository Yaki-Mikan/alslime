// Package entitlement は支援者 entitlement トークンのローカル保存（14番 7章の TokenStore）。
//
// 保存先は AuthDir 配下（roleplay/auth/entitlement-token）。トークンは
// entitlement サーバーが Ed25519 署名した不透明文字列で、本パッケージは中身を
// 解釈しない（署名検証・tier 判定は core 側 featuresimpl の責務）。
// 秘匿情報のため、値をログ・レスポンス・診断へ出さない（安全要件§8-1）。
package entitlement

import (
	"os"
	"path/filepath"
	"strings"
	"sync"

	"alslime/internal/config"
)

// Store は entitlement トークンの読み書き。並行アクセス安全。
//
// gate（core 側）が判定のたびに Current を呼ぶため、ファイルは初回だけ読み、
// 以後はメモリキャッシュを正本にする（書き換えは Save / Clear 経由に限る）。
type Store struct {
	path string

	mu     sync.RWMutex
	loaded bool
	token  string
}

// New は WORKSPACE_ROOT 配下の既定パスで Store を生成する。
func New(workspaceRoot string) *Store {
	return &Store{path: filepath.Join(workspaceRoot, filepath.FromSlash(config.EntitlementTokenFile))}
}

// Current は保存済みトークンを返す（未保存・読込失敗は空文字）。
func (s *Store) Current() string {
	s.mu.RLock()
	if s.loaded {
		defer s.mu.RUnlock()
		return s.token
	}
	s.mu.RUnlock()

	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.loaded {
		raw, err := os.ReadFile(s.path)
		if err == nil {
			s.token = strings.TrimSpace(string(raw))
		}
		s.loaded = true
	}
	return s.token
}

// Save はトークンをファイルへ保存し、キャッシュを更新する。
//
// 認証ファイルのため所有者のみ読み書き（0600）で書く（Windows では無視されるが
// 本番 Linux で意味を持つ。絶対遵守事項13）。
func (s *Store) Save(token string) error {
	token = strings.TrimSpace(token)
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.MkdirAll(filepath.Dir(s.path), config.DirPerm); err != nil {
		return err
	}
	if err := os.WriteFile(s.path, []byte(token+"\n"), 0o600); err != nil {
		return err
	}
	s.token = token
	s.loaded = true
	return nil
}

// Clear はトークンファイルを削除し、キャッシュを空にする（ログアウト）。
func (s *Store) Clear() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.Remove(s.path); err != nil && !os.IsNotExist(err) {
		return err
	}
	s.token = ""
	s.loaded = true
	return nil
}
