// Package firstrun は起動時のワークスペース初期化を担う。
//
// 責務: WORKSPACE_ROOT 配下に必要ディレクトリ一式を作成し、同梱デフォルト
// ファイル（defaults/ 配下に埋め込んだもの）を「存在しない場合のみ」書き出す。
// 既存ファイルは絶対に上書きしない（何度起動しても既存環境は不変）。
package firstrun

import (
	"bytes"
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
		config.TTSDir,
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
//
// 固定 API プリセット指示だけは、旧版が配布した「短い追加指示」と完全一致する
// 場合に限り、Claude 相当の API 基本指示を含む全文へ安全に更新する。利用者が
// 1 文字でも編集したファイルは従来どおり上書きしない。
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
		data, legacyData, err := materializeDefault(p, rel)
		if err != nil {
			return err
		}
		if existing, readErr := os.ReadFile(dest); readErr == nil {
			if legacyData == nil || !bytes.Equal(existing, legacyData) {
				return nil
			}
			return os.WriteFile(dest, data, config.FilePerm)
		} else if !os.IsNotExist(readErr) {
			return readErr
		}
		if err := os.MkdirAll(filepath.Dir(dest), config.DirPerm); err != nil {
			return err
		}
		return os.WriteFile(dest, data, config.FilePerm)
	})
}

// DefaultContent は同梱デフォルトの書き出し内容を返す（rel は WORKSPACE_ROOT
// 相対・"/" 区切り）。初回書き出しと同一の内容を返すため、「デフォルトへ戻す」
// 系の機能はこれを正本として利用者ファイルを上書きできる。
func DefaultContent(rel string) ([]byte, error) {
	data, _, err := materializeDefault(defaultsRoot+"/"+rel, rel)
	return data, err
}

// materializeDefault は埋め込みデフォルトの書き出し内容を返す。
// 固定3プリセットは、埋め込み側に保持する旧「追加指示」を API 共通基本指示の
// 後ろへ結合し、各ファイル単体で基本指示として成立させる。
func materializeDefault(embeddedPath, rel string) (data, legacyData []byte, err error) {
	data, err = defaultsFS.ReadFile(embeddedPath)
	if err != nil {
		return nil, nil, err
	}
	presetPrefix := config.OpenAICompatPresetPromptsDir + "/"
	if !strings.HasPrefix(rel, presetPrefix) {
		return data, nil, nil
	}
	locale := strings.TrimSuffix(path.Base(rel), ".md")
	locale = strings.TrimPrefix(locale, "system.")
	if locale != "ja" && locale != "en" {
		return data, nil, nil
	}
	basePath := defaultsRoot + "/" + config.OpenAICompatSystemPromptFile(locale)
	base, readErr := defaultsFS.ReadFile(basePath)
	if readErr != nil {
		return nil, nil, readErr
	}
	legacyData = data
	joined := make([]byte, 0, len(base)+len(data)+2)
	joined = append(joined, bytes.TrimSpace(base)...)
	joined = append(joined, '\n', '\n')
	joined = append(joined, bytes.TrimSpace(data)...)
	joined = append(joined, '\n')
	return joined, legacyData, nil
}
