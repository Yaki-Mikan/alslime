// Package manual は同梱の操作マニュアル（Markdown＋画像）を保持する。
//
// docs/manual 配下を go:embed で本体へ焼き込み、アプリ内マニュアル表示
// （/api/manual・マニュアル作成/00_マニュアル設計.md §8-2）から配信する。
// GitHub 上での閲覧（README からのリンク）と同じファイルが正本。
package manual

import "embed"

// FS は操作マニュアル一式（index.md / ja / en / images）。
//
//go:embed index.md ja en images
var FS embed.FS
