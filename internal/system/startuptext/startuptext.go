// Package startuptext は、起動に失敗したときにコンソールへ出す理由の文を、
// 利用者が選んだ表示言語で組み立てる。
//
// 起動の途中で止まるため、サーバーの各サービスは使えない。作業場所が分かれば
// そこの表示言語の設定と辞書を直に読み、分からない・読めないときは内蔵辞書で組み立てる。
package startuptext

import (
	"errors"
	"strings"

	"alslime/internal/config"
	i18nsvc "alslime/internal/i18n"
	"alslime/internal/storage/locations"
	"alslime/internal/storage/paths"
	pwasettingsstore "alslime/internal/storage/pwasettings"
)

// Describe は key の文の {{detail}} へ cause を差し込んだ理由の文を返す。
// root は作業場所（分からなければ空）。cause が config.StartupError なら、
// その理由も同じ表示言語の文にしてから差し込む。
func Describe(root, key string, cause error) string {
	messages := loadMessages(root)
	detail := ""
	if cause != nil {
		detail = cause.Error()
		var startupErr *config.StartupError
		if errors.As(cause, &startupErr) {
			detail = fill(messages, startupErr.Key, startupErr.Values)
		}
	}
	return fill(messages, key, map[string]string{"detail": detail})
}

// loadMessages は作業場所の表示言語の辞書を返す。
func loadMessages(root string) map[string]string {
	if root == "" {
		return i18nsvc.BuiltinMessages(config.I18NDefaultLang)
	}
	resolver := paths.NewResolver(root)
	locs := locations.NewResolver()
	lang := ""
	if settings, err := pwasettingsstore.New(resolver, locs.MustPath(locations.PWASettingsFile)).Load(); err == nil {
		lang, _ = settings["uiLanguage"].(string)
	}
	catalog, err := i18nsvc.New(resolver, locs.MustPath(locations.I18NDir)).Load(lang)
	if err != nil {
		// 作業場所の辞書が壊れていても、選ばれた言語の内蔵辞書で理由を出す。
		return i18nsvc.BuiltinMessages(lang)
	}
	return catalog.Messages
}

// fill は key の文の {{名前}} へ values を差し込む。辞書に無い鍵はそのまま返す。
func fill(messages map[string]string, key string, values map[string]string) string {
	text := messages[key]
	if text == "" {
		return key
	}
	for name, value := range values {
		text = strings.ReplaceAll(text, "{{"+name+"}}", value)
	}
	return text
}
