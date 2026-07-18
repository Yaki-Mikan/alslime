package settingspack

import (
	"encoding/json"

	"alslime/internal/config"
)

// Manifest はパック zip ルートの alslime-pack.json（設計 §3-3）。
//
// マニフェストは無くてもよい（手作りパック許容）。無い場合は
// packFormat=1・構造検知に従う。
type Manifest struct {
	// PackFormat はパック仕様バージョン。現行より大きい値は拒否する。
	PackFormat int `json:"packFormat"`
	// Structure はワークスペース構造世代（現行 "workspace-v2"）。
	Structure string `json:"structure,omitempty"`
	// Name はパック名（表示用）。
	Name string `json:"name,omitempty"`
	// Description はパック説明（表示用）。
	Description string `json:"description,omitempty"`
	// CreatedAt は作成日時（RFC3339）。
	CreatedAt string `json:"createdAt,omitempty"`
	// CreatedBy は作成元（"alslime <version>" 等）。
	CreatedBy string `json:"createdBy,omitempty"`
	// Contents は内容一覧（種別ごとの件数。表示用の目安であり正本は実エントリ）。
	Contents []ManifestContent `json:"contents,omitempty"`
}

// ManifestContent はマニフェストの内容一覧1件。
type ManifestContent struct {
	Kind  string `json:"kind"`
	Count int    `json:"count"`
}

// ParseManifest は alslime-pack.json の中身を解釈する。
//
// JSON として壊れている場合はエラー。packFormat が現行より新しい場合も
// エラー（互換性を保証できないため安全側で拒否。設計 §3-3）。
// packFormat 省略（0）は 1 とみなす。
func ParseManifest(data []byte) (*Manifest, error) {
	var m Manifest
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, ErrManifestInvalid
	}
	if m.PackFormat == 0 {
		m.PackFormat = 1
	}
	if m.PackFormat > config.SettingsPackFormat {
		return nil, ErrPackFormatTooNew
	}
	return &m, nil
}
