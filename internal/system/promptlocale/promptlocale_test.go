package promptlocale

import (
	"os"
	"testing"

	"alslime/internal/config"
	pwasettingssvc "alslime/internal/domain/pwasettings"
	i18nsvc "alslime/internal/i18n"
	"alslime/internal/storage/locations"
	"alslime/internal/storage/paths"
	pwasettingsstore "alslime/internal/storage/pwasettings"
)

// 方式C の文脈読込完了の合成応答に使うキー（Antigravity が Locale から引く代表例）。
const completionKey = i18nsvc.KeyPromptNativeHistoryContextLoadCompleteSingle

type fixture struct {
	resolver *paths.Resolver
	i18n     *i18nsvc.Service
	pwa      *pwasettingssvc.Service
}

func newFixture(t *testing.T) fixture {
	t.Helper()
	resolver := paths.NewResolver(t.TempDir())
	locs := locations.NewResolver()
	return fixture{
		resolver: resolver,
		i18n:     i18nsvc.New(resolver, locs.MustPath(locations.I18NDir)),
		pwa:      pwasettingssvc.New(pwasettingsstore.New(resolver, locs.MustPath(locations.PWASettingsFile))),
	}
}

func (f fixture) setLang(t *testing.T, lang string) {
	t.Helper()
	if _, err := f.pwa.Update(map[string]any{"uiLanguage": lang}); err != nil {
		t.Fatal(err)
	}
}

// writeRawSettings は PWA 設定ファイルへ内容をそのまま書く（壊れた設定・不正な言語の再現用）。
func (f fixture) writeRawSettings(t *testing.T, content string) {
	t.Helper()
	path, err := f.resolver.ResolveForCreateMkdirAll(locations.NewResolver().MustPath(locations.PWASettingsFile), config.DirPerm)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), config.FilePerm); err != nil {
		t.Fatal(err)
	}
}

func TestResolve_uiLanguageの辞書を返す(t *testing.T) {
	f := newFixture(t)
	f.setLang(t, "ja")
	ja := Resolve(f.i18n, f.pwa)
	f.setLang(t, "en")
	en := Resolve(f.i18n, f.pwa)
	if ja.Lang != "ja" || ja.Text(completionKey, "") == "" {
		t.Fatalf("ja: unexpected locale: lang=%q text=%q", ja.Lang, ja.Text(completionKey, ""))
	}
	if en.Lang != "en" || en.Text(completionKey, "") == "" {
		t.Fatalf("en: unexpected locale: lang=%q text=%q", en.Lang, en.Text(completionKey, ""))
	}
	if ja.Text(completionKey, "") == en.Text(completionKey, "") {
		t.Fatalf("ja と en の文言が同じ: %q", ja.Text(completionKey, ""))
	}
}

func TestResolver_設定変更に次の呼び出しから追随する(t *testing.T) {
	f := newFixture(t)
	resolve := Resolver(f.i18n, f.pwa)
	f.setLang(t, "ja")
	if got := resolve().Lang; got != "ja" {
		t.Fatalf("expected ja, got %q", got)
	}
	f.setLang(t, "en")
	if got := resolve().Lang; got != "en" {
		t.Fatalf("expected en, got %q", got)
	}
}

func TestResolve_読取失敗時は既存の既定動作へ落ちる(t *testing.T) {
	t.Run("設定ファイルが壊れていれば既定言語の辞書", func(t *testing.T) {
		f := newFixture(t)
		f.writeRawSettings(t, "{")
		got := Resolve(f.i18n, f.pwa)
		if got.Lang != config.I18NDefaultLang || got.Text(completionKey, "") == "" {
			t.Fatalf("unexpected locale: lang=%q text=%q", got.Lang, got.Text(completionKey, ""))
		}
	})
	t.Run("辞書を読めない言語なら辞書なしでコード内既定を使う", func(t *testing.T) {
		f := newFixture(t)
		f.writeRawSettings(t, `{"uiLanguage":"../ja"}`)
		got := Resolve(f.i18n, f.pwa)
		if got.Messages != nil || got.Text(completionKey, "既定") != "既定" {
			t.Fatalf("unexpected locale: %#v", got)
		}
	})
}
