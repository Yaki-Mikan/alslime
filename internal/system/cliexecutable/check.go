package cliexecutable

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"alslime/internal/process"
	"alslime/internal/system/cliresolve"
)

// CLI 識別子（server-settings の cliPaths のキーと同じ）。
const (
	CLIGemini      = "gemini"
	CLIClaude      = "claude"
	CLIAntigravity = "antigravity"
)

// ErrUnknownCLI は未知の CLI 識別子を渡された場合に返す。
var ErrUnknownCLI = errors.New("unknown CLI")

// Resolve は configuredPath を設定パスとみなし、実行時と同じ規則で cli の起動パスを解決する。
// configuredPath が空なら既定の探索候補を探す。
func Resolve(cli, configuredPath string) (string, error) {
	var fallbacks []string
	switch cli {
	case CLIGemini:
		fallbacks = geminiFallbacks()
	case CLIClaude:
		fallbacks = claudeFallbacks()
	case CLIAntigravity:
		fallbacks = antigravityFallbacks()
	default:
		return "", ErrUnknownCLI
	}
	return cliresolve.Resolver{ConfiguredPath: configuredPath, Fallbacks: fallbacks}.Resolve()
}

// CheckStatus は疎通確認の結果種別。
type CheckStatus string

const (
	// CheckOK は解決した CLI が --version に正常終了で応えた。
	CheckOK CheckStatus = "ok"
	// CheckNotFound は設定パスが空で、既定の探索候補からも見つからなかった。
	CheckNotFound CheckStatus = "notFound"
	// CheckConfiguredPathInvalid は指定パスに実行できるファイルが無い。
	CheckConfiguredPathInvalid CheckStatus = "configuredPathInvalid"
	// CheckFailed は起動できなかった、または異常終了した。
	CheckFailed CheckStatus = "failed"
	// CheckTimeout は制限時間内に終わらなかった。
	CheckTimeout CheckStatus = "timeout"
)

// versionCheckTimeout は --version の実行に許す時間。npm 版ランチャーの起動の遅さを見込む。
const versionCheckTimeout = 15 * time.Second

// versionMaxRunes は応答の表示に使う版数文字列の上限。
const versionMaxRunes = 200

// CheckResult は疎通確認の結果。
//
// 解決した絶対パスはホーム配下を含み得るため返さず、ファイル名だけを載せる。
type CheckResult struct {
	Status  CheckStatus `json:"status"`
	Command string      `json:"command,omitempty"`
	Version string      `json:"version,omitempty"`
}

// Check は configuredPath（保存前の入力値でよい）で cli を解決し、--version を実行して
// 起動できるかを確かめる。未知の cli だけを error で返し、確認の成否は結果の Status で返す。
func Check(ctx context.Context, cli, configuredPath string) (CheckResult, error) {
	path, err := Resolve(cli, configuredPath)
	switch {
	case errors.Is(err, ErrUnknownCLI):
		return CheckResult{}, err
	case errors.Is(err, cliresolve.ErrConfiguredPathInvalid):
		return CheckResult{Status: CheckConfiguredPathInvalid}, nil
	case err != nil:
		return CheckResult{Status: CheckNotFound}, nil
	}
	result := CheckResult{Command: filepath.Base(path)}

	ctx, cancel := context.WithTimeout(ctx, versionCheckTimeout)
	defer cancel()
	command := exec.CommandContext(ctx, path, "--version")
	// 確認のためだけにブラウザでのログインを始めさせない。
	command.Env = append(os.Environ(), "NO_BROWSER=1")
	var stdout strings.Builder
	command.Stdout = &stdout
	runErr := process.RunCommandContext(ctx, command)
	switch {
	case errors.Is(ctx.Err(), context.DeadlineExceeded):
		result.Status = CheckTimeout
	case runErr != nil:
		result.Status = CheckFailed
	default:
		result.Status = CheckOK
		result.Version = firstLine(stdout.String())
	}
	return result, nil
}

// firstLine は出力の最初の空でない行を、表示用の長さに切り詰めて返す。
func firstLine(output string) string {
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if runes := []rune(line); len(runes) > versionMaxRunes {
			return string(runes[:versionMaxRunes])
		}
		return line
	}
	return ""
}
