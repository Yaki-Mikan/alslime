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
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		logging.Error("設定の読み込みに失敗しました: %v", err)
		os.Exit(1)
	}

	srv, err := app.New(cfg)
	if err != nil {
		logging.Error("サーバーの初期化に失敗しました: %v", err)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := srv.Run(ctx); err != nil {
		logging.Error("サーバーが異常終了しました: %v", err)
		os.Exit(1)
	}
}
