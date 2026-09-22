package apiproviders

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"strings"
	"sync"
	"time"

	"alslime/internal/config"
	"alslime/internal/storage/jsonstore"
	"alslime/internal/storage/paths"
)

// imageAPITokenIDPrefix は旧配置（secrets.json）で画像生成 API サービスのトークンに付けていた
// ID 接頭辞。今は別ファイルに置くが、旧配置からの読み取りと起動時点検の除外に使う。
const imageAPITokenIDPrefix = "imageapi:"

// imageAPISecretsData は image_api_secrets.json の内容（キーはサービス ID）。
type imageAPISecretsData struct {
	Tokens map[string]string `json:"tokens"`
}

// ImageAPITokenStore は画像生成 API サービスのトークン置き場。
//
// 接続先の秘密情報（secrets.json）とは別ファイルに置く。同じファイルを本体と画像生成
// モジュールの両方が書くと、同時保存で片方の更新が消えるため、このファイルの書込元は
// 内蔵モードでは本体、サイドカーモードでは画像生成モジュールの一方だけにする。
// 値は AuthDir 配下（0600）に入り、応答・ログへは出さない。
// 同一プロセス内に複数の置き場があっても整合するよう、読み書きの前にファイルの更新を確かめる。
type ImageAPITokenStore struct {
	resolver *paths.Resolver
	// legacy は旧配置（secrets.json の imageapi: 接頭辞）の読み取り専用の口。
	// 自分のファイルが未作成のときだけ参照し、見つかった値は自分のファイルへ移す。
	legacy *SecretStore

	mu          sync.Mutex
	loaded      bool
	data        imageAPISecretsData
	fileExists  bool
	fileModTime time.Time
	fileSize    int64
}

// NewImageAPITokenStore はワークスペースのトークン置き場を返す。
func NewImageAPITokenStore(resolver *paths.Resolver) *ImageAPITokenStore {
	return &ImageAPITokenStore{resolver: resolver, legacy: NewSecretStore(resolver)}
}

func imageAPITokenID(service string) string {
	return imageAPITokenIDPrefix + strings.TrimSpace(service)
}

// IsImageAPITokenID は secrets.json の ID が旧配置の画像生成トークンのものかを返す。
// 接続先の起動時点検（接続先一覧に無い秘密情報の回収）から除外するために使う。
func IsImageAPITokenID(id string) bool {
	return strings.HasPrefix(id, imageAPITokenIDPrefix)
}

// load はファイルが未読か、前回から更新されていれば読み込む（mu 保持前提）。
func (s *ImageAPITokenStore) load() error {
	lexical, err := s.resolver.ResolveLexical(config.ImageAPISecretsFile)
	if err != nil {
		return err
	}
	info, statErr := os.Lstat(lexical)
	if errors.Is(statErr, fs.ErrNotExist) {
		s.data = imageAPISecretsData{Tokens: map[string]string{}}
		s.loaded = true
		s.fileExists = false
		s.fileModTime = time.Time{}
		s.fileSize = 0
		return nil
	}
	if statErr != nil {
		return fmt.Errorf("apiproviders: 画像生成トークンの置き場の確認に失敗: %w", statErr)
	}
	if s.loaded && s.fileExists && info.ModTime().Equal(s.fileModTime) && info.Size() == s.fileSize {
		return nil
	}
	path, err := s.resolver.ResolveExisting(config.ImageAPISecretsFile)
	if err != nil {
		return err
	}
	var data imageAPISecretsData
	if err := jsonstore.ReadJSON(path, &data); err != nil {
		// 破損・権限エラー等はエラー返却（値は含めない）。
		return fmt.Errorf("apiproviders: 画像生成トークンの置き場の読み込みに失敗: %w", err)
	}
	if data.Tokens == nil {
		data.Tokens = map[string]string{}
	}
	s.data = data
	s.loaded = true
	s.fileExists = true
	s.fileModTime = info.ModTime()
	s.fileSize = info.Size()
	return nil
}

// save は現在の内容を 0600 で原子的に書き込み、書いたファイルの印を覚える（mu 保持前提）。
func (s *ImageAPITokenStore) save() error {
	path, err := resolveSecretFileForWrite(s.resolver, config.ImageAPISecretsFile)
	if err != nil {
		return err
	}
	if err := jsonstore.WriteJSONMode(path, s.data, config.SecretFilePerm); err != nil {
		return err
	}
	s.fileExists = true
	if info, statErr := os.Lstat(path); statErr == nil {
		s.fileModTime = info.ModTime()
		s.fileSize = info.Size()
	}
	return nil
}

// Get はサービス ID のトークンを返す（未保存・空は ok=false）。
// 自分のファイルが無いときは旧配置（secrets.json）を読み、見つかれば自分のファイルへ移す。
func (s *ImageAPITokenStore) Get(service string) (string, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.load(); err != nil {
		return "", false, err
	}
	key := strings.TrimSpace(service)
	if token := strings.TrimSpace(s.data.Tokens[key]); token != "" {
		return token, true, nil
	}
	if s.fileExists || s.legacy == nil {
		return "", false, nil
	}
	secret, ok, err := s.legacy.Get(imageAPITokenID(key))
	if err != nil || !ok || strings.TrimSpace(secret.APIKey) == "" {
		return "", false, err
	}
	token := strings.TrimSpace(secret.APIKey)
	s.data.Tokens[key] = token
	if err := s.save(); err != nil {
		return "", false, err
	}
	return token, true, nil
}

// Set はサービス ID のトークンを保存する（空文字は削除と同じ）。
func (s *ImageAPITokenStore) Set(service, token string) error {
	token = strings.TrimSpace(token)
	if token == "" {
		return s.Delete(service)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.load(); err != nil {
		return err
	}
	s.data.Tokens[strings.TrimSpace(service)] = token
	return s.save()
}

// Delete はサービス ID のトークンを削除する。旧配置の値が読まれないよう、
// 自分のファイルが未作成でも空の内容で作る。
func (s *ImageAPITokenStore) Delete(service string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.load(); err != nil {
		return err
	}
	key := strings.TrimSpace(service)
	if _, ok := s.data.Tokens[key]; !ok && s.fileExists {
		return nil
	}
	delete(s.data.Tokens, key)
	return s.save()
}
