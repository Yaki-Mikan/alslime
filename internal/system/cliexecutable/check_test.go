package cliexecutable

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"testing"
)

// writeScript は stdout へ版数を出して exitCode で終わる実行可能なスクリプトを作り、
// その絶対パスを返す。
func writeScript(t *testing.T, version string, exitCode int) string {
	t.Helper()
	dir := t.TempDir()
	var path, body string
	if runtime.GOOS == "windows" {
		path = filepath.Join(dir, "fake-cli.cmd")
		body = "@echo off\r\necho " + version + "\r\nexit /b " + strconv.Itoa(exitCode) + "\r\n"
	} else {
		path = filepath.Join(dir, "fake-cli")
		body = "#!/bin/sh\necho '" + version + "'\nexit " + strconv.Itoa(exitCode) + "\n"
	}
	if err := os.WriteFile(path, []byte(body), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestCheck_起動できれば版数とファイル名を返す(t *testing.T) {
	path := writeScript(t, "fake 1.2.3", 0)
	got, err := Check(context.Background(), CLIClaude, path)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != CheckOK || got.Version != "fake 1.2.3" || got.Command != filepath.Base(path) {
		t.Fatalf("unexpected: %#v", got)
	}
}

func TestCheck_異常終了なら起動失敗を返す(t *testing.T) {
	path := writeScript(t, "broken", 1)
	got, err := Check(context.Background(), CLIGemini, path)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != CheckFailed || got.Version != "" || got.Command != filepath.Base(path) {
		t.Fatalf("unexpected: %#v", got)
	}
}

func TestCheck_指定パスが無ければ設定不備を返す(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "missing", "agy.exe")
	got, err := Check(context.Background(), CLIAntigravity, missing)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != CheckConfiguredPathInvalid || got.Command != "" {
		t.Fatalf("unexpected: %#v", got)
	}
}

func TestCheck_空欄で既定の探索先にも無ければ未検出を返す(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	t.Setenv("HOME", t.TempDir())
	t.Setenv("USERPROFILE", t.TempDir())
	got, err := Check(context.Background(), CLIGemini, "")
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != CheckNotFound {
		t.Fatalf("unexpected: %#v", got)
	}
}

func TestCheck_未知のCLIはエラーを返す(t *testing.T) {
	if _, err := Check(context.Background(), "unknown", ""); !errors.Is(err, ErrUnknownCLI) {
		t.Fatalf("expected ErrUnknownCLI, got: %v", err)
	}
}

func TestFirstLine_最初の空でない行を上限まで切り詰める(t *testing.T) {
	if got := firstLine("\r\n  v1.0.0  \r\nextra\r\n"); got != "v1.0.0" {
		t.Fatalf("got %q", got)
	}
	long := make([]rune, versionMaxRunes+10)
	for i := range long {
		long[i] = 'あ'
	}
	if got := []rune(firstLine(string(long))); len(got) != versionMaxRunes {
		t.Fatalf("len=%d", len(got))
	}
}
