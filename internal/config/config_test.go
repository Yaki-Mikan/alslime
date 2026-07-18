package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoad_ServerSettingsFileを読む(t *testing.T) {
	root := t.TempDir()
	t.Setenv(EnvWorkspaceRoot, root)
	t.Setenv(EnvPort, "")
	t.Setenv(EnvHost, "")
	writeServerSettings(t, root, `{"port":3210,"bindAddress":"0.0.0.0"}`)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}
	if cfg.WorkspaceRoot != root {
		t.Fatalf("workspace root mismatch: %q", cfg.WorkspaceRoot)
	}
	if cfg.Port != 3210 || cfg.Host != "0.0.0.0" {
		t.Fatalf("server settings were not applied: %#v", cfg)
	}
	if cfg.ChatCLITimeoutSeconds != DefaultChatCLITimeoutSeconds {
		t.Fatalf("chat cli timeout default mismatch: %#v", cfg)
	}
}

func TestLoad_LegacyServerSettingsFileを読む(t *testing.T) {
	root := t.TempDir()
	t.Setenv(EnvWorkspaceRoot, root)
	t.Setenv(EnvPort, "")
	t.Setenv(EnvHost, "")
	writeLegacyServerSettings(t, root, `{"port":3211,"bindAddress":"127.0.0.2"}`)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}
	if cfg.Port != 3211 || cfg.Host != "127.0.0.2" {
		t.Fatalf("legacy server settings were not applied: %#v", cfg)
	}
}

func TestLoad_LANPublicは全インターフェイスにbindする(t *testing.T) {
	root := t.TempDir()
	t.Setenv(EnvWorkspaceRoot, root)
	t.Setenv(EnvPort, "")
	t.Setenv(EnvHost, "")
	writeServerSettings(t, root, `{"lanPublic":true}`)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}
	if cfg.Host != "0.0.0.0" {
		t.Fatalf("lanPublic host mismatch: %q", cfg.Host)
	}
}

func TestLoad_環境変数がServerSettingsFileより優先(t *testing.T) {
	root := t.TempDir()
	t.Setenv(EnvWorkspaceRoot, root)
	t.Setenv(EnvPort, "4321")
	t.Setenv(EnvHost, "127.0.0.2")
	writeServerSettings(t, root, `{"port":3210,"bindAddress":"0.0.0.0"}`)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}
	if cfg.Port != 4321 || cfg.Host != "127.0.0.2" {
		t.Fatalf("env override mismatch: %#v", cfg)
	}
}

func TestLoad_ServerSettingsFileのJSON破損はエラー(t *testing.T) {
	root := t.TempDir()
	t.Setenv(EnvWorkspaceRoot, root)
	t.Setenv(EnvPort, "")
	t.Setenv(EnvHost, "")
	writeServerSettings(t, root, `{"port":`)

	if _, err := Load(); err == nil {
		t.Fatal("broken server settings should fail")
	}
}

func TestLoad_ServerSettingsFileのPort不正はエラー(t *testing.T) {
	root := t.TempDir()
	t.Setenv(EnvWorkspaceRoot, root)
	t.Setenv(EnvPort, "")
	t.Setenv(EnvHost, "")
	writeServerSettings(t, root, `{"port":70000}`)

	if _, err := Load(); err == nil {
		t.Fatal("invalid port should fail")
	}
}

func TestLoad_ChatCLITimeoutEnvを読む(t *testing.T) {
	root := t.TempDir()
	t.Setenv(EnvWorkspaceRoot, root)
	t.Setenv(EnvPort, "")
	t.Setenv(EnvHost, "")
	t.Setenv(EnvChatCLITimeoutSeconds, "12")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}
	if cfg.ChatCLITimeoutSeconds != 12 {
		t.Fatalf("chat cli timeout mismatch: %#v", cfg)
	}
}

func TestLoad_ChatCLITimeoutEnv不正値は既定値(t *testing.T) {
	root := t.TempDir()
	t.Setenv(EnvWorkspaceRoot, root)
	t.Setenv(EnvPort, "")
	t.Setenv(EnvHost, "")
	t.Setenv(EnvChatCLITimeoutSeconds, "0")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}
	if cfg.ChatCLITimeoutSeconds != DefaultChatCLITimeoutSeconds {
		t.Fatalf("chat cli timeout should fallback: %#v", cfg)
	}
}

func writeServerSettings(t *testing.T, root, body string) {
	t.Helper()
	path := filepath.Join(root, filepath.FromSlash(ServerSettingsFile))
	writeSettingsFile(t, path, body)
}

func writeLegacyServerSettings(t *testing.T, root, body string) {
	t.Helper()
	path := filepath.Join(root, filepath.FromSlash(LegacyServerSettingsFile))
	writeSettingsFile(t, path, body)
}

func writeSettingsFile(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), DirPerm); err != nil {
		t.Fatalf("mkdir failed: %v", err)
	}
	if err := os.WriteFile(path, []byte(body), FilePerm); err != nil {
		t.Fatalf("write failed: %v", err)
	}
}
