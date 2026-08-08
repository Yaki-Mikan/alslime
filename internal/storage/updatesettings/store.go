// Package updatesettings はアップデート確認設定の保存先を担う。
//
// 設定ファイルの正本:
//
//	roleplay/global/settings/update-settings.json
//
// 自動確認の ON/OFF と「このバージョンの告知をスキップ」の版数を保持する
// （ファイル自動更新、確認 01番 3章）。
package updatesettings

import (
	"errors"
	"io/fs"

	"alslime/internal/config"
	"alslime/internal/storage/jsonstore"
	"alslime/internal/storage/paths"
)

// Settings は update-settings.json の構造。
//
// AutoCheckDisabled はゼロ値（false）＝自動確認有効。既定 ON をゼロ値で
// 表現するため、JSON 上も「無効化フラグ」として持つ（API 層で autoCheck へ反転する）。
type Settings struct {
	AutoCheckDisabled bool `json:"autoCheckDisabled"`
	// SkippedVersion は告知をスキップした本体バージョン（v 無しの正規化形。例 "0.1.5"）。
	// より新しいバージョンの検知時は無視される。
	SkippedVersion string `json:"skippedVersion"`
	// PostponedDate は「後で」を押した日付（ローカル日付 "2006-01-02" 形式）。
	// 同日中は起動時の告知モーダルを出さない（翌日以降は再表示）。
	PostponedDate string `json:"postponedDate"`
	// PendingModuleUpdates は一括全更新でユーザーが承認したモジュール更新のうち、
	// 本体の更新完了後でないと適用できないもの（minAppVersion 制約）の ID 一覧。
	// 本体更新後の起動時に一度だけ適用を試み、成否に関わらずクリアされる
	//（承認していない更新を起動時に勝手に適用しないための正本）。
	PendingModuleUpdates []string `json:"pendingModuleUpdates,omitempty"`
}

// Store は update-settings.json の読み書きを担う。
type Store struct {
	resolver *paths.Resolver
	logical  string
}

// New は Store を生成する。logical は locations 由来の論理パス。
func New(resolver *paths.Resolver, logical string) *Store {
	return &Store{resolver: resolver, logical: logical}
}

// Load は保存済み設定を読み、未作成なら既定値（ゼロ値）を返す。
func (s *Store) Load() (Settings, error) {
	path, err := s.resolver.ResolveLexical(s.logical)
	if err != nil {
		return Settings{}, err
	}
	var out Settings
	if err := jsonstore.ReadJSON(path, &out); err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return Settings{}, nil
		}
		return Settings{}, err
	}
	return out, nil
}

// Save は update-settings.json を作成・上書きする。
func (s *Store) Save(settings Settings) (Settings, error) {
	path, err := s.resolver.ResolveForCreateMkdirAll(s.logical, config.DirPerm)
	if err != nil {
		return Settings{}, err
	}
	if err := jsonstore.WriteJSON(path, settings); err != nil {
		return Settings{}, err
	}
	return settings, nil
}
