package clistatus

import (
	"os"
	"path/filepath"
	"testing"

	"alslime/internal/config"
	"alslime/internal/system/cliauth"
	"alslime/internal/system/cliresolve"
	"alslime/internal/system/diagnostics"
)

// resolved は指定パスへ解決できた起動パス解決を返す。
func resolved(path string) func() (string, error) {
	return func() (string, error) { return path, nil }
}

// failing は指定エラーで失敗する起動パス解決を返す。
func failing(err error) func() (string, error) {
	return func() (string, error) { return "", err }
}

func TestCheck_AllCLIsFound(t *testing.T) {
	checker := Checker{
		GOOS:               "windows",
		ResolveGemini:      resolved(filepath.Join("bin", "gemini.cmd")),
		ResolveClaude:      resolved(filepath.Join("bin", "claude.exe")),
		ResolveAntigravity: resolved(filepath.Join("bin", "agy.exe")),
		Stat: func(string) (os.FileInfo, error) {
			return nil, nil
		},
	}

	got := checker.Check()
	if len(got.CLIs) != 4 {
		t.Fatalf("clis len=%d", len(got.CLIs))
	}
	// 発見（存在）は CLI 3 種で OK（openai_compat は CLI ではないため別検証）。
	for _, cli := range got.CLIs[:3] {
		if cli.Status != diagnostics.CheckOK || cli.MessageKey != "diagnostics.cliFound" {
			t.Fatalf("cli unexpected: %#v", cli)
		}
	}
	// 表示用のコマンドは解決結果のファイル名だけ（ディレクトリは出さない）。
	for i, want := range []string{"gemini.cmd", "claude.exe", "agy.exe"} {
		if got.CLIs[i].Command != want {
			t.Fatalf("command[%d]=%q want %q", i, got.CLIs[i].Command, want)
		}
	}
	// openai_compat は接続先読み出し口が未設定 → 未構成の warning。
	// 認証の段階は持たず、名前は文言キーで表示言語に合わせる。
	compat := got.CLIs[3]
	if compat.ID != "openai_compat" || compat.Status != diagnostics.CheckWarning ||
		compat.MessageKey != "cli.openaiCompat.notConfigured" || compat.AuthStatus != "" ||
		compat.LabelKey != "cli.openaiCompat.label" {
		t.Fatalf("openai_compat unexpected: %#v", compat)
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
	checker := Checker{
		HomeDir:            t.TempDir(),
		GOOS:               "linux",
		ResolveGemini:      resolved("/usr/bin/gemini"),
		ResolveClaude:      failing(cliresolve.ErrNotFound),
		ResolveAntigravity: failing(cliresolve.ErrNotFound),
	}

	got := checker.Check()
	if got.Status != diagnostics.CheckWarning {
		t.Fatalf("status unexpected: %#v", got)
	}
	if got.CLIs[0].Status != diagnostics.CheckOK {
		t.Fatalf("gemini should be ok: %#v", got.CLIs[0])
	}
	for _, cli := range got.CLIs[1:3] {
		if cli.Status != diagnostics.CheckWarning || cli.MessageKey != "diagnostics.cliNotFound" || cli.Command != "" {
			t.Fatalf("missing cli should be warning: %#v", cli)
		}
	}
}

func TestCheck_起動パス解決が無いCLIは未検出(t *testing.T) {
	got := Checker{HomeDir: t.TempDir(), GOOS: "linux"}.Check()
	for _, cli := range got.CLIs[:3] {
		if cli.Status != diagnostics.CheckWarning || cli.MessageKey != "diagnostics.cliNotFound" {
			t.Fatalf("cli without resolver should be not found: %#v", cli)
		}
	}
}

func TestCheck_設定パスが無効なら設定不備として返す(t *testing.T) {
	checker := Checker{
		GOOS:               "windows",
		ResolveGemini:      failing(cliresolve.ErrConfiguredPathInvalid),
		ResolveClaude:      failing(cliresolve.ErrConfiguredPathInvalid),
		ResolveAntigravity: failing(cliresolve.ErrConfiguredPathInvalid),
		Stat: func(string) (os.FileInfo, error) {
			return nil, os.ErrNotExist
		},
	}

	got := checker.Check()
	for _, cli := range got.CLIs[:3] {
		if cli.Status != diagnostics.CheckWarning || cli.MessageKey != "diagnostics.cliConfiguredPathMissing" {
			t.Fatalf("configured path invalid unexpected: %#v", cli)
		}
		if cli.Command != "" {
			t.Fatalf("configured path must not leak: %#v", cli)
		}
	}
}

func TestCheck_未認証はloginRequiredを載せる(t *testing.T) {
	home := t.TempDir() // 認証ファイルを一切置かない
	checker := Checker{
		HomeDir:            home,
		GOOS:               "linux",
		ResolveGemini:      resolved("/usr/bin/gemini"), // 発見は全部OK
		ResolveClaude:      resolved("/usr/bin/claude"),
		ResolveAntigravity: resolved("/usr/bin/agy"),
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
		HomeDir:       home,
		GOOS:          "linux",
		ResolveGemini: resolved("/usr/bin/gemini"),
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
		ResolveClaude: resolved("/usr/bin/claude"),
	}

	got := checker.Check()
	if got.CLIs[1].AuthStatus != "ok" {
		t.Fatalf("claude should be ok via workspace auth: %#v", got.CLIs[1])
	}
}

func TestNew_起動パス解決をそのまま使う(t *testing.T) {
	checker := New(cliauth.WorkspacePaths{}, Resolvers{
		Gemini:      resolved("/opt/gemini"),
		Claude:      resolved("/opt/claude"),
		Antigravity: resolved("/opt/agy"),
	}, nil)
	checker.HomeDir = t.TempDir()
	checker.GOOS = "linux"

	got := checker.Check()
	for i, want := range []string{"gemini", "claude", "agy"} {
		if got.CLIs[i].Status != diagnostics.CheckOK || got.CLIs[i].Command != want {
			t.Fatalf("cli[%d] unexpected: %#v", i, got.CLIs[i])
		}
	}
}
