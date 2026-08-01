package jsonstore

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"alslime/internal/config"
)

// tempFiles は dir 直下に残る jsonstore の一時ファイル（.tmp-*.json）を列挙する。
func tempFiles(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("ReadDir failed: %v", err)
	}
	var out []string
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".tmp-") {
			out = append(out, e.Name())
		}
	}
	return out
}

func TestWriteRawAtomic_既存内容を新内容へ置換する(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "instruction.md")
	if err := WriteRawAtomic(path, []byte("旧内容")); err != nil {
		t.Fatalf("初回書き込みに失敗: %v", err)
	}
	if err := WriteRawAtomic(path, []byte("新内容")); err != nil {
		t.Fatalf("置換書き込みに失敗: %v", err)
	}
	got, err := os.ReadFile(path)
	if err != nil || string(got) != "新内容" {
		t.Fatalf("置換されるべき: %q err=%v", got, err)
	}
	// 成功後に一時ファイルを残さない。
	if tmp := tempFiles(t, dir); len(tmp) != 0 {
		t.Fatalf("一時ファイルが残っている: %v", tmp)
	}
}

func TestWriteJSONMode_マーシャル失敗時は既存内容を保持する(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "secrets.json")
	if err := WriteJSONMode(path, map[string]string{"ok": "v1"}, config.SecretFilePerm); err != nil {
		t.Fatalf("初回書き込みに失敗: %v", err)
	}
	// チャネルは JSON マーシャル不能。書き込み前に失敗し、既存内容は不変。
	if err := WriteJSONMode(path, map[string]any{"bad": make(chan int)}, config.SecretFilePerm); err == nil {
		t.Fatalf("マーシャル不能値はエラーのはず")
	}
	got, err := os.ReadFile(path)
	if err != nil || !strings.Contains(string(got), `"ok": "v1"`) {
		t.Fatalf("失敗時は既存内容を保持するべき: %q err=%v", got, err)
	}
	if tmp := tempFiles(t, dir); len(tmp) != 0 {
		t.Fatalf("失敗後に一時ファイルが残っている: %v", tmp)
	}
}

func TestWriteRawAtomic_親ディレクトリ不存在はエラー(t *testing.T) {
	// 親作成は呼び出し側（paths.Resolver）の責務のため、掘らずにエラーを返す。
	path := filepath.Join(t.TempDir(), "missing-dir", "file.md")
	if err := WriteRawAtomic(path, []byte("x")); err == nil {
		t.Fatalf("親ディレクトリ不存在はエラーのはず")
	}
}

func TestWriteJSONMode_パーミッションをrename前に確定する(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows ではファイルモードが意味を持たない")
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "secrets.json")
	if err := WriteJSONMode(path, map[string]string{"k": "v"}, config.SecretFilePerm); err != nil {
		t.Fatalf("書き込みに失敗: %v", err)
	}
	info, err := os.Stat(path)
	if err != nil || info.Mode().Perm() != config.SecretFilePerm {
		t.Fatalf("0600 で出現するべき: %v err=%v", info.Mode(), err)
	}
}
