// Package cliresolve は外部 AI CLI の起動パス解決を 3 provider で共有する部品。
//
// 解決順（設定パス優先・21番§13 で確定）:
//
//  1. 設定パス（server-settings の cliPaths.{cli}）が入っていれば検証する。
//     有効ならそれを使い、無効ならフォールバックせず明確にエラーを返す
//     （設定ミスを握り潰さず気づかせる）。
//  2. 設定パスが空なら Fallbacks を順に探索する。絶対パス候補は存在・種別・
//     実行可否を検証し、コマンド名候補は LookPath で解決する。全滅なら未検出。
//
// 安全方針:
//   - 検証は「存在・通常ファイル・実行可能」を確認する。ディレクトリや
//     デバイス、実行ビットの無いファイルは弾く。
//   - 解決結果は絶対パスで確定させ、呼び出し側はそれを exec の Name に渡す。
//     相対名のまま exec へ渡して作業ディレクトリを再探索させない
//     （カレントディレクトリ汚染の回避）。
//   - 解決した絶対パスはログ・レスポンスへ出さない前提で扱う（呼び出し側責務）。
package cliresolve

import (
	"errors"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// ErrConfiguredPathInvalid は設定パスが入っているが検証に失敗した場合に返す。
// フォールバックせず、設定ミスとして呼び出し側へ伝える。
var ErrConfiguredPathInvalid = errors.New("configured CLI path is invalid")

// ErrNotFound は設定パスが空で、Fallbacks からも解決できなかった場合に返す。
var ErrNotFound = errors.New("CLI executable not found")

// Resolver は 1 つの CLI の起動パスを解決する純粋部品。
//
// LookPath / Stat / GOOS は差し替え可能にしてテストで実 CLI に依存させない。
type Resolver struct {
	// ConfiguredPath は利用者が明示指定した実行ファイルパス。空なら未設定。
	ConfiguredPath string
	// Fallbacks は設定パスが空のときの探索候補。絶対パスとコマンド名を混在可。
	// 先頭ほど優先。
	Fallbacks []string
	// LookPath は PATH 探索関数（テスト差し替え用）。nil なら exec.LookPath。
	LookPath func(string) (string, error)
	// Stat はファイル情報取得関数（テスト差し替え用）。nil なら os.Stat。
	Stat func(string) (os.FileInfo, error)
	// GOOS は実行ビット検証の OS 判定を上書きする（テスト用）。空なら runtime.GOOS。
	GOOS string
}

// Resolve は起動に使う実行ファイルパスを解決して返す。
//
// 設定パスがあればそれだけを検証し、無効ならフォールバックしない。
// 設定パスが空のときのみ Fallbacks を順に探索する。
func (r Resolver) Resolve() (string, error) {
	if configured := strings.TrimSpace(r.ConfiguredPath); configured != "" {
		if err := r.validate(configured); err != nil {
			return "", ErrConfiguredPathInvalid
		}
		return configured, nil
	}
	return r.resolveFallbacks()
}

// resolveFallbacks は Fallbacks を先頭から順に試し、最初に解決できたものを返す。
func (r Resolver) resolveFallbacks() (string, error) {
	for _, candidate := range r.Fallbacks {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			continue
		}
		if isPathLike(candidate) {
			if err := r.validate(candidate); err == nil {
				return candidate, nil
			}
			continue
		}
		// コマンド名は PATH 探索し、解決済み絶対パスを返す
		// （相対名のまま exec へ渡さず、作業ディレクトリ再探索を避ける）。
		if resolved, err := r.lookPath()(candidate); err == nil {
			return resolved, nil
		}
	}
	return "", ErrNotFound
}

// validate はパスが存在し、通常ファイルで、実行可能かを確認する。
func (r Resolver) validate(path string) error {
	info, err := r.stat()(path)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fs.ErrInvalid
	}
	if !r.isExecutable(info, path) {
		return fs.ErrPermission
	}
	return nil
}

// isExecutable は実行可否を OS 別に判定する。
//
// Windows は実行ビット概念が無いため拡張子の妥当性で判定する。
// それ以外は所有者・グループ・その他いずれかの実行ビットで判定する。
func (r Resolver) isExecutable(info os.FileInfo, path string) bool {
	if r.goos() == "windows" {
		return hasExecutableExtension(path)
	}
	return info.Mode().Perm()&0o111 != 0
}

// isPathLike はディレクトリ区切りを含むか、絶対パスかを判定する。
// 区切りを含まない素のコマンド名は PATH 探索側へ回す。
func isPathLike(candidate string) bool {
	if filepath.IsAbs(candidate) {
		return true
	}
	return strings.ContainsAny(candidate, `/\`)
}

// hasExecutableExtension は Windows の実行可能拡張子かを判定する。
func hasExecutableExtension(path string) bool {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".exe", ".cmd", ".bat", ".com":
		return true
	default:
		return false
	}
}

func (r Resolver) goos() string {
	if r.GOOS != "" {
		return r.GOOS
	}
	return runtime.GOOS
}

func (r Resolver) lookPath() func(string) (string, error) {
	if r.LookPath != nil {
		return r.LookPath
	}
	return exec.LookPath
}

func (r Resolver) stat() func(string) (os.FileInfo, error) {
	if r.Stat != nil {
		return r.Stat
	}
	return os.Stat
}
