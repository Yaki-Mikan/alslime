package module

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"alslime/internal/coreapi"
	"alslime/internal/domain/appearancejobs"
	"alslime/internal/i18n"
	"alslime/internal/jobs"
)

// newTestManager は起動済みモジュールの代わりに試験用サーバーを接続先とする Manager を返す。
func newTestManager(t *testing.T, handler http.HandlerFunc) *Manager {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	u, err := url.Parse(srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	return &Manager{secret: "test-secret", baseURL: u}
}

func appearanceJob() jobs.Job {
	return jobs.Job{
		JobID: "job-1",
		Type:  jobs.TypeAppearancePrompt,
		Payload: appearancejobs.Payload{
			DirName:  "雪",
			FileName: "雪",
			Provider: appearancejobs.ProviderClaude,
			Model:    "claude-sonnet-4-6",
		},
	}
}

func writeAppearanceResponse(w http.ResponseWriter, res coreapi.ModuleAppearancePromptResponse) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(res)
}

func TestAppearancePromptRunner_PayloadとJobIDを送り成功時のOutputを返す(t *testing.T) {
	const output = `{"dirName":"雪","fileName":"雪","groups":[],"all":["black_hair"]}`
	var got coreapi.ModuleAppearancePromptRequest
	var gotPath, gotSecret string
	mgr := newTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotSecret = r.Header.Get(coreapi.ModuleAuthHeader)
		_ = json.NewDecoder(r.Body).Decode(&got)
		writeAppearanceResponse(w, coreapi.ModuleAppearancePromptResponse{Success: true, Output: output})
	})

	result, err := AppearancePromptRunner{Manager: mgr}.Run(context.Background(), appearanceJob())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Output != output {
		t.Fatalf("unexpected output: %q", result.Output)
	}
	if gotPath != coreapi.ModuleAppearancePromptRoute || gotSecret != "test-secret" || got.JobID != "job-1" {
		t.Fatalf("unexpected request: path=%q secret=%q jobId=%q", gotPath, gotSecret, got.JobID)
	}
	var payload appearancejobs.Payload
	if err := json.Unmarshal(got.Payload, &payload); err != nil {
		t.Fatalf("payload is not appearancejobs.Payload: %v", err)
	}
	if payload.DirName != "雪" || payload.Provider != appearancejobs.ProviderClaude || payload.Model != "claude-sonnet-4-6" {
		t.Fatalf("unexpected payload: %#v", payload)
	}
}

func TestAppearancePromptRunner_失敗応答のmessageKeyをエラーにする(t *testing.T) {
	mgr := newTestManager(t, func(w http.ResponseWriter, _ *http.Request) {
		writeAppearanceResponse(w, coreapi.ModuleAppearancePromptResponse{Error: i18n.KeyErrorAppearanceParseFailed})
	})
	_, err := AppearancePromptRunner{Manager: mgr}.Run(context.Background(), appearanceJob())
	if err == nil || err.Error() != i18n.KeyErrorAppearanceParseFailed {
		t.Fatalf("expected %s, got %v", i18n.KeyErrorAppearanceParseFailed, err)
	}
}

func TestAppearancePromptRunner_接続先未解決はサービス未接続(t *testing.T) {
	cases := map[string]*Manager{
		"Managerがnil": nil,
		"BaseURLが無い":  {secret: "test-secret"},
	}
	for name, mgr := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := AppearancePromptRunner{Manager: mgr}.Run(context.Background(), appearanceJob())
			if err == nil || err.Error() != i18n.KeyErrorComfyUIServiceMissing {
				t.Fatalf("expected %s, got %v", i18n.KeyErrorComfyUIServiceMissing, err)
			}
		})
	}
}

func TestAppearancePromptRunner_不正なJSON応答は失敗(t *testing.T) {
	mgr := newTestManager(t, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("not json"))
	})
	result, err := AppearancePromptRunner{Manager: mgr}.Run(context.Background(), appearanceJob())
	if err == nil || result.Output != "" {
		t.Fatalf("expected failure, got output=%q err=%v", result.Output, err)
	}
}

func TestAppearancePromptRunner_中止が内部HTTP要求へ伝わる(t *testing.T) {
	arrived := make(chan struct{})
	serverCanceled := make(chan struct{})
	mgr := newTestManager(t, func(_ http.ResponseWriter, r *http.Request) {
		// サーバーは本文を読み終えてから接続切断を監視し始めるため、先に読み切る
		//（モジュールの実ハンドラも本文を復号してから Runner を実行する）。
		_, _ = io.Copy(io.Discard, r.Body)
		close(arrived)
		<-r.Context().Done()
		close(serverCanceled)
	})
	ctx, cancel := context.WithCancel(context.Background())
	errCh := make(chan error, 1)
	go func() {
		_, err := AppearancePromptRunner{Manager: mgr}.Run(ctx, appearanceJob())
		errCh <- err
	}()
	<-arrived
	cancel()
	select {
	case err := <-errCh:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("expected context.Canceled, got %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("runner did not return after cancel")
	}
	select {
	case <-serverCanceled:
	case <-time.After(3 * time.Second):
		t.Fatal("request context was not canceled on the module side")
	}
}
