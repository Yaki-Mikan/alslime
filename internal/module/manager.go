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
	"io"
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

// stopTimeout は stdin クローズによる自主終了を待つ上限（超過で Kill）。
const stopTimeout = 5 * time.Second

// Config はモジュール起動設定。
type Config struct {
	// ExePath はモジュール実行ファイルの絶対パス。
	ExePath string
	// Workspace は WORKSPACE_ROOT（モジュールへ --workspace で渡す）。
	Workspace string
	// Token は entitlement トークンの読み出し（TokenStore。nil 可）。
	// release ビルドのモジュールは起動時にこのトークンを検証する（流出対策）。
	Token func() string
}

// Manager はモジュールプロセスの起動・接続先解決・停止を担う。
// comfyui.ModuleTarget を満たす。
type Manager struct {
	cfg    Config
	secret string

	mu      sync.RWMutex
	baseURL *url.URL
	// runCtx は Run に渡された生存管理 ctx（Restart が再 start に使う）。
	runCtx context.Context
	// proc は現在のモジュールプロセス（未起動・停止済みは nil）。
	proc *moduleProcess

	// restartMu は停止→再起動の直列化（並行 Restart による二重起動を防ぐ）。
	restartMu sync.Mutex
}

// moduleProcess は起動中プロセスの操作ハンドル。
type moduleProcess struct {
	cmd   *exec.Cmd
	stdin io.WriteCloser
	// done はプロセス終了（Wait 回収完了）で close される。
	done chan struct{}
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
	m.mu.Lock()
	m.runCtx = ctx
	m.mu.Unlock()
	// 起動フェーズの更新適用（Restart）と直列化する（二重起動の防止）。
	m.restartMu.Lock()
	err := m.start(ctx)
	m.restartMu.Unlock()
	if err != nil {
		logging.Error("module: start failed: %v", err)
		return
	}
	<-ctx.Done()
}

// Restart は実行中のモジュールを停止し、更新後の実行ファイルで起動し直す
// （サイドカー更新の即時有効化用。ファイル自動更新、確認 01番 6.3）。
// Run 前・本体シャットダウン後はエラー。起動失敗時も接続先は解決されないまま
// （BaseURL が nil）で、本体再起動で復旧できる。
func (m *Manager) Restart() error {
	m.restartMu.Lock()
	defer m.restartMu.Unlock()
	m.mu.RLock()
	ctx := m.runCtx
	m.mu.RUnlock()
	if ctx == nil {
		// Run 実行前（起動フェーズ中の更新適用）。この後の Run が配置済みの
		// 新実体を起動するため、停止・再起動は不要（成功扱い）。
		return nil
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	m.stop()
	return m.start(ctx)
}

// StartInstalled は配置直後のモジュールを起動する（初回導入の即時有効化用）。
// Run が呼ばれないプロセス（未配置で起動した本体）では ctx をここで預かり、
// 以後の再取得・更新もこの経路の停止→起動で即時有効化できる。起動失敗時は
// 接続先が解決されないまま（BaseURL が nil）で、本体再起動で復旧できる。
func (m *Manager) StartInstalled(ctx context.Context) error {
	m.restartMu.Lock()
	defer m.restartMu.Unlock()
	m.mu.Lock()
	if m.runCtx == nil {
		m.runCtx = ctx
	}
	runCtx := m.runCtx
	m.mu.Unlock()
	if runCtx.Err() != nil {
		return runCtx.Err()
	}
	m.stop()
	return m.start(runCtx)
}

// stop は現在のプロセスを停止し、終了の回収まで待つ（未起動なら何もしない）。
// stdin を閉じるとモジュールは EOF 検知で自主終了する（孤児プロセス防止と同じ経路）。
// 猶予内に終了しなければ Kill する。
func (m *Manager) stop() {
	m.mu.Lock()
	proc := m.proc
	m.proc = nil
	m.baseURL = nil
	m.mu.Unlock()
	if proc == nil {
		return
	}
	_ = proc.stdin.Close()
	select {
	case <-proc.done:
	case <-time.After(stopTimeout):
		if proc.cmd.Process != nil {
			_ = proc.cmd.Process.Kill()
		}
		<-proc.done
	}
}

func (m *Manager) start(ctx context.Context) error {
	cmd := exec.CommandContext(ctx, m.cfg.ExePath,
		"--workspace", m.cfg.Workspace,
		"--port", "0",
	)
	cmd.Env = append(os.Environ(), coreapi.ModuleSecretEnv+"="+m.secret)
	if m.cfg.Token != nil {
		if tok := m.cfg.Token(); tok != "" {
			cmd.Env = append(cmd.Env, coreapi.ModuleTokenEnv+"="+tok)
		}
	}
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
	proc := &moduleProcess{cmd: cmd, stdin: stdin, done: make(chan struct{})}
	m.mu.Lock()
	m.proc = proc
	m.mu.Unlock()
	go func() {
		// プロセス終了で stdin パイプを解放し、待機ステータスを回収する。
		defer close(proc.done)
		defer func() { _ = stdin.Close() }()
		if err := cmd.Wait(); err != nil && ctx.Err() == nil {
			logging.Error("module: process exited: %v", err)
		}
		m.mu.Lock()
		// stop による世代交代後は新プロセスの接続先を消さない（自プロセス分のみ解除）。
		if m.proc == proc {
			m.baseURL = nil
			m.proc = nil
		}
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
