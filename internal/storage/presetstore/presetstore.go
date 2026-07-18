// Package presetstore はディレクトリ列挙型プリセットの共通 CRUD を担う。
//
// 対象（いずれも「1 プリセット = 1 JSON ファイル」をディレクトリへ並べる形式）:
//   - SSRP_Mode          roleplay/global/presets/SSRP_Mode
//   - 時刻設定グループ      roleplay/global/presets/SSRP_Mode/datetime
//   - SSRP_All           roleplay/global/presets/SSRP_Mode/SSRP_All
//   - SSRP_Parameter     roleplay/global/presets/SSRP_Mode/SSRP_Parameter
//
// これらは「保存先ディレクトリが違うだけ」で、一覧（readdir）・取得・保存・削除の
// 手順は同一。よって 1 つの Store にベースディレクトリを束ね、4 系統で使い回す。
//
// 単一ファイル型（datetime-presets。datetime_presets.json 内にキーで保持）は
// 手順が異なるため本パッケージには含めず、別 store で扱う（交換日記 08 の方針）。
//
// 責務の境界:
//   - 名前のサニタイズ・ファイル名化・重複判定は presetname へ委ねる。
//   - パス境界確認・親作成は paths.Resolver へ委ねる。
//   - JSON 読み書き・アトミック書き込みは jsonstore へ委ねる。
//   - createdAt/updatedAt のようなメタ付与は系統差なので持たない（service 層の責務）。
//
// データはスキーマを固定せず map[string]any で扱う。系統ごとの型強制・メタ付与は
// 呼び出し側（service）が行い、本 store は「検証済み名 ⇔ JSON ファイル」の橋渡しに徹する。
package presetstore

import (
	"errors"
	"io/fs"
	"os"

	"alslime/internal/config"
	"alslime/internal/storage/jsonstore"
	"alslime/internal/storage/paths"
	"alslime/internal/storage/presetname"
)

const (
	errKeyPresetNotFound     = "error.presetNotFound"
	errKeyPresetNameConflict = "error.presetNameConflict"
)

// ErrNotFound は指定名のプリセットが存在しない場合に返る。
// service 層はこれを 404 へマッピングする。
var ErrNotFound = errors.New(errKeyPresetNotFound)

// ErrNameConflict は大文字小文字違いの既存名と衝突した場合に返る。
// 例: 既存 "Test" に対して "test" を新規保存しようとした場合。
// service 層はこれを 409 もしくは 400 へマッピングする（契約は後述）。
var ErrNameConflict = errors.New(errKeyPresetNameConflict)

// Store はあるベースディレクトリ配下のディレクトリ列挙型プリセットを扱う。
//
// baseDir は WORKSPACE_ROOT からの "/" 区切り論理パス（config に定義した定数を渡す）。
type Store struct {
	resolver *paths.Resolver
	baseDir  string
}

// New は baseDir を基準とする Store を生成する。
//
// baseDir は WORKSPACE_ROOT 配下の論理パス（例: config.PresetSSRPModeDir）。
func New(resolver *paths.Resolver, baseDir string) *Store {
	return &Store{resolver: resolver, baseDir: baseDir}
}

// List はベースディレクトリ内の .json プリセット名（拡張子なし表示名）を返す。
//
// ディレクトリが存在しない場合は空スライスを返す（現行 Node 版と同じく、
// 未作成を空一覧として扱う）。読めないファイルや危険名は黙って除外せず、
// .json で表示名が検証を通るものだけを返す（移行時の安全側挙動。交換日記 08）。
func (s *Store) List() ([]string, error) {
	lexical, err := s.resolver.ResolveLexical(s.baseDir)
	if err != nil {
		return nil, err
	}
	if _, statErr := os.Lstat(lexical); errors.Is(statErr, fs.ErrNotExist) {
		return []string{}, nil
	}

	dir, err := s.resolver.ResolveExisting(s.baseDir)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}

	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		fname := e.Name()
		if !presetname.IsJSON(fname) {
			continue
		}
		display := presetname.DisplayName(fname)
		// 危険名・予約名のファイルが紛れていても表示名として返さない。
		// 利用者環境に手で置かれた不正名ファイルを一覧へ出さないための安全側除外。
		if _, verr := presetname.Validate(display); verr != nil {
			continue
		}
		names = append(names, display)
	}
	return names, nil
}

// Get は name のプリセット内容を map で返す。
//
// 名前は presetname で検証する。検証エラーはそのまま返す（service が 400 へ）。
// ファイルが無ければ ErrNotFound。
func (s *Store) Get(name string) (map[string]any, error) {
	logical, err := s.logicalPath(name)
	if err != nil {
		return nil, err
	}

	lexical, err := s.resolver.ResolveLexical(logical)
	if err != nil {
		return nil, err
	}
	if _, statErr := os.Lstat(lexical); errors.Is(statErr, fs.ErrNotExist) {
		return nil, ErrNotFound
	}

	path, err := s.resolver.ResolveExisting(logical)
	if err != nil {
		return nil, err
	}
	var data map[string]any
	if err := jsonstore.ReadJSON(path, &data); err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if data == nil {
		data = map[string]any{}
	}
	return data, nil
}

// Save は name のプリセットを data で保存する（同名は上書き、全置換）。
//
// 名前は presetname で検証する。保存前に既存一覧を見て、大文字小文字違いの
// 別名との衝突を検出した場合は ErrNameConflict を返す（Windows/Linux 差吸収。交換日記 08）。
// 完全一致の既存は上書き更新とみなし、衝突にはしない。
func (s *Store) Save(name string, data map[string]any) error {
	validated, err := presetname.Validate(name)
	if err != nil {
		return err
	}

	existing, err := s.List()
	if err != nil {
		return err
	}
	if conflict, hit := presetname.ConflictsWith(validated, existing); hit {
		// どの既存名と衝突したかはログ向け情報に留め、利用者へは汎用メッセージで返す。
		_ = conflict
		return ErrNameConflict
	}

	logical, err := s.logicalPath(validated)
	if err != nil {
		return err
	}
	path, err := s.resolver.ResolveForCreateMkdirAll(logical, config.DirPerm)
	if err != nil {
		return err
	}
	return jsonstore.WriteJSON(path, data)
}

// Delete は name のプリセットを削除する。
//
// 名前は presetname で検証する。存在しなければ ErrNotFound。
func (s *Store) Delete(name string) error {
	logical, err := s.logicalPath(name)
	if err != nil {
		return err
	}

	lexical, err := s.resolver.ResolveLexical(logical)
	if err != nil {
		return err
	}
	if _, statErr := os.Lstat(lexical); errors.Is(statErr, fs.ErrNotExist) {
		return ErrNotFound
	}

	path, err := s.resolver.ResolveExisting(logical)
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return ErrNotFound
		}
		return err
	}
	return nil
}

// Exists は name のプリセットが存在するかを返す。
//
// 名前検証に失敗した場合は false とエラーを返す。
func (s *Store) Exists(name string) (bool, error) {
	logical, err := s.logicalPath(name)
	if err != nil {
		return false, err
	}
	lexical, err := s.resolver.ResolveLexical(logical)
	if err != nil {
		return false, err
	}
	if _, statErr := os.Lstat(lexical); errors.Is(statErr, fs.ErrNotExist) {
		return false, nil
	}
	return true, nil
}

// logicalPath は name から WORKSPACE_ROOT 配下の論理パス（baseDir/<name>.json）を作る。
// presetname で検証・ファイル名化したうえで baseDir へ "/" 結合する。
func (s *Store) logicalPath(name string) (string, error) {
	fileName, err := presetname.FileName(name)
	if err != nil {
		return "", err
	}
	return s.baseDir + "/" + fileName, nil
}
