// Package cliauth は外部 AI CLI の認証状態を「存在のみ」で判定する。
//
// 方針（21番§4/§8/§11）:
//   - アプリは認証情報を読まない。各 CLI が自分で読む。ここは「認証済みか」を
//     秘匿情報に触れず存在ベースで確認するだけ。
//   - 中身・有効期限・トークン値は一切読まない。ファイルの存在のみで判定する。
//   - 認証ファイルの中身・絶対パスはログ・レスポンスへ出さない（呼び出し側責務）。
//
// 探索順（配置運用対応・21番§0/§4）:
//  1. WORKSPACE_ROOT/roleplay/auth/{cli}/ の認証ファイル
//  2. OS デフォルトのホーム配下認証ファイル
//     どちらかに存在すれば「認証済みの可能性あり（ok）」、無ければ「未認証（missing）」。
//
// Antigravity は OS で保存形態が異なる（Linux=ファイル / Windows=OS 資格ストア）。
// Windows は資格ストアを読まないため「unknown」を返す（存在判定しない）。
package cliauth

import (
	"os"
	"path/filepath"
	"runtime"

	"alslime/internal/config"
)

// AuthStatus は認証状態。ok / missing / unknown の 3 値（21番§5）。
type AuthStatus string

const (
	// AuthOK は認証済みの可能性あり（認証ファイルが存在）。
	AuthOK AuthStatus = "ok"
	// AuthMissing は未認証（認証ファイルが存在しない）。loginRequired 案内を出す。
	AuthMissing AuthStatus = "missing"
	// AuthUnknown は判定不能（Windows の Antigravity=OS 資格ストア等）。
	AuthUnknown AuthStatus = "unknown"
)

// Checker は各 CLI の認証状態を存在判定で確認する。
//
// テスト差し替えのため Stat / GOOS / HomeDir を注入可能にする。
// WorkspaceAuthPaths は呼び出し側（paths.Resolver 経由）が解決した
// WORKSPACE_ROOT 配下の絶対パス。cliauth 自体は Resolver に依存しない。
type Checker struct {
	// HomeDir は OS ホーム。空なら os.UserHomeDir。
	HomeDir string
	// WorkspaceAuthPaths は配置運用の認証ファイル絶対パス（CLI 別）。
	// 空文字なら配置運用の探索をスキップし、OS デフォルトのみ見る。
	WorkspaceAuthPaths WorkspacePaths
	// Stat はファイル情報取得関数（テスト差し替え用）。nil なら os.Stat。
	Stat func(string) (os.FileInfo, error)
	// GOOS は OS 判定を上書きする（テスト用）。空なら runtime.GOOS。
	GOOS string
}

// WorkspacePaths は配置運用の認証ファイル絶対パス（CLI 別）。
type WorkspacePaths struct {
	Gemini      string
	Claude      string
	Antigravity string
}

// Gemini は Gemini CLI の認証状態を返す（両 OS ファイル）。
func (c Checker) Gemini() AuthStatus {
	return c.fileBased(c.WorkspaceAuthPaths.Gemini, c.homeJoin(config.AuthHomeGeminiFile))
}

// Claude は Claude Code の認証状態を返す（両 OS ファイル）。
func (c Checker) Claude() AuthStatus {
	return c.fileBased(c.WorkspaceAuthPaths.Claude, c.homeJoin(config.AuthHomeClaudeFile))
}

// Antigravity は Antigravity CLI の認証状態を返す。
//
// Windows は OS 資格ストアのため存在判定せず unknown。
// ただし配置運用ファイルが置かれていればそれで ok と判定する
// （利用者が明示配置した場合は尊重する）。
func (c Checker) Antigravity() AuthStatus {
	if ws := c.WorkspaceAuthPaths.Antigravity; ws != "" && c.exists(ws) {
		return AuthOK
	}
	if c.goos() == "windows" {
		return AuthUnknown
	}
	return c.fileBased(c.WorkspaceAuthPaths.Antigravity, c.homeJoin(config.AuthHomeAntigravityFile))
}

// fileBased は WORKSPACE_ROOT 配置 → OS デフォルトの順に存在を見る。
func (c Checker) fileBased(workspacePath, homePath string) AuthStatus {
	if workspacePath != "" && c.exists(workspacePath) {
		return AuthOK
	}
	if homePath != "" && c.exists(homePath) {
		return AuthOK
	}
	return AuthMissing
}

func (c Checker) exists(path string) bool {
	_, err := c.stat()(path)
	return err == nil
}

func (c Checker) homeJoin(rel string) string {
	home := c.HomeDir
	if home == "" {
		home, _ = os.UserHomeDir()
	}
	if home == "" {
		return ""
	}
	return filepath.Join(home, filepath.FromSlash(rel))
}

func (c Checker) goos() string {
	if c.GOOS != "" {
		return c.GOOS
	}
	return runtime.GOOS
}

func (c Checker) stat() func(string) (os.FileInfo, error) {
	if c.Stat != nil {
		return c.Stat
	}
	return os.Stat
}
