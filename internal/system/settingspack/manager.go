// Package settingspack は設定パック zip の検査・インポート適用・エクスポート生成を担う。
//
// 分類・プラン判定の正本は domain/settingspack。本パッケージはファイルシステムと
// zip の読み書きだけを受け持ち、書き込みは必ず paths.Resolver を通す
// （ワークスペース外書き込み防止。設計 §5）。
package settingspack

import (
	"archive/zip"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"alslime/internal/buildinfo"
	"alslime/internal/config"
	domain "alslime/internal/domain/settingspack"
	"alslime/internal/storage/paths"
)

// Manager は設定パックの入出力を扱う。
type Manager struct {
	resolver *paths.Resolver
	now      func() time.Time
}

// New は Manager を生成する。
func New(resolver *paths.Resolver) *Manager {
	return &Manager{resolver: resolver, now: time.Now}
}

// ImportPolicy は衝突時の解決方針（設計 §5。既定はスキップ）。
type ImportPolicy string

const (
	// PolicySkip は既存ファイルを残し、パック側を書き込まない（既定）。
	PolicySkip ImportPolicy = "skip"
	// PolicyOverwrite は既存ファイルをパック側で上書きする。
	PolicyOverwrite ImportPolicy = "overwrite"
	// PolicyRename はパック側を「名前 (2).ext」形式の空き名で追加する。
	PolicyRename ImportPolicy = "rename"
)

// ValidPolicy は policy 文字列が既知の値かを返す。
func ValidPolicy(p ImportPolicy) bool {
	switch p {
	case PolicySkip, PolicyOverwrite, PolicyRename:
		return true
	}
	return false
}

// ImportOptions はインポート適用時の指定。
type ImportOptions struct {
	// Policy は衝突時の既定ポリシー。
	Policy ImportPolicy
	// Overrides は展開先パスごとの個別ポリシー（UI の個別トグル）。
	Overrides map[string]ImportPolicy
	// ImageGenAllowed は D 分類（画像生成系）の取り込み可否（tier ゲート）。
	ImageGenAllowed bool
}

// ImportedEntry は適用結果1件。
type ImportedEntry struct {
	// Path は展開先（WORKSPACE_ROOT 相対）。
	Path string `json:"path"`
	// WrittenAs はリネーム適用時の実際の書き込み先（それ以外は空）。
	WrittenAs string `json:"writtenAs,omitempty"`
}

// SkippedEntry はスキップ結果1件。
type SkippedEntry struct {
	Path      string `json:"path"`
	ReasonKey string `json:"reasonKey"`
}

// ImportResult はインポート適用結果。
type ImportResult struct {
	MessageKey string           `json:"messageKey"`
	Written    []ImportedEntry  `json:"written"`
	Skipped    []SkippedEntry   `json:"skipped"`
	Warnings   []domain.Warning `json:"warnings"`
}

// ExportSelection はエクスポート対象の選択。
type ExportSelection struct {
	// KindIDs は対象種別（domain.Kinds の ID）。
	KindIDs []string
	// IncludeCharacterImages はキャラ画像（images/）を含めるか（既定 false。設計 §6）。
	IncludeCharacterImages bool
	// Name / Description はマニフェストへ記録する表示情報。
	Name        string
	Description string
}

// ExportSummary はエクスポート結果の概要。
type ExportSummary struct {
	FileCount  int   `json:"fileCount"`
	TotalBytes int64 `json:"totalBytes"`
}

// errPolicyConflict はスキップ理由「衝突（ポリシー skip）」の messageKey。
const reasonConflictSkipped = "settingsPack.skip.conflict"

// Inspect はパック zip を検査してインポートプラン（dry-run）を返す。
// ファイルシステムには一切書き込まない。
func (m *Manager) Inspect(zipPath string, imageGenAllowed bool) (domain.Plan, error) {
	zr, err := zip.OpenReader(zipPath)
	if err != nil {
		return domain.Plan{}, domain.ErrManifestInvalid
	}
	defer func() { _ = zr.Close() }()

	entries, manifest, err := m.readEntries(&zr.Reader)
	if err != nil {
		return domain.Plan{}, err
	}
	return domain.BuildPlan(entries, manifest, domain.PlanOptions{
		Exists:          m.exists,
		ImageGenAllowed: imageGenAllowed,
	}), nil
}

// Import はパック zip を検査したうえで適用する。
//
// Blocked なプラン（auth 配下を含む等）は一切書かずにエラーを返す。
// 書き込みは同一ディレクトリの一時ファイル経由で行い、途中失敗で
// 中途半端な内容が残らないようにする。
func (m *Manager) Import(zipPath string, opts ImportOptions) (ImportResult, error) {
	if !ValidPolicy(opts.Policy) {
		opts.Policy = PolicySkip
	}
	zr, err := zip.OpenReader(zipPath)
	if err != nil {
		return ImportResult{}, domain.ErrManifestInvalid
	}
	defer func() { _ = zr.Close() }()

	entries, manifest, err := m.readEntries(&zr.Reader)
	if err != nil {
		return ImportResult{}, err
	}
	plan := domain.BuildPlan(entries, manifest, domain.PlanOptions{
		Exists:          m.exists,
		ImageGenAllowed: opts.ImageGenAllowed,
	})
	if plan.Blocked {
		return ImportResult{}, errors.New(plan.BlockedKey)
	}

	// zip 内エントリ（正規化前の名前）→ 展開先パスの対応を再構築する。
	// readEntries と同じ正規化を通るため、プランのエントリ順と一致する。
	files := payloadFiles(&zr.Reader)
	if len(files) != len(plan.Entries) {
		return ImportResult{}, fmt.Errorf("settingspack: プランとエントリ数が一致しない (plan=%d zip=%d)", len(plan.Entries), len(files))
	}

	result := ImportResult{
		MessageKey: "settingsPack.imported",
		Written:    []ImportedEntry{},
		Skipped:    []SkippedEntry{},
		Warnings:   plan.Warnings,
	}
	var totalWritten int64
	for i, pe := range plan.Entries {
		if pe.Action == domain.ActionSkip {
			result.Skipped = append(result.Skipped, SkippedEntry{Path: pe.Path, ReasonKey: pe.ReasonKey})
			continue
		}
		dest := pe.Path
		if pe.Action == domain.ActionConflict {
			policy := opts.Policy
			if override, ok := opts.Overrides[pe.Path]; ok && ValidPolicy(override) {
				policy = override
			}
			switch policy {
			case PolicySkip:
				result.Skipped = append(result.Skipped, SkippedEntry{Path: pe.Path, ReasonKey: reasonConflictSkipped})
				continue
			case PolicyRename:
				renamed, err := m.freeName(pe.Path)
				if err != nil {
					return result, err
				}
				dest = renamed
			case PolicyOverwrite:
				// dest のまま上書き。
			}
		}
		written, err := m.writeEntry(files[i], dest, config.SettingsPackMaxTotalBytes-totalWritten)
		if err != nil {
			return result, err
		}
		totalWritten += written
		entry := ImportedEntry{Path: pe.Path}
		if dest != pe.Path {
			entry.WrittenAs = dest
		}
		result.Written = append(result.Written, entry)
	}
	return result, nil
}

// Export は選択された種別のファイルを zip として w へ書き出す。
//
// E・F 分類は選択自体が不可能（Kinds に含まれない・walk 中も除外）。
// D 分類は imageGenAllowed=false のとき選択をエラーにする（API 層でも弾くが二重に守る）。
func (m *Manager) Export(w io.Writer, sel ExportSelection, imageGenAllowed bool) (ExportSummary, error) {
	kinds := make([]domain.Kind, 0, len(sel.KindIDs))
	for _, id := range sel.KindIDs {
		k, ok := domain.FindKind(id)
		if !ok {
			return ExportSummary{}, fmt.Errorf("settingspack: 未知の種別 %q", id)
		}
		if k.Class == domain.ClassImageGen && !imageGenAllowed {
			return ExportSummary{}, errors.New(domain.ReasonTier)
		}
		kinds = append(kinds, k)
	}

	files, err := m.collectExportFiles(kinds, sel.IncludeCharacterImages)
	if err != nil {
		return ExportSummary{}, err
	}

	manifest := m.buildManifest(sel, files)
	manifestJSON, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return ExportSummary{}, err
	}

	zw := zip.NewWriter(w)
	mw, err := zw.Create(config.SettingsPackManifestFileName)
	if err != nil {
		return ExportSummary{}, err
	}
	if _, err := mw.Write(manifestJSON); err != nil {
		return ExportSummary{}, err
	}

	var total int64
	for _, f := range files {
		fw, err := zw.Create(f.rel)
		if err != nil {
			return ExportSummary{}, err
		}
		src, err := os.Open(f.abs)
		if err != nil {
			return ExportSummary{}, err
		}
		n, err := io.Copy(fw, src)
		_ = src.Close()
		if err != nil {
			return ExportSummary{}, err
		}
		total += n
	}
	if err := zw.Close(); err != nil {
		return ExportSummary{}, err
	}
	return ExportSummary{FileCount: len(files), TotalBytes: total}, nil
}

// --- zip 読み出し ---

// payloadFiles はマニフェスト・ディレクトリエントリを除いたファイルエントリを返す。
func payloadFiles(zr *zip.Reader) []*zip.File {
	files := make([]*zip.File, 0, len(zr.File))
	for _, f := range zr.File {
		if f.FileInfo().IsDir() {
			continue
		}
		if normalizeZipName(f.Name) == config.SettingsPackManifestFileName {
			continue
		}
		files = append(files, f)
	}
	return files
}

// readEntries は zip 全エントリを正規化・上限検査し、マニフェストを解釈する。
func (m *Manager) readEntries(zr *zip.Reader) ([]domain.Entry, *domain.Manifest, error) {
	if len(zr.File) > config.SettingsPackMaxEntries {
		return nil, nil, domain.ErrTooManyEntries
	}
	var declared int64
	for _, f := range zr.File {
		declared += int64(f.UncompressedSize64)
		if declared > config.SettingsPackMaxTotalBytes {
			return nil, nil, domain.ErrTooLarge
		}
	}

	var manifest *domain.Manifest
	aliases := domain.LooseAliases()
	entries := make([]domain.Entry, 0, len(zr.File))
	for _, f := range zr.File {
		if f.FileInfo().IsDir() {
			continue
		}
		name := normalizeZipName(f.Name)
		if name == config.SettingsPackManifestFileName {
			data, err := readZipFile(f, 1<<20)
			if err != nil {
				return nil, nil, domain.ErrManifestInvalid
			}
			manifest, err = domain.ParseManifest(data)
			if err != nil {
				return nil, nil, err
			}
			continue
		}
		entry := domain.Entry{SizeBytes: int64(f.UncompressedSize64)}
		switch {
		case !validZipName(name) || f.FileInfo().Mode()&os.ModeSymlink != 0:
			// 脱出・絶対パス・symlink はプラン上で無条件スキップとして報告する。
			entry.Path = name
			entry.Invalid = true
		default:
			entry.Path = resolveLoose(name, aliases)
		}
		entries = append(entries, entry)
	}
	return entries, manifest, nil
}

// normalizeZipName は zip エントリ名を "/" 区切りへ正規化する
// （Windows 製 zip の "\" 区切りを吸収する）。
func normalizeZipName(name string) string {
	return strings.ReplaceAll(name, `\`, "/")
}

// validZipName はエントリ名が展開先として安全かを検査する。
// 絶対パス・ドライブレター・".."・空セグメントを拒否する。
func validZipName(name string) bool {
	if name == "" || strings.HasPrefix(name, "/") || strings.Contains(name, ":") {
		return false
	}
	for _, seg := range strings.Split(name, "/") {
		if seg == "" || seg == "." || seg == ".." {
			return false
		}
	}
	return true
}

// resolveLoose はゆるい形式（形式B。設計 §3-2）のエントリ名を展開先へ解決する。
//
// "roleplay/" 始まりは正準形式（形式A）としてそのまま返す。
// トップレベルディレクトリ名がエイリアス表に載っていれば展開先ベースへ差し替える。
// どちらでもないものはそのまま返し、分類側で未認識スキップとして報告される。
func resolveLoose(name string, aliases map[string]string) string {
	if strings.HasPrefix(name, config.RolePlayDir+"/") {
		return name
	}
	top, rest, ok := strings.Cut(name, "/")
	if !ok {
		return name
	}
	base, found := aliases[top]
	if !found {
		return name
	}
	return base + "/" + rest
}

// readZipFile は1エントリを上限付きで読み切る（マニフェスト用）。
func readZipFile(f *zip.File, limit int64) ([]byte, error) {
	rc, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer func() { _ = rc.Close() }()
	data, err := io.ReadAll(io.LimitReader(rc, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, domain.ErrTooLarge
	}
	return data, nil
}

// --- インポート書き込み ---

// exists は展開先の既存判定（プランの conflict 判定用）。
func (m *Manager) exists(rel string) bool {
	abs, err := m.resolver.ResolveLexical(rel)
	if err != nil {
		return false
	}
	_, err = os.Lstat(abs)
	return err == nil
}

// writeEntry は zip エントリ1件を dest へ書き込む。
//
// 親ディレクトリは resolver 経由で作成し、同一ディレクトリの一時ファイルへ
// 書いてから rename する。remaining は zip 爆弾対策の残り書き込み許容量
// （ヘッダ申告値でなく実書き込み量で制限する）。
func (m *Manager) writeEntry(f *zip.File, dest string, remaining int64) (int64, error) {
	if remaining <= 0 {
		return 0, domain.ErrTooLarge
	}
	dir := path.Dir(dest)
	dirAbs, err := m.resolver.ResolveDirForMkdirAll(dir, config.DirPerm)
	if err != nil {
		return 0, err
	}
	if _, err := m.resolver.ResolveForCreate(dest); err != nil {
		return 0, err
	}

	rc, err := f.Open()
	if err != nil {
		return 0, err
	}
	defer func() { _ = rc.Close() }()

	tmp, err := os.CreateTemp(dirAbs, ".pack-import-*")
	if err != nil {
		return 0, err
	}
	tmpName := tmp.Name()
	success := false
	defer func() {
		_ = tmp.Close()
		if !success {
			_ = os.Remove(tmpName)
		}
	}()

	written, err := io.Copy(tmp, io.LimitReader(rc, remaining+1))
	if err != nil {
		return 0, err
	}
	if written > remaining {
		return 0, domain.ErrTooLarge
	}
	if err := tmp.Close(); err != nil {
		return 0, err
	}
	if err := os.Chmod(tmpName, config.FilePerm); err != nil {
		return 0, err
	}
	destAbs := filepath.Join(dirAbs, path.Base(dest))
	if err := os.Rename(tmpName, destAbs); err != nil {
		return 0, err
	}
	success = true
	return written, nil
}

// freeName は「名前 (2).ext」形式の空き名を探す（PolicyRename 用）。
func (m *Manager) freeName(rel string) (string, error) {
	dir := path.Dir(rel)
	base := path.Base(rel)
	ext := path.Ext(base)
	stem := strings.TrimSuffix(base, ext)
	for n := 2; n < 1000; n++ {
		candidate := fmt.Sprintf("%s/%s (%d)%s", dir, stem, n, ext)
		if !m.exists(candidate) {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("settingspack: 空き名を確保できない: %s", rel)
}

// --- エクスポート収集 ---

type exportFile struct {
	abs  string
	rel  string
	kind string
}

// collectExportFiles は選択種別の実ファイルを列挙する。
//
// walk 中も F 分類（denylist）・キャラ内部データを常に除外し、
// キャラ画像は includeImages のときだけ含める（設計 §6）。
func (m *Manager) collectExportFiles(kinds []domain.Kind, includeImages bool) ([]exportFile, error) {
	var files []exportFile
	seen := map[string]bool{}
	add := func(rel, kindID string) error {
		if seen[rel] {
			return nil
		}
		abs, err := m.resolver.ResolveExisting(rel)
		if err != nil {
			return err
		}
		info, err := os.Lstat(abs)
		if err != nil || info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return nil
		}
		seen[rel] = true
		files = append(files, exportFile{abs: abs, rel: rel, kind: kindID})
		return nil
	}

	for _, k := range kinds {
		for _, f := range k.Files {
			if !m.exists(f) {
				continue
			}
			if err := add(f, k.ID); err != nil {
				return nil, err
			}
		}
		for _, root := range k.Roots {
			if err := m.walkRoot(root, k.ID, includeImages, add); err != nil {
				return nil, err
			}
		}
	}
	sort.Slice(files, func(i, j int) bool { return files[i].rel < files[j].rel })
	return files, nil
}

// walkRoot は root 配下を走査して add を呼ぶ（backup.collectEntries と同じ安全方針）。
func (m *Manager) walkRoot(root, kindID string, includeImages bool, add func(rel, kindID string) error) error {
	rootAbs, err := m.resolver.ResolveLexical(root)
	if err != nil {
		return err
	}
	info, err := os.Lstat(rootAbs)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return paths.ErrOutsideWorkspace
	}
	if _, err := m.resolver.ResolveExisting(root); err != nil {
		return err
	}
	return filepath.WalkDir(rootAbs, func(p string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if p == rootAbs {
			return nil
		}
		rel, err := m.resolver.ToSlash(p)
		if err != nil {
			return err
		}
		if excludeOnExport(rel, includeImages) {
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
		return add(rel, kindID)
	})
}

// excludeOnExport はエクスポート walk 中の除外判定。
func excludeOnExport(rel string, includeImages bool) bool {
	c := domain.Classify(rel)
	if c.Class == domain.ClassForbidden || c.Class == domain.ClassEnv {
		return true
	}
	if domain.IsCharacterInternal(rel) {
		return true
	}
	if !includeImages && domain.IsCharacterImage(rel) {
		return true
	}
	return false
}

// buildManifest はエクスポート用マニフェストを組み立てる。
func (m *Manager) buildManifest(sel ExportSelection, files []exportFile) domain.Manifest {
	counts := map[string]int{}
	order := []string{}
	for _, f := range files {
		if _, ok := counts[f.kind]; !ok {
			order = append(order, f.kind)
		}
		counts[f.kind]++
	}
	contents := make([]domain.ManifestContent, 0, len(order))
	for _, kind := range order {
		contents = append(contents, domain.ManifestContent{Kind: kind, Count: counts[kind]})
	}
	return domain.Manifest{
		PackFormat:  config.SettingsPackFormat,
		Structure:   config.SettingsPackStructure,
		Name:        sel.Name,
		Description: sel.Description,
		CreatedAt:   m.now().Format(time.RFC3339),
		CreatedBy:   "alslime " + buildinfo.Snapshot().Version,
		Contents:    contents,
	}
}
