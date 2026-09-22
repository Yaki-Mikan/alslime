package apiproviders

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"sync"
	"time"

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
// メモリキャッシュを持つが、同じファイルを別プロセス（画像生成モジュール）も読み書きするため、
// 読み書きのたびにファイルの更新時刻と大きさを確かめ、変わっていれば読み直してから使う。
// これにより、相手が足した秘密情報を自分の古いキャッシュで上書きして消すことを防ぐ。
// 読み込みの分岐:
//   - os.ErrNotExist: 空の SecretsData として正常扱い（初回起動）
//   - JSON 破損・権限エラー等: エラー返却（キー消失を「未設定」と誤認させない）
type SecretStore struct {
	resolver *paths.Resolver

	mu     sync.Mutex
	loaded bool
	data   SecretsData
	// fileModTime / fileSize は最後に読んだ（または書いた）ファイルの印。
	fileModTime time.Time
	fileSize    int64
}

// NewSecretStore は SecretStore を生成する。
func NewSecretStore(resolver *paths.Resolver) *SecretStore {
	return &SecretStore{resolver: resolver}
}

// load はファイルが未読か、前回から更新されていれば読み込む（mu 保持前提）。
func (s *SecretStore) load() error {
	lexical, err := s.resolver.ResolveLexical(config.APIProviderSecretsFile)
	if err != nil {
		return err
	}
	info, statErr := os.Lstat(lexical)
	if errors.Is(statErr, fs.ErrNotExist) {
		// 初回起動、または別プロセスが消した: 空として正常扱い。
		s.data = SecretsData{Secrets: map[string]ConnectionSecret{}}
		s.loaded = true
		s.fileModTime = time.Time{}
		s.fileSize = 0
		return nil
	}
	if statErr != nil {
		return fmt.Errorf("apiproviders: 秘密ストアの確認に失敗: %w", statErr)
	}
	if s.loaded && info.ModTime().Equal(s.fileModTime) && info.Size() == s.fileSize {
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
	s.fileModTime = info.ModTime()
	s.fileSize = info.Size()
	return nil
}

// resolveSecretFileForWrite は秘匿領域のファイルを書くためのパスを返す（親ディレクトリを作る）。
// 別プロセス（本体と画像生成モジュール）が同じ秘匿領域を同時に初めて作ると、片方の
// ディレクトリ作成が「既に存在する」で失敗することがあるため、その場合は一度だけやり直す。
func resolveSecretFileForWrite(resolver *paths.Resolver, rel string) (string, error) {
	path, err := resolver.ResolveForCreateMkdirAll(rel, config.SecretDirPerm)
	if err == nil {
		return path, nil
	}
	if retried, retryErr := resolver.ResolveForCreateMkdirAll(rel, config.SecretDirPerm); retryErr == nil {
		return retried, nil
	}
	return "", err
}

// save は現在のキャッシュ内容を 0600 で原子的に書き込み、書いたファイルの印を覚える（mu 保持前提）。
func (s *SecretStore) save() error {
	path, err := resolveSecretFileForWrite(s.resolver, config.APIProviderSecretsFile)
	if err != nil {
		return err
	}
	if err := jsonstore.WriteJSONMode(path, s.data, config.SecretFilePerm); err != nil {
		return err
	}
	if info, statErr := os.Lstat(path); statErr == nil {
		s.fileModTime = info.ModTime()
		s.fileSize = info.Size()
	}
	return nil
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
