package coreapi

import "strings"

// PromptLocale はプロンプト層（AIへ渡すタグ・指示文）の言語解決コンテキスト。
//
// Lang は UI 言語設定（uiLanguage）由来の言語コード。Messages は i18n カタログ
// （prompt.* キーを含む。内蔵 ja/en に WORKSPACE の i18n/<lang>.json を上書き合成）。
// 組み立て層が「送信のたびに現在の uiLanguage でカタログを解決するクロージャ」を
// 各 Assembler / Runner へ注入する。
//
// 方針: プロンプト層の文言は必ず PromptLocale.Text(key, 日本語既定) で引くこと。
// 日本語既定は Node 版と同一文言を保ち、辞書が取得できない場合でも
// 従来（ja）の出力が完全に維持されるようにする。
// （旧 chatflow.PromptLocale。chatflow 側はエイリアスで互換を保つ。）
type PromptLocale struct {
	Lang     string
	Messages map[string]string
}

// Text は key の文言を返す。辞書に無い・空の場合は fallback（日本語既定）。
func (l PromptLocale) Text(key, fallback string) string {
	if l.Messages != nil {
		if v := strings.TrimSpace(l.Messages[key]); v != "" {
			return v
		}
	}
	return fallback
}

// LangOrDefault は言語コードを返す（未設定なら ja）。
func (l PromptLocale) LangOrDefault() string {
	if strings.TrimSpace(l.Lang) != "" {
		return l.Lang
	}
	return "ja"
}
