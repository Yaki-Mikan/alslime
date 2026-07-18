// browser_open.go はローカル利用時にアプリ画面を既定ブラウザで開く。
//
// 配布版はロガーが無効でコンソールに案内が出ないため、起動直後に画面へ
// 到達する導線をここが担う。GUI の無い環境（ヘッドレス運用等）では何もしない。
package app

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"

	"alslime/internal/config"
	"alslime/internal/logging"
)

// browserURL はブラウザで開くローカル URL を組み立てる。
// 全インターフェイス待受（0.0.0.0）はそのままではブラウザで開けないため、
// ループバックアドレスへ読み替える。
func (s *Server) browserURL() string {
	host := s.cfg.Host
	if host == "" || host == config.DefaultLANHost {
		host = config.DefaultHost
	}
	return fmt.Sprintf("http://%s:%d", host, s.cfg.Port)
}

// shouldOpenBrowser はブラウザ自動起動を行うべき環境かを判定する。
// ローカル利用（Firebase 認証なし）かつ GUI のある OS セッションに限り、
// ALSLIME_NO_BROWSER で明示的に抑止できる。
func (s *Server) shouldOpenBrowser() bool {
	if os.Getenv(config.EnvNoBrowser) != "" {
		return false
	}
	if s.cfg.FirebaseProjectID != "" {
		return false
	}
	switch runtime.GOOS {
	case "windows":
		return true
	case "linux":
		return os.Getenv(config.EnvDisplay) != "" || os.Getenv(config.EnvWaylandDisplay) != ""
	default:
		return false
	}
}

// openBrowser は既定ブラウザで url を開く。失敗してもサーバー起動は続行する。
func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "linux":
		cmd = exec.Command("xdg-open", url)
	default:
		return
	}
	if err := cmd.Start(); err != nil {
		logging.Info("browser open failed: %v", err)
		return
	}
	// 子プロセスの残骸を残さないよう回収だけ行う。
	go func() { _ = cmd.Wait() }()
}
