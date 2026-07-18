// Package logging は配布版でデバッグ出力を抑制できるロガーを提供する。
//
// 配布版（既定ビルド）は Error / Warn のみを出し、Info / Debug は出さない。
// 開発版は build tag "debug" を付けてビルドすると Info / Debug も出る。
// Debug の実体は build tag で切り替わる（debug_enabled.go / debug_stub.go）。
package logging

import (
	"log"
	"os"
)

var (
	errLogger  = log.New(os.Stderr, "", log.LstdFlags)
	warnLogger = log.New(os.Stderr, "", log.LstdFlags)
)

// Error は配布版でも出力する。利用者対応に必要な最低限の異常を記録する。
func Error(format string, args ...any) {
	errLogger.Printf("[ERROR] "+format, args...)
}

// Warn は配布版でも必要最小限のみ出力する。
func Warn(format string, args ...any) {
	warnLogger.Printf("[WARN] "+format, args...)
}

// Info は配布版では出力しない。デバッグビルドでのみ出る（debug_*.go 参照）。
func Info(format string, args ...any) {
	infoImpl(format, args...)
}

// Debug は配布版では出力しない。デバッグビルドでのみ出る（debug_*.go 参照）。
func Debug(format string, args ...any) {
	debugImpl(format, args...)
}
