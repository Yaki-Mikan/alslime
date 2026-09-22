package module

import (
	"context"
	"encoding/base64"
	"net/http"
	"net/url"
	"sync/atomic"
	"testing"

	"alslime/internal/coreapi"
	"alslime/internal/i18n"
)

// onceEndpoint は一度目の問い合わせだけ接続先を返し、二度目以降は nil を返す
// （確認の直後にモジュールが終了して接続先が外れた状態の再現）。
type onceEndpoint struct {
	base  *url.URL
	calls atomic.Int32
}

func (e *onceEndpoint) BaseURL() *url.URL {
	if e.calls.Add(1) == 1 {
		return e.base
	}
	return nil
}
func (e *onceEndpoint) Secret() string { return "test-secret" }

type stoppedEndpoint struct{}

func (stoppedEndpoint) BaseURL() *url.URL { return nil }
func (stoppedEndpoint) Secret() string    { return "test-secret" }

func TestTTSRunner_合成は接続先を一度だけ読む(t *testing.T) {
	var gotPath, gotSecret string
	audio := base64.StdEncoding.EncodeToString([]byte("abc"))
	mgr := newTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotSecret = r.Header.Get(coreapi.ModuleAuthHeader)
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("event: chunk\ndata: {\"index\":0,\"format\":\"wav\",\"audioBase64\":\"" + audio + "\"}\n\nevent: done\ndata: {}\n\n"))
	})
	endpoint := &onceEndpoint{base: mgr.BaseURL()}

	var chunks []coreapi.TTSChunk
	err := TTSRunner{}.synthesizeFrom(context.Background(), endpoint, coreapi.TTSSynthesizeRequest{Text: "こんにちは"}, func(chunk coreapi.TTSChunk) error {
		chunks = append(chunks, chunk)
		return nil
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(chunks) != 1 || string(chunks[0].Audio) != "abc" || chunks[0].Format != "wav" {
		t.Fatalf("unexpected chunks: %#v", chunks)
	}
	if gotPath != coreapi.ModuleTTSSynthesizeRoute || gotSecret != "test-secret" {
		t.Fatalf("unexpected request: path=%q secret=%q", gotPath, gotSecret)
	}
	if n := endpoint.calls.Load(); n != 1 {
		t.Fatalf("expected BaseURL to be read once, got %d", n)
	}
}

func TestTTSRunner_モジュール停止中で内蔵版も無ければサービス未接続(t *testing.T) {
	for name, endpoint := range map[string]ttsModuleEndpoint{
		"接続先なし":     stoppedEndpoint{},
		"Managerなし": nil,
	} {
		t.Run(name, func(t *testing.T) {
			err := TTSRunner{}.synthesizeFrom(context.Background(), endpoint, coreapi.TTSSynthesizeRequest{}, func(coreapi.TTSChunk) error {
				t.Error("onChunk must not be called")
				return nil
			})
			if err == nil || err.Error() != i18n.KeyErrorTTSServiceMissing {
				t.Fatalf("expected %s, got %v", i18n.KeyErrorTTSServiceMissing, err)
			}
		})
	}
}
