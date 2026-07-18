//go:build !release && !debug

package frontend

import "embed"

// 通常のテスト・ローカル実行では、追跡済みのプレースホルダ dist を使う。
// 既存PWAの通常ビルドやデプロイとは別物として扱う。
//
//go:embed all:dist
var frontendFS embed.FS

const frontendRoot = "dist"
