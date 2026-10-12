// Package cliexecutable は各 AI CLI の起動パス解決関数を組み立てる。
//
// 保存済み設定（server-settings の cliPaths）を最優先し、空なら OS 別の既定候補へ
// フォールバックする（検証と探索の規則は cliresolve）。本体のチャット実行、タグ判定・
// 容姿プロンプト作成（ComfyUI サイドカーと comfyembed の両方）、CLI 診断は、3 CLI とも
// この解決を使う。設定画面の疎通確認（Check）も、入力値を設定パスとみなして同じ解決を使う。
package cliexecutable

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"alslime/internal/config"
	serversettingssvc "alslime/internal/domain/serversettings"
)

// Gemini は Gemini CLI の起動パス解決関数を返す。
//
// 設定は都度読みし、起動中の設定変更を次の実行から反映する（誤設定に運用中気づいて直せる）。
func Gemini(svc *serversettingssvc.Service) func() (string, error) {
	return func() (string, error) {
		return Resolve(CLIGemini, cliPaths(svc).Gemini)
	}
}

// Claude は Claude Code CLI の起動パス解決関数を返す。
func Claude(svc *serversettingssvc.Service) func() (string, error) {
	return func() (string, error) {
		return Resolve(CLIClaude, cliPaths(svc).Claude)
	}
}

// Antigravity は Antigravity CLI の起動パス解決関数を返す。
//
// 優先順位は「設定パス → AGY_PATH 環境変数 → 既定（OS 別のホーム配下 / PATH）」。
// AGY_PATH はデバッグ・上書き用として残しつつ、設定パスを最優先する。
func Antigravity(svc *serversettingssvc.Service) func() (string, error) {
	return func() (string, error) {
		return Resolve(CLIAntigravity, cliPaths(svc).Antigravity)
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

// geminiFallbacks は設定未指定時の Gemini 探索候補。
// Windows は gemini.cmd を PATH 探索、それ以外は PATH 上の gemini。
func geminiFallbacks() []string {
	if runtime.GOOS == "windows" {
		return []string{"gemini.cmd"}
	}
	return []string{"gemini"}
}

// claudeFallbacks は設定未指定時の Claude 探索候補。
//
// PATH 探索を先に置き、続けてネイティブインストーラーの既定配置先（ホーム配下の
// .local/bin）を並べる。サービス起動では PATH に .local/bin が含まれないことが多いため。
// Windows は npm 版の claude.cmd に加え、ネイティブ版の claude.exe も探す。
func claudeFallbacks() []string {
	home, _ := os.UserHomeDir()
	if runtime.GOOS == "windows" {
		fallbacks := []string{"claude.cmd", "claude.exe"}
		if home != "" {
			fallbacks = append(fallbacks, filepath.Join(home, ".local", "bin", "claude.exe"))
		}
		return fallbacks
	}
	fallbacks := []string{"claude"}
	if home != "" {
		fallbacks = append(fallbacks, filepath.Join(home, ".local", "bin", "claude"))
	}
	return fallbacks
}

// antigravityFallbacks は設定未指定時の Antigravity 探索候補。
//
// 先頭に AGY_PATH（あれば）を置き、次に OS 別の既定を並べる。
// Windows は既定インストール先のフルパス、続けて PATH 上の agy.exe。
// それ以外は PATH 上の agy、続けてホーム配下の .local/bin（サービス起動では PATH に
// .local/bin が含まれないことが多いため）。
// ホームが取れない場合はホーム配下の候補を並べない（相対パスになり作業ディレクトリを
// 探索してしまうため）。
func antigravityFallbacks() []string {
	home, _ := os.UserHomeDir()
	fallbacks := make([]string, 0, 3)
	if agyPath := strings.TrimSpace(os.Getenv(config.EnvAntigravityPath)); agyPath != "" {
		fallbacks = append(fallbacks, agyPath)
	}
	if runtime.GOOS == "windows" {
		if home != "" {
			fallbacks = append(fallbacks, filepath.Join(home, "AppData", "Local", "agy", "bin", "agy.exe"))
		}
		fallbacks = append(fallbacks, "agy.exe")
		return fallbacks
	}
	fallbacks = append(fallbacks, "agy")
	if home != "" {
		fallbacks = append(fallbacks, filepath.Join(home, ".local", "bin", "agy"))
	}
	return fallbacks
}
