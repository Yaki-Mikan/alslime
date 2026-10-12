// Command app は alslime のエントリポイント。
//
// config を読み込み、HTTP サーバーを起動する。
// OS シグナル（Ctrl+C / SIGTERM）でグレースフルに停止する。
package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"

	"alslime/internal/app"
	"alslime/internal/config"
	"alslime/internal/logging"
	"alslime/internal/system/firstrun"
	"alslime/internal/system/startuptext"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		// 設定の読み込みに失敗しても、作業場所が分かればそこの表示言語で理由を出す。
		root, _ := config.ResolveWorkspaceRoot()
		exitWithStartupError(root, config.KeyStartupLoadConfigFailed, err)
	}

	if err := firstrun.Ensure(cfg.WorkspaceRoot); err != nil {
		exitWithStartupError(cfg.WorkspaceRoot, config.KeyStartupInitWorkspaceFailed, err)
	}

	srv, err := app.New(cfg)
	if err != nil {
		exitWithStartupError(cfg.WorkspaceRoot, config.KeyStartupInitServerFailed, err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := srv.Run(ctx); err != nil {
		exitWithStartupError(cfg.WorkspaceRoot, config.KeyStartupServerStopped, err)
	}
}

// exitWithStartupError は起動の失敗の理由を、利用者が選んだ表示言語でコンソールへ出して終了する。
func exitWithStartupError(root, key string, err error) {
	logging.Error("%s", startuptext.Describe(root, key, err))
	os.Exit(1)
}
