// Package cache は配布版が管理するアプリキャッシュの状態確認と削除を担う。
//
// 対象は config.AppCacheDir のみ。CLI のホーム配下キャッシュ、認証情報、履歴、
// キャラ設定、プリセットなどは一切触らない。
package cache

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"

	"alslime/internal/config"
	"alslime/internal/logging"
	"alslime/internal/storage/paths"
	"alslime/internal/system/diagnostics"
)

// Manager はアプリ管理 cache ディレクトリを扱う。
type Manager struct {
	resolver *paths.Resolver
}

// New は Manager を生成する。
func New(resolver *paths.Resolver) *Manager {
	return &Manager{resolver: resolver}
}

// Status は cache ディレクトリの状態。
type Status struct {
	Status     diagnostics.CheckStatus `json:"status"`
	MessageKey string                  `json:"messageKey"`
	Path       string                  `json:"path"`
	Exists     bool                    `json:"exists"`
	FileCount  int                     `json:"fileCount"`
	DirCount   int                     `json:"dirCount"`
	SizeBytes  int64                   `json:"sizeBytes"`
}

// ClearResult は cache 削除の結果。
type ClearResult struct {
	Status       diagnostics.CheckStatus `json:"status"`
	MessageKey   string                  `json:"messageKey"`
	Path         string                  `json:"path"`
	RemovedCount int                     `json:"removedCount"`
	SizeBytes    int64                   `json:"sizeBytes"`
	After        Status                  `json:"after"`
}

// Status は cache ディレクトリを走査し、件数と容量を返す。
func (m *Manager) Status() (Status, error) {
	rel := config.AppCacheDir
	abs, err := m.resolver.ResolveLexical(rel)
	if err != nil {
		return Status{}, err
	}
	info, err := os.Lstat(abs)
	if errors.Is(err, fs.ErrNotExist) {
		return Status{
			Status:     diagnostics.CheckOK,
			MessageKey: "system.cache.notCreated",
			Path:       rel,
			Exists:     false,
		}, nil
	}
	if err != nil {
		return Status{}, err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return Status{
			Status:     diagnostics.CheckError,
			MessageKey: "system.cache.invalidPath",
			Path:       rel,
			Exists:     true,
		}, nil
	}
	if _, err := m.resolver.ResolveExisting(rel); err != nil {
		return Status{
			Status:     diagnostics.CheckError,
			MessageKey: "system.cache.outsideWorkspace",
			Path:       rel,
			Exists:     true,
		}, nil
	}

	status := Status{
		Status:     diagnostics.CheckOK,
		MessageKey: "system.cache.ready",
		Path:       rel,
		Exists:     true,
	}
	err = filepath.WalkDir(abs, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if path == abs {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if entry.IsDir() {
			status.DirCount++
			return nil
		}
		status.FileCount++
		status.SizeBytes += info.Size()
		return nil
	})
	if err != nil {
		return Status{}, err
	}
	return status, nil
}

// Clear はアプリ管理 cache ディレクトリ配下だけを削除する。
func (m *Manager) Clear() (ClearResult, error) {
	before, err := m.Status()
	if err != nil {
		return ClearResult{}, err
	}
	abs, err := m.resolver.ResolveDirForMkdirAll(config.AppCacheDir, config.DirPerm)
	if err != nil {
		return ClearResult{}, err
	}
	entries, err := os.ReadDir(abs)
	if err != nil {
		return ClearResult{}, err
	}

	// 個別エントリの異常（壊れた symlink・解決失敗・削除失敗）で全体を中断しない。
	// 中断すると当該項目を UI から消す手段が無くなるため、ログしてスキップし、
	// 消せるものは消し切る（残存は After の件数で見える）。
	removed := 0
	skipped := 0
	for _, entry := range entries {
		childRel := config.AppCacheDir + "/" + entry.Name()
		childAbs, err := m.resolver.ResolveExisting(childRel)
		if err != nil {
			logging.Warn("cache clear: %s の解決に失敗したためスキップ: %v", childRel, err)
			skipped++
			continue
		}
		info, err := os.Lstat(childAbs)
		if err != nil {
			logging.Warn("cache clear: %s の状態取得に失敗したためスキップ: %v", childRel, err)
			skipped++
			continue
		}
		if info.Mode()&os.ModeSymlink != 0 {
			// 領域外を指し得る symlink には触れない（既存の防御方針を維持）。
			logging.Warn("cache clear: %s は symlink のためスキップ", childRel)
			skipped++
			continue
		}
		if err := os.RemoveAll(childAbs); err != nil {
			logging.Warn("cache clear: %s の削除に失敗したためスキップ: %v", childRel, err)
			skipped++
			continue
		}
		removed++
	}
	if skipped > 0 {
		logging.Warn("cache clear: %d 件をスキップ（%d 件削除）", skipped, removed)
	}

	after, err := m.Status()
	if err != nil {
		return ClearResult{}, err
	}
	return ClearResult{
		Status:       diagnostics.CheckOK,
		MessageKey:   "system.cache.cleared",
		Path:         config.AppCacheDir,
		RemovedCount: removed,
		SizeBytes:    before.SizeBytes,
		After:        after,
	}, nil
}
