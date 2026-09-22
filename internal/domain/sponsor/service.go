// Package sponsor は支援者機能のログイン・トークン管理フロー（Phase D-3。14番 7章-3）。
//
// entitlement サーバーとの通信（OAuth 誘導・認証結果ポーリング・refresh）と、
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
	"math"
	"net/http"
	"net/url"
	"os"
	"strconv"
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

// NoticeStore は開発者お知らせ文言の保存境界（storage/entitlement.NoticeStore。
// 作業予定14番）。受領文言は次に取り直すまで再起動を跨いで保持される。
type NoticeStore interface {
	Current() string
	Save(lang, text string) error
	Clear() error
}

// ログイン結果コード（フロントは sponsor.error.<code> の i18n キーで表示する）。
const (
	// LoginErrorInvalidToken は受領トークンが署名検証を通らない
	//（サーバー・本体の鍵不一致、または core 未結合ビルド）。
	LoginErrorInvalidToken = "invalid_token"
	// LoginErrorServer はサーバー側が明示エラーを返した（コールバックの error クエリ）。
	LoginErrorServer = "server_error"
	// LoginErrorExpired は認証セッションのローカル停止期限が到来した。
	LoginErrorExpired = "expired"
)

// Status は支援者機能の現在状態（GET /api/sponsor/status の本文）。
type Status struct {
	// Entitlement は gate（署名検証）由来の支援状態。
	Entitlement coreapi.EntitlementStatus `json:"entitlement"`
	// LoginPending はブラウザでのログイン完了を待っている間 true。
	LoginPending bool `json:"loginPending"`
	// LastLoginError は直近ログイン試行の失敗コード（成功・未試行は空）。
	LastLoginError string `json:"lastLoginError,omitempty"`
	// LoginedAsFree は直近ログインが GitHub 認証成功・有効な支援なし（Free 扱い）
	// だったとき true。これは失敗ではなくログイン成功の一種。
	LoginedAsFree bool `json:"loginedAsFree,omitempty"`
	// LoginExpiresAt は進行中ログインの表示用期限。停止判定はローカル deadline を使う。
	LoginExpiresAt string `json:"loginExpiresAt,omitempty"`
	// Notice は entitlement サーバーから受領した開発者お知らせ文言（未受領は空。
	// 作業予定14番）。ログイン完了時と refresh 時に取り直され、それまで保持される。
	Notice string `json:"notice,omitempty"`
}

// Service は支援者機能のログイン・トークン管理。並行アクセス安全。
type Service struct {
	store     TokenStore
	gate      coreapi.FeatureGate
	clock     ClockResetter
	serverURL string
	client    *http.Client

	// dlBaseURL は配布ファイルの配信用ドメイン（末尾スラッシュなし）。
	dlBaseURL string
	// modules / verifyManifestSig はサイドカーモジュール・パック取得の依存
	//（ConfigureModules で注入。未設定の間は取得がエラーを返す）。
	modules           map[string]ModuleTarget
	moduleIDs         []string
	verifyManifestSig func(kid string, payload []byte, sigB64 string) error
	// dlMu / lastManifestAt は直近に受理した一覧ファイルの作成時刻（巻き戻しの記録用）。
	dlMu           sync.Mutex
	lastManifestAt string
	// moduleOpMu はモジュール変更操作（install / clean）の排他。UI の抑止は
	// ブラウザ内に閉じるため、API 並行実行による配置物・レシートの破損を
	// サーバー側で防ぐ（TryLock で競合時は ErrModuleBusy。交換日記 005-3）。
	moduleOpMu sync.Mutex

	// notices / uiLang は開発者お知らせの依存（ConfigureNotice で注入。
	// 未設定の間はお知らせの取得・表示を行わない）。
	notices NoticeStore
	uiLang  func() string

	mu            sync.Mutex
	loginStartMu  sync.Mutex
	login         *loginSession
	lastError     string
	loginedAsFree bool
}

// ModuleTarget は 1 モジュールの取得・配置依存。
type ModuleTarget struct {
	// InstallPath は配置先の絶対パス（<WORKSPACE_ROOT>/modules/alslime-<id>(.exe)）。
	InstallPath string
	// ReceiptPath は配置レシートの絶対パス（module.ReceiptPath。
	// 空の場合はレシートを書かない・読まない）。
	ReceiptPath string
	// Active は現在プロセスで当該サイドカーが起動しているかを都度返す
	//（接続先解決済みかの実測。nil は常に未起動扱い）。
	Active func() bool
	// InstallCompanionPack は署名・ハッシュ検証済み付属パックの適用口。
	// 戻り値は付属パックによって利用可能になった ComfyUI workflow
	// テンプレート名。nil のモジュールは付属パックを取得しない。
	InstallCompanionPack func(zipPath string) ([]string, error)
	// WorkflowTemplateDir は companion pack が展開する workflow テンプレートの
	// ルート絶対パス（<WORKSPACE_ROOT>/roleplay/global/ComfyUI/templates）。
	// クリーン再導入がレシートのテンプレート名から削除先を組み立てるのに使う。
	// 空のモジュールはテンプレート削除を行わない（01番 7章）。
	WorkflowTemplateDir string
	// Restart は配置後にサイドカーを停止→新実体で起動し直す（更新の即時有効化）。
	// nil のモジュール（サイドカー未起動）は従来通り本体再起動で有効化する。
	Restart func() error
}

// ConfigureModules はサイドカーモジュール取得・配置の依存を注入する（複数対応）。
//
// ids は一覧の表示順（module.IDs()）、targets はモジュールID→配置依存、
// verifyManifestSig は core 側の配布ファイル一覧の署名検証（coreapi.Core.VerifyManifestSig）。
func (s *Service) ConfigureModules(ids []string, targets map[string]ModuleTarget, verifyManifestSig func(kid string, payload []byte, sigB64 string) error) {
	s.moduleIDs = ids
	s.modules = targets
	s.verifyManifestSig = verifyManifestSig
}

// ConfigureNotice は開発者お知らせの保存先と表示言語の解決口を注入する（14番）。
// uiLang は現在の UI 言語（pwa 設定 uiLanguage）を返す。空はサーバー側既定（ja）。
func (s *Service) ConfigureNotice(notices NoticeStore, uiLang func() string) {
	s.notices = notices
	s.uiLang = uiLang
}

// loginSession は進行中の認証サーバー結果ポーリング。
type loginSession struct {
	id               string
	pollSecret       string
	deadline         time.Time
	displayExpiresAt time.Time
	pollInterval     time.Duration
	cancel           context.CancelFunc
}

// LoginStart はフロントへ返すログイン開始情報。秘密値は含めない。
type LoginStart struct {
	AuthURL   string `json:"authUrl"`
	ExpiresAt string `json:"expiresAt"`
}

// New は Service を生成する。
//
// サーバー URL と配信用ドメインは本体埋め込み定数を正本とし、dev ビルドに限り環境変数
// ALSLIME_ENTITLEMENT_SERVER / ALSLIME_DL_BASE_URL で上書きできる（ローカル検証用。release は見ない）。
// clock は時刻巻き戻し検出記録のリセット口（nil 可）。
func New(store TokenStore, gate coreapi.FeatureGate, clock ClockResetter) *Service {
	url := config.EntitlementServerURL
	dlURL := config.DownloadBaseURL
	if !buildinfo.IsRelease() {
		if v := strings.TrimSpace(os.Getenv("ALSLIME_ENTITLEMENT_SERVER")); v != "" {
			url = v
		}
		if v := strings.TrimSpace(os.Getenv("ALSLIME_DL_BASE_URL")); v != "" {
			dlURL = v
		}
	}
	return &Service{
		store:     store,
		gate:      gate,
		clock:     clock,
		serverURL: strings.TrimRight(url, "/"),
		dlBaseURL: strings.TrimRight(dlURL, "/"),
		client:    &http.Client{Timeout: 30 * time.Second},
	}
}

// Status は現在の支援状態とログイン進行状態を返す。
func (s *Service) Status() Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	notice := ""
	if s.notices != nil {
		notice = s.notices.Current()
	}
	return Status{
		Entitlement:    s.gate.Entitlement(),
		LoginPending:   s.login != nil,
		LastLoginError: s.lastError,
		LoginedAsFree:  s.loginedAsFree,
		Notice:         notice,
		LoginExpiresAt: loginExpiresAt(s.login),
	}
}

func loginExpiresAt(session *loginSession) string {
	if session == nil || session.displayExpiresAt.IsZero() {
		return ""
	}
	return session.displayExpiresAt.UTC().Format(time.RFC3339)
}

// StartLogin は認証サーバー上の一回性セッションを開始し、結果ポーリングを起動する。
func (s *Service) StartLogin() (LoginStart, error) {
	s.loginStartMu.Lock()
	defer s.loginStartMu.Unlock()
	s.mu.Lock()
	s.closeLoginLocked()
	s.lastError = ""
	s.loginedAsFree = false
	s.mu.Unlock()

	req, err := http.NewRequestWithContext(context.Background(), http.MethodPost, s.serverURL+"/auth/github/session", nil)
	if err != nil {
		return LoginStart{}, err
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return LoginStart{}, err
	}
	receivedAt := time.Now()
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusCreated {
		return LoginStart{}, fmt.Errorf("sponsor: login session status %d", resp.StatusCode)
	}
	var body struct {
		AuthURL          string `json:"authUrl"`
		SessionID        string `json:"sessionId"`
		PollSecret       string `json:"pollSecret"`
		ExpiresAt        string `json:"expiresAt"`
		ExpiresInSeconds int64  `json:"expiresInSeconds"`
		PollAfterSeconds int64  `json:"pollAfterSeconds"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&body); err != nil {
		return LoginStart{}, err
	}
	displayExpiresAt, err := time.Parse(time.RFC3339, body.ExpiresAt)
	if err != nil || body.ExpiresInSeconds <= 0 || body.PollAfterSeconds <= 0 ||
		body.ExpiresInSeconds > math.MaxInt64/int64(time.Second) ||
		body.PollAfterSeconds > math.MaxInt64/int64(time.Second) ||
		body.PollAfterSeconds >= body.ExpiresInSeconds ||
		body.SessionID == "" || body.PollSecret == "" || !validGitHubAuthURL(body.AuthURL) {
		return LoginStart{}, errors.New("sponsor: invalid login session response")
	}
	ctx, cancel := context.WithCancel(context.Background())
	session := &loginSession{
		id: body.SessionID, pollSecret: body.PollSecret,
		deadline:         receivedAt.Add(time.Duration(body.ExpiresInSeconds) * time.Second),
		displayExpiresAt: displayExpiresAt, pollInterval: time.Duration(body.PollAfterSeconds) * time.Second,
		cancel: cancel,
	}
	s.mu.Lock()
	s.closeLoginLocked()
	s.login = session
	s.mu.Unlock()
	go s.pollLogin(ctx, session)
	return LoginStart{AuthURL: body.AuthURL, ExpiresAt: body.ExpiresAt}, nil
}

func validGitHubAuthURL(raw string) bool {
	parsed, err := url.Parse(raw)
	return err == nil && parsed.Scheme == "https" && parsed.Host == "github.com" && parsed.Path == "/login/oauth/authorize"
}

func (s *Service) pollLogin(ctx context.Context, session *loginSession) {
	delay := session.pollInterval
	for {
		remaining := time.Until(session.deadline)
		if remaining <= 0 {
			s.finishLogin(session, LoginErrorExpired, false, false)
			return
		}
		wait := delay
		if wait > remaining {
			wait = remaining
		}
		timer := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
		nextDelay, done := s.pollLoginOnce(ctx, session)
		if done {
			return
		}
		delay = nextDelay
	}
}

func (s *Service) pollLoginOnce(ctx context.Context, session *loginSession) (time.Duration, bool) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		s.serverURL+"/auth/github/session/"+url.PathEscape(session.id)+"/result", nil)
	if err != nil {
		return session.pollInterval, false
	}
	req.Header.Set("Authorization", "Bearer "+session.pollSecret)
	resp, err := s.client.Do(req)
	if err != nil {
		return session.pollInterval, false
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode == http.StatusTooManyRequests {
		return pollRetryDelay(session, resp.Header.Get("Retry-After")), false
	}
	if resp.StatusCode == http.StatusAccepted {
		var pending struct {
			PollAfterSeconds int64 `json:"pollAfterSeconds"`
		}
		if json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&pending) == nil && pending.PollAfterSeconds > 0 {
			return boundedPollDelay(session, pending.PollAfterSeconds), false
		}
		return boundedPollDelay(session, 0), false
	}
	if resp.StatusCode >= http.StatusInternalServerError && resp.StatusCode <= 599 {
		return pollRetryDelay(session, resp.Header.Get("Retry-After")), false
	}
	if resp.StatusCode != http.StatusOK {
		s.finishLogin(session, LoginErrorServer, false, false)
		return 0, true
	}
	var result struct {
		Status string `json:"status"`
		Token  string `json:"token"`
		Error  string `json:"error"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&result); err != nil {
		return session.pollInterval, false
	}
	switch result.Status {
	case "entitled":
		if result.Token == "" {
			return session.pollInterval, false
		}
		s.finishLoginWithToken(session, result.Token)
		return 0, true
	case "free":
		s.finishLogin(session, "", true, true)
		return 0, true
	case "failed":
		s.finishLogin(session, LoginErrorServer, false, false)
		return 0, true
	default:
		return session.pollInterval, false
	}
}

func pollRetryDelay(session *loginSession, rawRetryAfter string) time.Duration {
	seconds, err := strconv.ParseInt(strings.TrimSpace(rawRetryAfter), 10, 64)
	if err != nil || seconds <= 0 {
		return boundedPollDelay(session, 0)
	}
	return boundedPollDelay(session, seconds)
}

func boundedPollDelay(session *loginSession, seconds int64) time.Duration {
	delay := session.pollInterval
	if seconds > 0 && seconds <= math.MaxInt64/int64(time.Second) {
		delay = time.Duration(seconds) * time.Second
	}
	if session.deadline.IsZero() {
		return delay
	}
	remaining := time.Until(session.deadline)
	if remaining <= 0 {
		return 0
	}
	if delay > remaining {
		return remaining
	}
	return delay
}

func (s *Service) finishLogin(session *loginSession, code string, free, success bool) {
	s.mu.Lock()
	if s.login != session {
		s.mu.Unlock()
		return
	}
	s.lastError = code
	s.loginedAsFree = free
	s.closeLoginLocked()
	s.mu.Unlock()
	if success {
		s.fetchNotice(context.Background())
	}
}

func (s *Service) finishLoginWithToken(session *loginSession, resultToken string) {
	s.mu.Lock()
	if s.login != session {
		s.mu.Unlock()
		return
	}
	code := s.acceptToken(resultToken)
	s.lastError = code
	s.loginedAsFree = false
	s.closeLoginLocked()
	s.mu.Unlock()
	if code == "" {
		s.fetchNotice(context.Background())
	}
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

// Logout は保存済みトークンを破棄する。受領済みお知らせも一緒に破棄する
// （お知らせはログイン時に取得するものなので、ログイン状態と寿命を揃える）。
func (s *Service) Logout() error {
	s.mu.Lock()
	s.closeLoginLocked()
	s.lastError = ""
	s.loginedAsFree = false
	s.mu.Unlock()
	if s.notices != nil {
		if err := s.notices.Clear(); err != nil {
			logging.Warn("sponsor: notice clear failed: %v", err)
		}
	}
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
	// 「状態を更新」でお知らせも取り直す（14番）。手動更新ではこの後の
	// Status 返却に文言が反映されるよう同期で取得する。失敗しても refresh
	// 自体は成功として扱う（fetchNotice 内でログのみ）。
	s.fetchNotice(ctx)
	return nil
}

// fetchNotice は entitlement サーバーから開発者お知らせを取得して保存する（14番）。
//
// 認証不要の公開エンドポイントのためトークンは送らない（Free ログインでも受け取れる）。
// 空文字の受領はお知らせ取り下げとして保持中の文言を消す。失敗はログのみに留め、
// 保持中の文言はそのまま残す（ログイン・refresh の成否へ影響させない）。
func (s *Service) fetchNotice(ctx context.Context) {
	if s.notices == nil {
		return
	}
	lang := ""
	if s.uiLang != nil {
		lang = strings.TrimSpace(s.uiLang())
	}
	reqURL := s.serverURL + "/notice"
	if lang != "" {
		reqURL += "?lang=" + url.QueryEscape(lang)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		logging.Warn("sponsor: notice request build failed: %v", err)
		return
	}
	resp, err := s.client.Do(req)
	if err != nil {
		logging.Warn("sponsor: notice fetch failed: %v", err)
		return
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		logging.Warn("sponsor: notice fetch status %d", resp.StatusCode)
		return
	}
	var body struct {
		Notice string `json:"notice"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&body); err != nil {
		logging.Warn("sponsor: notice decode failed: %v", err)
		return
	}
	if err := s.notices.Save(lang, strings.TrimSpace(body.Notice)); err != nil {
		logging.Warn("sponsor: notice save failed: %v", err)
	}
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
	defer func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		s.closeLoginLocked()
	}()
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

// closeLoginLocked は進行中ログインのポーリングを閉じる（mu 保持前提）。
func (s *Service) closeLoginLocked() {
	if s.login == nil {
		return
	}
	session := s.login
	s.login = nil
	session.cancel()
}
