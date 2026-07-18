package sponsor

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
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

// callbackURL は StartLogin の戻り値から redirect_port を取り出し、
// ローカルコールバック URL を組み立てる。
func callbackURL(t *testing.T, authURL string, query string) string {
	t.Helper()
	u, err := url.Parse(authURL)
	if err != nil {
		t.Fatalf("authURL parse failed: %v", err)
	}
	port := u.Query().Get("redirect_port")
	if port == "" {
		t.Fatalf("redirect_port missing in authURL: %s", authURL)
	}
	return "http://127.0.0.1:" + port + "/oauth-done?" + query
}

func TestStartLoginとコールバック_有効トークンで保存される(t *testing.T) {
	svc, store, clock := newTestServiceWithClock(t, "https://example.invalid")
	authURL, err := svc.StartLogin()
	if err != nil {
		t.Fatalf("StartLogin 失敗: %v", err)
	}
	if !strings.HasPrefix(authURL, "https://example.invalid/auth/github/start?redirect_port=") {
		t.Fatalf("authURL の形が想定外: %s", authURL)
	}
	if !svc.Status().LoginPending {
		t.Fatalf("ログイン開始後は LoginPending のはず")
	}

	resp, err := http.Get(callbackURL(t, authURL, "token=good-token"))
	if err != nil {
		t.Fatalf("コールバック送信失敗: %v", err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("コールバック応答 status=%d", resp.StatusCode)
	}
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
	// リスナーは遅延クローズのため、少し待って解放を確認する。
	deadline := time.Now().Add(2 * time.Second)
	for svc.Status().LoginPending {
		if time.Now().After(deadline) {
			t.Fatalf("コールバック後もリスナーが閉じない")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestコールバックF_検証NGトークンは旧トークンへ巻き戻す(t *testing.T) {
	svc, store := newTestService(t, "https://example.invalid")
	if err := store.Save("good-old"); err != nil {
		t.Fatal(err)
	}
	authURL, err := svc.StartLogin()
	if err != nil {
		t.Fatalf("StartLogin 失敗: %v", err)
	}
	resp, err := http.Get(callbackURL(t, authURL, "token=bogus"))
	if err != nil {
		t.Fatalf("コールバック送信失敗: %v", err)
	}
	_ = resp.Body.Close()
	if got := store.Current(); got != "good-old" {
		t.Fatalf("旧トークンへ巻き戻るはず: got=%q", got)
	}
	if got := svc.Status().LastLoginError; got != LoginErrorInvalidToken {
		t.Fatalf("LastLoginError=invalid_token のはず: got=%q", got)
	}
}

func Testコールバック_not_a_sponsorはコードを保持(t *testing.T) {
	svc, store := newTestService(t, "https://example.invalid")
	authURL, err := svc.StartLogin()
	if err != nil {
		t.Fatalf("StartLogin 失敗: %v", err)
	}
	resp, err := http.Get(callbackURL(t, authURL, "error=not_a_sponsor"))
	if err != nil {
		t.Fatalf("コールバック送信失敗: %v", err)
	}
	_ = resp.Body.Close()
	if got := svc.Status().LastLoginError; got != LoginErrorNotASponsor {
		t.Fatalf("LastLoginError=not_a_sponsor のはず: got=%q", got)
	}
	if store.Current() != "" {
		t.Fatalf("失敗時にトークンが保存されてはいけない")
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

func TestStartLogin_再実行で前のリスナーを閉じて新規開始(t *testing.T) {
	svc, _ := newTestService(t, "https://example.invalid")
	first, err := svc.StartLogin()
	if err != nil {
		t.Fatalf("1回目 StartLogin 失敗: %v", err)
	}
	second, err := svc.StartLogin()
	if err != nil {
		t.Fatalf("2回目 StartLogin 失敗: %v", err)
	}
	if first == second {
		t.Fatalf("再実行では新しいポートが払い出されるはず")
	}
	// 1回目のポートは閉じられている（接続拒否）。
	if _, err := http.Get(callbackURL(t, first, "token=good")); err == nil {
		t.Fatalf("旧リスナーは閉じているはず")
	}
	if !svc.Status().LoginPending {
		t.Fatalf("2回目のログインは進行中のはず")
	}
}
