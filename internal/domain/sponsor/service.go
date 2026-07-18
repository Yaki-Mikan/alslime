// Package sponsor は支援者機能のログイン・トークン管理フロー（Phase D-3。14番 7章-3）。
//
// entitlement サーバーとの通信（OAuth 誘導・localhost コールバック受け・refresh）と、
// TokenStore への保存判断を担う。トークンの署名検証・tier 判定は core 側 gate
// （featuresimpl）の責務で、本パッケージは gate.Entitlement() の結果だけを見る。
// トークン値・URL クエリはログへ出さない（安全要件§8-1）。
package sponsor

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"alslime/internal/buildinfo"
	"alslime/internal/config"
	"alslime/internal/coreapi"
	"alslime/internal/logging"
)

// TokenStore は entitlement トークンの保存境界（storage/entitlement の必要メソッドだけ）。
type TokenStore interface {
	Current() string
	Save(token string) error
	Clear() error
}

// ClockResetter は時刻巻き戻し検出記録の強制リセット境界（storage/entitlement.Clock）。
//
// サーバー由来トークンの受領成功はサーバーが正当性を確認済みのため、記録を現在時刻へ
// 強制上書きしてよい（時計を誤って進めて起動した事故＝未来値汚染からの自動回復口）。
type ClockResetter interface {
	Reset(now int64)
}

// ログイン結果コード（フロントは sponsor.error.<code> の i18n キーで表示する）。
const (
	// LoginErrorNotASponsor はサーバー台帳に有効な支援が見つからない。
	LoginErrorNotASponsor = "not_a_sponsor"
	// LoginErrorInvalidToken は受領トークンが署名検証を通らない
	//（サーバー・本体の鍵不一致、または core 未結合ビルド）。
	LoginErrorInvalidToken = "invalid_token"
	// LoginErrorServer はサーバー側が明示エラーを返した（コールバックの error クエリ）。
	LoginErrorServer = "server_error"
)

// loginTimeout はコールバック待ち受けの上限。過ぎたらリスナーを閉じる。
const loginTimeout = 5 * time.Minute

// Status は支援者機能の現在状態（GET /api/sponsor/status の本文）。
type Status struct {
	// Entitlement は gate（署名検証）由来の支援状態。
	Entitlement coreapi.EntitlementStatus `json:"entitlement"`
	// LoginPending はブラウザでのログイン完了を待っている間 true。
	LoginPending bool `json:"loginPending"`
	// LastLoginError は直近ログイン試行の失敗コード（成功・未試行は空）。
	LastLoginError string `json:"lastLoginError,omitempty"`
}

// Service は支援者機能のログイン・トークン管理。並行アクセス安全。
type Service struct {
	store     TokenStore
	gate      coreapi.FeatureGate
	clock     ClockResetter
	serverURL string
	client    *http.Client

	// modules / verifySig はサイドカーモジュール取得の依存
	//（ConfigureModules で注入。未設定の間は InstallModule がエラーを返す）。
	modules   map[string]ModuleTarget
	moduleIDs []string
	verifySig func(payload []byte, sigB64 string) error

	mu        sync.Mutex
	login     *loginSession
	lastError string
}

// ModuleTarget は 1 モジュールの取得・配置依存。
type ModuleTarget struct {
	// InstallPath は配置先の絶対パス（<WORKSPACE_ROOT>/modules/alslime-<id>(.exe)）。
	InstallPath string
	// Active は現在プロセスで当該サイドカーが起動しているか。
	Active bool
}

// ConfigureModules はサイドカーモジュール取得・配置の依存を注入する（複数対応）。
//
// ids は一覧の表示順（module.IDs()）、targets はモジュールID→配置依存、
// verifySig は core 側の署名検証（coreapi.Core.VerifyModuleSig）。
func (s *Service) ConfigureModules(ids []string, targets map[string]ModuleTarget, verifySig func(payload []byte, sigB64 string) error) {
	s.moduleIDs = ids
	s.modules = targets
	s.verifySig = verifySig
}

// loginSession は進行中のコールバック待ち受け。
type loginSession struct {
	srv   *http.Server
	ln    net.Listener
	timer *time.Timer
}

// New は Service を生成する。
//
// サーバー URL は本体埋め込み定数を正本とし、dev ビルドに限り環境変数
// ALSLIME_ENTITLEMENT_SERVER で上書きできる（ローカル検証用。release は見ない）。
// clock は時刻巻き戻し検出記録のリセット口（nil 可）。
func New(store TokenStore, gate coreapi.FeatureGate, clock ClockResetter) *Service {
	url := config.EntitlementServerURL
	if !buildinfo.IsRelease() {
		if v := strings.TrimSpace(os.Getenv("ALSLIME_ENTITLEMENT_SERVER")); v != "" {
			url = v
		}
	}
	return &Service{
		store:     store,
		gate:      gate,
		clock:     clock,
		serverURL: strings.TrimRight(url, "/"),
		client:    &http.Client{Timeout: 30 * time.Second},
	}
}

// Status は現在の支援状態とログイン進行状態を返す。
func (s *Service) Status() Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	return Status{
		Entitlement:    s.gate.Entitlement(),
		LoginPending:   s.login != nil,
		LastLoginError: s.lastError,
	}
}

// StartLogin はコールバック待ち受けを開始し、ブラウザで開くべき認可 URL を返す。
//
// 127.0.0.1 の一時ポートで GET /oauth-done を待ち、entitlement サーバーが
// リダイレクトで渡すトークンを受け取る（14番 3章の localhost リダイレクト方式）。
// 進行中のログインがあれば閉じて新しく始める（ボタン連打・やり直しを許容）。
func (s *Service) StartLogin() (authURL string, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.closeLoginLocked()
	s.lastError = ""

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return "", fmt.Errorf("sponsor: listen callback port: %w", err)
	}
	port := ln.Addr().(*net.TCPAddr).Port

	mux := http.NewServeMux()
	mux.HandleFunc("GET /oauth-done", s.handleOAuthDone)
	srv := &http.Server{Handler: mux}
	session := &loginSession{srv: srv, ln: ln}
	session.timer = time.AfterFunc(loginTimeout, func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		if s.login == session {
			s.closeLoginLocked()
		}
	})
	s.login = session

	go func() {
		// Serve はリスナーを閉じると ErrServerClosed 等で戻る。正常系のため無視。
		_ = srv.Serve(ln)
	}()

	return fmt.Sprintf("%s/auth/github/start?redirect_port=%d", s.serverURL, port), nil
}

// handleOAuthDone は entitlement サーバーからのリダイレクトを受ける。
func (s *Service) handleOAuthDone(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	code := ""
	switch {
	case q.Get("error") != "":
		// サーバーが明示コードで返す失敗（not_a_sponsor 等）。想定外の値は丸める。
		code = q.Get("error")
		if code != LoginErrorNotASponsor {
			code = LoginErrorServer
		}
	case q.Get("token") != "":
		code = s.acceptToken(q.Get("token"))
	default:
		code = LoginErrorServer
	}

	s.mu.Lock()
	s.lastError = code
	s.mu.Unlock()

	writeLoginResultPage(w, code == "")

	// ハンドラ内から自分のサーバーを閉じるためデッドロック回避で遅延させる。
	go func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		s.closeLoginLocked()
	}()
}

// acceptToken は受領トークンを検証してから確定保存する。失敗コードを返す（成功は空）。
//
// gate の判定源は TokenStore そのものなので、いったん保存して gate（署名検証）へ問い、
// 通らなければ元のトークンへ巻き戻す（有効だった旧トークンを失わない）。
func (s *Service) acceptToken(token string) string {
	old := s.store.Current()
	if err := s.store.Save(token); err != nil {
		logging.Error("sponsor: token save failed: %v", err)
		return LoginErrorInvalidToken
	}
	st := s.gate.Entitlement()
	if st.State == coreapi.TokenStateValid || st.State == coreapi.TokenStateGrace {
		// サーバー由来トークンの受領成功＝サーバーが正当性を確認済み。
		// 巻き戻し検出記録を現在時刻へリセットし、未来値汚染事故から自動回復させる。
		if s.clock != nil {
			s.clock.Reset(time.Now().Unix())
		}
		return ""
	}
	// 検証を通らないトークンは保持しない。旧トークンがあれば書き戻す。
	if old != "" {
		if err := s.store.Save(old); err != nil {
			logging.Error("sponsor: token rollback failed: %v", err)
		}
	} else if err := s.store.Clear(); err != nil {
		logging.Error("sponsor: token clear failed: %v", err)
	}
	return LoginErrorInvalidToken
}

// Logout は保存済みトークンを破棄する。
func (s *Service) Logout() error {
	s.mu.Lock()
	s.lastError = ""
	s.mu.Unlock()
	return s.store.Clear()
}

// ErrNoToken は refresh 対象のトークンが無い。
var ErrNoToken = errors.New("sponsor: no token to refresh")

// ErrRefreshRejected はサーバーが再発行を拒否した（支援の解約等）。
// トークンは保持したまま grace 満了で自然失効させる（14番の失効設計）。
var ErrRefreshRejected = errors.New("sponsor: refresh rejected by server")

// Refresh は保存済みトークンをサーバーで再発行して置き換える。
func (s *Service) Refresh(ctx context.Context) error {
	tok := s.store.Current()
	if tok == "" {
		return ErrNoToken
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.serverURL+"/token/refresh", nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+tok)
	resp, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return ErrRefreshRejected
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("sponsor: refresh status %d", resp.StatusCode)
	}
	var body struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&body); err != nil {
		return err
	}
	if body.Token == "" {
		return errors.New("sponsor: empty token in refresh response")
	}
	if code := s.acceptToken(body.Token); code != "" {
		return errors.New("sponsor: refreshed token failed verification")
	}
	return nil
}

// autoRefreshInterval は定期確認の間隔。refreshLeadTime は exp 前の前倒し再取得幅。
const (
	autoRefreshInterval  = 6 * time.Hour
	autoRefreshLeadTime  = 48 * time.Hour
	autoRefreshFirstWait = time.Minute
)

// RunAutoRefresh はバックグラウンドの定期 refresh（12番 3.3 の「バックグラウンド再取得」）。
//
// exp が近い（lead time 内）か grace 中のときだけサーバーへ問い合わせる。
// 失敗はログに留めて次回へ持ち越す（オフラインでも本体動作へ影響させない）。
func (s *Service) RunAutoRefresh(ctx context.Context) {
	timer := time.NewTimer(autoRefreshFirstWait)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
		s.refreshIfNeeded(ctx)
		timer.Reset(autoRefreshInterval)
	}
}

// refreshIfNeeded は状態を見て必要なときだけ Refresh を呼ぶ。
func (s *Service) refreshIfNeeded(ctx context.Context) {
	st := s.gate.Entitlement()
	needs := st.State == coreapi.TokenStateGrace ||
		(st.State == coreapi.TokenStateValid &&
			time.Until(time.Unix(st.ExpiresAt, 0)) < autoRefreshLeadTime)
	if !needs {
		return
	}
	if err := s.Refresh(ctx); err != nil {
		// 解約（rejected）は想定内の状態遷移なので情報レベルに留める。
		if errors.Is(err, ErrRefreshRejected) {
			logging.Info("sponsor: token refresh rejected (sponsorship inactive)")
			return
		}
		logging.Warn("sponsor: token auto-refresh failed: %v", err)
		return
	}
	logging.Info("sponsor: entitlement token refreshed")
}

// closeLoginLocked は進行中ログインの待ち受けを閉じる（mu 保持前提）。
func (s *Service) closeLoginLocked() {
	if s.login == nil {
		return
	}
	session := s.login
	s.login = nil
	session.timer.Stop()
	// Close はリスナーも閉じる。コールバック応答は書き終わっている前提で即時 Close でよい。
	_ = session.srv.Close()
}

// writeLoginResultPage はブラウザ側へ完了ページを返す（このタブは閉じてよい旨）。
// アプリ本体の状態はフロントが /api/sponsor/status のポーリングで拾う。
func writeLoginResultPage(w http.ResponseWriter, ok bool) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	title, body := "ログイン完了 / Sign-in complete", "AlSlime へ戻ってください。このタブは閉じて構いません。<br>Return to AlSlime. You can close this tab."
	if !ok {
		title, body = "ログイン失敗 / Sign-in failed", "AlSlime に戻り、表示されたエラーを確認してください。<br>Return to AlSlime and check the error shown there."
	}
	_, _ = fmt.Fprintf(w, `<!doctype html><html><head><meta charset="utf-8"><title>%s</title></head><body style="font-family:sans-serif;text-align:center;margin-top:4rem"><h2>%s</h2><p>%s</p></body></html>`, title, title, body)
}
