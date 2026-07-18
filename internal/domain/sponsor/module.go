package sponsor

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
	"path/filepath"
	"runtime"
	"strings"

	"alslime/internal/logging"
)

// サイドカーモジュールの取得・検証・配置（12番 5章 / 14番 6章。複数モジュール対応）。
//
// entitlement サーバーの署名付きマニフェスト（SHA-256 + Ed25519）を検証してから
// バイナリを配置する。署名鍵は entitlement トークンと同じ埋め込み公開鍵系で、
// 検証実体は core（featuresimpl）に閉じ、本パッケージは注入された関数だけを呼ぶ。
// 対象モジュールは ConfigureModules で注入されたレジストリ（module.IDs()）に限る。

// ErrModuleNoToken はモジュール取得に必要なトークンが無い。
var ErrModuleNoToken = errors.New("sponsor: no token for module download")

// ErrModuleUnavailable はサーバー側にモジュール配布が無い（404）。
var ErrModuleUnavailable = errors.New("sponsor: module not available on server")

// ErrModuleRejected はサーバーがトークンを拒否した（401/403）。
var ErrModuleRejected = errors.New("sponsor: module download rejected by server")

// ErrModuleUnknown は取得対象がレジストリに無い（本体が知らないモジュールID）。
var ErrModuleUnknown = errors.New("sponsor: unknown module id")

// moduleManifest は entitlement サーバーが返す署名付きマニフェスト。
// サーバー側 httpapi.Manifest と同一契約で、署名対象の正規化 JSON は
// Sig を空にした本構造体の json.Marshal（フィールド順も一致させること）。
type moduleManifest struct {
	Version       string `json:"version"`
	OS            string `json:"os"`
	Arch          string `json:"arch"`
	SHA256        string `json:"sha256"`
	MinAppVersion string `json:"minAppVersion"`
	MaxAppVersion string `json:"maxAppVersion"`
	Sig           string `json:"sig"`
}

// ModuleStatusEntry は 1 モジュールの配置状態（GET /api/sponsor/modules の要素）。
type ModuleStatusEntry struct {
	// ID はモジュールID（module レジストリの定数）。
	ID string `json:"id"`
	// Installed はモジュール実行ファイルが配置済みか。
	Installed bool `json:"installed"`
	// Active は現在のプロセスで当該サイドカーが起動しているか。
	// 配置直後は false のままで、本体の再起動後に有効になる。
	Active bool `json:"active"`
}

// ModulesStatus は全モジュールの配置状態を返す（ConfigureModules の ids 順）。
func (s *Service) ModulesStatus() []ModuleStatusEntry {
	out := make([]ModuleStatusEntry, 0, len(s.moduleIDs))
	for _, id := range s.moduleIDs {
		target, ok := s.modules[id]
		if !ok {
			continue
		}
		installed := false
		if _, err := os.Stat(target.InstallPath); err == nil {
			installed = true
		}
		out = append(out, ModuleStatusEntry{ID: id, Installed: installed, Active: target.Active})
	}
	return out
}

// InstallModule は entitlement サーバーから指定モジュールを取得・検証して配置する。
// 成功時はマニフェストのバージョンを返す。配置の有効化には本体の再起動が必要。
func (s *Service) InstallModule(ctx context.Context, moduleID string) (version string, err error) {
	if len(s.modules) == 0 || s.verifySig == nil {
		return "", errors.New("sponsor: module install is not configured")
	}
	target, ok := s.modules[moduleID]
	if !ok {
		return "", ErrModuleUnknown
	}
	tok := s.store.Current()
	if tok == "" {
		return "", ErrModuleNoToken
	}

	query := fmt.Sprintf("?os=%s&arch=%s", runtime.GOOS, runtime.GOARCH)

	// 1. 署名付きマニフェスト取得
	manifest, err := s.fetchModuleManifest(ctx, tok, moduleID, query)
	if err != nil {
		return "", err
	}

	// 2. 署名検証（Sig を除いた正規化 JSON への Ed25519 署名）
	payload := manifest
	payload.Sig = ""
	canonical, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	if err := s.verifySig(canonical, manifest.Sig); err != nil {
		return "", fmt.Errorf("sponsor: module manifest verification failed: %w", err)
	}

	// 3. バイナリ取得（一時ファイルへ書きつつ SHA-256 を計算）
	tmpPath := target.InstallPath + ".download"
	sum, err := s.downloadModuleBinary(ctx, tok, moduleID, query, tmpPath)
	if err != nil {
		_ = os.Remove(tmpPath)
		return "", err
	}

	// 4. ハッシュ照合 → 配置（atomic rename）
	if !strings.EqualFold(sum, manifest.SHA256) {
		_ = os.Remove(tmpPath)
		return "", errors.New("sponsor: module binary hash mismatch")
	}
	if err := os.Chmod(tmpPath, 0o755); err != nil {
		_ = os.Remove(tmpPath)
		return "", err
	}
	if err := os.Rename(tmpPath, target.InstallPath); err != nil {
		_ = os.Remove(tmpPath)
		return "", err
	}
	logging.Info("sponsor: module %s installed (version %s)", moduleID, manifest.Version)
	return manifest.Version, nil
}

// fetchModuleManifest はマニフェスト API を叩いて検証前のマニフェストを返す。
func (s *Service) fetchModuleManifest(ctx context.Context, tok, moduleID, query string) (moduleManifest, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.serverURL+"/modules/"+moduleID+query, nil)
	if err != nil {
		return moduleManifest{}, err
	}
	req.Header.Set("Authorization", "Bearer "+tok)
	resp, err := s.client.Do(req)
	if err != nil {
		return moduleManifest{}, err
	}
	defer func() { _ = resp.Body.Close() }()
	if err := moduleResponseError(resp.StatusCode); err != nil {
		return moduleManifest{}, err
	}
	var m moduleManifest
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&m); err != nil {
		return moduleManifest{}, err
	}
	if m.SHA256 == "" || m.Sig == "" {
		return moduleManifest{}, errors.New("sponsor: incomplete module manifest")
	}
	return m, nil
}

// downloadModuleBinary はモジュールバイナリを dst へ保存し SHA-256（hex）を返す。
func (s *Service) downloadModuleBinary(ctx context.Context, tok, moduleID, query, dst string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.serverURL+"/modules/"+moduleID+"/download"+query, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+tok)
	resp, err := s.client.Do(req)
	if err != nil {
		return "", err
	}
	defer func() { _ = resp.Body.Close() }()
	if err := moduleResponseError(resp.StatusCode); err != nil {
		return "", err
	}

	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return "", err
	}
	f, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o755)
	if err != nil {
		return "", err
	}
	h := sha256.New()
	_, copyErr := io.Copy(io.MultiWriter(f, h), resp.Body)
	closeErr := f.Close()
	if copyErr != nil {
		return "", copyErr
	}
	if closeErr != nil {
		return "", closeErr
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// moduleResponseError はモジュール API の HTTP ステータスをエラーへ変換する。
func moduleResponseError(status int) error {
	switch {
	case status == http.StatusOK:
		return nil
	case status == http.StatusUnauthorized || status == http.StatusForbidden:
		return ErrModuleRejected
	case status == http.StatusNotFound:
		return ErrModuleUnavailable
	default:
		return fmt.Errorf("sponsor: module server status %d", status)
	}
}
