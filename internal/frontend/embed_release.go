//go:build release

package frontend

import "embed"

// 配布ビルドでは、build-release.ps1 が生成する dist_release を埋め込む。
//
//go:embed all:dist_release
var frontendFS embed.FS

const frontendRoot = "dist_release"
