package i18n

import (
	"os"
	"path/filepath"
	"testing"

	"alslime/internal/config"
	"alslime/internal/storage/paths"
)

func TestServiceLoadBuiltinAndExternal(t *testing.T) {
	root := t.TempDir()
	svc := New(paths.NewResolver(root), config.I18NDir)

	catalog, err := svc.Load("ja")
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}
	if catalog.Messages["app.save"] != "保存" {
		t.Fatalf("builtin ja unexpected: %#v", catalog.Messages["app.save"])
	}

	dir := filepath.Join(root, filepath.FromSlash(config.I18NDir))
	if err := os.MkdirAll(dir, config.DirPerm); err != nil {
		t.Fatalf("mkdir failed: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "ja.json"), []byte(`{"app.save":"保存する"}`), config.FilePerm); err != nil {
		t.Fatalf("write failed: %v", err)
	}
	catalog, err = svc.Load("ja")
	if err != nil {
		t.Fatalf("Load external failed: %v", err)
	}
	if catalog.Messages["app.save"] != "保存する" || catalog.Messages["app.cancel"] == "" {
		t.Fatalf("external merge unexpected: %#v", catalog.Messages)
	}
}

func TestServiceLoad_外部fallbackは内蔵langを上書きしない(t *testing.T) {
	root := t.TempDir()
	svc := New(paths.NewResolver(root), config.I18NDir)

	dir := filepath.Join(root, filepath.FromSlash(config.I18NDir))
	if err := os.MkdirAll(dir, config.DirPerm); err != nil {
		t.Fatalf("mkdir failed: %v", err)
	}
	// 外部 en.json（fallback 辞書）に内蔵 ja にもあるキーを置く。
	if err := os.WriteFile(filepath.Join(dir, "en.json"), []byte(`{"app.save":"Save!!","only.en":"EN only"}`), config.FilePerm); err != nil {
		t.Fatalf("write failed: %v", err)
	}

	catalog, err := svc.Load("ja")
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}
	// lang=ja のとき、内蔵 ja の日本語が外部 fallback(en) に上書きされてはいけない（02調査 中#4）。
	if catalog.Messages["app.save"] != "保存" {
		t.Fatalf("builtin ja must win over external fallback: %#v", catalog.Messages["app.save"])
	}
	// ja に無いキーは fallback から補完される。
	if catalog.Messages["only.en"] != "EN only" {
		t.Fatalf("fallback should fill missing keys: %#v", catalog.Messages["only.en"])
	}
}

func TestServiceInvalidLang(t *testing.T) {
	svc := New(paths.NewResolver(t.TempDir()), config.I18NDir)
	if _, err := svc.Load("../ja"); err != ErrInvalidLang {
		t.Fatalf("invalid lang err=%v", err)
	}
}
