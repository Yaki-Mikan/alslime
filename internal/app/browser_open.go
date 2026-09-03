// browser_open.go はローカル利用時にアプリ画面を既定ブラウザで開く。
//
// 配布版はロガーが無効でコンソールに案内が出ないため、起動直後に画面へ
// 到達する導線をここが担う。GUI の無い環境（ヘッドレス運用等）では何もしない。
//
// Windows では exe 自身はブラウザを開かない。exe がシステムユーティリティを
// 子プロセスとして起動する挙動はセキュリティ製品の行動検知に該当しやすいため、
// 配布物に同梱する起動バッチ（start-alslime.bat）がブラウザ起動を担う。
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
// ローカル利用（Firebase 認証なし）かつ GUI のある Linux セッションに限り、
// ALSLIME_NO_BROWSER で明示的に抑止できる。Windows は常に false。
func (s *Server) shouldOpenBrowser() bool {
	if os.Getenv(config.EnvNoBrowser) != "" {
		return false
	}
	if s.cfg.FirebaseProjectID != "" {
		return false
	}
	if runtime.GOOS != "linux" {
		return false
	}
	return os.Getenv(config.EnvDisplay) != "" || os.Getenv(config.EnvWaylandDisplay) != ""
}

// openBrowser は既定ブラウザで url を開く（Linux のみ）。失敗してもサーバー起動は続行する。
func openBrowser(url string) {
	if runtime.GOOS != "linux" {
		return
	}
	cmd := exec.Command("xdg-open", url)
	if err := cmd.Start(); err != nil {
		logging.Info("browser open failed: %v", err)
		return
	}
	// 子プロセスの残骸を残さないよう回収だけ行う。
	go func() { _ = cmd.Wait() }()
}
