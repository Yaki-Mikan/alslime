package cliresolve

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

// writeExecutable は実行可能なファイルを作って絶対パスを返す。
// Windows は拡張子で実行可否を見るため .cmd を付ける。
func writeExecutable(t *testing.T, dir, name string) string {
	t.Helper()
	if runtime.GOOS == "windows" && filepath.Ext(name) == "" {
		name += ".cmd"
	}
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatalf("ファイル作成失敗: %v", err)
	}
	return path
}

func TestResolve_設定パスあり有効ならそのパス(t *testing.T) {
	dir := t.TempDir()
	exe := writeExecutable(t, dir, "gemini")

	got, err := Resolver{ConfiguredPath: exe}.Resolve()
	if err != nil {
		t.Fatalf("想定外エラー: %v", err)
	}
	if got != exe {
		t.Fatalf("解決パスが違う: got=%q want=%q", got, exe)
	}
}

func TestResolve_設定パスあり存在しないならフォールバックせずエラー(t *testing.T) {
	dir := t.TempDir()
	fallback := writeExecutable(t, dir, "gemini")
	missing := filepath.Join(dir, "does-not-exist")

	_, err := Resolver{
		ConfiguredPath: missing,
		Fallbacks:      []string{fallback}, // これに逃げてはいけない
	}.Resolve()
	if !errors.Is(err, ErrConfiguredPathInvalid) {
		t.Fatalf("ErrConfiguredPathInvalid を期待: got=%v", err)
	}
}

func TestResolve_設定パスがディレクトリならエラー(t *testing.T) {
	dir := t.TempDir()

	_, err := Resolver{ConfiguredPath: dir}.Resolve()
	if !errors.Is(err, ErrConfiguredPathInvalid) {
		t.Fatalf("ErrConfiguredPathInvalid を期待: got=%v", err)
	}
}

func TestResolve_設定パスが非実行ファイルならエラー(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows は実行ビットではなく拡張子で判定するため対象外")
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "notexec")
	if err := os.WriteFile(path, []byte("x"), 0o644); err != nil {
		t.Fatalf("ファイル作成失敗: %v", err)
	}

	_, err := Resolver{ConfiguredPath: path}.Resolve()
	if !errors.Is(err, ErrConfiguredPathInvalid) {
		t.Fatalf("ErrConfiguredPathInvalid を期待: got=%v", err)
	}
}

func TestResolve_設定パスが空白のみならフォールバック探索(t *testing.T) {
	dir := t.TempDir()
	exe := writeExecutable(t, dir, "gemini")

	got, err := Resolver{
		ConfiguredPath: "   ",
		Fallbacks:      []string{exe},
	}.Resolve()
	if err != nil {
		t.Fatalf("想定外エラー: %v", err)
	}
	if got != exe {
		t.Fatalf("解決パスが違う: got=%q want=%q", got, exe)
	}
}

func TestResolve_設定パス空でPATHあり(t *testing.T) {
	resolved := "/resolved/abs/claude"
	got, err := Resolver{
		Fallbacks: []string{"claude"},
		LookPath: func(name string) (string, error) {
			if name != "claude" {
				t.Fatalf("LookPath へ渡る名前が違う: %q", name)
			}
			return resolved, nil
		},
	}.Resolve()
	if err != nil {
		t.Fatalf("想定外エラー: %v", err)
	}
	if got != resolved {
		t.Fatalf("解決済み絶対パスを返すべき: got=%q want=%q", got, resolved)
	}
}

func TestResolve_設定パス空でPATH無しなら未検出(t *testing.T) {
	_, err := Resolver{
		Fallbacks: []string{"claude"},
		LookPath: func(string) (string, error) {
			return "", errors.New("not found")
		},
	}.Resolve()
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("ErrNotFound を期待: got=%v", err)
	}
}

func TestResolve_フォールバックは先頭優先で絶対パス候補を検証(t *testing.T) {
	dir := t.TempDir()
	good := writeExecutable(t, dir, "agy")
	missing := filepath.Join(dir, "missing-agy")

	// 先頭は存在しない絶対パス → スキップし、次の有効な絶対パスへ。
	got, err := Resolver{
		Fallbacks: []string{missing, good},
	}.Resolve()
	if err != nil {
		t.Fatalf("想定外エラー: %v", err)
	}
	if got != good {
		t.Fatalf("2番目の有効候補を返すべき: got=%q want=%q", got, good)
	}
}

func TestResolve_全フォールバック空なら未検出(t *testing.T) {
	_, err := Resolver{Fallbacks: []string{"", "   "}}.Resolve()
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("ErrNotFound を期待: got=%v", err)
	}
}

func TestValidate_Statエラーをそのまま返す(t *testing.T) {
	sentinel := errors.New("stat boom")
	r := Resolver{
		Stat: func(string) (os.FileInfo, error) { return nil, sentinel },
	}
	if err := r.validate("/whatever"); !errors.Is(err, sentinel) {
		t.Fatalf("Stat のエラーを透過すべき: got=%v", err)
	}
}

func TestValidate_通常ファイルでなければInvalid(t *testing.T) {
	r := Resolver{
		Stat: func(string) (os.FileInfo, error) {
			return fakeFileInfo{mode: fs.ModeDir | 0o755}, nil
		},
	}
	if err := r.validate("/dir"); !errors.Is(err, fs.ErrInvalid) {
		t.Fatalf("fs.ErrInvalid を期待: got=%v", err)
	}
}

// fakeFileInfo は validate の種別・権限判定用の最小 FileInfo。
type fakeFileInfo struct {
	mode fs.FileMode
}

func (f fakeFileInfo) Name() string       { return "fake" }
func (f fakeFileInfo) Size() int64        { return 0 }
func (f fakeFileInfo) Mode() fs.FileMode  { return f.mode }
func (f fakeFileInfo) ModTime() time.Time { return time.Time{} }
func (f fakeFileInfo) IsDir() bool        { return f.mode.IsDir() }
func (f fakeFileInfo) Sys() any           { return nil }
