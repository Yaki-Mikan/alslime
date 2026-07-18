// Package parameters は Parameters 項目設定（schema）とパラメータプリセットの保存先を担う。
//
// schema 系の特徴（現行 Node 版 routes/parameters.ts 準拠）:
//   - ファイル名 ≠ schemaId。ファイル内容の "schemaId" を正本に線形探索する。
//   - default（固定ファイル名）と custom（parameter-schema-<id>.json）の 2 ディレクトリ。
//   - 検索順は default → custom。
//   - 保存インデントは現行互換の 4 スペース（jsonstore.WriteJSONIndent）。
package parameters

import (
	"errors"
	"io/fs"
	"os"
	"strings"

	"alslime/internal/config"
	"alslime/internal/storage/jsonstore"
	"alslime/internal/storage/parameters/schemaid"
	"alslime/internal/storage/paths"
)

// schemaIndent は schema 保存時のインデント（現行互換の 4 スペース）。
const schemaIndent = "    "

// schemaFilePrefix は custom schema ファイル名の接頭辞。一覧の絞り込みに使う。
const schemaFilePrefix = "parameter-schema-"

// SchemaStore は項目設定スキーマの保存先（default/custom 2 ディレクトリ）を扱う。
type SchemaStore struct {
	resolver   *paths.Resolver
	defaultDir string // default schema のディレクトリ（論理パス）
	customDir  string // custom schema のディレクトリ（論理パス）
}

// NewSchemaStore は SchemaStore を生成する。dir は locations 由来の論理パス。
func NewSchemaStore(resolver *paths.Resolver, defaultDir, customDir string) *SchemaStore {
	return &SchemaStore{resolver: resolver, defaultDir: defaultDir, customDir: customDir}
}

// schemaEntry は読み出した 1 件の schema とその論理パスを束ねる。
type schemaEntry struct {
	logical string
	data    map[string]any
}

// ListItem は一覧の 1 項目（id と name）。name は schemaName（LocalizedString）。
type ListItem struct {
	ID   string
	Name any
}

// List は default → custom の順に schema を集め、{id, name} 一覧を返す。
//
// default と同じ schemaId を持つ custom はスキップする（現行の重複スキップ）。
// 読めない・schemaId 不正なファイルは黙って除外する（現行の console.warn 相当はログ抑制）。
func (s *SchemaStore) List() ([]ListItem, error) {
	var items []ListItem
	seen := make(map[string]bool)

	// 1. default（固定ファイル名）。
	if e, ok, err := s.readDefault(); err != nil {
		return nil, err
	} else if ok {
		if id, name, valid := idAndName(e.data); valid {
			items = append(items, ListItem{ID: id, Name: name})
			seen[id] = true
		}
	}

	// 2. custom ディレクトリ内の parameter-schema-*.json。
	entries, err := s.readCustomDirEntries()
	if err != nil {
		return nil, err
	}
	for _, e := range entries {
		id, name, valid := idAndName(e.data)
		if !valid || seen[id] {
			continue
		}
		items = append(items, ListItem{ID: id, Name: name})
		seen[id] = true
	}
	return items, nil
}

// Find は schemaId に一致する schema を default → custom の順に探して返す。
// 見つからなければ ok=false。
func (s *SchemaStore) Find(id string) (data map[string]any, logical string, ok bool, err error) {
	if e, found, derr := s.readDefault(); derr != nil {
		return nil, "", false, derr
	} else if found {
		if did, _ := e.data["schemaId"].(string); did == id {
			return e.data, e.logical, true, nil
		}
	}
	entries, err := s.readCustomDirEntries()
	if err != nil {
		return nil, "", false, err
	}
	for _, e := range entries {
		if did, _ := e.data["schemaId"].(string); did == id {
			return e.data, e.logical, true, nil
		}
	}
	return nil, "", false, nil
}

// Exists は schemaId が default/custom のいずれかに存在するかを返す（重複チェック用）。
func (s *SchemaStore) Exists(id string) (bool, error) {
	_, _, ok, err := s.Find(id)
	return ok, err
}

// Save は schema を保存する（全置換）。
//
// schemaId == "default" は default ディレクトリの固定ファイル名へ、
// それ以外は custom ディレクトリの parameter-schema-<id>.json へ書く。
// data["schemaId"] は呼び出し側で検証済みであること。
func (s *SchemaStore) Save(id string, data map[string]any) error {
	logical, err := s.logicalForSave(id)
	if err != nil {
		return err
	}
	path, err := s.resolver.ResolveForCreateMkdirAll(logical, config.DirPerm)
	if err != nil {
		return err
	}
	return jsonstore.WriteJSONIndent(path, data, schemaIndent)
}

// SaveAt は既存の論理パスへ上書き保存する（update 用。場所を移動させない）。
func (s *SchemaStore) SaveAt(logical string, data map[string]any) error {
	path, err := s.resolver.ResolveForCreateMkdirAll(logical, config.DirPerm)
	if err != nil {
		return err
	}
	return jsonstore.WriteJSONIndent(path, data, schemaIndent)
}

// Delete は custom schema を削除する。default の削除可否は呼び出し側（service）で 403 にする。
// 見つからなければ ok=false。
func (s *SchemaStore) Delete(id string) (bool, error) {
	entries, err := s.readCustomDirEntries()
	if err != nil {
		return false, err
	}
	for _, e := range entries {
		if did, _ := e.data["schemaId"].(string); did == id {
			path, rerr := s.resolver.ResolveExisting(e.logical)
			if rerr != nil {
				return false, rerr
			}
			if rerr := os.Remove(path); rerr != nil {
				if errors.Is(rerr, fs.ErrNotExist) {
					return false, nil
				}
				return false, rerr
			}
			return true, nil
		}
	}
	return false, nil
}

// logicalForSave は保存先の論理パスを返す。default は固定ファイル名、custom は id 由来。
func (s *SchemaStore) logicalForSave(id string) (string, error) {
	if schemaid.IsDefault(id) {
		return s.defaultDir + "/" + config.ParameterSchemaDefaultFileName, nil
	}
	fileName, err := schemaid.SchemaFileName(id)
	if err != nil {
		return "", err
	}
	return s.customDir + "/" + fileName, nil
}

// readDefault は default schema（固定ファイル名）を読む。未存在は ok=false。
func (s *SchemaStore) readDefault() (schemaEntry, bool, error) {
	logical := s.defaultDir + "/" + config.ParameterSchemaDefaultFileName
	data, ok, err := s.readJSONIfExists(logical)
	if err != nil || !ok {
		return schemaEntry{}, false, err
	}
	return schemaEntry{logical: logical, data: data}, true, nil
}

// readCustomDirEntries は custom ディレクトリ内の parameter-schema-*.json を読む。
// ディレクトリ未存在は空スライス。個別ファイルの読み取り失敗は黙ってスキップする。
func (s *SchemaStore) readCustomDirEntries() ([]schemaEntry, error) {
	lexical, err := s.resolver.ResolveLexical(s.customDir)
	if err != nil {
		return nil, err
	}
	if _, statErr := os.Lstat(lexical); errors.Is(statErr, fs.ErrNotExist) {
		return nil, nil
	}
	dir, err := s.resolver.ResolveExisting(s.customDir)
	if err != nil {
		return nil, err
	}
	names, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}

	var out []schemaEntry
	for _, n := range names {
		if n.IsDir() {
			continue
		}
		fname := n.Name()
		if !strings.HasPrefix(fname, schemaFilePrefix) || !strings.HasSuffix(fname, ".json") {
			continue
		}
		logical := s.customDir + "/" + fname
		data, ok, derr := s.readJSONIfExists(logical)
		if derr != nil || !ok {
			continue // 壊れたファイルは現行同様スキップ
		}
		out = append(out, schemaEntry{logical: logical, data: data})
	}
	return out, nil
}

// readJSONIfExists は logical の JSON を読む。未存在・パース失敗は ok=false。
func (s *SchemaStore) readJSONIfExists(logical string) (map[string]any, bool, error) {
	lexical, err := s.resolver.ResolveLexical(logical)
	if err != nil {
		return nil, false, err
	}
	if _, statErr := os.Lstat(lexical); errors.Is(statErr, fs.ErrNotExist) {
		return nil, false, nil
	}
	path, err := s.resolver.ResolveExisting(logical)
	if err != nil {
		return nil, false, err
	}
	var data map[string]any
	if rerr := jsonstore.ReadJSON(path, &data); rerr != nil {
		// パース失敗は「読めないファイル」として扱い、呼び出し側でスキップ。
		return nil, false, nil
	}
	if data == nil {
		return nil, false, nil
	}
	return data, true, nil
}

// idAndName は schema データから id と name(schemaName) を取り出す。
// schemaId が非空文字列で、かつ schemaName が存在する場合のみ valid。
func idAndName(data map[string]any) (id string, name any, valid bool) {
	id, ok := data["schemaId"].(string)
	if !ok || id == "" {
		return "", nil, false
	}
	name, ok = data["schemaName"]
	if !ok {
		return "", nil, false
	}
	// schemaName が LocalizedString（ja を持つ）であることまでは List では緩く見る。
	// 厳密な検証は ValidateSchema 側に委ねる。
	return id, name, true
}
