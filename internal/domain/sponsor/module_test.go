package sponsor

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestInstallModule_署名検証後に付属パックを適用(t *testing.T) {
	pub, priv, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatalf("keygen: %v", err)
	}
	binary := []byte("module binary")
	pack := []byte("companion pack")
	binarySum := sha256.Sum256(binary)
	packSum := sha256.Sum256(pack)

	moduleInfo := moduleManifest{
		Version: "1.2.3", OS: "windows", Arch: "amd64",
		SHA256: hex.EncodeToString(binarySum[:]),
	}
	moduleInfo.Sig = signModulePayload(t, priv, moduleInfo)
	packInfo := companionPackManifest{
		Module: "comfy", Version: "2026.07.1",
		SHA256: hex.EncodeToString(packSum[:]), SizeBytes: int64(len(pack)),
	}
	packInfo.Sig = signPackPayload(t, priv, packInfo)

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer good-token" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		switch r.URL.Path {
		case "/modules/comfy":
			_ = json.NewEncoder(w).Encode(moduleInfo)
		case "/modules/comfy/download":
			_, _ = w.Write(binary)
		case "/modules/comfy/companion-pack":
			_ = json.NewEncoder(w).Encode(packInfo)
		case "/modules/comfy/companion-pack/download":
			_, _ = w.Write(pack)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer ts.Close()

	svc, store := newTestService(t, ts.URL)
	if err := store.Save("good-token"); err != nil {
		t.Fatal(err)
	}
	installPath := filepath.Join(t.TempDir(), "alslime-comfy.exe")
	var installedPack []byte
	installedTemplates := []string{"AlSlime Generic Workflow"}
	svc.ConfigureModules([]string{"comfy"}, map[string]ModuleTarget{
		"comfy": {
			InstallPath: installPath,
			InstallCompanionPack: func(zipPath string) ([]string, error) {
				var readErr error
				installedPack, readErr = os.ReadFile(zipPath)
				return installedTemplates, readErr
			},
		},
	}, func(payload []byte, sigB64 string) error {
		sig, decodeErr := base64.RawURLEncoding.DecodeString(sigB64)
		if decodeErr != nil {
			return decodeErr
		}
		if !ed25519.Verify(pub, payload, sig) {
			return errors.New("signature verification failed")
		}
		return nil
	})

	result, err := svc.InstallModule(context.Background(), "comfy")
	if err != nil {
		t.Fatalf("InstallModule: %v", err)
	}
	if result.Version != "1.2.3" || !result.CompanionPackConfigured || !result.CompanionPackInstalled {
		t.Fatalf("result: %+v", result)
	}
	if len(result.CompanionPackWorkflowTemplates) != 1 ||
		result.CompanionPackWorkflowTemplates[0] != installedTemplates[0] {
		t.Fatalf("workflow templates: %#v", result.CompanionPackWorkflowTemplates)
	}
	gotBinary, err := os.ReadFile(installPath)
	if err != nil || string(gotBinary) != string(binary) {
		t.Fatalf("binary: %q err=%v", gotBinary, err)
	}
	if string(installedPack) != string(pack) {
		t.Fatalf("pack: %q", installedPack)
	}

	failedInstallPath := filepath.Join(t.TempDir(), "alslime-comfy.exe")
	svc.ConfigureModules([]string{"comfy"}, map[string]ModuleTarget{
		"comfy": {
			InstallPath: failedInstallPath,
			InstallCompanionPack: func(string) ([]string, error) {
				return []string{"返却してはならない名前"}, errors.New("pack install failed")
			},
		},
	}, svc.verifySig)
	failedResult, err := svc.InstallModule(context.Background(), "comfy")
	if err != nil {
		t.Fatalf("付随パック失敗時の InstallModule: %v", err)
	}
	if !failedResult.CompanionPackConfigured || failedResult.CompanionPackInstalled {
		t.Fatalf("付随パック失敗時の result: %+v", failedResult)
	}
	if failedResult.CompanionPackWorkflowTemplates == nil ||
		len(failedResult.CompanionPackWorkflowTemplates) != 0 {
		t.Fatalf("付随パック失敗時の workflow templates: %#v",
			failedResult.CompanionPackWorkflowTemplates)
	}
}

func signModulePayload(t *testing.T, priv ed25519.PrivateKey, manifest moduleManifest) string {
	t.Helper()
	manifest.Sig = ""
	payload, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	return base64.RawURLEncoding.EncodeToString(ed25519.Sign(priv, payload))
}

func signPackPayload(t *testing.T, priv ed25519.PrivateKey, manifest companionPackManifest) string {
	t.Helper()
	manifest.Sig = ""
	payload, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	return base64.RawURLEncoding.EncodeToString(ed25519.Sign(priv, payload))
}
