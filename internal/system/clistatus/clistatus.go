// Package clistatus は外部 AI CLI の軽量診断を提供する。
package clistatus

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"alslime/internal/config"
	"alslime/internal/system/cliauth"
	"alslime/internal/system/diagnostics"
)

const (
	cliIDGemini      = "gemini"
	cliIDClaude      = "claude"
	cliIDAntigravity = "antigravity"

	cliLabelGemini      = "Gemini CLI"
	cliLabelClaude      = "Claude Code"
	cliLabelAntigravity = "Antigravity CLI"

	commandGemini = "gemini"
	commandClaude = "claude"
	commandAgy    = "agy"

	messageKeyCLIFound                 = "diagnostics.cliFound"
	messageKeyCLINotFound              = "diagnostics.cliNotFound"
	messageKeyCLIConfiguredPathMissing = "diagnostics.cliConfiguredPathMissing"

	messageKeyLoginGemini      = "cli.gemini.loginRequired"
	messageKeyLoginClaude      = "cli.claude.loginRequired"
	messageKeyLoginAntigravity = "cli.antigravity.loginRequired"

	detailsSourceKey     = "source"
	detailsSourceEnv     = config.EnvAntigravityPath
	detailsSourceDefault = "default"
)

// Status は公開用 CLI 診断レスポンス。
type Status struct {
	Status diagnostics.CheckStatus `json:"status"`
	CLIs   []CLIStatus             `json:"clis"`
}

// CLIStatus は外部 CLI 1件の状態を表す。
// Command は画面表示用の短い値に留め、絶対パスは details にも出さない。
//
// 状態は 2 段階（21番§13）:
//   - Status/MessageKey: 発見（起動解決の成否）。
//   - AuthStatus/AuthMessageKey: 認証（認証ファイル存在）。未認証なら loginRequired。
type CLIStatus struct {
	ID             string                  `json:"id"`
	Label          string                  `json:"label"`
	Status         diagnostics.CheckStatus `json:"status"`
	MessageKey     string                  `json:"messageKey"`
	Command        string                  `json:"command"`
	AuthStatus     cliauth.AuthStatus      `json:"authStatus"`
	AuthMessageKey string                  `json:"authMessageKey,omitempty"`
	Details        map[string]any          `json:"details,omitempty"`
}

// Checker は CLI の発見（存在）と認証（ファイル存在）を確認する。
// CLI は実行せず、認証ファイルの中身・トークンは読まない（存在のみ）。
type Checker struct {
	HomeDir  string
	LookPath func(string) (string, error)
	Stat     func(string) (os.FileInfo, error)
	GOOS     string
	// WorkspaceAuth は配置運用の認証ファイル絶対パス（CLI 別）。
	// routes 側が paths.Resolver 経由で解決して渡す。空なら配置運用は見ない。
	WorkspaceAuth cliauth.WorkspacePaths
}

// New は配置運用の認証ファイルパスを載せた Checker を返す。
// workspaceAuth は routes 側が paths.Resolver 経由で解決した絶対パス。
// 配置運用を使わない場合はゼロ値を渡す。
func New(workspaceAuth cliauth.WorkspacePaths) Checker {
	return Checker{WorkspaceAuth: workspaceAuth}
}

// authChecker は自身の設定を反映した cliauth.Checker を組み立てる。
func (c Checker) authChecker() cliauth.Checker {
	return cliauth.Checker{
		HomeDir:            c.HomeDir,
		WorkspaceAuthPaths: c.WorkspaceAuth,
		Stat:               c.Stat,
		GOOS:               c.GOOS,
	}
}

// Check は設定済み CLI を実行せずに確認する。
// 各 CLI に発見（存在）と認証（ファイル存在）の 2 段階を載せる。
func (c Checker) Check() Status {
	auth := c.authChecker()
	gemini := c.checkLookPath(cliIDGemini, cliLabelGemini, executableName(c.goos(), commandGemini))
	applyAuth(&gemini, auth.Gemini(), messageKeyLoginGemini)
	claude := c.checkLookPath(cliIDClaude, cliLabelClaude, executableName(c.goos(), commandClaude))
	applyAuth(&claude, auth.Claude(), messageKeyLoginClaude)
	antigravity := c.checkAntigravity()
	applyAuth(&antigravity, auth.Antigravity(), messageKeyLoginAntigravity)

	results := []CLIStatus{gemini, claude, antigravity}
	checks := make([]diagnostics.CheckResult, 0, len(results)*2)
	for _, result := range results {
		checks = append(checks, diagnostics.CheckResult{ID: result.ID, Status: result.Status})
		checks = append(checks, diagnostics.CheckResult{ID: result.ID + ".auth", Status: authCheckStatus(result.AuthStatus)})
	}
	return Status{
		Status: diagnostics.Aggregate(checks),
		CLIs:   results,
	}
}

// applyAuth は認証状態と、未認証時の loginRequired メッセージを載せる。
func applyAuth(cli *CLIStatus, status cliauth.AuthStatus, loginKey string) {
	cli.AuthStatus = status
	if status == cliauth.AuthMissing {
		cli.AuthMessageKey = loginKey
	}
}

// authCheckStatus は認証状態を集約用の CheckStatus へ写す。
// missing=warning（起動は継続でき案内対象）、unknown=unknown、ok=ok。
func authCheckStatus(status cliauth.AuthStatus) diagnostics.CheckStatus {
	switch status {
	case cliauth.AuthMissing:
		return diagnostics.CheckWarning
	case cliauth.AuthUnknown:
		return diagnostics.CheckUnknown
	default:
		return diagnostics.CheckOK
	}
}

// checkLookPath は PATH 上の CLI 存在だけを確認する。
// 実際の解決パスはホーム配下を含み得るため、レスポンスには載せない。
func (c Checker) checkLookPath(id, label, command string) CLIStatus {
	if _, err := c.lookPath()(command); err != nil {
		return CLIStatus{
			ID:         id,
			Label:      label,
			Status:     diagnostics.CheckWarning,
			MessageKey: messageKeyCLINotFound,
			Command:    command,
		}
	}
	return CLIStatus{
		ID:         id,
		Label:      label,
		Status:     diagnostics.CheckOK,
		MessageKey: messageKeyCLIFound,
		Command:    command,
	}
}

func (c Checker) checkAntigravity() CLIStatus {
	if configured := strings.TrimSpace(os.Getenv(config.EnvAntigravityPath)); configured != "" {
		if _, err := c.stat()(configured); err == nil {
			return CLIStatus{
				ID:         cliIDAntigravity,
				Label:      cliLabelAntigravity,
				Status:     diagnostics.CheckOK,
				MessageKey: messageKeyCLIFound,
				Command:    filepath.Base(configured),
				Details:    map[string]any{detailsSourceKey: detailsSourceEnv},
			}
		}
		return CLIStatus{
			ID:         cliIDAntigravity,
			Label:      cliLabelAntigravity,
			Status:     diagnostics.CheckWarning,
			MessageKey: messageKeyCLIConfiguredPathMissing,
			Command:    filepath.Base(configured),
			Details:    map[string]any{detailsSourceKey: detailsSourceEnv},
		}
	}

	if c.goos() == "windows" {
		command := antigravityExecutableName(c.goos())
		path := filepath.Join(c.homeDir(), "AppData", "Local", "agy", "bin", command)
		if _, err := c.stat()(path); err == nil {
			return CLIStatus{
				ID:         cliIDAntigravity,
				Label:      cliLabelAntigravity,
				Status:     diagnostics.CheckOK,
				MessageKey: messageKeyCLIFound,
				Command:    command,
				Details:    map[string]any{detailsSourceKey: detailsSourceDefault},
			}
		}
		return CLIStatus{
			ID:         cliIDAntigravity,
			Label:      cliLabelAntigravity,
			Status:     diagnostics.CheckWarning,
			MessageKey: messageKeyCLINotFound,
			Command:    command,
			Details:    map[string]any{detailsSourceKey: detailsSourceDefault},
		}
	}
	return c.checkLookPath(cliIDAntigravity, cliLabelAntigravity, commandAgy)
}

func executableName(goos, base string) string {
	if goos == "windows" {
		return base + ".cmd"
	}
	return base
}

func antigravityExecutableName(goos string) string {
	if goos == "windows" {
		return commandAgy + ".exe"
	}
	return commandAgy
}

func (c Checker) goos() string {
	if c.GOOS != "" {
		return c.GOOS
	}
	return runtime.GOOS
}

func (c Checker) homeDir() string {
	if c.HomeDir != "" {
		return c.HomeDir
	}
	home, _ := os.UserHomeDir()
	return home
}

func (c Checker) lookPath() func(string) (string, error) {
	if c.LookPath != nil {
		return c.LookPath
	}
	return exec.LookPath
}

func (c Checker) stat() func(string) (os.FileInfo, error) {
	if c.Stat != nil {
		return c.Stat
	}
	return os.Stat
}
