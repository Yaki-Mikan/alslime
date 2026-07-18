// Package configeditor は設定編集 UI 用のファイル・テンプレート操作の保存先を担う。
//
// カテゴリ定義（正本）は domain/configeditor が持ち、本 storage は「解決済みカテゴリ」
// （domain.Category）を受け取ってファイル操作する（交換日記 32）。
//
// 名前検証は safename を流用し、拡張子（.md）は本パッケージで付与する。
// 境界確認は paths.Resolver を正本にし、現行の path.resolve 直書きは使わない。
package configeditor

import (
	"errors"
	"io/fs"
	"os"
	"sort"
	"strings"
	"sync"

	"alslime/internal/config"
	"alslime/internal/storage/jsonstore"
	"alslime/internal/storage/paths"
	"alslime/internal/storage/safename"
)

// Category は storage が必要とする「解決済みカテゴリ」。
//
// カテゴリ定義の正本は domain/configeditor にあるが、storage が domain を import すると
// 循環参照になるため、保存先解決に必要な値だけを受け取る storage 独自の型を切る。
// domain 側はこの型へ詰め替えて渡す（依存は domain → storage の一方向）。
type Category struct {
	Dir             string // 設定ファイル保存先（WORKSPACE_ROOT 相対）
	TemplateDirName string // テンプレート保存先のディレクトリ名
	IsCharacter     bool   // true: <Dir>/<dirName>/settings/<fileName>.md 形式
}

// 定数（べた書き散在を避ける。交換日記 32）。
const (
	// templateRoot はテンプレート保存先のルート（config.ConfigEditorTemplateRoot と同値）。
	templateRoot = "roleplay/global/templates"
	// defaultsFile はデフォルトテンプレート設定ファイル。
	defaultsFile = templateRoot + "/_defaults.json"
	// settingsDirName は character カテゴリの設定サブディレクトリ名。
	settingsDirName = "settings"
	// mdExt は設定・テンプレートファイルの拡張子。
	mdExt = ".md"
)

// FileEntry は設定ファイル一覧の 1 要素。
type FileEntry struct {
	Name    string `json:"name"`    // 表示名（拡張子なし）
	DirName string `json:"dirName"` // フォルダ名（非 character は name と同じ）
}

// Store は設定ファイル・テンプレートの読み書きを担う。
type Store struct {
	resolver *paths.Resolver
	// defaultsMu は _defaults.json の「読み→マージ→書き戻し」直列化用
	//（同時保存の更新消失防止）。
	defaultsMu sync.Mutex
}

// New は Store を生成する。
func New(resolver *paths.Resolver) *Store {
	return &Store{resolver: resolver}
}

// ---- 設定ファイル ----

// ListFiles はカテゴリ配下の設定ファイル一覧を返す。
//
// character: <Dir>/<dirName>/settings/*.md を全件フラット展開（各 md = 1 エントリ）。
// 非 character: <Dir>/*.md（dirName == name）。
// ディレクトリ未存在は空。危険名は除外。名前順ソート。
func (s *Store) ListFiles(cat Category) ([]FileEntry, error) {
	if cat.IsCharacter {
		return s.listCharacterFiles(cat)
	}
	return s.listFlatFiles(cat)
}

func (s *Store) listCharacterFiles(cat Category) ([]FileEntry, error) {
	dirAbs, ok, err := s.resolveExistingIfExists(cat.Dir)
	if err != nil || !ok {
		return []FileEntry{}, err
	}
	dirents, err := os.ReadDir(dirAbs)
	if err != nil {
		return nil, err
	}
	entries := make([]FileEntry, 0)
	for _, d := range dirents {
		if !d.IsDir() {
			continue
		}
		dirName := d.Name()
		// dirName は read/write/delete で検証されるため、一覧時点で不正なものは
		// スキップする（一覧に出たのに開けない項目を防ぐ。燈レビュー34 指摘2）。
		if _, verr := safename.Validate(dirName); verr != nil {
			continue
		}
		settingsLogical := cat.Dir + "/" + dirName + "/" + settingsDirName
		settingsAbs, sok, _ := s.resolveExistingIfExists(settingsLogical)
		if !sok {
			continue
		}
		files, rerr := os.ReadDir(settingsAbs)
		if rerr != nil {
			continue
		}
		for _, f := range files {
			if f.IsDir() || !strings.HasSuffix(f.Name(), mdExt) {
				continue
			}
			name := strings.TrimSuffix(f.Name(), mdExt)
			if _, verr := safename.Validate(name); verr != nil {
				continue
			}
			entries = append(entries, FileEntry{Name: name, DirName: dirName})
		}
	}
	sortFileEntries(entries)
	return entries, nil
}

func (s *Store) listFlatFiles(cat Category) ([]FileEntry, error) {
	dirAbs, ok, err := s.resolveExistingIfExists(cat.Dir)
	if err != nil || !ok {
		return []FileEntry{}, err
	}
	dirents, err := os.ReadDir(dirAbs)
	if err != nil {
		return nil, err
	}
	entries := make([]FileEntry, 0)
	for _, d := range dirents {
		if d.IsDir() || !strings.HasSuffix(d.Name(), mdExt) {
			continue
		}
		name := strings.TrimSuffix(d.Name(), mdExt)
		if _, verr := safename.Validate(name); verr != nil {
			continue
		}
		entries = append(entries, FileEntry{Name: name, DirName: name})
	}
	sortFileEntries(entries)
	return entries, nil
}

// fileLogical はカテゴリ・dirName・fileName から設定ファイルの論理パスを作る。
// dirName / fileName は safename で検証する。
func (s *Store) fileLogical(cat Category, dirName, fileName string) (string, error) {
	validFile, err := safename.Validate(fileName)
	if err != nil {
		return "", err
	}
	if cat.IsCharacter {
		validDir, derr := safename.Validate(dirName)
		if derr != nil {
			return "", derr
		}
		return cat.Dir + "/" + validDir + "/" + settingsDirName + "/" + validFile + mdExt, nil
	}
	return cat.Dir + "/" + validFile + mdExt, nil
}

// ReadFile は設定ファイル内容を返す。未存在は ErrNotExist（呼び出し側で 404）。
func (s *Store) ReadFile(cat Category, dirName, fileName string) (string, error) {
	logical, err := s.fileLogical(cat, dirName, fileName)
	if err != nil {
		return "", err
	}
	return s.readText(logical)
}

// FileExists は設定ファイルの存在確認。
func (s *Store) FileExists(cat Category, dirName, fileName string) (bool, error) {
	logical, err := s.fileLogical(cat, dirName, fileName)
	if err != nil {
		return false, err
	}
	return s.exists(logical)
}

// WriteFile は設定ファイルを書き込む（親作成）。
func (s *Store) WriteFile(cat Category, dirName, fileName, content string) error {
	logical, err := s.fileLogical(cat, dirName, fileName)
	if err != nil {
		return err
	}
	return s.writeText(logical, content)
}

// DeleteFile は設定ファイルを削除する。未存在は ErrNotExist。
func (s *Store) DeleteFile(cat Category, dirName, fileName string) error {
	logical, err := s.fileLogical(cat, dirName, fileName)
	if err != nil {
		return err
	}
	return s.remove(logical)
}

// ---- テンプレート ----

// templateLogical はテンプレートの論理パスを作る。name は safename で検証する。
func (s *Store) templateLogical(cat Category, name string) (string, error) {
	validName, err := safename.Validate(name)
	if err != nil {
		return "", err
	}
	return templateRoot + "/" + cat.TemplateDirName + "/" + validName + mdExt, nil
}

// ListTemplates はカテゴリのテンプレート名一覧を返す。
func (s *Store) ListTemplates(cat Category) ([]string, error) {
	logical := templateRoot + "/" + cat.TemplateDirName
	dirAbs, ok, err := s.resolveExistingIfExists(logical)
	if err != nil || !ok {
		return []string{}, err
	}
	dirents, err := os.ReadDir(dirAbs)
	if err != nil {
		return nil, err
	}
	names := make([]string, 0)
	for _, d := range dirents {
		if d.IsDir() || !strings.HasSuffix(d.Name(), mdExt) {
			continue
		}
		name := strings.TrimSuffix(d.Name(), mdExt)
		if _, verr := safename.Validate(name); verr != nil {
			continue
		}
		names = append(names, name)
	}
	sort.Strings(names)
	return names, nil
}

// ReadTemplate はテンプレート内容を返す。未存在は ErrNotExist。
func (s *Store) ReadTemplate(cat Category, name string) (string, error) {
	logical, err := s.templateLogical(cat, name)
	if err != nil {
		return "", err
	}
	return s.readText(logical)
}

// TemplateExists はテンプレートの存在確認。
func (s *Store) TemplateExists(cat Category, name string) (bool, error) {
	logical, err := s.templateLogical(cat, name)
	if err != nil {
		return false, err
	}
	return s.exists(logical)
}

// WriteTemplate はテンプレートを書き込む（親作成）。
func (s *Store) WriteTemplate(cat Category, name, content string) error {
	logical, err := s.templateLogical(cat, name)
	if err != nil {
		return err
	}
	return s.writeText(logical, content)
}

// DeleteTemplate はテンプレートを削除する。未存在は ErrNotExist。
func (s *Store) DeleteTemplate(cat Category, name string) error {
	logical, err := s.templateLogical(cat, name)
	if err != nil {
		return err
	}
	return s.remove(logical)
}

// ---- 固定ファイル（AIプロバイダ指示ファイル。設計 §8） ----
//
// rel はアプリ定数（config.ProviderInstruction*File）であり利用者入力ではないため、
// safename 検証は通さない（大文字ファイル名を許容する）。境界確認は通常どおり
// paths.Resolver を通す。

// ReadFixedFile は WORKSPACE_ROOT 相対の固定ファイルを読む。
// 未作成は空文字・exists=false（固定ファイルは未作成を正常系として扱う）。
func (s *Store) ReadFixedFile(rel string) (string, bool, error) {
	abs, ok, err := s.resolveExistingIfExists(rel)
	if err != nil || !ok {
		return "", false, err
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		return "", false, err
	}
	return string(data), true, nil
}

// FixedFileExists は固定ファイルの存在確認。
func (s *Store) FixedFileExists(rel string) (bool, error) {
	return s.exists(rel)
}

// WriteFixedFile は固定ファイルを上書き保存する。
func (s *Store) WriteFixedFile(rel, content string) error {
	return s.writeText(rel, content)
}

// ---- defaults ----

// LoadDefaults はデフォルトテンプレート設定（{categoryId: templateName}）を返す。無ければ空。
func (s *Store) LoadDefaults() (map[string]string, error) {
	abs, ok, err := s.resolveExistingIfExists(defaultsFile)
	if err != nil || !ok {
		return map[string]string{}, err
	}
	raw, rerr := jsonstore.ReadRaw(abs)
	if rerr != nil {
		// 破損は空フォールバック（現行踏襲。config-check で検出予定）。
		return map[string]string{}, nil
	}
	out := map[string]string{}
	for k, v := range raw {
		if vs, ok := v.(string); ok {
			out[k] = vs
		}
	}
	return out, nil
}

// SaveDefault は categoryId のデフォルトテンプレート名を保存する（マージ）。
func (s *Store) SaveDefault(categoryID, templateName string) error {
	s.defaultsMu.Lock()
	defer s.defaultsMu.Unlock()
	defaults, err := s.LoadDefaults()
	if err != nil {
		return err
	}
	defaults[categoryID] = templateName

	// map[string]string を map[string]any へ移して書き出す（jsonstore 互換）。
	out := make(map[string]any, len(defaults))
	for k, v := range defaults {
		out[k] = v
	}
	path, err := s.resolver.ResolveForCreateMkdirAll(defaultsFile, config.DirPerm)
	if err != nil {
		return err
	}
	return jsonstore.WriteJSON(path, out)
}

// ---- 低レベル共通 ----

// readText は logical のテキストを返す。未存在は fs.ErrNotExist。
func (s *Store) readText(logical string) (string, error) {
	abs, ok, err := s.resolveExistingIfExists(logical)
	if err != nil {
		return "", err
	}
	if !ok {
		return "", fs.ErrNotExist
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// writeText は logical へテキストを書き込む（親作成・境界確認）。
func (s *Store) writeText(logical, content string) error {
	abs, err := s.resolver.ResolveForCreateMkdirAll(logical, config.DirPerm)
	if err != nil {
		return err
	}
	return os.WriteFile(abs, []byte(content), config.FilePerm)
}

// remove は logical を削除する。未存在は fs.ErrNotExist。削除前に ResolveExisting を通す。
func (s *Store) remove(logical string) error {
	abs, ok, err := s.resolveExistingIfExists(logical)
	if err != nil {
		return err
	}
	if !ok {
		return fs.ErrNotExist
	}
	return os.Remove(abs)
}

// exists は logical が存在するかを返す。
//
// 未存在は (false, nil)。境界外（root 外 symlink 等）はエラーを返し、handler で 403 にする
// （exists:false に潰さず、エラー粒度を読み書きと揃える。燈レビュー34 指摘1）。
func (s *Store) exists(logical string) (bool, error) {
	_, ok, err := s.resolveExistingIfExists(logical)
	if err != nil {
		return false, err
	}
	return ok, nil
}

// resolveExistingIfExists は logical が存在すれば実体境界確認済み絶対パスを返す。
func (s *Store) resolveExistingIfExists(logical string) (string, bool, error) {
	lexical, err := s.resolver.ResolveLexical(logical)
	if err != nil {
		return "", false, err
	}
	if _, statErr := os.Lstat(lexical); errors.Is(statErr, fs.ErrNotExist) {
		return "", false, nil
	}
	abs, err := s.resolver.ResolveExisting(logical)
	if err != nil {
		return "", false, err
	}
	return abs, true, nil
}

// sortFileEntries は名前順で安定ソートする。
func sortFileEntries(entries []FileEntry) {
	sort.SliceStable(entries, func(i, j int) bool { return entries[i].Name < entries[j].Name })
}
