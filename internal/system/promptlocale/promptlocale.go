// Package promptlocale は UI 言語設定（uiLanguage）に対応するプロンプト層の言語解決を組み立てる。
//
// 本体のチャット実行と、ComfyUI サイドカーの Antigravity 経路（画像タグ判定・容姿プロンプト
// 作成）が同じ規則を使う。どちらも同じワークスペースの PWA 設定と i18n 辞書を正本とする。
package promptlocale

import (
	"alslime/internal/coreapi"
	pwasettingssvc "alslime/internal/domain/pwasettings"
	i18nsvc "alslime/internal/i18n"
)

// Resolver は呼び出しのたびに現在の設定で言語を解決する関数を返す
// （起動中の UI 言語の切り替えを次の実行から反映する）。
func Resolver(i18nService *i18nsvc.Service, pwaSvc *pwasettingssvc.Service) func() coreapi.PromptLocale {
	return func() coreapi.PromptLocale {
		return Resolve(i18nService, pwaSvc)
	}
}

// Resolve は UI 言語設定（uiLanguage）に対応するプロンプト層の
// 言語解決コンテキスト（prompt.* キーを含む i18n カタログ）を返す。
// 設定・辞書の取得に失敗した場合は空（呼び出し側が日本語既定へフォールバック）。
//
// 必ず LoadPrompt（fallback 補完なし）を使うこと。Load（UI 辞書）を使うと
// 内蔵 ja に無い prompt.* キーが内蔵 en から補完され、コード内日本語既定への
// フォールバックが発動しなくなる（セリフ引用符が "" になった不具合の原因）。
func Resolve(i18nService *i18nsvc.Service, pwaSvc *pwasettingssvc.Service) coreapi.PromptLocale {
	lang := ""
	if settings, err := pwaSvc.Get(); err == nil {
		lang, _ = settings["uiLanguage"].(string)
	}
	catalog, err := i18nService.LoadPrompt(lang)
	if err != nil {
		return coreapi.PromptLocale{Lang: lang}
	}
	return coreapi.PromptLocale{Lang: catalog.Lang, Messages: catalog.Messages}
}
