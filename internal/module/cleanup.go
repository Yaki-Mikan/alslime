package module

import (
	"os"
	"path/filepath"

	"alslime/internal/logging"
)

// CleanupStaleFiles は更新時の待避残骸（<WORKSPACE_ROOT>/modules/*.old）を削除する
// （ファイル自動更新、確認 01番 6.3）。
//
// サイドカー更新は実行中 exe を .old へ待避して新実体を配置するため、本体の
// 再起動後に旧実体が残る。旧サイドカープロセスは本体終了で解放済みのため、
// 起動時（background）に一度呼べば削除できる。失敗しても次回起動で再試行される。
func CleanupStaleFiles(workspaceRoot string) {
	pattern := filepath.Join(workspaceRoot, "modules", "alslime-*.old")
	matches, err := filepath.Glob(pattern)
	if err != nil {
		return
	}
	for _, path := range matches {
		if err := os.Remove(path); err != nil {
			logging.Info("module: stale file cleanup failed (retry next start): %s: %v", path, err)
		}
	}
}
