package apiproviders

import (
	"errors"
	"io/fs"
	"os"
	"slices"
	"strings"
	"unicode/utf8"

	"alslime/internal/config"
	"alslime/internal/storage/jsonstore"
)

// 接続別追加指示。
//
// 物理パスはサーバー生成の Connection ID だけから組み立てる（Label は使わない。
// 改名時にも移動しない）。空ファイルは「追加指示なし」を表す正常値。

// IsValidInstructionLocale は locale が ja/en のいずれかであることを返す。
func IsValidInstructionLocale(locale string) bool {
	return slices.Contains(InstructionLocales, locale)
}

// createEmptyInstructions は接続作成時に ja/en の空ファイルを同一操作内で生成する。
// 既存ファイルは上書きしない（冪等）。
func (s *Service) createEmptyInstructions(connectionID string) error {
	for _, locale := range InstructionLocales {
		if err := s.writeInstructionIfMissing(connectionID, locale); err != nil {
			return err
		}
	}
	return nil
}

// ensureInstructionFiles は欠落した指示ファイルだけを空で再生成する（起動時チェック用）。
func (s *Service) ensureInstructionFiles(connectionID string) error {
	return s.createEmptyInstructions(connectionID)
}

// writeInstructionIfMissing は未存在の場合のみ空ファイルを作成する。
func (s *Service) writeInstructionIfMissing(connectionID, locale string) error {
	logical := config.OpenAICompatConnectionPromptFile(connectionID, locale)
	lexical, err := s.resolver.ResolveLexical(logical)
	if err != nil {
		return err
	}
	if _, statErr := os.Lstat(lexical); statErr == nil {
		return nil
	} else if !errors.Is(statErr, fs.ErrNotExist) {
		return statErr
	}
	abs, err := s.resolver.ResolveForCreateMkdirAll(logical, config.DirPerm)
	if err != nil {
		return err
	}
	return jsonstore.WriteRawAtomic(abs, []byte{})
}

// GetInstruction は接続別追加指示の本文を返す。
// 接続の実在確認は呼び出し側（handler）が行う。ファイル欠落は空本文として返す
// （欠落は起動時チェックで再生成される正常回復対象のため）。
func (s *Service) GetInstruction(connectionID, locale string) (string, error) {
	logical := config.OpenAICompatConnectionPromptFile(connectionID, locale)
	lexical, err := s.resolver.ResolveLexical(logical)
	if err != nil {
		return "", err
	}
	if _, statErr := os.Lstat(lexical); errors.Is(statErr, fs.ErrNotExist) {
		return "", nil
	}
	abs, err := s.resolver.ResolveExisting(logical)
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// PutInstruction は接続別追加指示を検証して原子的に保存する（空本文を許容）。
//
// 作成・更新・削除カスケードと同じ Service 排他の中で接続の実在を再確認して
// から保存する。排他の外だと、存在確認〜保存の間に削除カスケードが走って
// 削除済み接続の指示ディレクトリを再作成する競合が起こり得るため。
func (s *Service) PutInstruction(connectionID, locale, content string) error {
	if len(content) > config.OpenAICompatInstructionMaxBytes {
		return ErrInstructionTooLarge
	}
	if !utf8.ValidString(content) {
		return ErrInstructionInvalidUTF8
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok, err := s.Get(connectionID); err != nil {
		return err
	} else if !ok {
		return ErrConnectionNotFound
	}
	logical := config.OpenAICompatConnectionPromptFile(connectionID, locale)
	abs, err := s.resolver.ResolveForCreateMkdirAll(logical, config.DirPerm)
	if err != nil {
		return err
	}
	return jsonstore.WriteRawAtomic(abs, []byte(content))
}

// removeInstructionDir は接続別追加指示ディレクトリを削除する（未存在は成功。冪等）。
func (s *Service) removeInstructionDir(connectionID string) error {
	logical := config.OpenAICompatConnectionPromptDir(connectionID)
	lexical, err := s.resolver.ResolveLexical(logical)
	if err != nil {
		return err
	}
	if _, statErr := os.Lstat(lexical); errors.Is(statErr, fs.ErrNotExist) {
		return nil
	}
	abs, err := s.resolver.ResolveExisting(logical)
	if err != nil {
		return err
	}
	return os.RemoveAll(abs)
}

// listInstructionDirs は接続別追加指示ルート直下のディレクトリ名（= Connection ID）
// を返す（孤児検出用。ルート未存在は空）。
func (s *Service) listInstructionDirs() ([]string, error) {
	lexical, err := s.resolver.ResolveLexical(config.OpenAICompatConnectionPromptsDir)
	if err != nil {
		return nil, err
	}
	if _, statErr := os.Lstat(lexical); errors.Is(statErr, fs.ErrNotExist) {
		return []string{}, nil
	}
	abs, err := s.resolver.ResolveExisting(config.OpenAICompatConnectionPromptsDir)
	if err != nil {
		return nil, err
	}
	dirents, err := os.ReadDir(abs)
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(dirents))
	for _, d := range dirents {
		if d.IsDir() && strings.TrimSpace(d.Name()) != "" {
			out = append(out, d.Name())
		}
	}
	return out, nil
}
