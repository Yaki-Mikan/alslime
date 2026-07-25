// 開発者お知らせ文言のローカル保存（作業予定14番）。
//
// entitlement サーバーの GET /notice から受領した文言を保存し、次に取り直すまで
// 再起動を跨いで保持する。保存先は AuthDir 配下（roleplay/auth/entitlement-notice.json）
// のためバックアップ・キャッシュ削除・全文走査の対象外（安全要件§8-2）。
// 取得・保存の判断は domain/sponsor が担い、本ファイルは読み書きだけを持つ
// （TokenStore / Clock と同じ役割分担）。

package entitlement

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"

	"alslime/internal/config"
)

// noticeRecord は保存ファイルの形式。lang は受領時の言語（言語切替後も次の
// 取得までは旧言語の文言を保持し続けることを後から判別できるよう残す）。
type noticeRecord struct {
	Lang string `json:"lang"`
	Text string `json:"text"`
}

// NoticeStore は開発者お知らせ文言の読み書き。並行アクセス安全。
// ファイルは初回だけ読み、以後はメモリキャッシュを正本にする（Store と同じ方針）。
type NoticeStore struct {
	path string

	mu     sync.Mutex
	loaded bool
	rec    noticeRecord
}

// NewNoticeStore は WORKSPACE_ROOT 配下の既定パスで NoticeStore を生成する。
func NewNoticeStore(workspaceRoot string) *NoticeStore {
	return &NoticeStore{path: filepath.Join(workspaceRoot, filepath.FromSlash(config.EntitlementNoticeFile))}
}

// Current は保存済みのお知らせ文言を返す（未保存・読込失敗は空文字）。
func (s *NoticeStore) Current() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.loadLocked()
	return s.rec.Text
}

// Save は受領した文言を保存する。空文字はお知らせ取り下げとして保存ファイルを消す。
func (s *NoticeStore) Save(lang, text string) error {
	if text == "" {
		return s.Clear()
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	rec := noticeRecord{Lang: lang, Text: text}
	raw, err := json.Marshal(rec)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.path), config.DirPerm); err != nil {
		return err
	}
	if err := os.WriteFile(s.path, append(raw, '\n'), 0o600); err != nil {
		return err
	}
	s.rec = rec
	s.loaded = true
	return nil
}

// Clear は保存ファイルを削除し、キャッシュを空にする（ログアウト・お知らせ取り下げ）。
func (s *NoticeStore) Clear() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.Remove(s.path); err != nil && !os.IsNotExist(err) {
		return err
	}
	s.rec = noticeRecord{}
	s.loaded = true
	return nil
}

// loadLocked は初回だけファイルから読む（mu 保持前提。壊れたファイルは空扱い）。
func (s *NoticeStore) loadLocked() {
	if s.loaded {
		return
	}
	s.loaded = true
	raw, err := os.ReadFile(s.path)
	if err != nil {
		return
	}
	var rec noticeRecord
	if err := json.Unmarshal(raw, &rec); err != nil {
		return
	}
	s.rec = rec
}
