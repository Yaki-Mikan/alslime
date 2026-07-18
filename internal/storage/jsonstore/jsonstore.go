// Package jsonstore は WORKSPACE_ROOT 配下の JSON ファイルの読み書きを共通化する。
//
// 規約案で「共通化すべきもの」に挙がっている JSON 読み書き・アトミック書き込みを
// ここへ集約する。各 storage 層はこのパッケージを使い、os.WriteFile や
// json.Marshal を直書きしないこと。
//
// 書き込みは「同一ディレクトリの一時ファイルへ書く → fsync → rename」で行い、
// 書き込み途中での電源断・クラッシュによる JSON 破損を避ける。
//
// 責務の境界（重要）:
// 本パッケージは「安全確認済みの絶対パス」だけを受け取る低レベル層とする。
// 親ディレクトリの作成やパス境界確認は行わない。それらは paths.Resolver
// （ResolveForCreate / ResolveForCreateMkdirAll）や storage 層の責務とする。
// これにより、境界確認なしで親を掘って書く経路ができるのを防ぐ。
package jsonstore

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// defaultIndent は保存時の既定 JSON インデント。
// 現行 Node 版の JSON.stringify(x, null, 2) に揃える（2 スペース）。
const defaultIndent = "  "

// ReadJSON は path の JSON を v へデコードする。
//
// ファイルが存在しない場合は os.ErrNotExist を返す（呼び出し側で既定値へ分岐できる）。
// パースに失敗した場合はその旨のエラーを返す。
func ReadJSON(path string, v any) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(data, v); err != nil {
		return fmt.Errorf("JSON のパースに失敗 (%s): %w", path, err)
	}
	return nil
}

// ReadRaw は path をマップとして読み込む。
//
// パーシャルアップデート（既存をマージして保存）のように、
// スキーマを固定せず任意のキーを保持したい場合に使う。
// ファイルが無い場合は os.ErrNotExist を返す。
func ReadRaw(path string) (map[string]any, error) {
	var m map[string]any
	if err := ReadJSON(path, &m); err != nil {
		return nil, err
	}
	if m == nil {
		m = map[string]any{}
	}
	return m, nil
}

// WriteJSON は v を既定インデント（2 スペース）で整形し、path へアトミックに書き込む。
//
// 一時ファイルへ書いてから rename することで、読み手が中途半端な内容を観測しないようにする。
// 親ディレクトリの作成は行わない。呼び出し側で paths.Resolver により親作成と
// 境界確認を済ませた絶対パスを渡すこと（パッケージ doc 参照）。
func WriteJSON(path string, v any) error {
	return WriteJSONIndent(path, v, defaultIndent)
}

// WriteJSONIndent は v を指定インデントで整形し、path へアトミックに書き込む。
//
// 現行 Node 版で 4 スペース保存しているファイル（Parameters の schema / preset 等）を
// 移植する際、既存ファイルと無駄な差分を出さないために使う。
// 既定の 2 スペースでよい場合は WriteJSON を使うこと。
func WriteJSONIndent(path string, v any, indent string) error {
	data, err := json.MarshalIndent(v, "", indent)
	if err != nil {
		return fmt.Errorf("JSON の整形に失敗 (%s): %w", path, err)
	}
	return writeAtomic(path, filepath.Dir(path), data)
}

// writeAtomic は同一ディレクトリの一時ファイルへ書いてから path へ rename する。
func writeAtomic(path, dir string, data []byte) error {
	tmp, err := os.CreateTemp(dir, ".tmp-*.json")
	if err != nil {
		return fmt.Errorf("一時ファイル作成に失敗 (%s): %w", dir, err)
	}
	tmpName := tmp.Name()

	// 失敗時に一時ファイルを残さないよう後始末する。
	// 成功時は rename 済みで Remove は no-op（既に存在しない）。
	defer func() { _ = os.Remove(tmpName) }()

	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("一時ファイル書き込みに失敗 (%s): %w", tmpName, err)
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("一時ファイル sync に失敗 (%s): %w", tmpName, err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("一時ファイル close に失敗 (%s): %w", tmpName, err)
	}

	if err := os.Rename(tmpName, path); err != nil {
		return fmt.Errorf("rename に失敗 (%s -> %s): %w", tmpName, path, err)
	}
	return nil
}
