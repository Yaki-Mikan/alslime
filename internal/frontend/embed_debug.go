//go:build debug

package frontend

import "embed"

// デバッグビルドでは、build-debug.ps1 が生成する dist_debug を埋め込む。
//
//go:embed all:dist_debug
var frontendFS embed.FS

const frontendRoot = "dist_debug"
