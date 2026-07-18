// Package app はサーバーの組み立て・起動を担う。
//
// 責務: config を受け取り、ルーティング・静的配信・フロント同梱を束ねて
// http.Server を構築する。個々の API ハンドラの実装は internal/api 配下へ分ける。
package app

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"time"

	"alslime/internal/auth"
	"alslime/internal/config"
	calendarsvc "alslime/internal/domain/calendar"
	"alslime/internal/frontend"
	"alslime/internal/logging"
	calendarstore "alslime/internal/storage/calendar"
	globalsettingsstore "alslime/internal/storage/globalsettings"
	"alslime/internal/storage/locations"
	"alslime/internal/storage/paths"
	pwasettingsstore "alslime/internal/storage/pwasettings"
)

// Server はランタイム依存をまとめた本体。
type Server struct {
	cfg      *config.Config
	resolver *paths.Resolver
	http     *http.Server
	// background はルーティング構築時に登録されたバックグラウンドタスクの起動口
	// （ジョブキューの定期掃除等）。Run で起動し、ctx キャンセルで停止する。
	background func(ctx context.Context)
}

// New は config から Server を組み立てる。
func New(cfg *config.Config) (*Server, error) {
	s := &Server{
		cfg:      cfg,
		resolver: paths.NewResolver(cfg.WorkspaceRoot),
	}

	handler, err := s.buildHandler()
	if err != nil {
		return nil, err
	}

	s.http = &http.Server{
		Addr:              announce(cfg.Addr()),
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}
	return s, nil
}

func (s *Server) checkAndUpdateCalendar(ctx context.Context) {
	locs := locations.NewResolver()
	service := calendarsvc.New(
		calendarstore.New(s.resolver, locs.MustPath(locations.CalendarFile)),
		globalsettingsstore.New(s.resolver),
		pwasettingsstore.New(s.resolver, locs.MustPath(locations.PWASettingsFile)),
	)
	if err := service.CheckAndUpdate(ctx); err != nil {
		logging.Error("calendar update failed: %v", err)
	}
}

// announce は Addr をそのまま返す（将来のバインド方針変更の差し込み口）。
func announce(addr string) string { return addr }

// buildHandler はルーティングを構築する。
//
// /api/* は API ルーターへ、それ以外は同梱フロントへフォールバックする。
func (s *Server) buildHandler() (http.Handler, error) {
	mux := http.NewServeMux()

	// API ルートの登録口。各 API パッケージはここへ集約してマウントする。
	s.background = registerAPIRoutes(mux, s.cfg, s.resolver)

	// フロント同梱（/api 以外のフォールバック）。
	frontHandler, err := frontend.Handler()
	if err != nil {
		return nil, err
	}
	mux.Handle("/", frontHandler)

	// 公開運用（Lightsail 等）では /api/* に Firebase IDトークン検証を挟む。
	// 未設定ならローカル利用として従来どおり認証なし。
	if s.cfg.FirebaseProjectID != "" {
		logging.Info("firebase auth enabled (project: %s, allowed uids: %d)", s.cfg.FirebaseProjectID, len(s.cfg.AllowedUIDs))
		return auth.New(s.cfg.FirebaseProjectID, s.cfg.AllowedUIDs).Wrap(mux), nil
	}

	return mux, nil
}

// Run はサーバーを起動し、ctx のキャンセルでグレースフルに停止する。
func (s *Server) Run(ctx context.Context) error {
	// ルーティング構築時に登録されたバックグラウンドタスク
	// （ジョブキューの定期掃除・ハウスキーピング等。ネイティブ掃除の実装が
	// core 側になったため、ハウスキーピングの合成は routes.go 側へ移した）。
	if s.background != nil {
		s.background(ctx)
	}

	// 祝日カレンダーの更新チェック。外部フェッチ（最長15秒）を伴うため、
	// listen 開始をブロックしないよう起動と並行して行う（ctx 連動）。
	go s.checkAndUpdateCalendar(ctx)

	// リッスン成功を確定させてから案内・ブラウザ起動を行うため、
	// ListenAndServe ではなく Listen と Serve に分ける（ポート衝突は即時エラー）。
	ln, err := net.Listen("tcp", s.http.Addr)
	if err != nil {
		return err
	}
	logging.Info("alslime listening on %s (workspace: %s)", s.cfg.Addr(), s.cfg.WorkspaceRoot)

	// 配布版はロガーが無効なため、画面への到達手段はここで必ず表示する。
	url := s.browserURL()
	fmt.Printf("AlSlime: %s\n", url)
	if s.shouldOpenBrowser() {
		openBrowser(url)
	}

	errCh := make(chan error, 1)
	go func() {
		if err := s.http.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return s.http.Shutdown(shutdownCtx)
	case err := <-errCh:
		return err
	}
}
