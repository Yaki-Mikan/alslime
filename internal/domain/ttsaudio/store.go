// Package ttsaudio は読み上げ生成音声の保存（設計02の5章）。
//
// 配置:
//
//	roleplay/history/tts_audio/<sessionId>/
//	  <messageId>_<turnId>.wav   … TURN の最終音声（チャンク結合済み）
//	  <messageId>_<turnId>.part/ … 実行中のチャンク一時領域（終端で掃除）
//	  index.json                 … 作成済み判定・再生の正本
//
// セッション本体とはディレクトリを分離し、セッション削除時に
// <sessionId> ディレクトリごと削除する（要件10章）。
package ttsaudio

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"alslime/internal/config"
	"alslime/internal/storage/jsonstore"
	"alslime/internal/storage/paths"
)

// safeIDPattern は ID（sessionId / messageId / turnId）として受け付ける形式。
// いずれも内部生成IDのため英数字・ハイフン・アンダースコアに限定する。
var safeIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

// ErrBadID は ID 形式の不正。
var ErrBadID = errors.New("ttsaudio: invalid id")

// Store は読み上げ音声の保存・読み出し。
type Store struct {
	resolver *paths.Resolver
}

// New は Store を生成する。
func New(resolver *paths.Resolver) *Store {
	return &Store{resolver: resolver}
}

// TurnKey は音声ファイル・index の複合キー
// （turnId はメッセージ内一意のため messageId と組み合わせる。設計02の5-2）。
func TurnKey(messageID, turnID string) string {
	return messageID + "_" + turnID
}

// IndexEntry は index.json の1エントリ（作成済み判定・再生の正本）。
type IndexEntry struct {
	File            string  `json:"file"`
	MessageID       string  `json:"messageId"`
	TurnID          string  `json:"turnId"`
	VoiceID         string  `json:"voiceId"`
	Format          string  `json:"format"`
	CreatedAt       string  `json:"createdAt"`
	DurationSeconds float64 `json:"durationSeconds"`
}

// Index は index.json の全体。
type Index struct {
	Version int                   `json:"version"`
	Entries map[string]IndexEntry `json:"entries"`
}

func validateIDs(ids ...string) error {
	for _, id := range ids {
		if !safeIDPattern.MatchString(id) {
			return ErrBadID
		}
	}
	return nil
}

func sessionDirRel(sessionID string) string {
	return config.TTSAudioDir + "/" + sessionID
}

func finalFileName(turnKey, format string) string {
	return turnKey + "." + format
}

// SaveChunk は完成チャンクを一時領域へ保存する（逐次再生の配信元。要件9.2）。
func (s *Store) SaveChunk(sessionID, messageID, turnID string, index int, format string, audio []byte) error {
	if err := validateIDs(sessionID, messageID, turnID); err != nil {
		return err
	}
	rel := fmt.Sprintf("%s/%s.part/%d.%s", sessionDirRel(sessionID), TurnKey(messageID, turnID), index, format)
	path, err := s.resolver.ResolveForCreateMkdirAll(rel, config.DirPerm)
	if err != nil {
		return err
	}
	return os.WriteFile(path, audio, config.FilePerm)
}

// ChunkPath は完成チャンクの物理パスを返す（逐次再生の取得API用）。
func (s *Store) ChunkPath(sessionID, messageID, turnID string, index int, format string) (string, error) {
	if err := validateIDs(sessionID, messageID, turnID); err != nil {
		return "", err
	}
	rel := fmt.Sprintf("%s/%s.part/%d.%s", sessionDirRel(sessionID), TurnKey(messageID, turnID), index, format)
	return s.resolver.ResolveExisting(rel)
}

// MergeTurn は一時領域のチャンクを結合して最終音声を保存し、index.json を更新する。
// voiceID は index の記録用。結合は wav（波形連結）と mp3（フレーム連結）に対応する。
//
// 一時チャンク（.part）はここでは削除しない。逐次再生のフロントはポーリングで
// チャンク完成を知ってから取得しに来るため、結合直後に消すと取得前のチャンクが
// 404 になり再生が欠ける。正常時の残骸は次回実行の runTurn 冒頭掃除と
// ハウスキーピング（SweepParts）が回収する。
func (s *Store) MergeTurn(sessionID, messageID, turnID string, chunkCount int, format, voiceID string, silenceSeconds float64) (IndexEntry, error) {
	if err := validateIDs(sessionID, messageID, turnID); err != nil {
		return IndexEntry{}, err
	}
	if format != "wav" && format != "mp3" {
		return IndexEntry{}, fmt.Errorf("ttsaudio: merge for format %q is not supported yet", format)
	}
	turnKey := TurnKey(messageID, turnID)
	chunks := make([][]byte, 0, chunkCount)
	for i := 0; i < chunkCount; i++ {
		rel := fmt.Sprintf("%s/%s.part/%d.%s", sessionDirRel(sessionID), turnKey, i, format)
		path, err := s.resolver.ResolveExisting(rel)
		if err != nil {
			return IndexEntry{}, err
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return IndexEntry{}, err
		}
		chunks = append(chunks, data)
	}
	var merged []byte
	var duration float64
	var mergeErr error
	if format == "mp3" {
		merged, duration, mergeErr = mergeMP3(chunks, silenceSeconds)
	} else {
		merged, duration, mergeErr = mergeWav(chunks, silenceSeconds)
	}
	if mergeErr != nil {
		return IndexEntry{}, mergeErr
	}
	finalRel := sessionDirRel(sessionID) + "/" + finalFileName(turnKey, format)
	finalPath, err := s.resolver.ResolveForCreateMkdirAll(finalRel, config.DirPerm)
	if err != nil {
		return IndexEntry{}, err
	}
	if err := os.WriteFile(finalPath, merged, config.FilePerm); err != nil {
		return IndexEntry{}, err
	}
	entry := IndexEntry{
		File:            finalFileName(turnKey, format),
		MessageID:       messageID,
		TurnID:          turnID,
		VoiceID:         voiceID,
		Format:          format,
		CreatedAt:       time.Now().UTC().Format(time.RFC3339),
		DurationSeconds: duration,
	}
	if err := s.writeIndexEntry(sessionID, turnKey, entry); err != nil {
		return IndexEntry{}, err
	}
	return entry, nil
}

// SweepParts は全セッション配下の古いチャンク一時領域（.part）を削除する
// （ハウスキーピング用）。更新時刻が cutoff より古い .part ディレクトリだけを
// 丸ごと消し、最終音声・index.json には触れない。
func (s *Store) SweepParts(cutoff time.Time) (removedFiles, removedDirs int) {
	root, err := s.resolver.ResolveExisting(config.TTSAudioDir)
	if err != nil {
		return 0, 0
	}
	sessions, err := os.ReadDir(root)
	if err != nil {
		return 0, 0
	}
	for _, session := range sessions {
		if !session.IsDir() {
			continue
		}
		sessionDir := filepath.Join(root, session.Name())
		entries, err := os.ReadDir(sessionDir)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			if !entry.IsDir() || !strings.HasSuffix(entry.Name(), ".part") {
				continue
			}
			info, err := entry.Info()
			if err != nil || !info.ModTime().Before(cutoff) {
				continue
			}
			partDir := filepath.Join(sessionDir, entry.Name())
			files, err := os.ReadDir(partDir)
			if err == nil {
				removedFiles += len(files)
			}
			if err := os.RemoveAll(partDir); err != nil {
				continue
			}
			removedDirs++
		}
	}
	return removedFiles, removedDirs
}

// CleanupTurnTemp はチャンク一時領域を削除する（中止・失敗時の終端で必ず呼ぶ。要件9.2）。
func (s *Store) CleanupTurnTemp(sessionID, messageID, turnID string) {
	if err := validateIDs(sessionID, messageID, turnID); err != nil {
		return
	}
	rel := sessionDirRel(sessionID) + "/" + TurnKey(messageID, turnID) + ".part"
	if path, err := s.resolver.ResolveLexical(rel); err == nil {
		_ = os.RemoveAll(path)
	}
}

// ReadIndex は index.json を読む（未作成は空 Index）。
func (s *Store) ReadIndex(sessionID string) (Index, error) {
	if err := validateIDs(sessionID); err != nil {
		return Index{}, err
	}
	rel := sessionDirRel(sessionID) + "/index.json"
	lexical, err := s.resolver.ResolveLexical(rel)
	if err != nil {
		return Index{}, err
	}
	if _, err := os.Lstat(lexical); errors.Is(err, fs.ErrNotExist) {
		return Index{Version: 1, Entries: map[string]IndexEntry{}}, nil
	} else if err != nil {
		return Index{}, err
	}
	path, err := s.resolver.ResolveExisting(rel)
	if err != nil {
		return Index{}, err
	}
	var idx Index
	if err := jsonstore.ReadJSON(path, &idx); err != nil {
		return Index{}, err
	}
	if idx.Entries == nil {
		idx.Entries = map[string]IndexEntry{}
	}
	return idx, nil
}

// writeIndexEntry は index.json へ1エントリを追加・置換する（再作成は上書き）。
func (s *Store) writeIndexEntry(sessionID, turnKey string, entry IndexEntry) error {
	idx, err := s.ReadIndex(sessionID)
	if err != nil {
		return err
	}
	idx.Version = 1
	idx.Entries[turnKey] = entry
	rel := sessionDirRel(sessionID) + "/index.json"
	path, err := s.resolver.ResolveForCreateMkdirAll(rel, config.DirPerm)
	if err != nil {
		return err
	}
	return jsonstore.WriteJSON(path, idx)
}

// FinalPath は最終音声の物理パスを返す（再生の取得API用）。
func (s *Store) FinalPath(sessionID, turnKey string) (string, string, error) {
	if err := validateIDs(sessionID); err != nil {
		return "", "", err
	}
	idx, err := s.ReadIndex(sessionID)
	if err != nil {
		return "", "", err
	}
	entry, ok := idx.Entries[turnKey]
	if !ok {
		return "", "", fs.ErrNotExist
	}
	path, err := s.resolver.ResolveExisting(sessionDirRel(sessionID) + "/" + entry.File)
	if err != nil {
		return "", "", err
	}
	return path, entry.Format, nil
}

// DeleteTurn は1TURN分の最終音声と index エントリを削除する。
func (s *Store) DeleteTurn(sessionID, turnKey string) error {
	if err := validateIDs(sessionID); err != nil {
		return err
	}
	idx, err := s.ReadIndex(sessionID)
	if err != nil {
		return err
	}
	entry, ok := idx.Entries[turnKey]
	if !ok {
		return nil
	}
	if path, err := s.resolver.ResolveLexical(sessionDirRel(sessionID) + "/" + entry.File); err == nil {
		_ = os.Remove(path)
	}
	delete(idx.Entries, turnKey)
	rel := sessionDirRel(sessionID) + "/index.json"
	path, err := s.resolver.ResolveForCreateMkdirAll(rel, config.DirPerm)
	if err != nil {
		return err
	}
	return jsonstore.WriteJSON(path, idx)
}

// DeleteMessage は1応答（メッセージ）分の最終音声と index エントリをまとめて削除する
// （応答単位の音声削除UI用。要件10章）。
func (s *Store) DeleteMessage(sessionID, messageID string) error {
	if err := validateIDs(sessionID, messageID); err != nil {
		return err
	}
	idx, err := s.ReadIndex(sessionID)
	if err != nil {
		return err
	}
	removed := false
	for turnKey, entry := range idx.Entries {
		if entry.MessageID != messageID {
			continue
		}
		if path, err := s.resolver.ResolveLexical(sessionDirRel(sessionID) + "/" + entry.File); err == nil {
			_ = os.Remove(path)
		}
		delete(idx.Entries, turnKey)
		removed = true
	}
	if !removed {
		return nil
	}
	rel := sessionDirRel(sessionID) + "/index.json"
	path, err := s.resolver.ResolveForCreateMkdirAll(rel, config.DirPerm)
	if err != nil {
		return err
	}
	return jsonstore.WriteJSON(path, idx)
}

// DeleteSession はセッションの生成音声一式（ディレクトリごと）を削除する
// （セッション削除連動。要件10章）。
func (s *Store) DeleteSession(sessionID string) error {
	if err := validateIDs(sessionID); err != nil {
		return err
	}
	path, err := s.resolver.ResolveLexical(sessionDirRel(sessionID))
	if err != nil {
		return err
	}
	return os.RemoveAll(path)
}
