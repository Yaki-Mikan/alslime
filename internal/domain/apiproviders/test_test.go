package apiproviders

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"alslime/internal/config"
	"alslime/internal/i18n"
)

// newTestServiceWithServer は httptest サーバーを baseUrl に持つ接続先を 1 件作る。
func newTestServiceWithServer(t *testing.T, handler http.Handler, apiKey string) (*Service, string) {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	svc, _ := newTestService(t, nil)
	in := validInput()
	in.Preset = PresetCustom
	in.BaseURL = server.URL
	view, err := svc.Create(in, apiKey)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}
	return svc, view.ID
}

func TestConnectionTest_成功とモデル一覧(t *testing.T) {
	var gotAuth string
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/models" {
			http.NotFound(w, r)
			return
		}
		gotAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"deepseek/deepseek-chat","name":"DeepSeek"},{"id":""}]}`))
	})
	svc, id := newTestServiceWithServer(t, handler, "sk-test")

	result, err := svc.Test(context.Background(), id)
	if err != nil {
		t.Fatalf("Test failed: %v", err)
	}
	if !result.Success || !result.SupportsModelsAPI {
		t.Fatalf("成功のはず: %+v", result)
	}
	// ID 空の行はスキップされ、有効な 1 件だけが返る。
	if len(result.Models) != 1 || result.Models[0].ID != "deepseek/deepseek-chat" {
		t.Fatalf("モデル一覧が不正: %+v", result.Models)
	}
	if gotAuth != "Bearer sk-test" {
		t.Fatalf("bearer 認証ヘッダーが送出されるべき: %q", gotAuth)
	}
}

func TestConnectionTest_認証失敗はキー値を反射させない(t *testing.T) {
	handler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		// キー値をエラーへ反射する接続先でも details へ現れないこと（完全一致マスク）。
		_, _ = w.Write([]byte(`{"error":{"message":"invalid key sk-reflected provided"}}`))
	})
	svc, id := newTestServiceWithServer(t, handler, "sk-reflected")

	result, err := svc.Test(context.Background(), id)
	if err != nil {
		t.Fatalf("Test failed: %v", err)
	}
	if result.Success || result.FailureKind != FailureKindAuth || result.MessageKey != i18n.KeyAPIProvidersTestFailedAuth {
		t.Fatalf("auth 失敗のはず: %+v", result)
	}
	if strings.Contains(result.Details, "sk-reflected") {
		t.Fatalf("details へキー値が漏えい: %q", result.Details)
	}
	if !strings.Contains(result.Details, "[MASKED]") {
		t.Fatalf("マスク済み詳細が返るべき: %q", result.Details)
	}
}

func TestConnectionTest_認証必須でキー未設定は公開モデル一覧へ接続しない(t *testing.T) {
	called := false
	handler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		_, _ = w.Write([]byte(`{"data":[{"id":"public-model"}]}`))
	})
	svc, id := newTestServiceWithServer(t, handler, "")

	result, err := svc.Test(context.Background(), id)
	if err != nil {
		t.Fatalf("Test failed: %v", err)
	}
	if result.Success || result.FailureKind != FailureKindAuth || result.MessageKey != i18n.KeyAPIProvidersTestKeyRequired {
		t.Fatalf("キー必須エラーのはず: %+v", result)
	}
	if called {
		t.Fatal("キー未設定時に公開 /models へ接続してはならない")
	}
}

func TestConnectionTest_認証方式Noneはキー未設定でも許可する(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"data":[{"id":"local-model"}]}`))
	}))
	defer server.Close()
	svc, _ := newTestService(t, nil)
	in := validInput()
	in.Preset = PresetCustom
	in.BaseURL = server.URL
	in.AuthScheme = AuthSchemeNone
	view, err := svc.Create(in, "")
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	result, err := svc.Test(context.Background(), view.ID)
	if err != nil || !result.Success || len(result.Models) != 1 {
		t.Fatalf("none は無キーで成功するはず: result=%+v err=%v", result, err)
	}
}

func TestConnectionTest_到達不能はnetwork(t *testing.T) {
	svc, _ := newTestService(t, nil)
	in := validInput()
	in.Preset = PresetCustom
	// 予約済み未使用ポートの代わりに、即時 close されたサーバーの URL を使う。
	server := httptest.NewServer(http.NotFoundHandler())
	url := server.URL
	server.Close()
	in.BaseURL = url
	view, err := svc.Create(in, "sk-x")
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	result, err := svc.Test(context.Background(), view.ID)
	if err != nil {
		t.Fatalf("Test failed: %v", err)
	}
	if result.Success || result.FailureKind != FailureKindNetwork || result.MessageKey != i18n.KeyAPIProvidersTestFailedNetwork {
		t.Fatalf("network 失敗のはず: %+v", result)
	}
}

func TestConnectionTest_モデル一覧非対応は手入力フォールバック(t *testing.T) {
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	})
	svc, id := newTestServiceWithServer(t, handler, "sk-x")

	result, err := svc.Test(context.Background(), id)
	if err != nil {
		t.Fatalf("Test failed: %v", err)
	}
	if result.Success || result.FailureKind != FailureKindModelsUnavailable ||
		result.MessageKey != i18n.KeyAPIProvidersTestModelsUnavailable || result.SupportsModelsAPI {
		t.Fatalf("models_unavailable のはず: %+v", result)
	}
}

func TestConnectionTest_不正応答は中立詳細化(t *testing.T) {
	handler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.WriteHeader(http.StatusBadGateway)
		// 非 JSON ボディ（HTML 等）は全文を保存せず中立文言へ落とす。
		_, _ = w.Write([]byte("<html><body>gateway error with sensitive path /var/www</body></html>"))
	})
	svc, id := newTestServiceWithServer(t, handler, "sk-x")

	result, err := svc.Test(context.Background(), id)
	if err != nil {
		t.Fatalf("Test failed: %v", err)
	}
	if result.Success || result.FailureKind != FailureKindInvalidResponse {
		t.Fatalf("invalid_response のはず: %+v", result)
	}
	if strings.Contains(result.Details, "sensitive") || !strings.Contains(result.Details, "HTTP 502") {
		t.Fatalf("中立詳細（ステータス＋Content-Type）へ落ちるべき: %q", result.Details)
	}
}

func TestConnectionTest_不存在の接続先(t *testing.T) {
	svc, _ := newTestService(t, nil)
	if _, err := svc.Test(context.Background(), "conn-missing"); err == nil {
		t.Fatalf("不存在はエラーのはず")
	}
}

// modelsBodyOfSize は指定バイト数ちょうどの有効な models 応答 JSON を作る。
func modelsBodyOfSize(t *testing.T, size int) string {
	t.Helper()
	base := `{"data":[{"id":"m1","name":"`
	tail := `"}]}`
	padding := size - len(base) - len(tail)
	if padding < 0 {
		t.Fatalf("size が小さすぎる: %d", size)
	}
	body := base + strings.Repeat("a", padding) + tail
	if len(body) != size {
		t.Fatalf("ボディ長が不正: %d != %d", len(body), size)
	}
	return body
}

func TestConnectionTest_モデル一覧応答の上限境界(t *testing.T) {
	serve := func(body string) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(body))
		})
	}

	t.Run("上限ちょうどは受理", func(t *testing.T) {
		svc, id := newTestServiceWithServer(t, serve(modelsBodyOfSize(t, config.APIProviderTestMaxModelsBodyBytes)), "sk-x")
		result, err := svc.Test(context.Background(), id)
		if err != nil {
			t.Fatalf("Test failed: %v", err)
		}
		if !result.Success || len(result.Models) != 1 || result.Models[0].ID != "m1" {
			t.Fatalf("上限ちょうどは受理されるべき: %+v", result)
		}
	})

	t.Run("上限プラス1は拒否", func(t *testing.T) {
		svc, id := newTestServiceWithServer(t, serve(modelsBodyOfSize(t, config.APIProviderTestMaxModelsBodyBytes+1)), "sk-x")
		result, err := svc.Test(context.Background(), id)
		if err != nil {
			t.Fatalf("Test failed: %v", err)
		}
		if result.Success || result.FailureKind != FailureKindInvalidResponse {
			t.Fatalf("上限超過は拒否されるべき: %+v", result)
		}
	})

	t.Run("先頭完結JSONの後続超過も拒否", func(t *testing.T) {
		// Decoder を LimitReader へ直結すると先頭の完結 JSON で読み終えて超過を
		// 見逃す。長さ検査を先に行う契約をここで固定する。
		body := `{"data":[{"id":"m1"}]}` + "\n" + strings.Repeat("x", config.APIProviderTestMaxModelsBodyBytes)
		svc, id := newTestServiceWithServer(t, serve(body), "sk-x")
		result, err := svc.Test(context.Background(), id)
		if err != nil {
			t.Fatalf("Test failed: %v", err)
		}
		if result.Success || result.FailureKind != FailureKindInvalidResponse {
			t.Fatalf("後続超過も拒否されるべき: %+v", result)
		}
	})
}

func TestConnectionTest_リダイレクト制御(t *testing.T) {
	// 同一 origin のリダイレクトを hops 回経由して models 応答へ到達するサーバー。
	newRedirectServer := func(t *testing.T, hops int) *httptest.Server {
		t.Helper()
		mux := http.NewServeMux()
		server := httptest.NewServer(mux)
		t.Cleanup(server.Close)
		for i := 0; i < hops; i++ {
			from, next := i, i+1
			target := fmt.Sprintf("/hop%d/models", next)
			if next == hops {
				target = "/final/models"
			}
			prefix := fmt.Sprintf("/hop%d/", from)
			if from == 0 {
				prefix = "/"
			}
			mux.HandleFunc(prefix+"models", func(w http.ResponseWriter, r *http.Request) {
				http.Redirect(w, r, server.URL+target, http.StatusTemporaryRedirect)
			})
		}
		mux.HandleFunc("/final/models", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"data":[{"id":"m1"}]}`))
		})
		return server
	}

	newSvcFor := func(t *testing.T, baseURL string) (*Service, string) {
		t.Helper()
		svc, _ := newTestService(t, nil)
		in := validInput()
		in.Preset = PresetCustom
		in.BaseURL = baseURL
		view, err := svc.Create(in, "sk-x")
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}
		return svc, view.ID
	}

	t.Run("同一originは上限回数まで許可", func(t *testing.T) {
		server := newRedirectServer(t, config.APIProviderTestMaxRedirects)
		svc, id := newSvcFor(t, server.URL)
		result, err := svc.Test(context.Background(), id)
		if err != nil {
			t.Fatalf("Test failed: %v", err)
		}
		if !result.Success {
			t.Fatalf("上限回数までは追従して成功するべき: %+v", result)
		}
	})

	t.Run("上限プラス1回は拒否", func(t *testing.T) {
		server := newRedirectServer(t, config.APIProviderTestMaxRedirects+1)
		svc, id := newSvcFor(t, server.URL)
		result, err := svc.Test(context.Background(), id)
		if err != nil {
			t.Fatalf("Test failed: %v", err)
		}
		if result.Success || result.FailureKind != FailureKindNetwork {
			t.Fatalf("上限超過は拒否されるべき: %+v", result)
		}
	})

	t.Run("異originは拒否し認証情報を転送しない", func(t *testing.T) {
		var authAtOther string
		other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authAtOther = r.Header.Get("Authorization")
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"data":[{"id":"m1"}]}`))
		}))
		t.Cleanup(other.Close)
		origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Redirect(w, r, other.URL+"/models", http.StatusTemporaryRedirect)
		}))
		t.Cleanup(origin.Close)

		svc, id := newSvcFor(t, origin.URL)
		result, err := svc.Test(context.Background(), id)
		if err != nil {
			t.Fatalf("Test failed: %v", err)
		}
		if result.Success || result.FailureKind != FailureKindNetwork {
			t.Fatalf("異 origin は拒否されるべき: %+v", result)
		}
		if authAtOther != "" {
			t.Fatalf("異 origin へ認証ヘッダーが転送された: %q", authAtOther)
		}
	})
}
