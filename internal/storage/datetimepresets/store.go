// Package datetimepresets は単一ファイル型プリセット（日付時刻プリセット）の保存先を担う。
//
// ディレクトリ列挙型（presetstore）と違い、全プリセットを 1 つの JSON ファイル
// （datetime_presets.json）の "presets" キー配下にまとめて保持する。
//
//	{ "presets": { "<名前>": <値オブジェクト>, ... } }
//
// 現行 Node 版 datetime-preset-service.ts の listDateTimePresets / getDateTimePreset /
// saveDateTimePreset / deleteDateTimePreset を移植する。API 契約は presetstore と
// 同一に見せる（一覧は名前配列、取得/保存は値オブジェクト、未存在は ErrNotFound）。
//
// 名前のサニタイズは presetname を流用し、ディレクトリ列挙型と同じ規則で塞ぐ
// （現行はキー名を無検証で扱っていたが、ファイル名にこそならないものの、
// 一貫した名前規則・大小重複検出のため共通化する）。
package datetimepresets

import (
	"errors"
	"io/fs"
	"os"
	"sort"
	"sync"

	"alslime/internal/config"
	"alslime/internal/storage/jsonstore"
	"alslime/internal/storage/paths"
	"alslime/internal/storage/presetname"
	"alslime/internal/storage/presetstore"
)

// ErrNotFound は指定名のプリセットが存在しない場合に返る。
// presetstore と同じ意味・同じ値を再利用し、handler のエラーマッピングを共通化する。
var ErrNotFound = presetstore.ErrNotFound

// ErrNameConflict は大文字小文字違いの既存名と衝突した場合に返る（presetstore と共通）。
var ErrNameConflict = presetstore.ErrNameConflict

// presetsKey は JSON 内でプリセット群を保持するトップレベルキー。現行と揃える。
const presetsKey = "presets"

// Store は datetime_presets.json 内のキー操作を担う。
type Store struct {
	resolver *paths.Resolver
	// logical は保存先ファイルの WORKSPACE_ROOT からの論理パス。
	logical string
	// mu は「読み→変更→書き戻し」の直列化用（同時保存の更新消失防止）。
	mu sync.Mutex
}

// New は Store を生成する。logical は保存先ファイルの論理パス
// （locations 経由で config.DateTimePresetsFile を渡す）。
func New(resolver *paths.Resolver, logical string) *Store {
	return &Store{resolver: resolver, logical: logical}
}

// load はファイル全体を読み、presets マップを返す。
//
// ファイル未存在・presets キー無しは空マップを返す（現行の「無ければ空一覧」挙動）。
func (s *Store) load() (map[string]any, error) {
	lexical, err := s.resolver.ResolveLexical(s.logical)
	if err != nil {
		return nil, err
	}
	if _, statErr := os.Lstat(lexical); errors.Is(statErr, fs.ErrNotExist) {
		return map[string]any{}, nil
	}

	path, err := s.resolver.ResolveExisting(s.logical)
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

	presets, ok := raw[presetsKey].(map[string]any)
	if !ok || presets == nil {
		return map[string]any{}, nil
	}
	return presets, nil
}

// save は presets マップをファイルへ書き戻す（全置換）。
//
// ファイル全体は { "presets": {...} } の形を維持する。親作成＋境界確認は
// resolver の ResolveForCreateMkdirAll に集約する。
func (s *Store) save(presets map[string]any) error {
	path, err := s.resolver.ResolveForCreateMkdirAll(s.logical, config.DirPerm)
	if err != nil {
		return err
	}
	return jsonstore.WriteJSON(path, map[string]any{presetsKey: presets})
}

// List はプリセット名一覧（キー名）をソートして返す。
//
// 危険名・予約名のキーは presetstore の List と同様に黙って除外する
// （利用者が手で不正キーを入れていても一覧へ出さない）。
func (s *Store) List() ([]string, error) {
	presets, err := s.load()
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(presets))
	for name := range presets {
		if _, verr := presetname.Validate(name); verr != nil {
			continue
		}
		names = append(names, name)
	}
	sort.Strings(names)
	return names, nil
}

// Get は name のプリセット値を返す。未存在は ErrNotFound。
func (s *Store) Get(name string) (any, error) {
	validated, err := presetname.Validate(name)
	if err != nil {
		return nil, err
	}
	presets, err := s.load()
	if err != nil {
		return nil, err
	}
	v, ok := lookupFold(presets, validated)
	if !ok {
		return nil, ErrNotFound
	}
	return v, nil
}

// Save は name のプリセット値を保存する（同名は上書き、全置換）。
//
// 保存前に大文字小文字違いの別名衝突を検出した場合は ErrNameConflict
// （presetstore.Save と同じ挙動。Windows/Linux 差吸収）。
func (s *Store) Save(name string, value any) error {
	validated, err := presetname.Validate(name)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	presets, err := s.load()
	if err != nil {
		return err
	}

	existing := make([]string, 0, len(presets))
	for k := range presets {
		existing = append(existing, k)
	}
	if _, hit := presetname.ConflictsWith(validated, existing); hit {
		return ErrNameConflict
	}

	if presets == nil {
		presets = map[string]any{}
	}
	presets[validated] = value
	return s.save(presets)
}

// Delete は name のプリセットを削除する。未存在は ErrNotFound。
func (s *Store) Delete(name string) error {
	validated, err := presetname.Validate(name)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	presets, err := s.load()
	if err != nil {
		return err
	}
	key, ok := keyFold(presets, validated)
	if !ok {
		return ErrNotFound
	}
	delete(presets, key)
	return s.save(presets)
}

// lookupFold は大文字小文字を無視して presets から値を引く。
// 完全一致を優先し、無ければ fold 一致を探す。
func lookupFold(presets map[string]any, name string) (any, bool) {
	if v, ok := presets[name]; ok {
		return v, true
	}
	for k, v := range presets {
		if presetname.EqualFold(k, name) {
			return v, true
		}
	}
	return nil, false
}

// keyFold は大文字小文字を無視して presets の実キーを返す（削除対象の特定用）。
func keyFold(presets map[string]any, name string) (string, bool) {
	if _, ok := presets[name]; ok {
		return name, true
	}
	for k := range presets {
		if presetname.EqualFold(k, name) {
			return k, true
		}
	}
	return "", false
}
