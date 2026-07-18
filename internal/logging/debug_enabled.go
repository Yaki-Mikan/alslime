//go:build debug

package logging

import (
	"log"
	"os"
)

// デバッグビルド（go build -tags debug）でのみ Info / Debug を出力する。

var (
	infoLogger  = log.New(os.Stdout, "", log.LstdFlags)
	debugLogger = log.New(os.Stdout, "", log.LstdFlags)
)

func infoImpl(format string, args ...any) {
	infoLogger.Printf("[INFO] "+format, args...)
}

func debugImpl(format string, args ...any) {
	debugLogger.Printf("[DEBUG] "+format, args...)
}
