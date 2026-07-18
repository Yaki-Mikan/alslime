//go:build !debug

package logging

// 配布版（debug タグなし）では Info / Debug は何もしない。
// 内部プロンプト・トークン・HTTP direct の詳細などを配布版ログへ漏らさないため、
// これらの呼び出しはコンパイル時に無害化される。

func infoImpl(format string, args ...any) {}

func debugImpl(format string, args ...any) {}
