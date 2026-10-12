// Package clistatus は外部 AI CLI の軽量診断を提供する。
package clistatus

import (
	"errors"
	"os"
	"path/filepath"

	"alslime/internal/system/cliauth"
	"alslime/internal/system/cliresolve"
	"alslime/internal/system/diagnostics"
)

const (
	cliIDGemini       = "gemini"
	cliIDClaude       = "claude"
	cliIDAntigravity  = "antigravity"
	cliIDOpenAICompat = "openai_compat"

	cliLabelGemini       = "Gemini CLI"
	cliLabelClaude       = "Claude Code"
	cliLabelAntigravity  = "Antigravity CLI"
	cliLabelOpenAICompat = "API (OpenAI-compatible)"

	// labelKeyOpenAICompat は API の行の名前の文言キー。CLI の行の名前は製品名なので訳さない。
	labelKeyOpenAICompat = "cli.openaiCompat.label"

	messageKeyOpenAICompatReady         = "cli.openaiCompat.ready"
	messageKeyOpenAICompatNotConfigured = "cli.openaiCompat.notConfigured"

	messageKeyCLIFound                 = "diagnostics.cliFound"
	messageKeyCLINotFound              = "diagnostics.cliNotFound"
	messageKeyCLIConfiguredPathMissing = "diagnostics.cliConfiguredPathMissing"

	messageKeyLoginGemini      = "cli.gemini.loginRequired"
	messageKeyLoginClaude      = "cli.claude.loginRequired"
	messageKeyLoginAntigravity = "cli.antigravity.loginRequired"
)

// Status は公開用 CLI 診断レスポンス。
type Status struct {
	Status diagnostics.CheckStatus `json:"status"`
	CLIs   []CLIStatus             `json:"clis"`
}

// CLIStatus は外部 CLI 1件の状態を表す。
// Command は画面表示用の短い値に留め、絶対パスは details にも出さない。
//
// 状態は 2 段階:
//   - Status/MessageKey: 発見（起動解決の成否）。
//   - AuthStatus/AuthMessageKey: 認証（認証ファイル存在）。未認証なら loginRequired。
//     認証ファイルを持たない API の行は空（認証の段階が無い）。
//
// LabelKey があれば、画面はそのキーで表示言語の名前を出す（Label はキーが引けないときの予備）。
type CLIStatus struct {
	ID             string                  `json:"id"`
	Label          string                  `json:"label"`
	LabelKey       string                  `json:"labelKey,omitempty"`
	Status         diagnostics.CheckStatus `json:"status"`
	MessageKey     string                  `json:"messageKey"`
	Command        string                  `json:"command"`
	AuthStatus     cliauth.AuthStatus      `json:"authStatus,omitempty"`
	AuthMessageKey string                  `json:"authMessageKey,omitempty"`
	Details        map[string]any          `json:"details,omitempty"`
}

// Checker は CLI の発見（存在）と認証（ファイル存在）を確認する。
// CLI は実行せず、認証ファイルの中身・トークンは読まない（存在のみ）。
type Checker struct {
	HomeDir string
	Stat    func(string) (os.FileInfo, error)
	GOOS    string
	// ResolveGemini / ResolveClaude / ResolveAntigravity は実際の起動と同じ CLI 実行パス解決
	//（設定パス優先・既定の探索候補）。診断だけ別の探し方をすると、起動できるのに未検出と
	// 表示する・その逆が起きるため、起動側の解決をそのまま注入する。nil の CLI は未検出扱い。
	ResolveGemini      func() (string, error)
	ResolveClaude      func() (string, error)
	ResolveAntigravity func() (string, error)
	// WorkspaceAuth は配置運用の認証ファイル絶対パス（CLI 別）。
	// routes 側が paths.Resolver 経由で解決して渡す。空なら配置運用は見ない。
	WorkspaceAuth cliauth.WorkspacePaths
	// HasEnabledAPIConnection は openai_compat の有効な接続先が 1 つ以上あるか
	//（CLI 実行ファイル・認証ファイルを持たないため、これが状態の正本。
	// nil は未設定＝未構成扱い）。
	HasEnabledAPIConnection func() (bool, error)
}

// Resolvers は 3 CLI の起動パス解決をまとめて渡すための入れ物。
type Resolvers struct {
	Gemini      func() (string, error)
	Claude      func() (string, error)
	Antigravity func() (string, error)
}

// New は配置運用の認証ファイルパスと起動パス解決を載せた Checker を返す。
// workspaceAuth は routes 側が paths.Resolver 経由で解決した絶対パス。
// 配置運用を使わない場合はゼロ値を渡す。
// resolvers は起動側と同じ CLI 実行パス解決。
// hasEnabledAPIConnection は openai_compat の接続先有無の読み出し口。
func New(workspaceAuth cliauth.WorkspacePaths, resolvers Resolvers, hasEnabledAPIConnection func() (bool, error)) Checker {
	return Checker{
		WorkspaceAuth:           workspaceAuth,
		ResolveGemini:           resolvers.Gemini,
		ResolveClaude:           resolvers.Claude,
		ResolveAntigravity:      resolvers.Antigravity,
		HasEnabledAPIConnection: hasEnabledAPIConnection,
	}
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
	gemini := checkResolved(cliIDGemini, cliLabelGemini, c.ResolveGemini)
	applyAuth(&gemini, auth.Gemini(), messageKeyLoginGemini)
	claude := checkResolved(cliIDClaude, cliLabelClaude, c.ResolveClaude)
	applyAuth(&claude, auth.Claude(), messageKeyLoginClaude)
	antigravity := checkResolved(cliIDAntigravity, cliLabelAntigravity, c.ResolveAntigravity)
	applyAuth(&antigravity, auth.Antigravity(), messageKeyLoginAntigravity)
	openaiCompat := c.checkOpenAICompat()

	results := []CLIStatus{gemini, claude, antigravity, openaiCompat}
	checks := make([]diagnostics.CheckResult, 0, len(results)*2)
	for _, result := range results {
		checks = append(checks, diagnostics.CheckResult{ID: result.ID, Status: result.Status})
		if result.AuthStatus == "" {
			continue
		}
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

// checkResolved は起動側と同じ解決で CLI の発見を判定する。
// 実際の解決パスはホーム配下を含み得るため、レスポンスにはファイル名だけを載せる。
// 設定パスが無効なら、他の候補へ切り替えない起動側の規則どおり設定不備として返す。
func checkResolved(id, label string, resolve func() (string, error)) CLIStatus {
	status := CLIStatus{
		ID:         id,
		Label:      label,
		Status:     diagnostics.CheckWarning,
		MessageKey: messageKeyCLINotFound,
	}
	if resolve == nil {
		return status
	}
	path, err := resolve()
	switch {
	case err == nil:
		status.Status = diagnostics.CheckOK
		status.MessageKey = messageKeyCLIFound
		status.Command = filepath.Base(path)
	case errors.Is(err, cliresolve.ErrConfiguredPathInvalid):
		status.MessageKey = messageKeyCLIConfiguredPathMissing
	}
	return status
}

// checkOpenAICompat は openai_compat の状態を返す。
//
// CLI 実行ファイル・認証ファイルは存在しないため、「有効な接続先が 1 つ以上
// あるか」だけを状態にする。認証の段階は持たない（AuthStatus は空。
// キー未設定は送信時の ErrorType で案内する）。
func (c Checker) checkOpenAICompat() CLIStatus {
	configured := false
	if c.HasEnabledAPIConnection != nil {
		if has, err := c.HasEnabledAPIConnection(); err == nil {
			configured = has
		}
	}
	status := diagnostics.CheckWarning
	messageKey := messageKeyOpenAICompatNotConfigured
	if configured {
		status = diagnostics.CheckOK
		messageKey = messageKeyOpenAICompatReady
	}
	return CLIStatus{
		ID:         cliIDOpenAICompat,
		Label:      cliLabelOpenAICompat,
		LabelKey:   labelKeyOpenAICompat,
		Status:     status,
		MessageKey: messageKey,
	}
}
