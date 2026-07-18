// Package serversettings は起動前サーバー設定の保存先を担う。
//
// 設定ファイルの正本:
//
//	roleplay/global/settings/server-settings.json
//
// 起動時 config.Load と同じファイルを見るが、この package は HTTP API から
// 次回起動用の値を確認・保存するための薄い storage 層。
package serversettings

import (
	"errors"
	"io/fs"
	"os"

	"alslime/internal/config"
	"alslime/internal/storage/jsonstore"
	"alslime/internal/storage/paths"
)

// Settings は server-settings.json の構造。
type Settings struct {
	Port        int      `json:"port"`
	BindAddress string   `json:"bindAddress"`
	LANPublic   bool     `json:"lanPublic"`
	CLIPaths    CLIPaths `json:"cliPaths"`
}

// CLIPaths は各 AI CLI 実行ファイルの明示指定パス。
//
// 空文字は「未設定＝フォールバック探索（PATH / 既定パス）」を意味する。
// ここには実行ファイルの絶対パスまたはコマンド名が入り、cliresolve が
// 起動前に検証する。認証情報ではないためログ・レスポンスへ載せてよい値だが、
// 起動解決の結果パスは別途秘匿する（呼び出し側責務）。
type CLIPaths struct {
	Gemini      string `json:"gemini"`
	Claude      string `json:"claude"`
	Antigravity string `json:"antigravity"`
}

// Store は server-settings.json の読み書きを担う。
type Store struct {
	resolver *paths.Resolver
	logical  string
}

// New は Store を生成する。logical は locations 由来の論理パス。
func New(resolver *paths.Resolver, logical string) *Store {
	return &Store{resolver: resolver, logical: logical}
}

// Load は保存済み設定を読み、未作成なら既定値を返す。
func (s *Store) Load() (Settings, error) {
	logical, err := s.existingLogical()
	if err != nil {
		return Settings{}, err
	}
	if logical == "" {
		return Defaults(), nil
	}
	path, err := s.resolver.ResolveLexical(logical)
	if err != nil {
		return Settings{}, err
	}
	var out Settings
	if err := jsonstore.ReadJSON(path, &out); err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return Defaults(), nil
		}
		return Settings{}, err
	}
	applyDefaults(&out)
	return out, nil
}

// Save は server-settings.json を作成・上書きする。
func (s *Store) Save(settings Settings) (Settings, error) {
	applyDefaults(&settings)
	path, err := s.resolver.ResolveForCreateMkdirAll(s.logical, config.DirPerm)
	if err != nil {
		return Settings{}, err
	}
	if err := jsonstore.WriteJSON(path, settings); err != nil {
		return Settings{}, err
	}
	return settings, nil
}

// Defaults は server-settings.json 未作成時の既定値を返す。
func Defaults() Settings {
	return Settings{
		Port:        config.DefaultPort,
		BindAddress: config.DefaultHost,
		LANPublic:   false,
	}
}

func applyDefaults(settings *Settings) {
	defaults := Defaults()
	if settings.Port == 0 {
		settings.Port = defaults.Port
	}
	if settings.BindAddress == "" {
		settings.BindAddress = defaults.BindAddress
	}
}

func (s *Store) existingLogical() (string, error) {
	candidates := []string{s.logical}
	if s.logical == config.ServerSettingsFile {
		candidates = append(candidates, config.LegacyServerSettingsFile)
	}
	for _, logical := range candidates {
		path, err := s.resolver.ResolveLexical(logical)
		if err != nil {
			return "", err
		}
		if _, statErr := os.Lstat(path); statErr == nil {
			return logical, nil
		} else if !errors.Is(statErr, fs.ErrNotExist) {
			return "", statErr
		}
	}
	return "", nil
}
