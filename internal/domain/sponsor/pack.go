package sponsor

// モジュールに紐づかない支援者向け配布パック（表情プロンプトのサンプル等）の取得。
//
// モジュールと同じ流れで取得する：配信用ドメインの署名付き一覧ファイルから最も新しい
// バージョンを選び、entitlement サーバーのダウンロード許可を付けて取得し、SHA-256 と
// サイズを照合する。検証済みの zip は一時ファイルとして install へ渡し、戻り後に削除する。

import (
	"context"
	"errors"
	"os"
	"regexp"
	"strings"

	"alslime/internal/config"
)

var packIDPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,63}$`)

// ErrPackUnknown はパック ID が不正。
var ErrPackUnknown = errors.New("sponsor: unknown pack id")

// FetchPack はパックを取得・検証し、zip のパスを install へ渡す。戻り値はパックの版。
// トークン無しは ErrModuleNoToken、401 は ErrTokenInvalid、403 は ErrTierRejected、未配布は ErrModuleUnavailable、
// 一覧ファイルを取得できない場合は ErrManifestUnavailable（モジュール取得と同じ判定）。
func (s *Service) FetchPack(ctx context.Context, packID string, install func(zipPath string) error) (string, error) {
	if !packIDPattern.MatchString(packID) {
		return "", ErrPackUnknown
	}
	tok := s.store.Current()
	if tok == "" {
		return "", ErrModuleNoToken
	}
	manifest, err := s.fetchDownloadManifest(ctx)
	if err != nil {
		return "", err
	}
	pack := selectPack(manifest.Packs[packID])
	if pack == nil {
		return "", ErrModuleUnavailable
	}
	if pack.Size > config.SettingsPackMaxUploadBytes {
		return "", errors.New("sponsor: pack exceeds the size limit")
	}
	grant, err := s.requestDownloadGrant(ctx, tok, downloadKindPack, packID, pack.Version)
	if err != nil {
		return "", err
	}
	tmp, err := os.CreateTemp("", "alslime-pack-*.zip")
	if err != nil {
		return "", err
	}
	tmpPath := tmp.Name()
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpPath)
		return "", err
	}
	defer func() { _ = os.Remove(tmpPath) }()
	folder := downloadFolder(downloadKindPack, packID, pack.Version)
	sum, size, err := s.downloadGranted(ctx, grant, folder, pack.Name, tmpPath, pack.Size, 0o600)
	if err != nil {
		return "", err
	}
	if size != pack.Size || !strings.EqualFold(sum, pack.SHA256) {
		return "", errors.New("sponsor: pack hash or size mismatch")
	}
	if err := install(tmpPath); err != nil {
		return "", err
	}
	return pack.Version, nil
}
