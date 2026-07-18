package clistatus

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"alslime/internal/config"
	"alslime/internal/system/cliauth"
	"alslime/internal/system/diagnostics"
)

func TestCheck_AllCLIsFound(t *testing.T) {
	t.Setenv("AGY_PATH", filepath.Join(t.TempDir(), "agy.exe"))
	checker := Checker{
		GOOS: "windows",
		LookPath: func(command string) (string, error) {
			return filepath.Join("bin", command), nil
		},
		Stat: func(string) (os.FileInfo, error) {
			return nil, nil
		},
	}

	got := checker.Check()
	if len(got.CLIs) != 3 {
		t.Fatalf("clis len=%d", len(got.CLIs))
	}
	// 発見（存在）は全 CLI で OK。
	for _, cli := range got.CLIs {
		if cli.Status != diagnostics.CheckOK || cli.MessageKey != "diagnostics.cliFound" {
			t.Fatalf("cli unexpected: %#v", cli)
		}
	}
	// 認証: Stat が常に存在を返すため Gemini/Claude は ok、
	// Antigravity は Windows=資格ストアのため unknown（存在判定しない）。
	if got.CLIs[0].AuthStatus != "ok" || got.CLIs[1].AuthStatus != "ok" {
		t.Fatalf("gemini/claude auth should be ok: %#v", got.CLIs)
	}
	if got.CLIs[2].AuthStatus != "unknown" {
		t.Fatalf("antigravity auth on windows should be unknown: %#v", got.CLIs[2])
	}
}

func TestCheck_MissingCLIIsWarning(t *testing.T) {
	t.Setenv("AGY_PATH", "")
	checker := Checker{
		HomeDir: t.TempDir(),
		GOOS:    "linux",
		LookPath: func(command string) (string, error) {
			if command == "gemini" {
				return "/usr/bin/gemini", nil
			}
			return "", errors.New("not found")
		},
	}

	got := checker.Check()
	if got.Status != diagnostics.CheckWarning {
		t.Fatalf("status unexpected: %#v", got)
	}
	if got.CLIs[0].Status != diagnostics.CheckOK {
		t.Fatalf("gemini should be ok: %#v", got.CLIs[0])
	}
	if got.CLIs[1].Status != diagnostics.CheckWarning || got.CLIs[2].Status != diagnostics.CheckWarning {
		t.Fatalf("missing cli should be warning: %#v", got.CLIs)
	}
}

func TestCheck_AntigravityWindowsDefaultPathUsesExe(t *testing.T) {
	t.Setenv("AGY_PATH", "")
	home := t.TempDir()
	checker := Checker{
		HomeDir: home,
		GOOS:    "windows",
		LookPath: func(command string) (string, error) {
			return filepath.Join("bin", command), nil
		},
		Stat: func(path string) (os.FileInfo, error) {
			// antigravity 発見の既定パスのみ存在扱い。
			// 認証チェック（Gemini/Claude のホーム認証ファイル）は存在しない扱い。
			want := filepath.Join(home, "AppData", "Local", "agy", "bin", "agy.exe")
			if path == want {
				return nil, nil
			}
			return nil, os.ErrNotExist
		},
	}

	got := checker.Check()
	agy := got.CLIs[2]
	if agy.Status != diagnostics.CheckOK || agy.Command != "agy.exe" {
		t.Fatalf("antigravity unexpected: %#v", agy)
	}
	// Windows の Antigravity 認証は資格ストアのため unknown。
	if agy.AuthStatus != "unknown" {
		t.Fatalf("antigravity auth should be unknown: %#v", agy)
	}
}

func TestCheck_未認証はloginRequiredを載せる(t *testing.T) {
	home := t.TempDir() // 認証ファイルを一切置かない
	checker := Checker{
		HomeDir: home,
		GOOS:    "linux",
		LookPath: func(command string) (string, error) {
			return filepath.Join("/usr/bin", command), nil // 発見は全部OK
		},
	}

	got := checker.Check()
	// Gemini/Claude は未認証 → missing + loginRequired。
	if got.CLIs[0].AuthStatus != "missing" || got.CLIs[0].AuthMessageKey != "cli.gemini.loginRequired" {
		t.Fatalf("gemini auth unexpected: %#v", got.CLIs[0])
	}
	if got.CLIs[1].AuthStatus != "missing" || got.CLIs[1].AuthMessageKey != "cli.claude.loginRequired" {
		t.Fatalf("claude auth unexpected: %#v", got.CLIs[1])
	}
	// Antigravity(Linux) も未認証 → missing + loginRequired。
	if got.CLIs[2].AuthStatus != "missing" || got.CLIs[2].AuthMessageKey != "cli.antigravity.loginRequired" {
		t.Fatalf("antigravity auth unexpected: %#v", got.CLIs[2])
	}
	// 発見OKでも未認証があれば集約は warning。
	if got.Status != diagnostics.CheckWarning {
		t.Fatalf("status should be warning when unauthenticated: %#v", got.Status)
	}
}

func TestCheck_認証済みならmessageKeyを載せない(t *testing.T) {
	home := t.TempDir()
	// Gemini 認証ファイルだけ置く。
	geminiAuth := filepath.Join(home, filepath.FromSlash(config.AuthHomeGeminiFile))
	if err := os.MkdirAll(filepath.Dir(geminiAuth), 0o755); err != nil {
		t.Fatalf("mkdir 失敗: %v", err)
	}
	if err := os.WriteFile(geminiAuth, []byte("x"), 0o600); err != nil {
		t.Fatalf("write 失敗: %v", err)
	}
	checker := Checker{
		HomeDir: home,
		GOOS:    "linux",
		LookPath: func(command string) (string, error) {
			return filepath.Join("/usr/bin", command), nil
		},
	}

	got := checker.Check()
	if got.CLIs[0].AuthStatus != "ok" || got.CLIs[0].AuthMessageKey != "" {
		t.Fatalf("gemini should be authenticated without message: %#v", got.CLIs[0])
	}
}

func TestCheck_WORKSPACE配置がデフォルトより優先(t *testing.T) {
	home := t.TempDir() // デフォルト未配置
	wsClaude := filepath.Join(t.TempDir(), ".credentials.json")
	if err := os.WriteFile(wsClaude, []byte("x"), 0o600); err != nil {
		t.Fatalf("write 失敗: %v", err)
	}
	checker := Checker{
		HomeDir:       home,
		GOOS:          "linux",
		WorkspaceAuth: cliauth.WorkspacePaths{Claude: wsClaude},
		LookPath: func(command string) (string, error) {
			return filepath.Join("/usr/bin", command), nil
		},
	}

	got := checker.Check()
	if got.CLIs[1].AuthStatus != "ok" {
		t.Fatalf("claude should be ok via workspace auth: %#v", got.CLIs[1])
	}
}

func TestCheck_AntigravityConfiguredPathMissing(t *testing.T) {
	configuredPath := filepath.Join(t.TempDir(), "missing-agy.exe")
	t.Setenv("AGY_PATH", configuredPath)
	checker := Checker{
		GOOS: "windows",
		LookPath: func(command string) (string, error) {
			return filepath.Join("bin", command), nil
		},
		Stat: func(string) (os.FileInfo, error) {
			return nil, os.ErrNotExist
		},
	}

	got := checker.Check()
	agy := got.CLIs[2]
	if agy.ID != "antigravity" || agy.Status != diagnostics.CheckWarning || agy.MessageKey != "diagnostics.cliConfiguredPathMissing" {
		t.Fatalf("antigravity unexpected: %#v", agy)
	}
	if agy.Command == configuredPath {
		t.Fatalf("configured absolute path leaked: %#v", agy)
	}
	if agy.Command != "missing-agy.exe" {
		t.Fatalf("command=%q want basename", agy.Command)
	}
}
