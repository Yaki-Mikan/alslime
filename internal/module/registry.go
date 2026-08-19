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
	// ModuleTTS は音声読み上げ（Irodori-TTS連携）サイドカー。
	ModuleTTS = "tts"
)

// Definition は配布モジュールと付属物の宣言。
type Definition struct {
	ID            string
	CompanionPack bool
}

// Definitions は配布対応モジュールの正本（表示順）。
func Definitions() []Definition {
	return []Definition{
		{ID: ModuleComfy, CompanionPack: true},
		{ID: ModuleActionChoice},
		// TTS の companion pack は絵文字説明ファイル・Latent変換用ONNXモデル・
		// セットアップ案内を配布する（設定パック種別 "tts"）。
		{ID: ModuleTTS, CompanionPack: true},
	}
}

// IDs は配布対応モジュールの一覧（表示順）。
func IDs() []string {
	defs := Definitions()
	out := make([]string, 0, len(defs))
	for _, def := range defs {
		out = append(out, def.ID)
	}
	return out
}

// ExePath はモジュールの本体側配置パスを返す
// （<WORKSPACE_ROOT>/modules/alslime-<id>。Windows は .exe 付き）。
func ExePath(workspaceRoot, moduleID string) string {
	name := "alslime-" + moduleID
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	return filepath.Join(workspaceRoot, "modules", name)
}

// ReceiptPath はモジュール配置レシートのパスを返す
// （<WORKSPACE_ROOT>/modules/alslime-<id>.receipt.json。ファイル自動更新、確認 01番 6.1）。
// 配置済みバージョンの正本で、更新有無の判定とクリーン再導入の対象限定に使う。
func ReceiptPath(workspaceRoot, moduleID string) string {
	return filepath.Join(workspaceRoot, "modules", "alslime-"+moduleID+".receipt.json")
}
