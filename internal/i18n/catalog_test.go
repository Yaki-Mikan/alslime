package i18n

import (
	"os"
	"path/filepath"
	"strings"
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
	if _, err := svc.LoadPrompt("../ja"); err != ErrInvalidLang {
		t.Fatalf("LoadPrompt invalid lang err=%v", err)
	}
}

func TestServiceLoadPrompt_fallback補完を行わない(t *testing.T) {
	svc := New(paths.NewResolver(t.TempDir()), config.I18NDir)

	// 内蔵 ja に無い prompt.emotion.instruction が内蔵 en から補完されると、
	// コード内日本語既定（emotionInstructionJA）へのフォールバックが発動せず、
	// uiLanguage=ja でもセリフが "" 区切りで生成される（セリフ引用符問題）。
	catalog, err := svc.LoadPrompt("ja")
	if err != nil {
		t.Fatalf("LoadPrompt failed: %v", err)
	}
	if v, ok := catalog.Messages["prompt.emotion.instruction"]; ok {
		t.Fatalf("ja のプロンプト辞書へ en のキーが補完されてはいけない: %q", v)
	}
	// 内蔵 ja 自身のキーは取得できる。
	if catalog.Messages["prompt.fileType.world"] != "世界観設定" {
		t.Fatalf("builtin ja key unexpected: %#v", catalog.Messages["prompt.fileType.world"])
	}

	// en では英語版の出力契約が取得できる（英語UIは "" 区切りが正式仕様）。
	enCatalog, err := svc.LoadPrompt("en")
	if err != nil {
		t.Fatalf("LoadPrompt(en) failed: %v", err)
	}
	if v := enCatalog.Messages["prompt.emotion.instruction"]; !strings.Contains(v, `CharacterName: "Dialogue"`) {
		t.Fatalf("en の出力契約が取得できるべき: %q", v)
	}
}

func TestServiceLoadPrompt_外部辞書は同一言語のみ合成する(t *testing.T) {
	root := t.TempDir()
	svc := New(paths.NewResolver(root), config.I18NDir)

	dir := filepath.Join(root, filepath.FromSlash(config.I18NDir))
	if err := os.MkdirAll(dir, config.DirPerm); err != nil {
		t.Fatalf("mkdir failed: %v", err)
	}
	// 外部 en.json（UI 辞書では fallback として補完される）はプロンプト層へ混ざらない。
	if err := os.WriteFile(filepath.Join(dir, "en.json"), []byte(`{"prompt.only.en":"EN only"}`), config.FilePerm); err != nil {
		t.Fatalf("write failed: %v", err)
	}
	// 外部 ja.json による同一言語の上書きは有効。
	if err := os.WriteFile(filepath.Join(dir, "ja.json"), []byte(`{"prompt.fileType.world":"世界の設定"}`), config.FilePerm); err != nil {
		t.Fatalf("write failed: %v", err)
	}

	catalog, err := svc.LoadPrompt("ja")
	if err != nil {
		t.Fatalf("LoadPrompt failed: %v", err)
	}
	if _, ok := catalog.Messages["prompt.only.en"]; ok {
		t.Fatal("外部 en 辞書が ja のプロンプト辞書へ混ざってはいけない")
	}
	if catalog.Messages["prompt.fileType.world"] != "世界の設定" {
		t.Fatalf("外部 ja 辞書の上書きが効くべき: %#v", catalog.Messages["prompt.fileType.world"])
	}
}
