package sponsor

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"alslime/internal/coreapi"
)

// memStore はテスト用のインメモリ TokenStore。
type memStore struct {
	mu    sync.Mutex
	token string
}

func (m *memStore) Current() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.token
}

func (m *memStore) Save(token string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.token = token
	return nil
}

func (m *memStore) Clear() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.token = ""
	return nil
}

// storeGate はテスト用 gate。実物（featuresimpl）と同じく store の現在値を判定源にし、
// "good" 接頭辞のトークンだけを valid とみなす。
type storeGate struct{ store *memStore }

func (g storeGate) Enabled(string) bool             { return false }
func (g storeGate) PublicSnapshot() map[string]bool { return map[string]bool{} }
func (g storeGate) Entitlement() coreapi.EntitlementStatus {
	tok := g.store.Current()
	switch {
	case tok == "":
		return coreapi.EntitlementStatus{State: coreapi.TokenStateNone}
	case strings.HasPrefix(tok, "good"):
		return coreapi.EntitlementStatus{State: coreapi.TokenStateValid, Tier: "supporter",
			ExpiresAt: time.Now().Add(7 * 24 * time.Hour).Unix()}
	default:
		return coreapi.EntitlementStatus{State: coreapi.TokenStateInvalid}
	}
}

// memClock は ClockResetter のテスト用実装。
type memClock struct {
	mu    sync.Mutex
	reset int64
}

func (c *memClock) Reset(now int64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.reset = now
}

func (c *memClock) lastReset() int64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.reset
}

// newTestService は memStore と storeGate で Service を組む。
func newTestService(t *testing.T, serverURL string) (*Service, *memStore) {
	t.Helper()
	svc, store, _ := newTestServiceWithClock(t, serverURL)
	return svc, store
}

// newTestServiceWithClock はクロック観測付きで Service を組む。
func newTestServiceWithClock(t *testing.T, serverURL string) (*Service, *memStore, *memClock) {
	t.Helper()
	if serverURL != "" {
		t.Setenv("ALSLIME_ENTITLEMENT_SERVER", serverURL)
	}
	store := &memStore{}
	clock := &memClock{}
	return New(store, storeGate{store: store}, clock), store, clock
}

type loginResultFixture struct {
	status string
	token  string
	error  string
}

func newLoginServer(t *testing.T, results ...loginResultFixture) (*httptest.Server, *int) {
	t.Helper()
	var mu sync.Mutex
	created := 0
	polled := 0
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/auth/github/session":
			mu.Lock()
			created++
			id := created
			mu.Unlock()
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_, _ = fmt.Fprintf(w, `{"authUrl":"https://github.com/login/oauth/authorize?client_id=test&state=%d","sessionId":"session-%d","pollSecret":"secret-%d","expiresAt":"2099-01-01T00:00:00Z","expiresInSeconds":5,"pollAfterSeconds":1}`, id, id, id)
		case r.Method == http.MethodPost && strings.HasPrefix(r.URL.Path, "/auth/github/session/session-") && strings.HasSuffix(r.URL.Path, "/result"):
			mu.Lock()
			index := polled
			polled++
			mu.Unlock()
			if index >= len(results) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusAccepted)
				_, _ = w.Write([]byte(`{"status":"pending","pollAfterSeconds":1}`))
				return
			}
			result := results[index]
			w.Header().Set("Content-Type", "application/json")
			_, _ = fmt.Fprintf(w, `{"status":%q,"token":%q,"error":%q}`, result.status, result.token, result.error)
		default:
			http.NotFound(w, r)
		}
	}))
	return ts, &created
}

func waitLoginComplete(t *testing.T, svc *Service) Status {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for svc.Status().LoginPending {
		if time.Now().After(deadline) {
			t.Fatalf("認証結果のポーリングが完了しませんでした")
		}
		time.Sleep(10 * time.Millisecond)
	}
	return svc.Status()
}

func TestPollLogin_停止期限到来をサーバーエラーと区別する(t *testing.T) {
	svc, _ := newTestService(t, "http://127.0.0.1")
	ctx, cancel := context.WithCancel(context.Background())
	session := &loginSession{
		deadline:     time.Now().Add(-time.Second),
		pollInterval: time.Second,
		cancel:       cancel,
	}
	svc.mu.Lock()
	svc.login = session
	svc.mu.Unlock()

	svc.pollLogin(ctx, session)
	status := svc.Status()
	if status.LoginPending || status.LastLoginError != LoginErrorExpired {
		t.Fatalf("期限到来 status=%+v", status)
	}
}

func TestStartLoginとポーリング_有効トークンで保存される(t *testing.T) {
	ts, _ := newLoginServer(t, loginResultFixture{status: "entitled", token: "good-token"})
	defer ts.Close()
	svc, store, clock := newTestServiceWithClock(t, ts.URL)
	start, err := svc.StartLogin()
	if err != nil {
		t.Fatalf("StartLogin 失敗: %v", err)
	}
	if !strings.HasPrefix(start.AuthURL, "https://github.com/login/oauth/authorize?") {
		t.Fatalf("authURL の形が想定外: %s", start.AuthURL)
	}
	if start.ExpiresAt == "" {
		t.Fatalf("有効期限が返る必要があります: %+v", start)
	}
	if !svc.Status().LoginPending {
		t.Fatalf("ログイン開始後は LoginPending のはず")
	}
	waitLoginComplete(t, svc)
	if got := store.Current(); got != "good-token" {
		t.Fatalf("トークンが保存されていない: got=%q", got)
	}
	st := svc.Status()
	if st.LastLoginError != "" {
		t.Fatalf("成功時は LastLoginError 空のはず: %q", st.LastLoginError)
	}
	if clock.lastReset() == 0 {
		t.Fatalf("サーバー由来トークンの受領成功で巻き戻し記録が Reset されるべき")
	}
}

func Testポーリング_検証NGトークンは旧トークンへ巻き戻す(t *testing.T) {
	ts, _ := newLoginServer(t, loginResultFixture{status: "entitled", token: "bogus"})
	defer ts.Close()
	svc, store := newTestService(t, ts.URL)
	if err := store.Save("good-old"); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.StartLogin(); err != nil {
		t.Fatalf("StartLogin 失敗: %v", err)
	}
	waitLoginComplete(t, svc)
	if got := store.Current(); got != "good-old" {
		t.Fatalf("旧トークンへ巻き戻るはず: got=%q", got)
	}
	if got := svc.Status().LastLoginError; got != LoginErrorInvalidToken {
		t.Fatalf("LastLoginError=invalid_token のはず: got=%q", got)
	}
}

func Testポーリング_freeはFreeログイン成功扱い(t *testing.T) {
	ts, _ := newLoginServer(t, loginResultFixture{status: "free"})
	defer ts.Close()
	svc, store := newTestService(t, ts.URL)
	if _, err := svc.StartLogin(); err != nil {
		t.Fatalf("StartLogin 失敗: %v", err)
	}
	st := waitLoginComplete(t, svc)
	if st.LastLoginError != "" {
		t.Fatalf("not_a_sponsor は失敗コードを持たないはず: got=%q", st.LastLoginError)
	}
	if !st.LoginedAsFree {
		t.Fatalf("not_a_sponsor は LoginedAsFree=true のはず")
	}
	if store.Current() != "" {
		t.Fatalf("Free ログインではトークンを保存してはいけない")
	}
}

func Testポーリング_failedはサーバーエラー(t *testing.T) {
	ts, _ := newLoginServer(t, loginResultFixture{status: "failed", error: "oauth_exchange_failed"})
	defer ts.Close()
	svc, _ := newTestService(t, ts.URL)
	if _, err := svc.StartLogin(); err != nil {
		t.Fatalf("StartLogin 失敗: %v", err)
	}
	st := waitLoginComplete(t, svc)
	if st.LastLoginError != LoginErrorServer {
		t.Fatalf("想定外 error は server_error のはず: got=%q", st.LastLoginError)
	}
	if st.LoginedAsFree {
		t.Fatalf("失敗時に LoginedAsFree が立ってはいけない")
	}
}

func TestPollLoginOnce_429のRetryAfterへ追随する(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/result") {
			w.Header().Set("Retry-After", "7")
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		http.NotFound(w, r)
	}))
	defer ts.Close()
	svc, _ := newTestService(t, ts.URL)
	session := &loginSession{id: "session", pollSecret: "secret", pollInterval: time.Second}
	delay, done := svc.pollLoginOnce(context.Background(), session)
	if done || delay != 7*time.Second {
		t.Fatalf("delay=%s done=%v", delay, done)
	}
}

func TestPollLoginOnce_一過性503の次にEntitledを取得する(t *testing.T) {
	var calls atomic.Int32
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/result") {
			http.NotFound(w, r)
			return
		}
		if calls.Add(1) == 1 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"entitled","token":"good-token"}`))
	}))
	defer ts.Close()
	svc, store := newTestService(t, ts.URL)
	_, cancel := context.WithCancel(context.Background())
	session := &loginSession{
		id: "session", pollSecret: "secret", pollInterval: time.Second,
		deadline: time.Now().Add(time.Minute), cancel: cancel,
	}
	svc.mu.Lock()
	svc.login = session
	svc.mu.Unlock()

	delay, done := svc.pollLoginOnce(context.Background(), session)
	if done || delay <= 0 || !svc.Status().LoginPending {
		t.Fatalf("503後 delay=%s done=%v status=%+v", delay, done, svc.Status())
	}
	_, done = svc.pollLoginOnce(context.Background(), session)
	if !done || store.Current() != "good-token" || svc.Status().LoginPending {
		t.Fatalf("再試行後 done=%v token=%q status=%+v", done, store.Current(), svc.Status())
	}
}

func TestPollRetryDelay_巨大な秒数をDurationへOverflowさせない(t *testing.T) {
	session := &loginSession{pollInterval: 2 * time.Second}
	if got := pollRetryDelay(session, "9223372036854775807"); got != session.pollInterval {
		t.Fatalf("delay=%s want=%s", got, session.pollInterval)
	}
}

func TestPollLoginOnce_4xxは再試行せず失敗を確定する(t *testing.T) {
	for _, status := range []int{http.StatusBadRequest, http.StatusNotFound, http.StatusUnauthorized, http.StatusForbidden} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(status)
			}))
			defer ts.Close()
			svc, _ := newTestService(t, ts.URL)
			_, cancel := context.WithCancel(context.Background())
			session := &loginSession{id: "session", pollSecret: "secret", pollInterval: time.Second, cancel: cancel}
			svc.mu.Lock()
			svc.login = session
			svc.mu.Unlock()
			_, done := svc.pollLoginOnce(context.Background(), session)
			statusAfter := svc.Status()
			if !done || statusAfter.LoginPending || statusAfter.LastLoginError != LoginErrorServer {
				t.Fatalf("done=%v status=%+v", done, statusAfter)
			}
		})
	}
}

func TestStartLogin_応答の相対期限と間隔が矛盾すれば拒否する(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"authUrl":"https://github.com/login/oauth/authorize?client_id=test","sessionId":"session","pollSecret":"secret","expiresAt":"2099-01-01T00:00:00Z","expiresInSeconds":5,"pollAfterSeconds":5}`))
	}))
	defer ts.Close()
	svc, _ := newTestService(t, ts.URL)
	if _, err := svc.StartLogin(); err == nil {
		t.Fatal("期限以上のポーリング間隔を受理しました")
	}
	if svc.Status().LoginPending {
		t.Fatal("不正応答でポーリングを開始しました")
	}
}

func TestRefresh_成功で新トークンへ置き換わる(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/token/refresh" {
			http.NotFound(w, r)
			return
		}
		if r.Header.Get("Authorization") != "Bearer good-old" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"token":"good-new"}`))
	}))
	defer ts.Close()

	svc, store := newTestService(t, ts.URL)
	if err := store.Save("good-old"); err != nil {
		t.Fatal(err)
	}
	if err := svc.Refresh(context.Background()); err != nil {
		t.Fatalf("Refresh 失敗: %v", err)
	}
	if got := store.Current(); got != "good-new" {
		t.Fatalf("新トークンへ置き換わるはず: got=%q", got)
	}
}

func TestRefresh_403は拒否エラーでトークン保持(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	}))
	defer ts.Close()

	svc, store := newTestService(t, ts.URL)
	if err := store.Save("good-old"); err != nil {
		t.Fatal(err)
	}
	err := svc.Refresh(context.Background())
	if err != ErrRefreshRejected {
		t.Fatalf("ErrRefreshRejected のはず: got=%v", err)
	}
	if got := store.Current(); got != "good-old" {
		t.Fatalf("拒否時はトークン保持（grace 自然失効）のはず: got=%q", got)
	}
}

func TestRefresh_トークン無しはErrNoToken(t *testing.T) {
	svc, _ := newTestService(t, "https://example.invalid")
	if err := svc.Refresh(context.Background()); err != ErrNoToken {
		t.Fatalf("ErrNoToken のはず: got=%v", err)
	}
}

func TestStartLogin_再実行で前のポーリングを止めて新規開始(t *testing.T) {
	ts, created := newLoginServer(t)
	defer ts.Close()
	svc, _ := newTestService(t, ts.URL)
	first, err := svc.StartLogin()
	if err != nil {
		t.Fatalf("1回目 StartLogin 失敗: %v", err)
	}
	svc.mu.Lock()
	oldSession := svc.login
	svc.mu.Unlock()
	second, err := svc.StartLogin()
	if err != nil {
		t.Fatalf("2回目 StartLogin 失敗: %v", err)
	}
	if first == second {
		t.Fatalf("再実行では新しい認証セッションが払い出されるはず")
	}
	if *created != 2 {
		t.Fatalf("認証セッション作成回数=%d want=2", *created)
	}
	if !svc.Status().LoginPending {
		t.Fatalf("2回目のログインは進行中のはず")
	}
	svc.finishLoginWithToken(oldSession, "good-stale")
	if got := svc.store.Current(); got != "" {
		t.Fatalf("取り消した旧セッションの結果を保存しました: %q", got)
	}
}
