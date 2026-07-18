package entitlement

// 時刻巻き戻し検出用の単調クロック記録（17番の緩和策②）。
//
// 「最後に entitlement 検証が成功した時刻」を保存し、gate（core 側）は現在時刻が
// これより大きく過去なら時刻偽装とみなして失効扱いにする。判定は core、
// 保存の管理は本パッケージ（TokenStore と同じ役割分担）。
//
// 既知の限界（17番に明記）: このファイル自体を削除されると記録は失われる。
// 半自動ツール層の遮断が目的で、完全防御は難読化＋EULA の担当。

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"alslime/internal/config"
	"alslime/internal/logging"
)

// clockWriteIntervalSeconds はファイル書き込みのスロットリング幅。
// Advance は機能判定のたびに呼ばれるため、毎回の書き込みを避ける
// （プロセス異常終了時に最大この幅だけ記録が欠けるが、検出目的には影響しない）。
const clockWriteIntervalSeconds = 60

// Clock は最終検証時刻の単調記録。並行アクセス安全。
type Clock struct {
	path string

	mu      sync.Mutex
	loaded  bool
	last    int64 // メモリ上の最終時刻（unix 秒）
	written int64 // ファイルへ書き込み済みの値
}

// NewClock は WORKSPACE_ROOT 配下の既定パスで Clock を生成する。
func NewClock(workspaceRoot string) *Clock {
	return &Clock{path: filepath.Join(workspaceRoot, filepath.FromSlash(config.EntitlementClockFile))}
}

// LastSeen は記録済みの最終検証時刻を返す（未記録は 0）。
func (c *Clock) LastSeen() int64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.loadLocked()
	return c.last
}

// Advance は現在時刻で記録を前進させる（過去方向へは動かない＝単調）。
// 書き込みはスロットリングし、判定のたびの呼び出しに耐える。
func (c *Clock) Advance(now int64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.loadLocked()
	if now <= c.last {
		return
	}
	c.last = now
	if now-c.written >= clockWriteIntervalSeconds {
		c.writeLocked(now)
	}
}

// Reset は記録を強制上書きする（過去方向も許す）。
//
// サーバー由来トークンの受領成功時（ログイン・refresh）専用。サーバーが正当性を
// 確認済みのため、時計を誤って進めて起動した事故（未来値汚染）からの自動回復口になる。
func (c *Clock) Reset(now int64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.loaded = true
	c.last = now
	c.writeLocked(now)
}

// loadLocked は初回だけファイルから読む（mu 保持前提）。
func (c *Clock) loadLocked() {
	if c.loaded {
		return
	}
	c.loaded = true
	raw, err := os.ReadFile(c.path)
	if err != nil {
		return
	}
	if v, err := strconv.ParseInt(strings.TrimSpace(string(raw)), 10, 64); err == nil {
		c.last = v
		c.written = v
	}
}

// writeLocked はファイルへ書き出す（mu 保持前提。失敗はログのみ＝判定を止めない）。
func (c *Clock) writeLocked(v int64) {
	if err := os.MkdirAll(filepath.Dir(c.path), config.DirPerm); err != nil {
		logging.Warn("entitlement: clock dir create failed: %v", err)
		return
	}
	if err := os.WriteFile(c.path, []byte(strconv.FormatInt(v, 10)+"\n"), 0o600); err != nil {
		logging.Warn("entitlement: clock write failed: %v", err)
		return
	}
	c.written = v
}
