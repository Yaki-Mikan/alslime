// Package configgendialog は設定自動生成の対話作成で使うセッション履歴
// （中間ファイル）の読み書きを担う。
//
// 置き場は WORKSPACE_ROOT/configgen_workspace/sessions/<sessionId>.json。
// 1 セッション = 1 ファイル。ファイル内容の写しは持たず、正本は正規位置の
// 設定ファイル。履歴・対象ファイル・最後に確認した内容ハッシュのみを記録する。
//
// 既存セッションへの変更はセッション ID 単位のロック下で「読み→変更→保存」
// する Update 経由に限る（Save 直呼びの全置換は新規初回のみ）。API 層と
// ジョブ実行器の双方から同じセッションを触るため、ロックはパッケージ全体で持つ。
package configgendialog

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"alslime/internal/domain/configgenjobs"
	"alslime/internal/storage/jsonstore"
	"alslime/internal/storage/paths"
	"alslime/internal/storage/safename"
)

// SchemaVersion は Session の保存形式バージョン。
const SchemaVersion = 1

// 役割。
const (
	RoleUser  = "user"
	RoleAgent = "agent"
)

// ErrNotFound はセッションが存在しない。
var ErrNotFound = errors.New("configgen dialog session not found")

// Session は対話作成 1 件分の履歴。
type Session struct {
	SchemaVersion int       `json:"schemaVersion"`
	SessionID     string    `json:"sessionId"`
	CategoryID    string    `json:"categoryId"`
	DirName       string    `json:"dirName,omitempty"`
	FileName      string    `json:"fileName"`
	IsNew         bool      `json:"isNew"`
	FileHash      string    `json:"fileHash,omitempty"`
	Provider      string    `json:"provider,omitempty"`
	Model         string    `json:"model,omitempty"`
	Locale        string    `json:"locale,omitempty"`
	CreatedAt     time.Time `json:"createdAt"`
	LastUpdated   time.Time `json:"lastUpdated"`
	Messages      []Message `json:"messages"`
}

// Message は 1 発言。
type Message struct {
	Role      string    `json:"role"`
	Content   string    `json:"content"`
	Timestamp time.Time `json:"timestamp"`
	JobID     string    `json:"jobId,omitempty"`
	// Canceled は AI 応答が中止・失敗で得られなかったターン（agent 側に記録）。
	Canceled bool `json:"canceled,omitempty"`
}

// locks はセッション ID ごとの read-modify-write 直列化用（プロセス内）。
var locks sync.Map // map[string]*sync.Mutex

func lockFor(sessionID string) *sync.Mutex {
	actual, _ := locks.LoadOrStore(sessionID, &sync.Mutex{})
	return actual.(*sync.Mutex)
}

// Store はセッションファイルの読み書き。
type Store struct {
	resolver *paths.Resolver
	now      func() time.Time
}

// NewStore は WORKSPACE_ROOT の resolver から Store を作る。
func NewStore(resolver *paths.Resolver) *Store {
	return &Store{resolver: resolver, now: time.Now}
}

// WithNow は現在時刻取得を差し替える（テスト用）。
func (s *Store) WithNow(now func() time.Time) *Store {
	if now != nil {
		s.now = now
	}
	return s
}

func (s *Store) rel(sessionID string) (string, error) {
	id, err := safename.Validate(sessionID)
	if err != nil {
		return "", err
	}
	return configgenjobs.WorkspaceSessionsDir + "/" + id + ".json", nil
}

// Read はセッションを読む。無ければ ErrNotFound。
func (s *Store) Read(sessionID string) (Session, error) {
	rel, err := s.rel(sessionID)
	if err != nil {
		return Session{}, err
	}
	abs, err := s.resolver.ResolveExisting(rel)
	if err != nil {
		return Session{}, ErrNotFound
	}
	var session Session
	if err := jsonstore.ReadJSON(abs, &session); err != nil {
		return Session{}, err
	}
	if session.SchemaVersion != SchemaVersion || session.SessionID == "" {
		return Session{}, ErrNotFound
	}
	if session.Messages == nil {
		session.Messages = []Message{}
	}
	return session, nil
}

// Save はセッションを全置換で書く（新規作成専用）。
func (s *Store) Save(session Session) error {
	lock := lockFor(session.SessionID)
	lock.Lock()
	defer lock.Unlock()
	return s.saveLocked(session)
}

func (s *Store) saveLocked(session Session) error {
	rel, err := s.rel(session.SessionID)
	if err != nil {
		return err
	}
	abs, err := s.resolver.ResolveForCreateMkdirAll(rel, 0o755)
	if err != nil {
		return err
	}
	session.SchemaVersion = SchemaVersion
	session.LastUpdated = s.now()
	if session.CreatedAt.IsZero() {
		session.CreatedAt = session.LastUpdated
	}
	if session.Messages == nil {
		session.Messages = []Message{}
	}
	return jsonstore.WriteJSON(abs, session)
}

// Update はロック下で「読み→mutate→保存」し、保存後の姿を返す。
func (s *Store) Update(sessionID string, mutate func(*Session) error) (Session, error) {
	lock := lockFor(sessionID)
	lock.Lock()
	defer lock.Unlock()
	session, err := s.Read(sessionID)
	if err != nil {
		return Session{}, err
	}
	if err := mutate(&session); err != nil {
		return Session{}, err
	}
	if err := s.saveLocked(session); err != nil {
		return Session{}, err
	}
	return session, nil
}

// Delete はセッションファイルを削除する（無ければ何もしない）。
func (s *Store) Delete(sessionID string) error {
	rel, err := s.rel(sessionID)
	if err != nil {
		return err
	}
	lock := lockFor(sessionID)
	lock.Lock()
	defer lock.Unlock()
	abs, err := s.resolver.ResolveExisting(rel)
	if err != nil {
		return nil
	}
	if err := os.Remove(abs); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

// Find は対象ファイル（カテゴリ・ディレクトリ・ファイル名）が一致する
// セッションを返す。無ければ ok=false。
func (s *Store) Find(categoryID, dirName, fileName string) (Session, bool) {
	dirAbs, err := s.resolver.ResolveExisting(configgenjobs.WorkspaceSessionsDir)
	if err != nil {
		return Session{}, false
	}
	entries, err := os.ReadDir(dirAbs)
	if err != nil {
		return Session{}, false
	}
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || !strings.HasSuffix(name, ".json") || strings.HasPrefix(name, ".tmp") {
			continue
		}
		session, err := s.Read(strings.TrimSuffix(name, ".json"))
		if err != nil {
			continue
		}
		if session.CategoryID == categoryID && session.DirName == dirName && session.FileName == fileName {
			return session, true
		}
	}
	return Session{}, false
}

// Sweep は mtime が cutoff より古いセッションファイルを削除する（掃除用）。
func (s *Store) Sweep(cutoff time.Time) (removedFiles int, removedDirs int) {
	dirAbs, err := s.resolver.ResolveExisting(configgenjobs.WorkspaceSessionsDir)
	if err != nil {
		return 0, 0
	}
	entries, err := os.ReadDir(dirAbs)
	if err != nil {
		return 0, 0
	}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		info, err := e.Info()
		if err != nil || !info.ModTime().Before(cutoff) {
			continue
		}
		if err := os.Remove(filepath.Join(dirAbs, e.Name())); err == nil {
			removedFiles++
		}
	}
	return removedFiles, 0
}

// ContentHash は本文の sha256（16 進）。フロントと同じ計算規則（UTF-8 バイト列）。
func ContentHash(content string) string {
	sum := sha256.Sum256([]byte(content))
	return hex.EncodeToString(sum[:])
}

// BuildHistoryText は履歴を指示文へ差し込む形式に整える。
// 直近 maxTurns 往復のみを含め、それより古い分は省略した旨を先頭に示す。
func BuildHistoryText(messages []Message, maxTurns int, locale string) string {
	if maxTurns <= 0 {
		maxTurns = 20
	}
	limit := maxTurns * 2
	omitted := false
	if len(messages) > limit {
		messages = messages[len(messages)-limit:]
		omitted = true
	}
	var b strings.Builder
	if omitted {
		if strings.HasPrefix(strings.ToLower(locale), "en") {
			b.WriteString("(Earlier conversation omitted.)\n\n")
		} else {
			b.WriteString("（以前の会話は省略）\n\n")
		}
	}
	for _, m := range messages {
		if m.Canceled {
			continue
		}
		if m.Role == RoleUser {
			b.WriteString("### user\n\n")
		} else {
			b.WriteString("### assistant\n\n")
		}
		b.WriteString(strings.TrimSpace(m.Content))
		b.WriteString("\n\n")
	}
	return strings.TrimSpace(b.String())
}
