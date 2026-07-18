// Package module はサイドカーモジュールのライフサイクル管理と RPC クライアント（12番 4.2）。
//
// 本体が親プロセスとしてモジュール exe を起動し、共有シークレットを環境変数で
// 渡す。モジュールは実ポートを stdout の1行目（MODULE_PORT=<n>）で報告する。
// Phase B ではモジュール exe はローカルビルド・手動配置（DL・署名検証は Phase D）。
package module

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"

	"alslime/internal/coreapi"
	"alslime/internal/logging"
)

// startupTimeout はモジュールのポート報告を待つ上限。
const startupTimeout = 15 * time.Second

// Config はモジュール起動設定。
type Config struct {
	// ExePath はモジュール実行ファイルの絶対パス。
	ExePath string
	// Workspace は WORKSPACE_ROOT（モジュールへ --workspace で渡す）。
	Workspace string
}

// Manager はモジュールプロセスの起動・接続先解決・停止を担う。
// comfyui.ModuleTarget を満たす。
type Manager struct {
	cfg    Config
	secret string

	mu      sync.RWMutex
	baseURL *url.URL
}

// NewManager は Manager を生成する（起動はまだしない）。
// 共有シークレットはここで払い出す（プロセス生存中は不変）。
func NewManager(cfg Config) *Manager {
	return &Manager{cfg: cfg, secret: newSecret()}
}

// Available はモジュール exe が配置されているかを返す（起動可否の事前判定）。
func (m *Manager) Available() bool {
	info, err := os.Stat(m.cfg.ExePath)
	return err == nil && !info.IsDir()
}

// BaseURL はモジュールのベース URL を返す。未起動・起動失敗時は nil。
func (m *Manager) BaseURL() *url.URL {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.baseURL
}

// Secret は本体⇔モジュール間 RPC の共有シークレットを返す。
func (m *Manager) Secret() string {
	return m.secret
}

// Run はモジュールを起動し、ctx キャンセルまで生存管理する（background タスク用）。
//
// 起動失敗・異常終了はログへ残し、本体は落とさない（ComfyUI 機能が 503 になるだけ）。
// 再起動ポリシー（回数・バックオフ）は 12番 8章の宿題5。Phase B では自動再起動なし。
func (m *Manager) Run(ctx context.Context) {
	if err := m.start(ctx); err != nil {
		logging.Error("module: start failed: %v", err)
		return
	}
	<-ctx.Done()
}

func (m *Manager) start(ctx context.Context) error {
	cmd := exec.CommandContext(ctx, m.cfg.ExePath,
		"--workspace", m.cfg.Workspace,
		"--port", "0",
	)
	cmd.Env = append(os.Environ(), coreapi.ModuleSecretEnv+"="+m.secret)
	// stdin をパイプで繋ぐ。本体が死ぬとパイプが閉じ、モジュール側は
	// stdin EOF を検知して自主終了する（孤児プロセス防止）。
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return err
	}
	go func() {
		// プロセス終了で stdin パイプを解放し、待機ステータスを回収する。
		defer func() { _ = stdin.Close() }()
		if err := cmd.Wait(); err != nil && ctx.Err() == nil {
			logging.Error("module: process exited: %v", err)
		}
		m.mu.Lock()
		m.baseURL = nil
		m.mu.Unlock()
	}()

	// stdout の1行目からポート報告を待つ。
	portCh := make(chan int, 1)
	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if p, ok := strings.CutPrefix(line, coreapi.ModulePortPrefix); ok {
				if port, err := strconv.Atoi(strings.TrimSpace(p)); err == nil {
					portCh <- port
					break
				}
			}
		}
		// 以降の stdout は読み捨て（バッファ詰まり防止）。
		for scanner.Scan() {
		}
	}()
	select {
	case port := <-portCh:
		u, err := url.Parse(fmt.Sprintf("http://127.0.0.1:%d", port))
		if err != nil {
			return err
		}
		m.mu.Lock()
		m.baseURL = u
		m.mu.Unlock()
		logging.Info("module: started at %s", u)
		return nil
	case <-time.After(startupTimeout):
		return errors.New("module: startup timed out (no port report)")
	case <-ctx.Done():
		return ctx.Err()
	}
}

// newSecret は 32 バイトの乱数シークレットを払い出す。
func newSecret() string {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		// 乱数取得失敗は極めて稀。時刻ベースで最低限の一意性を確保する。
		return "fallback-" + hex.EncodeToString([]byte(time.Now().Format("20060102150405.000000000")))
	}
	return hex.EncodeToString(b[:])
}
