package settings

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"alslime/internal/system/cliexecutable"
)

// newCLICheckTestMux は疎通確認だけを差し替えた settings API の mux を返す。
// 受け取った引数は got へ記録する。
func newCLICheckTestMux(t *testing.T, got *[2]string) *http.ServeMux {
	t.Helper()
	mux := http.NewServeMux()
	Register(mux, Deps{
		CheckCLI: func(_ context.Context, cli, configuredPath string) (cliexecutable.CheckResult, error) {
			*got = [2]string{cli, configuredPath}
			if cli != cliexecutable.CLIClaude {
				return cliexecutable.CheckResult{}, cliexecutable.ErrUnknownCLI
			}
			return cliexecutable.CheckResult{Status: cliexecutable.CheckOK, Command: "claude", Version: "2.0.0"}, nil
		},
	})
	return mux
}

func TestServerCLICheck_入力値で確認した結果を返す(t *testing.T) {
	var got [2]string
	mux := newCLICheckTestMux(t, &got)
	rec := doSettings(t, mux, http.MethodPost, "/api/settings/server/cli-check", map[string]any{
		"cli":  "claude",
		"path": "  /opt/claude  ",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d want 200 body=%s", rec.Code, rec.Body.String())
	}
	if got != [2]string{"claude", "/opt/claude"} {
		t.Fatalf("args unexpected: %#v", got)
	}
	var res cliexecutable.CheckResult
	if err := json.NewDecoder(rec.Body).Decode(&res); err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if res.Status != cliexecutable.CheckOK || res.Command != "claude" || res.Version != "2.0.0" {
		t.Fatalf("response unexpected: %#v", res)
	}
}

func TestServerCLICheck_未知のCLIは400(t *testing.T) {
	var got [2]string
	mux := newCLICheckTestMux(t, &got)
	rec := doSettings(t, mux, http.MethodPost, "/api/settings/server/cli-check", map[string]any{"cli": "unknown"})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status=%d want 400 body=%s", rec.Code, rec.Body.String())
	}
}

func TestServerCLICheck_不正なJSONは400(t *testing.T) {
	var got [2]string
	mux := newCLICheckTestMux(t, &got)
	rec := doSettings(t, mux, http.MethodPost, "/api/settings/server/cli-check", "not-object")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status=%d want 400 body=%s", rec.Code, rec.Body.String())
	}
}
