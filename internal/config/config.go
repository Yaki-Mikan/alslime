package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"alslime/internal/buildinfo"
)

// Config は起動時に確定するランタイム設定。
// 起動直後に Load で組み立て、以降は読み取り専用として扱う。
type Config struct {
	// WorkspaceRoot は全データ操作の基準となる絶対パス。
	WorkspaceRoot string
	// Port はリッスンポート。
	Port int
	// Host はバインドアドレス。
	Host string
	// ChatCLITimeoutSeconds は外部AI CLIを待つ最大秒数。
	ChatCLITimeoutSeconds int
	// FirebaseProjectID は Firebase 認証のプロジェクトID。空なら認証無効（ローカル利用）。
	FirebaseProjectID string
	// AllowedUIDs は許可する Firebase UID の一覧。空なら UID 制限なし。
	AllowedUIDs []string
}

// serverSettings は WORKSPACE_ROOT 配下の起動前設定ファイル。
// JSON は利用者が直接編集する可能性があるため、フィールドは少数に絞る。
type serverSettings struct {
	Port        int    `json:"port"`
	BindAddress string `json:"bindAddress"`
	LANPublic   bool   `json:"lanPublic"`
}

// Load は環境変数と既定値から Config を組み立てる。
//
// WORKSPACE_ROOT は現行 Node 版に合わせ「環境変数 > カレントディレクトリ」で解決し、
// 必ず絶対パスへ正規化する。解決に失敗した場合はエラーを返し、起動を止める。
func Load() (*Config, error) {
	root, err := resolveWorkspaceRoot()
	if err != nil {
		return nil, err
	}

	settings, err := loadServerSettings(root)
	if err != nil {
		return nil, err
	}

	firebaseProjectID := strings.TrimSpace(os.Getenv(EnvFirebaseProjectID))
	// 公開ビルド（-tags public）は認証必須。設定漏れのまま無認証で公開待受する
	// 事故を構造的に防ぐため、警告ではなく起動エラーにする（フェイルクローズ）。
	if buildinfo.PublicBuild && firebaseProjectID == "" {
		return nil, fmt.Errorf("公開ビルドでは %s が必須です（認証なしでの起動は禁止）", EnvFirebaseProjectID)
	}

	return &Config{
		WorkspaceRoot: root,
		Port:          resolvePort(settings.Port),
		Host:          resolveHost(settings),
		ChatCLITimeoutSeconds: resolvePositiveIntEnv(
			EnvChatCLITimeoutSeconds,
			DefaultChatCLITimeoutSeconds,
		),
		FirebaseProjectID: firebaseProjectID,
		AllowedUIDs:       resolveCSVEnv(EnvAllowedUIDs),
	}, nil
}

// resolveCSVEnv はカンマ区切りの環境変数を空要素を除いたスライスへ解釈する。
func resolveCSVEnv(key string) []string {
	var values []string
	for _, item := range strings.Split(os.Getenv(key), ",") {
		if v := strings.TrimSpace(item); v != "" {
			values = append(values, v)
		}
	}
	return values
}

// resolveWorkspaceRoot は WORKSPACE_ROOT を絶対パスとして確定する。
func resolveWorkspaceRoot() (string, error) {
	raw := os.Getenv(EnvWorkspaceRoot)
	if raw == "" {
		cwd, err := os.Getwd()
		if err != nil {
			return "", fmt.Errorf("WORKSPACE_ROOT 未指定かつ作業ディレクトリ取得に失敗: %w", err)
		}
		raw = cwd
	}

	abs, err := filepath.Abs(raw)
	if err != nil {
		return "", fmt.Errorf("WORKSPACE_ROOT の絶対パス解決に失敗 (%q): %w", raw, err)
	}
	return filepath.Clean(abs), nil
}

// loadServerSettings は WORKSPACE_ROOT 配下の起動前設定を読む。
// 未作成なら既定値を使う。壊れた JSON は起動前に気づけるようエラーにする。
func loadServerSettings(root string) (serverSettings, error) {
	path, logical, err := existingServerSettingsPath(root)
	if err != nil {
		return serverSettings{}, err
	}
	if path == "" {
		return serverSettings{}, nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return serverSettings{}, fmt.Errorf("サーバー設定の読み込みに失敗 (%s): %w", logical, err)
	}
	var settings serverSettings
	if err := json.Unmarshal(data, &settings); err != nil {
		return serverSettings{}, fmt.Errorf("サーバー設定のJSONが不正です (%s): %w", logical, err)
	}
	if settings.Port != 0 && !validPort(settings.Port) {
		return serverSettings{}, fmt.Errorf("サーバー設定の port が不正です (%s): %d", logical, settings.Port)
	}
	if settings.BindAddress != "" && !validBindAddress(settings.BindAddress) {
		return serverSettings{}, fmt.Errorf("サーバー設定の bindAddress が不正です (%s): %q", logical, settings.BindAddress)
	}
	return settings, nil
}

func existingServerSettingsPath(root string) (string, string, error) {
	for _, logical := range []string{ServerSettingsFile, LegacyServerSettingsFile} {
		path := filepath.Join(root, filepath.FromSlash(logical))
		if _, err := os.Stat(path); err == nil {
			return path, logical, nil
		} else if !os.IsNotExist(err) {
			return "", logical, fmt.Errorf("サーバー設定の確認に失敗 (%s): %w", logical, err)
		}
	}
	return "", "", nil
}

// resolvePort は設定ファイルと PORT 環境変数を解釈する。
// 優先順は PORT 環境変数 > server-settings.json > 既定ポート。
func resolvePort(configured int) int {
	raw := os.Getenv(EnvPort)
	if raw == "" {
		if configured != 0 {
			return configured
		}
		return DefaultPort
	}
	port, err := strconv.Atoi(raw)
	if err != nil || !validPort(port) {
		return DefaultPort
	}
	return port
}

// resolveHost は設定ファイルと HOST 環境変数を解釈する。
// 優先順は HOST 環境変数 > bindAddress > lanPublic > 既定ホスト。
func resolveHost(settings serverSettings) string {
	if host := strings.TrimSpace(os.Getenv(EnvHost)); validBindAddress(host) {
		return host
	}
	if settings.BindAddress != "" {
		return settings.BindAddress
	}
	if settings.LANPublic {
		return DefaultLANHost
	}
	return DefaultHost
}

func validPort(port int) bool {
	return port > 0 && port <= 65535
}

func validBindAddress(host string) bool {
	host = strings.TrimSpace(host)
	return host != "" && !strings.ContainsAny(host, "/\\")
}

func resolvePositiveIntEnv(key string, fallback int) int {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}

// Addr は net/http がリッスンするアドレス文字列（host:port）を返す。
func (c *Config) Addr() string {
	return fmt.Sprintf("%s:%d", c.Host, c.Port)
}
