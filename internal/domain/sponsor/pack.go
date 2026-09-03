package sponsor

// モジュールに紐づかない支援者向け配布パック（表情プロンプトのサンプル等）の取得。
//
// サーバーの GET /packs/{pack}（署名付きマニフェスト）→ GET /packs/{pack}/download（zip）を
// 付属パック（companion pack）と同じ手順で検証する：署名（Sig を除いた正規化 JSON への Ed25519）、
// SHA-256、サイズ。検証済みの zip は一時ファイルとして install へ渡し、戻り後に削除する。

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"strings"

	"alslime/internal/config"
)

// packManifest はサーバーの PackManifest と同じ形（契約）。
type packManifest struct {
	Pack      string `json:"pack"`
	Version   string `json:"version"`
	SHA256    string `json:"sha256"`
	SizeBytes int64  `json:"sizeBytes"`
	Sig       string `json:"sig"`
}

var packIDPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,63}$`)

// ErrPackUnknown はパック ID が不正。
var ErrPackUnknown = errors.New("sponsor: unknown pack id")

// FetchPack はパックを取得・検証し、zip のパスを install へ渡す。戻り値はパックの版。
// トークン無しは ErrModuleNoToken、401 は ErrTokenInvalid、403 は ErrTierRejected、未配布は ErrModuleUnavailable
// （モジュール取得と同じ判定）。
func (s *Service) FetchPack(ctx context.Context, packID string, install func(zipPath string) error) (string, error) {
	if !packIDPattern.MatchString(packID) {
		return "", ErrPackUnknown
	}
	if s.verifySig == nil {
		return "", errors.New("sponsor: pack fetch is not configured")
	}
	tok := s.store.Current()
	if tok == "" {
		return "", ErrModuleNoToken
	}
	manifest, err := s.fetchPackManifest(ctx, tok, packID)
	if err != nil {
		return "", err
	}
	payload := manifest
	payload.Sig = ""
	canonical, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	if err := s.verifySig(canonical, manifest.Sig); err != nil {
		return "", fmt.Errorf("sponsor: pack manifest verification failed: %w", err)
	}
	if manifest.Pack != packID || manifest.SHA256 == "" || manifest.SizeBytes <= 0 ||
		manifest.SizeBytes > config.SettingsPackMaxUploadBytes {
		return "", errors.New("sponsor: incomplete pack manifest")
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
	sum, size, err := s.downloadPack(ctx, tok, packID, tmpPath, manifest.SizeBytes)
	if err != nil {
		return "", err
	}
	if size != manifest.SizeBytes || !strings.EqualFold(sum, manifest.SHA256) {
		return "", errors.New("sponsor: pack hash or size mismatch")
	}
	if err := install(tmpPath); err != nil {
		return "", err
	}
	return manifest.Version, nil
}

func (s *Service) fetchPackManifest(ctx context.Context, tok, packID string) (packManifest, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.serverURL+"/packs/"+packID, nil)
	if err != nil {
		return packManifest{}, err
	}
	req.Header.Set("Authorization", "Bearer "+tok)
	resp, err := s.client.Do(req)
	if err != nil {
		return packManifest{}, err
	}
	defer func() { _ = resp.Body.Close() }()
	if err := moduleResponseError(resp.StatusCode); err != nil {
		return packManifest{}, err
	}
	var manifest packManifest
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&manifest); err != nil {
		return packManifest{}, err
	}
	return manifest, nil
}

func (s *Service) downloadPack(ctx context.Context, tok, packID, dst string, expectedSize int64) (string, int64, error) {
	if expectedSize <= 0 {
		return "", 0, errors.New("sponsor: invalid pack size")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.serverURL+"/packs/"+packID+"/download", nil)
	if err != nil {
		return "", 0, err
	}
	req.Header.Set("Authorization", "Bearer "+tok)
	resp, err := s.client.Do(req)
	if err != nil {
		return "", 0, err
	}
	defer func() { _ = resp.Body.Close() }()
	if err := moduleResponseError(resp.StatusCode); err != nil {
		return "", 0, err
	}
	f, err := os.OpenFile(dst, os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return "", 0, err
	}
	h := sha256.New()
	written, copyErr := io.Copy(io.MultiWriter(f, h), io.LimitReader(resp.Body, expectedSize+1))
	closeErr := f.Close()
	if copyErr != nil {
		return "", written, copyErr
	}
	if closeErr != nil {
		return "", written, closeErr
	}
	if written > expectedSize {
		return "", written, errors.New("sponsor: pack exceeds signed size")
	}
	return hex.EncodeToString(h.Sum(nil)), written, nil
}
