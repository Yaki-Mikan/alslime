// Package backup は配布版の設定バックアップ作成と一覧取得を担う。
//
// 初期実装は restore を持たない。危険操作は後段の確認画面・検証設計とセットで扱う。
package backup

import (
	"archive/zip"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"alslime/internal/config"
	"alslime/internal/storage/paths"
	"alslime/internal/system/diagnostics"
)

// Manager はバックアップ保存先と対象を扱う。
type Manager struct {
	resolver *paths.Resolver
	now      func() time.Time
}

// New は Manager を生成する。
func New(resolver *paths.Resolver) *Manager {
	return &Manager{resolver: resolver, now: time.Now}
}

// Backup は作成済みバックアップの情報。
type Backup struct {
	Name      string    `json:"name"`
	Path      string    `json:"path"`
	SizeBytes int64     `json:"sizeBytes"`
	CreatedAt time.Time `json:"createdAt"`
}

// CreateResult はバックアップ作成結果。
type CreateResult struct {
	Status     diagnostics.CheckStatus `json:"status"`
	MessageKey string                  `json:"messageKey"`
	Backup     Backup                  `json:"backup"`
	FileCount  int                     `json:"fileCount"`
	SizeBytes  int64                   `json:"sizeBytes"`
}

// ListResult はバックアップ一覧。
type ListResult struct {
	Status     diagnostics.CheckStatus `json:"status"`
	MessageKey string                  `json:"messageKey"`
	Backups    []Backup                `json:"backups"`
}

// Create は設定・プリセット中心のバックアップ zip を作成する。
func (m *Manager) Create() (CreateResult, error) {
	backupDir, err := m.resolver.ResolveDirForMkdirAll(config.AppBackupDir, config.DirPerm)
	if err != nil {
		return CreateResult{}, err
	}
	name := "backup-" + m.now().Format("20060102-150405") + ".zip"
	rel := config.AppBackupDir + "/" + name
	abs, err := m.resolver.ResolveForCreate(rel)
	if err != nil {
		return CreateResult{}, err
	}

	entries, err := m.collectEntries()
	if err != nil {
		return CreateResult{}, err
	}

	tmp, err := os.CreateTemp(backupDir, ".backup-*.zip")
	if err != nil {
		return CreateResult{}, err
	}
	tmpName := tmp.Name()
	success := false
	defer func() {
		_ = tmp.Close()
		if !success {
			_ = os.Remove(tmpName)
		}
	}()

	zw := zip.NewWriter(tmp)
	var total int64
	for _, entry := range entries {
		size, err := addFile(zw, entry.abs, entry.rel)
		if err != nil {
			_ = zw.Close()
			return CreateResult{}, err
		}
		total += size
	}
	if err := zw.Close(); err != nil {
		return CreateResult{}, err
	}
	if err := tmp.Close(); err != nil {
		return CreateResult{}, err
	}
	if err := os.Rename(tmpName, abs); err != nil {
		return CreateResult{}, err
	}
	success = true

	info, err := os.Stat(abs)
	if err != nil {
		return CreateResult{}, err
	}
	return CreateResult{
		Status:     diagnostics.CheckOK,
		MessageKey: "system.backup.created",
		Backup: Backup{
			Name:      name,
			Path:      rel,
			SizeBytes: info.Size(),
			CreatedAt: info.ModTime(),
		},
		FileCount: len(entries),
		SizeBytes: total,
	}, nil
}

// List は作成済みバックアップ zip を返す。
func (m *Manager) List() (ListResult, error) {
	abs, err := m.resolver.ResolveLexical(config.AppBackupDir)
	if err != nil {
		return ListResult{}, err
	}
	infos, err := os.ReadDir(abs)
	if errors.Is(err, fs.ErrNotExist) {
		return ListResult{
			Status:     diagnostics.CheckOK,
			MessageKey: "system.backup.empty",
			Backups:    []Backup{},
		}, nil
	}
	if err != nil {
		return ListResult{}, err
	}
	if _, err := m.resolver.ResolveExisting(config.AppBackupDir); err != nil {
		return ListResult{}, err
	}

	backups := make([]Backup, 0, len(infos))
	for _, entry := range infos {
		if entry.IsDir() || !strings.HasSuffix(strings.ToLower(entry.Name()), ".zip") {
			continue
		}
		rel := config.AppBackupDir + "/" + entry.Name()
		childAbs, err := m.resolver.ResolveExisting(rel)
		if err != nil {
			return ListResult{}, err
		}
		info, err := os.Lstat(childAbs)
		if err != nil {
			return ListResult{}, err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			continue
		}
		backups = append(backups, Backup{
			Name:      entry.Name(),
			Path:      rel,
			SizeBytes: info.Size(),
			CreatedAt: info.ModTime(),
		})
	}
	sort.Slice(backups, func(i, j int) bool {
		return backups[i].CreatedAt.After(backups[j].CreatedAt)
	})
	return ListResult{
		Status:     diagnostics.CheckOK,
		MessageKey: "system.backup.ready",
		Backups:    backups,
	}, nil
}

type backupEntry struct {
	abs string
	rel string
}

func (m *Manager) collectEntries() ([]backupEntry, error) {
	roots := []string{
		"roleplay/global",
		"roleplay/settings",
	}
	var entries []backupEntry
	for _, rootRel := range roots {
		rootAbs, err := m.resolver.ResolveLexical(rootRel)
		if err != nil {
			return nil, err
		}
		info, err := os.Lstat(rootAbs)
		if errors.Is(err, fs.ErrNotExist) {
			continue
		}
		if err != nil {
			return nil, err
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return nil, paths.ErrOutsideWorkspace
		}
		if _, err := m.resolver.ResolveExisting(rootRel); err != nil {
			return nil, err
		}
		err = filepath.WalkDir(rootAbs, func(path string, entry fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			rel, err := m.resolver.ToSlash(path)
			if err != nil {
				return err
			}
			if path == rootAbs {
				return nil
			}
			if shouldExclude(rel) {
				if entry.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
			info, err := entry.Info()
			if err != nil {
				return err
			}
			if info.Mode()&os.ModeSymlink != 0 {
				if entry.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
			if entry.IsDir() {
				return nil
			}
			if _, err := m.resolver.ResolveExisting(rel); err != nil {
				return err
			}
			entries = append(entries, backupEntry{abs: path, rel: rel})
			return nil
		})
		if err != nil {
			return nil, err
		}
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].rel < entries[j].rel })
	return entries, nil
}

func shouldExclude(rel string) bool {
	excludedPrefixes := []string{
		config.AppCacheDir,
		config.AppBackupDir,
		// 認証ファイル配置場所は秘匿情報のため backup に含めない（安全要件§8-2）。
		config.AuthDir,
	}
	for _, prefix := range excludedPrefixes {
		if rel == prefix || strings.HasPrefix(rel, prefix+"/") {
			return true
		}
	}
	return false
}

func addFile(zw *zip.Writer, abs, rel string) (int64, error) {
	info, err := os.Lstat(abs)
	if err != nil {
		return 0, err
	}
	header, err := zip.FileInfoHeader(info)
	if err != nil {
		return 0, err
	}
	header.Name = rel
	header.Method = zip.Deflate

	writer, err := zw.CreateHeader(header)
	if err != nil {
		return 0, err
	}
	file, err := os.Open(abs)
	if err != nil {
		return 0, err
	}
	defer func() { _ = file.Close() }()
	size, err := io.Copy(writer, file)
	if err != nil {
		return 0, err
	}
	return size, nil
}
