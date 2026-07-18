package app

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"alslime/internal/config"
	serversettingssvc "alslime/internal/domain/serversettings"
	"alslime/internal/storage/paths"
	"alslime/internal/system/cliauth"
	"alslime/internal/system/cliresolve"
)

// workspaceAuthPaths は WORKSPACE_ROOT 配下の認証ファイル配置運用パスを
// 絶対パスへ解決して返す。存在確認は cliauth 側が行う（ここでは字句解決のみ）。
// 解決に失敗した項目は空文字にし、その CLI は配置運用探索をスキップする。
func workspaceAuthPaths(resolver *paths.Resolver) cliauth.WorkspacePaths {
	resolve := func(logical string) string {
		abs, err := resolver.ResolveLexical(logical)
		if err != nil {
			return ""
		}
		return abs
	}
	return cliauth.WorkspacePaths{
		Gemini:      resolve(config.AuthWorkspaceGeminiFile),
		Claude:      resolve(config.AuthWorkspaceClaudeFile),
		Antigravity: resolve(config.AuthWorkspaceAntigravityFile),
	}
}

// resolveGeminiExecutable は Gemini CLI の起動パス解決関数を返す。
//
// 設定パス（server-settings の cliPaths.gemini）を最優先し、空なら
// PATH 上の gemini / 既定フルパスへフォールバックする。設定は都度読みし、
// 起動中の設定変更を次の送信から反映する（誤設定に運用中気づいて直せる）。
func resolveGeminiExecutable(svc *serversettingssvc.Service) func() (string, error) {
	return func() (string, error) {
		return cliresolve.Resolver{
			ConfiguredPath: configuredGeminiPath(svc),
			Fallbacks:      geminiFallbacks(),
		}.Resolve()
	}
}

// resolveClaudeExecutable は Claude Code CLI の起動パス解決関数を返す。
func resolveClaudeExecutable(svc *serversettingssvc.Service) func() (string, error) {
	return func() (string, error) {
		return cliresolve.Resolver{
			ConfiguredPath: configuredClaudePath(svc),
			Fallbacks:      claudeFallbacks(),
		}.Resolve()
	}
}

// resolveAntigravityExecutable は Antigravity CLI の起動パス解決関数を返す。
//
// 優先順位は「設定パス → AGY_PATH 環境変数 → 既定（OS 別のホーム配下 / PATH）」。
// AGY_PATH はデバッグ・上書き用として残しつつ、設定パスを最優先する。
func resolveAntigravityExecutable(svc *serversettingssvc.Service) func() (string, error) {
	return func() (string, error) {
		return cliresolve.Resolver{
			ConfiguredPath: configuredAntigravityPath(svc),
			Fallbacks:      antigravityFallbacks(),
		}.Resolve()
	}
}

// cliPaths は保存済み cliPaths を読む。読み取り失敗時はゼロ値（全未設定）を返し、
// フォールバック探索に委ねる（設定不備で起動不能にはしない）。
func cliPaths(svc *serversettingssvc.Service) serversettingssvc.CLIPaths {
	if svc == nil {
		return serversettingssvc.CLIPaths{}
	}
	settings, err := svc.Get()
	if err != nil {
		return serversettingssvc.CLIPaths{}
	}
	return settings.CLIPaths
}

func configuredGeminiPath(svc *serversettingssvc.Service) string {
	return cliPaths(svc).Gemini
}

func configuredClaudePath(svc *serversettingssvc.Service) string {
	return cliPaths(svc).Claude
}

func configuredAntigravityPath(svc *serversettingssvc.Service) string {
	return cliPaths(svc).Antigravity
}

// geminiFallbacks は設定未指定時の Gemini 探索候補。
// Windows は gemini.cmd を PATH 探索、それ以外は PATH 上の gemini。
func geminiFallbacks() []string {
	if runtime.GOOS == "windows" {
		return []string{"gemini.cmd"}
	}
	return []string{"gemini"}
}

// claudeFallbacks は設定未指定時の Claude 探索候補。
func claudeFallbacks() []string {
	if runtime.GOOS == "windows" {
		return []string{"claude.cmd"}
	}
	return []string{"claude"}
}

// antigravityFallbacks は設定未指定時の Antigravity 探索候補。
//
// 先頭に AGY_PATH（あれば）を置き、次に OS 別の既定を並べる。
// Windows は既定インストール先のフルパス、それ以外は PATH 上の agy。
func antigravityFallbacks() []string {
	fallbacks := make([]string, 0, 2)
	if agyPath := strings.TrimSpace(os.Getenv(config.EnvAntigravityPath)); agyPath != "" {
		fallbacks = append(fallbacks, agyPath)
	}
	if runtime.GOOS == "windows" {
		home, _ := os.UserHomeDir()
		fallbacks = append(fallbacks, filepath.Join(home, "AppData", "Local", "agy", "bin", "agy.exe"))
		return fallbacks
	}
	fallbacks = append(fallbacks, "agy")
	return fallbacks
}
