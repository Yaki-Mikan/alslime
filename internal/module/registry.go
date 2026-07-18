package module

import (
	"path/filepath"
	"runtime"
)

// サイドカーモジュールのレジストリ（複数モジュール対応の正本）。
//
// モジュールを追加するときは IDs へ1行足す。ID は次の全てに共通で使われる:
//   - 配信サーバーのパス（/modules/<id> /modules/<id>/download）
//   - 配信サーバーの置き場（<MODULES_DIR>/<id>/alslime-<id>-<os>-<arch>(.exe)）
//   - 本体の配置ファイル名（<WORKSPACE_ROOT>/modules/alslime-<id>(.exe)）
// 形式は ^[a-z][a-z0-9-]{1,31}$（サーバー側の検証と一致させること）。

const (
	// ModuleComfy は ComfyUI 連携（画像生成）サイドカー。
	ModuleComfy = "comfy"
	// ModuleActionChoice は行動選択肢サイドカー。
	ModuleActionChoice = "actionchoice"
)

// IDs は配布対応モジュールの一覧（表示順）。
func IDs() []string {
	return []string{ModuleComfy, ModuleActionChoice}
}

// ExePath はモジュールの本体側配置パスを返す
//（<WORKSPACE_ROOT>/modules/alslime-<id>。Windows は .exe 付き）。
func ExePath(workspaceRoot, moduleID string) string {
	name := "alslime-" + moduleID
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	return filepath.Join(workspaceRoot, "modules", name)
}
