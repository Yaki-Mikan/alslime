package app

import (
	"alslime/internal/config"
	"alslime/internal/storage/paths"
	"alslime/internal/system/cliauth"
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
