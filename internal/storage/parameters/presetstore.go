// presetstore.go は通常モード用パラメータプリセットの保存先を担う。
//
// 構造（現行 Node 版準拠）:
//   - schemaId ごとに 1 ファイル: parameter-presets-<schemaId>.json
//   - ファイル内容: { "schemaId": "<id>", "presets": [ { "name", "parameterGroups" }, ... ] }
//   - presets は配列（datetime-presets のキーマップとは別構造）。
//
// プリセット CRUD（presetstore パッケージ）とは構造が異なるため専用に実装する。
// 名前検証は presetname を流用し、大小違い同名は衝突扱いにする（交換日記 17）。
// 保存インデントは現行互換の 4 スペース。
package parameters

import (
	"errors"
	"io/fs"
	"os"
	"sync"

	"alslime/internal/config"
	"alslime/internal/storage/jsonstore"
	"alslime/internal/storage/parameters/schemaid"
	"alslime/internal/storage/paths"
	"alslime/internal/storage/presetname"
	"alslime/internal/storage/presetstore"
)

// presetIndent は preset 保存時のインデント（現行互換の 4 スペース）。
const presetIndent = "    "

// preset ファイル内のキー。
const (
	keySchemaID = "schemaId"
	keyPresets  = "presets"
	keyName     = "name"
)

// ErrNotFound / ErrNameConflict は presetstore と共通の値を再利用し、
// handler のエラーマッピングを揃える。
var (
	ErrPresetNotFound = presetstore.ErrNotFound
	ErrNameConflict   = presetstore.ErrNameConflict
)

// PresetStore は schemaId 単位のパラメータプリセットファイルを扱う。
type PresetStore struct {
	resolver *paths.Resolver
	baseDir  string // Normal_Mode ディレクトリ（論理パス）
	// mu は「読み→変更→書き戻し」の直列化用。Go の net/http は並行実行のため、
	// 同時保存で片方の更新が消えるロストアップデートを防ぐ（単一プロセス前提）。
	mu sync.Mutex
}

// NewPresetStore は PresetStore を生成する。baseDir は locations 由来の論理パス。
func NewPresetStore(resolver *paths.Resolver, baseDir string) *PresetStore {
	return &PresetStore{resolver: resolver, baseDir: baseDir}
}

// logicalFor は schemaId に対応するプリセットファイルの論理パスを返す。
func (s *PresetStore) logicalFor(sid string) (string, error) {
	fileName, err := schemaid.PresetFileName(sid)
	if err != nil {
		return "", err
	}
	return s.baseDir + "/" + fileName, nil
}

// loadFile は schemaId のプリセットファイルを読み、presets 配列を返す。
// 未存在・壊れている場合は空スライス（現行の「無ければ空」挙動）。
func (s *PresetStore) loadFile(sid string) ([]any, error) {
	logical, err := s.logicalFor(sid)
	if err != nil {
		return nil, err
	}
	lexical, err := s.resolver.ResolveLexical(logical)
	if err != nil {
		return nil, err
	}
	if _, statErr := os.Lstat(lexical); errors.Is(statErr, fs.ErrNotExist) {
		return nil, nil
	}
	path, err := s.resolver.ResolveExisting(logical)
	if err != nil {
		return nil, err
	}
	var file map[string]any
	if rerr := jsonstore.ReadJSON(path, &file); rerr != nil {
		return nil, nil // 壊れているファイルは空扱い
	}
	presets, _ := file[keyPresets].([]any)
	return presets, nil
}

// saveFile は presets 配列を { schemaId, presets } としてファイルへ書き戻す。
func (s *PresetStore) saveFile(sid string, presets []any) error {
	logical, err := s.logicalFor(sid)
	if err != nil {
		return err
	}
	path, err := s.resolver.ResolveForCreateMkdirAll(logical, config.DirPerm)
	if err != nil {
		return err
	}
	if presets == nil {
		presets = []any{}
	}
	file := map[string]any{keySchemaID: sid, keyPresets: presets}
	return jsonstore.WriteJSONIndent(path, file, presetIndent)
}

// presetNameOf は presets 配列要素から name を取り出す。
func presetNameOf(item any) (string, bool) {
	m, ok := item.(map[string]any)
	if !ok {
		return "", false
	}
	name, ok := m[keyName].(string)
	return name, ok
}

// List は schemaId のプリセット名一覧を返す。危険名は除外する。
func (s *PresetStore) List(sid string) ([]string, error) {
	presets, err := s.loadFile(sid)
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(presets))
	for _, item := range presets {
		name, ok := presetNameOf(item)
		if !ok {
			continue
		}
		if _, verr := presetname.Validate(name); verr != nil {
			continue
		}
		names = append(names, name)
	}
	return names, nil
}

// Get は schemaId 内の name に一致するプリセット要素全体（{name, parameterGroups}）を返す。
// 未存在は ErrPresetNotFound。
func (s *PresetStore) Get(sid, name string) (map[string]any, error) {
	validated, err := presetname.Validate(name)
	if err != nil {
		return nil, err
	}
	presets, err := s.loadFile(sid)
	if err != nil {
		return nil, err
	}
	for _, item := range presets {
		if n, ok := presetNameOf(item); ok && n == validated {
			if m, ok := item.(map[string]any); ok {
				return m, nil
			}
		}
	}
	return nil, ErrPresetNotFound
}

// Save は schemaId 内へ preset（{name, parameterGroups}）を保存し、正規化済み正本名を返す。
//
// 完全一致は上書き、大小違いの別名は ErrNameConflict（現行 + 交換日記 17 の強化）。
// preset には正規化済み name を入れて保存し、その正本名を返す（レビュー20 指摘1）。
func (s *PresetStore) Save(sid, name string, parameterGroups any) (string, error) {
	validated, err := presetname.Validate(name)
	if err != nil {
		return "", err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	presets, err := s.loadFile(sid)
	if err != nil {
		return "", err
	}

	// 既存名を集めて大小衝突を検出（完全一致は上書きなので衝突から除く）。
	existing := make([]string, 0, len(presets))
	for _, item := range presets {
		if n, ok := presetNameOf(item); ok {
			existing = append(existing, n)
		}
	}
	if _, hit := presetname.ConflictsWith(validated, existing); hit {
		return "", ErrNameConflict
	}

	newItem := map[string]any{keyName: validated, "parameterGroups": parameterGroups}

	// 完全一致があれば上書き、無ければ追加。
	replaced := false
	for i, item := range presets {
		if n, ok := presetNameOf(item); ok && n == validated {
			presets[i] = newItem
			replaced = true
			break
		}
	}
	if !replaced {
		presets = append(presets, newItem)
	}
	if err := s.saveFile(sid, presets); err != nil {
		return "", err
	}
	return validated, nil
}

// Delete は schemaId 内の name を削除する。未存在は ErrPresetNotFound。
func (s *PresetStore) Delete(sid, name string) error {
	validated, err := presetname.Validate(name)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	presets, err := s.loadFile(sid)
	if err != nil {
		return err
	}
	idx := -1
	for i, item := range presets {
		if n, ok := presetNameOf(item); ok && n == validated {
			idx = i
			break
		}
	}
	if idx < 0 {
		return ErrPresetNotFound
	}
	presets = append(presets[:idx], presets[idx+1:]...)
	return s.saveFile(sid, presets)
}
