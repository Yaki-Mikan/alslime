// Package calendar は日付時刻プロンプト用の祝日カレンダーを読み込む。
package calendar

import (
	"errors"
	"io/fs"
	"os"
	"time"

	"alslime/internal/config"
	"alslime/internal/storage/jsonstore"
	"alslime/internal/storage/paths"
)

// Store は calendar.json の読み取りを担う。
type Store struct {
	resolver *paths.Resolver
	logical  string
}

// New は Store を生成する。logical は locations 由来の論理パス。
func New(resolver *paths.Resolver, logical string) *Store {
	return &Store{resolver: resolver, logical: logical}
}

// HolidayName は指定日の祝日名を返す。未定義・未作成なら空文字。
func (s *Store) HolidayName(t time.Time) (string, error) {
	holidays, err := s.LoadAll()
	if err != nil {
		return "", err
	}
	return holidays[t.Format("2006-01-02")], nil
}

// LoadAll は calendar.json 全体を返す。未作成なら空マップ。
func (s *Store) LoadAll() (map[string]string, error) {
	path, err := s.resolver.ResolveLexical(s.logical)
	if err != nil {
		return nil, err
	}
	var holidays map[string]string
	if err := jsonstore.ReadJSON(path, &holidays); err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return map[string]string{}, nil
		}
		return nil, err
	}
	if holidays == nil {
		holidays = map[string]string{}
	}
	return holidays, nil
}

// SaveAll は calendar.json を保存する。
func (s *Store) SaveAll(holidays map[string]string) error {
	path, err := s.resolver.ResolveForCreateMkdirAll(s.logical, config.DirPerm)
	if err != nil {
		return err
	}
	return jsonstore.WriteJSON(path, holidays)
}

// AppendLog はカレンダー更新ログへ1行追記する。
func (s *Store) AppendLog(line string) error {
	path, err := s.resolver.ResolveForCreateMkdirAll(config.CalendarLogFile, config.DirPerm)
	if err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, config.FilePerm)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.WriteString(line)
	return err
}
