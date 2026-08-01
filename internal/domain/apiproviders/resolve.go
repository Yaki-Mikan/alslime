package apiproviders

import (
	"alslime/internal/coreapi"
	"alslime/internal/i18n"
)

// ResolveConnectionInfo は接続先 ID から実行用の接続情報（キー含む）を解決する
// （CoreDeps.ResolveAPIConnection の実体）。
//
// 失敗は *coreapi.ProviderFailure で返す（通常の error だと chatflow で一律
// provider_execution_error に潰れるため）:
//   - 接続先不存在・無効: api_connection_unavailable
//   - AuthScheme≠none でキー未設定: api_key_missing
//
// 返り値の APIKey / ExtraHeaders は秘密値を含む。ログ・Response・エラーへ
// 含めないこと。
func (s *Service) ResolveConnectionInfo(connectionID string) (coreapi.APIConnectionInfo, error) {
	conn, ok, err := s.Get(connectionID)
	if err != nil {
		return coreapi.APIConnectionInfo{}, err
	}
	if !ok || !conn.Enabled {
		return coreapi.APIConnectionInfo{}, &coreapi.ProviderFailure{
			Type:       coreapi.APIErrorConnectionUnavailable,
			MessageKey: i18n.KeyChatErrorAPIConnectionUnavailable,
		}
	}
	secret, _, err := s.secrets.Get(connectionID)
	if err != nil {
		return coreapi.APIConnectionInfo{}, err
	}
	if conn.AuthScheme != AuthSchemeNone && secret.APIKey == "" {
		return coreapi.APIConnectionInfo{}, &coreapi.ProviderFailure{
			Type:       coreapi.APIErrorKeyMissing,
			MessageKey: i18n.KeyChatErrorAPIKeyMissing,
		}
	}
	cacheKeyParam := ""
	if preset, ok := PresetByID(conn.Preset); ok {
		cacheKeyParam = preset.CacheKeyParam
	}
	return coreapi.APIConnectionInfo{
		BaseURL:           conn.BaseURL,
		AuthScheme:        conn.AuthScheme,
		APIKey:            secret.APIKey,
		ExtraHeaders:      map[string]string{}, // SecretHeaders はフェーズ1で常に空
		ExtraParams:       conn.ExtraParams,
		ForceNonStreaming: conn.ForceNonStreaming,
		CacheKeyParam:     cacheKeyParam,
	}, nil
}

// ConnectionExists は接続先 ID がメタデータストアに実在するかを返す
// （usermodels の openai_compat 行検証用。Enabled は問わない）。
func (s *Service) ConnectionExists(connectionID string) (bool, error) {
	_, ok, err := s.Get(connectionID)
	return ok, err
}

// HasEnabledConnection は有効な接続先が 1 つ以上あるかを返す（clistatus 用）。
func (s *Service) HasEnabledConnection() (bool, error) {
	data, err := s.meta.Load()
	if err != nil {
		return false, err
	}
	for _, c := range data.Connections {
		if c.Enabled {
			return true, nil
		}
	}
	return false, nil
}
