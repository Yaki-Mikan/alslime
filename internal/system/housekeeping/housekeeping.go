// Package housekeeping は配布版が生成する使い捨て一時ファイルの掃除を担う。
//
// 19_ハウスキーピング設計.md に基づく。掃除対象は config.RuntimeTempDir 配下の
// 純粋な使い捨て作業ファイル（Antigravity 実行ログ・一時出力・一時
// コンテキスト等）に限定する。チャット履歴正本（unified session）・sidecar・
// 設定・キャッシュ正本・認証情報・外部 CLI のホーム配下には一切触れない。
//
// 各 CLI のネイティブ履歴（~/.gemini, ~/.claude 配下）は中間ファイル正本から
// 再生成可能な変換キャッシュだが、WORKSPACE_ROOT 外かつ正本存在確認が必要な
// ため、本パッケージの初期実装では対象外とする（グループ B のみ先行）。
package housekeeping

import (
	"io/fs"
	"os"
	"path/filepath"
	"time"

	"alslime/internal/config"
	"alslime/internal/logging"
	"alslime/internal/storage/paths"
)

// tempSubDirs は掃除対象とする RuntimeTempDir 配下の相対サブディレクトリ。
//
// ホワイトリスト方式。ここに列挙したディレクトリ配下のみを走査し、それ以外は
// 一切触れない（設計 §6-2）。新たな一時生成先が増えたらここへ追加する。
var tempSubDirs = []string{
	config.AntigravityLogDir,
	config.AntigravityTempOutputDir,
	config.AntigravityContextTempDir,
	config.ClaudeSystemPromptTempDir,
}

// NativeSweep は各 CLI ネイティブ履歴の定期掃除境界（12番 3.4）。
//
// 配置規則の知識は core 側（housekeepingnative）に閉じ、本パッケージは
// この小さい境界だけを見る。coreapi.NativeSweeper が構造的に満たす。
type NativeSweep interface {
	SweepNative(cutoff time.Time) (removedFiles int, removedDirs int)
}

// Sweeper は使い捨て一時ファイルとネイティブ履歴を掃除する。
//
// 時刻としきい値を注入できるためテスト可能。実体化に失敗しても起動・処理全体を
// 止めず、個々の削除失敗はログに残して続行するベストエフォート方針（設計 §6-4）。
//
// 対象は2系統:
//   - グループB: WORKSPACE_ROOT 配下の使い捨て一時ファイル（RuntimeTempDir）。
//   - グループA: home 配下の各 CLI ネイティブ履歴（native 境界へ委譲）。
type Sweeper struct {
	resolver *paths.Resolver
	native   NativeSweep
	maxAge   time.Duration
	now      func() time.Time
}

// New は既定のしきい値で Sweeper を生成する。
//
// native が nil の場合、グループA（ネイティブ履歴）の掃除はスキップされる。
func New(resolver *paths.Resolver, native NativeSweep) *Sweeper {
	return &Sweeper{
		resolver: resolver,
		native:   native,
		maxAge:   time.Duration(config.HousekeepingTempMaxAgeSeconds) * time.Second,
		now:      time.Now,
	}
}

// WithMaxAge は保持時間を上書きする（テスト・将来の設定連動用）。
func (s *Sweeper) WithMaxAge(maxAge time.Duration) *Sweeper {
	if maxAge > 0 {
		s.maxAge = maxAge
	}
	return s
}

// WithNow は現在時刻取得を差し替える（テスト用）。
func (s *Sweeper) WithNow(now func() time.Time) *Sweeper {
	if now != nil {
		s.now = now
	}
	return s
}

// Result は 1 回の掃除結果。
type Result struct {
	RemovedFiles int
	RemovedDirs  int
}

func (r *Result) add(other Result) {
	r.RemovedFiles += other.RemovedFiles
	r.RemovedDirs += other.RemovedDirs
}

// Sweep は対象サブディレクトリ配下の古い一時ファイルを削除する。
//
// mtime が maxAge より古いファイルを削除し、空になったディレクトリも畳む。
// しきい値内の新しいファイル・実体化できないパスには触れない。エラーは握り
// 潰してログへ残し、全体は続行する。
func (s *Sweeper) Sweep() Result {
	cutoff := s.now().Add(-s.maxAge)
	var total Result
	// グループB: WORKSPACE_ROOT 配下の使い捨て一時ファイル。
	for _, rel := range tempSubDirs {
		total.add(s.sweepDir(rel, cutoff))
	}
	// グループA: home 配下のネイティブ履歴（正本から到達できないもののみ）。
	if s.native != nil {
		files, dirs := s.native.SweepNative(cutoff)
		total.add(Result{RemovedFiles: files, RemovedDirs: dirs})
	}
	if total.RemovedFiles > 0 || total.RemovedDirs > 0 {
		logging.Info("housekeeping: removed %d file(s), %d dir(s)",
			total.RemovedFiles, total.RemovedDirs)
	}
	return total
}

func (s *Sweeper) sweepDir(rel string, cutoff time.Time) Result {
	var res Result
	// 走査前にレキシカル境界を確認し、WORKSPACE_ROOT 外なら何もしない。
	abs, err := s.resolver.ResolveExisting(rel)
	if err != nil {
		// 未作成（まだ一時ファイルが出ていない）は正常。境界違反は安全側で無視。
		return res
	}
	info, err := os.Lstat(abs)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		// 存在しない・ディレクトリでない・シンボリックリンクには触れない。
		return res
	}

	// 削除対象ファイルをまず集める（走査中の削除で WalkDir が乱れるのを避ける）。
	var oldFiles []string
	walkErr := filepath.WalkDir(abs, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			// 個別の走査エラーは握り潰して続行（権限・競合等）。
			return nil
		}
		if entry.IsDir() || entry.Type()&os.ModeSymlink != 0 {
			return nil
		}
		fileInfo, err := entry.Info()
		if err != nil {
			return nil
		}
		if fileInfo.ModTime().Before(cutoff) {
			oldFiles = append(oldFiles, path)
		}
		return nil
	})
	if walkErr != nil {
		logging.Error("housekeeping: walk failed under %s: %v", rel, walkErr)
		return res
	}

	for _, path := range oldFiles {
		if err := os.Remove(path); err != nil {
			logging.Error("housekeeping: failed to remove %s: %v", path, err)
			continue
		}
		res.RemovedFiles++
	}

	// ファイル削除後に空になったサブディレクトリを畳む（abs 自身は残す）。
	res.RemovedDirs += s.pruneEmptyDirs(abs)
	return res
}

// pruneEmptyDirs は root 配下の空ディレクトリを深い方から削除する。root 自身は残す。
func (s *Sweeper) pruneEmptyDirs(root string) int {
	var dirs []string
	_ = filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return nil
		}
		if entry.IsDir() && path != root && entry.Type()&os.ModeSymlink == 0 {
			dirs = append(dirs, path)
		}
		return nil
	})
	// 深い方（パスが長い方）から削除すると、空になった親も順に畳める。
	removed := 0
	for i := len(dirs) - 1; i >= 0; i-- {
		entries, err := os.ReadDir(dirs[i])
		if err != nil || len(entries) > 0 {
			continue
		}
		if err := os.Remove(dirs[i]); err != nil {
			continue
		}
		removed++
	}
	return removed
}
