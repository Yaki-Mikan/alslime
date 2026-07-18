// Package serversettings は起動前サーバー設定のユースケースを担う。
//
// 稼働中プロセスの host / port は即時変更しない。
// ここで保存する値は次回起動時に config.Load が読む。
package serversettings

import (
	"errors"
	"strings"

	"alslime/internal/config"
	"alslime/internal/i18n"
	storage "alslime/internal/storage/serversettings"
)

// ErrInvalidPort は port が範囲外の場合に返す。
var ErrInvalidPort = errors.New(i18n.KeyErrorInvalidServerPort)

// ErrInvalidBindAddress は bindAddress が危険な文字列の場合に返す。
var ErrInvalidBindAddress = errors.New(i18n.KeyErrorInvalidBindAddress)

// Settings は API と storage で共有する起動前サーバー設定。
type Settings = storage.Settings

// CLIPaths は各 AI CLI 実行ファイルの明示指定パス（storage と共有）。
type CLIPaths = storage.CLIPaths

// Patch は POST /api/settings/server の部分更新。
type Patch struct {
	Port        *int           `json:"port"`
	BindAddress *string        `json:"bindAddress"`
	LANPublic   *bool          `json:"lanPublic"`
	CLIPaths    *CLIPathsPatch `json:"cliPaths"`
}

// CLIPathsPatch は cliPaths の部分更新。
//
// 各フィールドが nil のものは据え置き、非 nil のものだけ更新する。
// 空文字は「未設定へ戻す（フォールバック探索）」を意味する。
type CLIPathsPatch struct {
	Gemini      *string `json:"gemini"`
	Claude      *string `json:"claude"`
	Antigravity *string `json:"antigravity"`
}

// Service は起動前サーバー設定を取得・更新する。
type Service struct {
	store *storage.Store
}

// New は Service を生成する。
func New(store *storage.Store) *Service {
	return &Service{store: store}
}

// Get は保存済み設定、または既定値を返す。
func (s *Service) Get() (Settings, error) {
	return s.store.Load()
}

// Update は patch を既存設定へ反映し、保存後の値を返す。
func (s *Service) Update(patch Patch) (Settings, error) {
	current, err := s.store.Load()
	if err != nil {
		return Settings{}, err
	}
	if patch.Port != nil {
		current.Port = *patch.Port
	}
	if patch.BindAddress != nil {
		current.BindAddress = strings.TrimSpace(*patch.BindAddress)
	}
	if patch.LANPublic != nil {
		current.LANPublic = *patch.LANPublic
	}
	if patch.CLIPaths != nil {
		applyCLIPathsPatch(&current.CLIPaths, *patch.CLIPaths)
	}
	normalizeLANPublic(&current)
	if err := validate(current); err != nil {
		return Settings{}, err
	}
	return s.store.Save(current)
}

// normalizeLANPublic は UI で LAN公開だけを ON にした場合の矛盾を避ける。
//
// 未編集の既定 bindAddress のまま lanPublic=true を保存すると、起動時は
// bindAddress 優先で 127.0.0.1 になり、LAN公開にならない。
// 利用者が明示的に別アドレスを入れた場合は尊重し、既定値のときだけ全IFへ寄せる。
// applyCLIPathsPatch は非 nil のフィールドだけを反映する。
// 空文字（未設定へ戻す指定）も尊重し、値は TrimSpace して保存する。
func applyCLIPathsPatch(current *CLIPaths, patch CLIPathsPatch) {
	if patch.Gemini != nil {
		current.Gemini = strings.TrimSpace(*patch.Gemini)
	}
	if patch.Claude != nil {
		current.Claude = strings.TrimSpace(*patch.Claude)
	}
	if patch.Antigravity != nil {
		current.Antigravity = strings.TrimSpace(*patch.Antigravity)
	}
}

func normalizeLANPublic(settings *Settings) {
	if settings.LANPublic && settings.BindAddress == config.DefaultHost {
		settings.BindAddress = config.DefaultLANHost
	}
}

func validate(settings Settings) error {
	if settings.Port < 1 || settings.Port > 65535 {
		return ErrInvalidPort
	}
	if !validBindAddress(settings.BindAddress) {
		return ErrInvalidBindAddress
	}
	return nil
}

func validBindAddress(value string) bool {
	if value == "" {
		return false
	}
	return !strings.ContainsAny(value, `/\`)
}
