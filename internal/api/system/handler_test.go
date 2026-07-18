package system

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"alslime/internal/coreapi"
	"alslime/internal/storage/paths"
	"alslime/internal/system/backup"
	"alslime/internal/system/cache"
	"alslime/internal/system/clistatus"
	"alslime/internal/system/configcheck"
	"alslime/internal/system/diagnostics"
)

// fakeGate はテスト用の常時許可 gate（gate 自体の挙動は featuresimpl 側でテスト）。
type fakeGate struct{}

func (fakeGate) Enabled(string) bool { return true }
func (fakeGate) PublicSnapshot() map[string]bool {
	return map[string]bool{"comfyui": true, "advancedIntegration": true}
}
func (fakeGate) Entitlement() coreapi.EntitlementStatus {
	return coreapi.EntitlementStatus{State: coreapi.TokenStateValid, Tier: "supporter"}
}

func TestHealthRoute_Featuresを返す(t *testing.T) {
	root := t.TempDir()
	resolver := paths.NewResolver(root)
	mux := http.NewServeMux()
	Register(mux, Deps{
		WorkspaceRoot:         root,
		Host:                  "127.0.0.1",
		Port:                  3000,
		ChatCLITimeoutSeconds: 600,
		ConfigCheck:           configcheck.New(resolver),
		Cache:                 cache.New(resolver),
		Backup:                backup.New(resolver),
		CLIStatus:             clistatus.Checker{},
		Features:              fakeGate{},
	})

	req := httptest.NewRequest(http.MethodGet, "/api/system/health", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status code=%d body=%s", rec.Code, rec.Body.String())
	}
	var got healthResponse
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if got.Features == nil || !got.Features["comfyui"] {
		t.Fatalf("features missing or comfyui disabled in dev test tier: %#v", got.Features)
	}
	if got.Entitlement.State != coreapi.TokenStateValid || got.Entitlement.Tier != "supporter" {
		t.Fatalf("entitlement snapshot mismatch: %#v", got.Entitlement)
	}
	if got.Host != "127.0.0.1" || got.Port != 3000 {
		t.Fatalf("host/port mismatch: %#v", got)
	}
	if got.ChatCLITimeoutSeconds != 600 {
		t.Fatalf("chat cli timeout mismatch: %#v", got)
	}
}

func TestCLIStatusRoute(t *testing.T) {
	root := t.TempDir()
	mux := http.NewServeMux()
	Register(mux, Deps{
		WorkspaceRoot: root,
		ConfigCheck:   configcheck.New(paths.NewResolver(root)),
		Cache:         cache.New(paths.NewResolver(root)),
		Backup:        backup.New(paths.NewResolver(root)),
		CLIStatus: clistatus.Checker{
			GOOS: "windows",
			LookPath: func(command string) (string, error) {
				return filepath.Join("bin", command), nil
			},
			Stat: func(string) (os.FileInfo, error) {
				return nil, nil
			},
		},
	})

	req := httptest.NewRequest(http.MethodGet, "/api/system/cli-status", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status code=%d body=%s", rec.Code, rec.Body.String())
	}
	var got clistatus.Status
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if len(got.CLIs) != 3 {
		t.Fatalf("response unexpected: %#v", got)
	}
	// 発見（存在）は全 CLI で OK。認証は別軸（Windows の Antigravity は
	// 資格ストアのため unknown となり集約へ影響するが、ここでは発見を検証する）。
	for _, cli := range got.CLIs {
		if cli.Status != diagnostics.CheckOK {
			t.Fatalf("cli discovery should be ok: %#v", cli)
		}
	}
}

func TestCacheStatusRoute(t *testing.T) {
	root := t.TempDir()
	resolver := paths.NewResolver(root)
	mux := http.NewServeMux()
	Register(mux, Deps{
		WorkspaceRoot: root,
		ConfigCheck:   configcheck.New(resolver),
		Cache:         cache.New(resolver),
		Backup:        backup.New(resolver),
		CLIStatus:     clistatus.Checker{},
	})

	req := httptest.NewRequest(http.MethodGet, "/api/system/cache", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status code=%d body=%s", rec.Code, rec.Body.String())
	}
	var got cache.Status
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if got.Status != diagnostics.CheckOK || got.Exists {
		t.Fatalf("response unexpected: %#v", got)
	}
}

func TestBackupListRoute(t *testing.T) {
	root := t.TempDir()
	resolver := paths.NewResolver(root)
	mux := http.NewServeMux()
	Register(mux, Deps{
		WorkspaceRoot: root,
		ConfigCheck:   configcheck.New(resolver),
		Cache:         cache.New(resolver),
		Backup:        backup.New(resolver),
		CLIStatus:     clistatus.Checker{},
	})

	req := httptest.NewRequest(http.MethodGet, "/api/system/backups", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status code=%d body=%s", rec.Code, rec.Body.String())
	}
	var got backup.ListResult
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if got.Status != diagnostics.CheckOK || len(got.Backups) != 0 {
		t.Fatalf("response unexpected: %#v", got)
	}
}
