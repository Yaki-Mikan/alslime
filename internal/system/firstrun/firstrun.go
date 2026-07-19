// Package firstrun は起動時のワークスペース初期化を担う。
//
// 責務: WORKSPACE_ROOT 配下に必要ディレクトリ一式を作成し、同梱デフォルト
// ファイル（defaults/ 配下に埋め込んだもの）を「存在しない場合のみ」書き出す。
// 既存ファイルは絶対に上書きしない（何度起動しても既存環境は不変）。
package firstrun

import (
	"embed"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"

	"alslime/internal/config"
	"alslime/internal/domain/configeditor"
)

// defaultsFS は同梱デフォルトファイル。中はワークスペース相対の物理構造を
// そのまま再現しており、対応表なしで機械的に書き出せる。
//
//go:embed all:defaults
var defaultsFS embed.FS

// defaultsRoot は埋め込みディレクトリ名。
const defaultsRoot = "defaults"

// Ensure は workspaceRoot 配下の初期ディレクトリと同梱デフォルトを整える。
func Ensure(workspaceRoot string) error {
	for _, dir := range workspaceDirs() {
		if err := os.MkdirAll(filepath.Join(workspaceRoot, filepath.FromSlash(dir)), config.DirPerm); err != nil {
			return err
		}
	}
	return writeDefaults(workspaceRoot)
}

// workspaceDirs は起動時に用意するディレクトリの一覧（WORKSPACE_ROOT 相対・"/" 区切り）。
//
// 一覧・列挙系 API が参照するディレクトリは、無いと画面表示が成立しないため
// ここで全て作る。書き込み時に各ストアが作る領域（history / temp / cache 等）も、
// 利用者がワークスペース構造を把握できるよう併せて作る。
func workspaceDirs() []string {
	dirs := []string{
		path.Dir(config.GlobalSettingsFile), // roleplay/global/defaults
		config.ParameterSchemaDefaultDir,    // roleplay/global/settings
		config.I18NDir,
		config.LanguageDir,
		config.ParameterSchemaCustomDir,
		config.PresetSSRPModeDir,
		config.PresetDateTimeGroupDir,
		config.PresetSSRPAllDir,
		config.PresetSSRPParamDir,
		config.ParameterNormalModePresetDir,
		path.Dir(config.DateTimePresetsFile), // roleplay/settings
		config.ConfigEditorTemplateRoot,
		config.ComfyUIDir,
		config.ComfyUITemplateDir,
		config.ComfyUIProfileDir,
		config.ComfyUITagMappingDir,
		config.ComfyUIPlaceholderPresetDir,
		config.SettingsPackInboxDir,
		path.Dir(config.SettingsPackInboxLogFile), // roleplay/log
		config.UnifiedSessionsDir,
		config.RuntimeTempDir,
		config.AppCacheDir,
		config.AuthDir,
	}
	for _, c := range configeditor.Categories() {
		dirs = append(dirs, c.Dir)
	}
	return dirs
}

// writeDefaults は同梱デフォルトを、書き出し先に存在しない場合のみ書き出す。
func writeDefaults(workspaceRoot string) error {
	return fs.WalkDir(defaultsFS, defaultsRoot, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		rel := strings.TrimPrefix(p, defaultsRoot+"/")
		dest := filepath.Join(workspaceRoot, filepath.FromSlash(rel))
		if _, statErr := os.Stat(dest); statErr == nil {
			return nil
		} else if !os.IsNotExist(statErr) {
			return statErr
		}
		if err := os.MkdirAll(filepath.Dir(dest), config.DirPerm); err != nil {
			return err
		}
		data, err := defaultsFS.ReadFile(p)
		if err != nil {
			return err
		}
		return os.WriteFile(dest, data, config.FilePerm)
	})
}
