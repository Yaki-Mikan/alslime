package sponsor

// ダウンロード許可の取得と、許可を付けた配信用ドメインからの取得。
//
// 支援状態の確認（失効・tier・回数制限）は entitlement サーバーが行い、短時間だけ有効な
// 許可を返す。配信側はその許可の署名・期限・対象フォルダだけを見る。許可は 1 つの
// 名前・1 つのバージョンのフォルダに限られ、モジュールの実行ファイルと付属パックは
// 同じ許可で取得できる。

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
)

const (
	downloadKindModule = "module"
	downloadKindPack   = "pack"
)

// requestDownloadGrant は entitlement サーバーからダウンロード許可を受け取る。
// 401 / 403 / 404 はモジュール取得と同じエラーへ変換する。
func (s *Service) requestDownloadGrant(ctx context.Context, tok, kind, name, version string) (string, error) {
	body, err := json.Marshal(map[string]string{"kind": kind, "name": name, "version": version})
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.serverURL+"/downloads/grant", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+tok)
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.client.Do(req)
	if err != nil {
		return "", err
	}
	defer func() { _ = resp.Body.Close() }()
	if err := moduleResponseError(resp.StatusCode); err != nil {
		return "", err
	}
	var result struct {
		Grant string `json:"grant"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&result); err != nil {
		return "", err
	}
	if result.Grant == "" {
		return "", errors.New("sponsor: empty download grant")
	}
	return result.Grant, nil
}

// downloadFolder は配信側の置き場所（許可の対象フォルダと同じ形。末尾スラッシュ付き）。
func downloadFolder(kind, name, version string) string {
	root := "sidecar"
	if kind == downloadKindPack {
		root = "packs"
	}
	return root + "/" + url.PathEscape(name) + "/" + url.PathEscape(version) + "/"
}

// downloadGranted は許可を付けて 1 ファイルを dst へ保存し、SHA-256（hex）と書き込みサイズを返す。
// 一覧ファイルに書かれたサイズを超えた時点で打ち切る（照合は呼び出し側）。
func (s *Service) downloadGranted(
	ctx context.Context, grant, folder, fileName, dst string, expectedSize int64, mode os.FileMode,
) (string, int64, error) {
	if expectedSize <= 0 {
		return "", 0, errors.New("sponsor: invalid download size")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.dlBaseURL+"/"+folder+url.PathEscape(fileName), nil)
	if err != nil {
		return "", 0, err
	}
	req.Header.Set("Authorization", "Bearer "+grant)
	resp, err := s.client.Do(req)
	if err != nil {
		return "", 0, err
	}
	defer func() { _ = resp.Body.Close() }()
	switch resp.StatusCode {
	case http.StatusOK:
	case http.StatusNotFound:
		return "", 0, ErrModuleUnavailable
	default:
		// 配信側の 401 / 403 は許可の不備で、利用者のトークン失効とは別物。
		// 再ログインの案内へ誤誘導しないよう、汎用の取得失敗として返す。
		return "", 0, fmt.Errorf("sponsor: download server status %d", resp.StatusCode)
	}

	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return "", 0, err
	}
	f, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, mode)
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
		return "", written, errors.New("sponsor: download exceeds signed size")
	}
	return hex.EncodeToString(h.Sum(nil)), written, nil
}
