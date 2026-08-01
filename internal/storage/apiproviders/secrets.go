package apiproviders

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"sync"

	"alslime/internal/config"
	"alslime/internal/storage/jsonstore"
	"alslime/internal/storage/paths"
)

// SecretsData は secrets.json の内容（AuthDir 配下の秘匿領域）。
type SecretsData struct {
	// Secrets のキーは Connection.ID。
	Secrets map[string]ConnectionSecret `json:"secrets"`
}

// ConnectionSecret は接続先 1 件の秘密情報。
//
// SecretHeaders はフェーズ1非対応（常に空。将来拡張用の構造確保のみ）。
// 値をログ・レスポンス・診断へ出さないこと。
type ConnectionSecret struct {
	APIKey        string            `json:"apiKey"`
	SecretHeaders map[string]string `json:"secretHeaders,omitempty"`
}

// SecretStore は secrets.json への読み書きを担う。
//
// 初回読み込み後はメモリキャッシュを正本にする（entitlement Store 慣行）。
// 読み込みの分岐:
//   - os.ErrNotExist: 空の SecretsData として正常扱い（初回起動）
//   - JSON 破損・権限エラー等: エラー返却（キー消失を「未設定」と誤認させない）
type SecretStore struct {
	resolver *paths.Resolver

	mu     sync.Mutex
	loaded bool
	data   SecretsData
}

// NewSecretStore は SecretStore を生成する。
func NewSecretStore(resolver *paths.Resolver) *SecretStore {
	return &SecretStore{resolver: resolver}
}

// load はキャッシュ未初期化ならファイルから読み込む（mu 保持前提）。
func (s *SecretStore) load() error {
	if s.loaded {
		return nil
	}
	lexical, err := s.resolver.ResolveLexical(config.APIProviderSecretsFile)
	if err != nil {
		return err
	}
	if _, statErr := os.Lstat(lexical); errors.Is(statErr, fs.ErrNotExist) {
		// 初回起動: 空として正常扱い。
		s.data = SecretsData{Secrets: map[string]ConnectionSecret{}}
		s.loaded = true
		return nil
	}
	path, err := s.resolver.ResolveExisting(config.APIProviderSecretsFile)
	if err != nil {
		return err
	}
	var data SecretsData
	if err := jsonstore.ReadJSON(path, &data); err != nil {
		// 破損・権限エラー等はエラー返却（値は含めない）。
		// NotExist は上の Lstat で処理済みのため、ここに来た読み失敗は全て異常。
		return fmt.Errorf("apiproviders: 秘密ストアの読み込みに失敗: %w", err)
	}
	if data.Secrets == nil {
		data.Secrets = map[string]ConnectionSecret{}
	}
	s.data = data
	s.loaded = true
	return nil
}

// save は現在のキャッシュ内容を 0600 で原子的に書き込む（mu 保持前提）。
func (s *SecretStore) save() error {
	path, err := s.resolver.ResolveForCreateMkdirAll(config.APIProviderSecretsFile, config.SecretDirPerm)
	if err != nil {
		return err
	}
	return jsonstore.WriteJSONMode(path, s.data, config.SecretFilePerm)
}

// Get は接続先 ID の秘密情報を返す（存在しなければ ok=false）。
func (s *SecretStore) Get(connectionID string) (secret ConnectionSecret, ok bool, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.load(); err != nil {
		return ConnectionSecret{}, false, err
	}
	secret, ok = s.data.Secrets[connectionID]
	return secret, ok, nil
}

// HasAPIKey は接続先 ID に非空の APIKey が保存されているかを返す
// （一覧応答の hasApiKey 導出用。キー値は返さない）。
func (s *SecretStore) HasAPIKey(connectionID string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.load(); err != nil {
		return false, err
	}
	secret, ok := s.data.Secrets[connectionID]
	return ok && secret.APIKey != "", nil
}

// IDs は秘密が保存されている接続先 ID の一覧を返す（孤児検出用）。
func (s *SecretStore) IDs() ([]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.load(); err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(s.data.Secrets))
	for id := range s.data.Secrets {
		ids = append(ids, id)
	}
	return ids, nil
}

// Set は接続先 ID の秘密情報を保存する。
func (s *SecretStore) Set(connectionID string, secret ConnectionSecret) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.load(); err != nil {
		return err
	}
	s.data.Secrets[connectionID] = secret
	return s.save()
}

// Delete は接続先 ID の秘密情報を削除する（存在しなければ何もしない。冪等）。
func (s *SecretStore) Delete(connectionID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.load(); err != nil {
		return err
	}
	if _, ok := s.data.Secrets[connectionID]; !ok {
		return nil
	}
	delete(s.data.Secrets, connectionID)
	return s.save()
}
