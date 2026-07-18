package cliauth

import (
	"os"
	"path/filepath"
	"testing"

	"alslime/internal/config"
)

// writeFile は空ファイルを作って絶対パスを返す（存在判定用）。
func writeFile(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir 失敗: %v", err)
	}
	if err := os.WriteFile(path, []byte("secret-does-not-matter"), 0o600); err != nil {
		t.Fatalf("ファイル作成失敗: %v", err)
	}
}

func TestGemini_デフォルトにあれば認証済み(t *testing.T) {
	home := t.TempDir()
	writeFile(t, filepath.Join(home, filepath.FromSlash(config.AuthHomeGeminiFile)))

	got := Checker{HomeDir: home, GOOS: "linux"}.Gemini()
	if got != AuthOK {
		t.Fatalf("AuthOK を期待: got=%q", got)
	}
}

func TestGemini_デフォルトに無ければ未認証(t *testing.T) {
	home := t.TempDir()

	got := Checker{HomeDir: home, GOOS: "linux"}.Gemini()
	if got != AuthMissing {
		t.Fatalf("AuthMissing を期待: got=%q", got)
	}
}

func TestClaude_デフォルトにあれば認証済み(t *testing.T) {
	home := t.TempDir()
	writeFile(t, filepath.Join(home, filepath.FromSlash(config.AuthHomeClaudeFile)))

	got := Checker{HomeDir: home, GOOS: "windows"}.Claude()
	if got != AuthOK {
		t.Fatalf("AuthOK を期待: got=%q", got)
	}
}

func TestAntigravity_Linuxファイルあれば認証済み(t *testing.T) {
	home := t.TempDir()
	writeFile(t, filepath.Join(home, filepath.FromSlash(config.AuthHomeAntigravityFile)))

	got := Checker{HomeDir: home, GOOS: "linux"}.Antigravity()
	if got != AuthOK {
		t.Fatalf("AuthOK を期待: got=%q", got)
	}
}

func TestAntigravity_Linuxファイル無ければ未認証(t *testing.T) {
	home := t.TempDir()

	got := Checker{HomeDir: home, GOOS: "linux"}.Antigravity()
	if got != AuthMissing {
		t.Fatalf("AuthMissing を期待: got=%q", got)
	}
}

func TestAntigravity_Windowsは資格ストアのためunknown(t *testing.T) {
	home := t.TempDir()
	// ホーム配下にファイルがあっても Windows は home を見ない（資格ストア想定）。
	writeFile(t, filepath.Join(home, filepath.FromSlash(config.AuthHomeAntigravityFile)))

	got := Checker{HomeDir: home, GOOS: "windows"}.Antigravity()
	if got != AuthUnknown {
		t.Fatalf("AuthUnknown を期待: got=%q", got)
	}
}

func TestAntigravity_Windowsでも配置運用ファイルあればok(t *testing.T) {
	home := t.TempDir()
	ws := filepath.Join(t.TempDir(), "antigravity-oauth-token")
	writeFile(t, ws)

	got := Checker{
		HomeDir:            home,
		GOOS:               "windows",
		WorkspaceAuthPaths: WorkspacePaths{Antigravity: ws},
	}.Antigravity()
	if got != AuthOK {
		t.Fatalf("配置運用ファイルで AuthOK を期待: got=%q", got)
	}
}

func TestGemini_WORKSPACE配置がデフォルトより優先(t *testing.T) {
	home := t.TempDir() // デフォルトは未配置
	ws := filepath.Join(t.TempDir(), "oauth_creds.json")
	writeFile(t, ws)

	got := Checker{
		HomeDir:            home,
		GOOS:               "linux",
		WorkspaceAuthPaths: WorkspacePaths{Gemini: ws},
	}.Gemini()
	if got != AuthOK {
		t.Fatalf("WORKSPACE 配置で AuthOK を期待: got=%q", got)
	}
}
