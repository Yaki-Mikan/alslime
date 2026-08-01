package apiproviders

import (
	"fmt"
	"net/url"
	"strings"
)

// ResolveEndpoint は baseURL の既存 path を保持したまま末尾へ segment を足した
// エンドポイント URL を返す（URL 結合の共通関数。文字列連結を散在させない）。
//
// メタストア検証・接続テスト・core 側 openaicompat エンジンの全てがこの関数を
// 使うこと。segment は "chat/completions"・"models" のようなスラッシュ区切りの
// 相対セグメント（アプリ定数）を想定する。
func ResolveEndpoint(baseURL, segment string) (string, error) {
	u, err := url.Parse(baseURL)
	if err != nil {
		return "", fmt.Errorf("apiproviders: baseUrl の解析に失敗: %w", err)
	}
	u.Path = strings.TrimSuffix(u.Path, "/") + "/" + strings.TrimPrefix(segment, "/")
	return u.String(), nil
}
