// Package charfilters はキャラリストの走査とキャラフィルタ（works/tags）の集約を担う。
//
// 現行 Node 版 routes/files.ts の character-tags / character-filters / rebuild を移植する。
//
// キャラ定義（現行忠実）:
//   - roleplay/characters/<dir>/settings/*.md の各 .md を 1 キャラとして扱う。
//   - 1 ディレクトリに複数 .md があれば複数キャラになる。
//   - 各キャラの設定ディレクトリにある tags.json（{ work, tags }）を読む。
//
// 返す path は「characters/<dir>/settings/<md>」の相対・"/" 区切り。
// この path は SSRP の選択値として使われるため、現行とズラさない（交換日記 28）。
package charfilters

import (
	"errors"
	"io/fs"
	"os"
	"sort"
	"strings"

	"alslime/internal/config"
	"alslime/internal/storage/jsonstore"
	"alslime/internal/storage/paths"
)

// tagsFileName は各キャラ設定ディレクトリ内のタグ定義ファイル名。
const tagsFileName = "tags.json"

// settingsDirName はキャラディレクトリ内の設定サブディレクトリ名。
const settingsDirName = "settings"

// Character は character-tags の 1 要素。
type Character struct {
	Name    string   `json:"name"`
	DirName string   `json:"dirName"`
	Path    string   `json:"path"`
	Work    *string  `json:"work"`
	Tags    []string `json:"tags"`
}

// Filters は works/tags のマスタ。
type Filters struct {
	Works []string `json:"works"`
	Tags  []string `json:"tags"`
}

// RebuildStats は rebuild の統計。
type RebuildStats struct {
	TotalCharacters int `json:"totalCharacters"`
	WithTags        int `json:"withTags"`
	WithoutTags     int `json:"withoutTags"`
}

// Store はキャラリスト走査・フィルタ集約を担う。
type Store struct {
	resolver    *paths.Resolver
	charListDir string // roleplay/characters
	filtersFile string // character_filters.json
}

// New は Store を生成する。dir は論理パス。
func New(resolver *paths.Resolver, charListDir, filtersFile string) *Store {
	return &Store{resolver: resolver, charListDir: charListDir, filtersFile: filtersFile}
}

// tagInfo は tags.json の中身。
type tagInfo struct {
	work *string
	tags []string
}

// readTagsJSON は設定ディレクトリの tags.json を読む。
// 未存在・破損は work=nil / tags=[]（現行の握り潰し。config-check で別途検出予定）。
func (s *Store) readTagsJSON(settingsLogical string) tagInfo {
	logical := settingsLogical + "/" + tagsFileName
	abs, err := s.resolver.ResolveExisting(logical)
	if err != nil {
		return tagInfo{tags: []string{}}
	}
	// 破損・未存在はここで握り潰す。破損ファイルの可視化は将来 config-check 側で扱う。
	raw, err := jsonstore.ReadRaw(abs)
	if err != nil {
		return tagInfo{tags: []string{}}
	}
	info := tagInfo{tags: []string{}}
	if w, ok := raw["work"].(string); ok && w != "" {
		info.work = &w
	}
	if arr, ok := raw["tags"].([]any); ok {
		for _, t := range arr {
			if ts, ok := t.(string); ok {
				info.tags = append(info.tags, ts)
			}
		}
	}
	return info
}

// ListCharacters はキャラ一覧（各 .md = 1 キャラ）を返す。名前順ソート。
func (s *Store) ListCharacters() ([]Character, error) {
	dirAbs, ok, err := s.resolveExistingIfExists(s.charListDir)
	if err != nil {
		return nil, err
	}
	if !ok {
		return []Character{}, nil
	}
	dirents, err := os.ReadDir(dirAbs)
	if err != nil {
		return nil, err
	}

	chars := make([]Character, 0)
	for _, d := range dirents {
		if !d.IsDir() {
			continue
		}
		dirName := d.Name()
		settingsLogical := s.charListDir + "/" + dirName + "/" + settingsDirName
		settingsAbs, sok, serr := s.resolveExistingIfExists(settingsLogical)
		if serr != nil || !sok {
			continue
		}
		settingsFiles, rerr := os.ReadDir(settingsAbs)
		if rerr != nil {
			continue
		}
		var mdFiles []string
		for _, f := range settingsFiles {
			if !f.IsDir() && strings.HasSuffix(f.Name(), ".md") {
				mdFiles = append(mdFiles, f.Name())
			}
		}
		if len(mdFiles) == 0 {
			continue
		}
		info := s.readTagsJSON(settingsLogical)
		for _, md := range mdFiles {
			chars = append(chars, Character{
				Name:    strings.TrimSuffix(md, ".md"),
				DirName: dirName,
				Path:    s.charListDir + "/" + dirName + "/" + settingsDirName + "/" + md,
				Work:    info.work,
				Tags:    info.tags,
			})
		}
	}
	sort.SliceStable(chars, func(i, j int) bool { return chars[i].Name < chars[j].Name })
	return chars, nil
}

// LoadFilters はマスタ（character_filters.json）を読む。無ければ空。
func (s *Store) LoadFilters() (Filters, error) {
	out := Filters{Works: []string{}, Tags: []string{}}
	abs, ok, err := s.resolveExistingIfExists(s.filtersFile)
	if err != nil {
		return out, err
	}
	if !ok {
		return out, nil
	}
	raw, rerr := jsonstore.ReadRaw(abs)
	if rerr != nil {
		// 破損は空を返す（現行踏襲。config-check で検出予定）。
		return out, nil
	}
	out.Works = toStringSlice(raw["works"])
	out.Tags = toStringSlice(raw["tags"])
	return out, nil
}

// Rebuild は全キャラの tags.json を走査して works/tags を集約し、マスタへ書き出す。
func (s *Store) Rebuild() (Filters, RebuildStats, error) {
	var stats RebuildStats
	result := Filters{Works: []string{}, Tags: []string{}}

	dirAbs, ok, err := s.resolveExistingIfExists(s.charListDir)
	if err != nil {
		return result, stats, err
	}
	if ok {
		dirents, rerr := os.ReadDir(dirAbs)
		if rerr != nil {
			return result, stats, rerr
		}
		worksSet := map[string]bool{}
		tagsSet := map[string]bool{}
		for _, d := range dirents {
			if !d.IsDir() {
				continue
			}
			settingsLogical := s.charListDir + "/" + d.Name() + "/" + settingsDirName
			if _, sok, _ := s.resolveExistingIfExists(settingsLogical); !sok {
				continue
			}
			stats.TotalCharacters++
			info := s.readTagsJSON(settingsLogical)
			if info.work != nil || len(info.tags) > 0 {
				stats.WithTags++
			}
			if info.work != nil {
				worksSet[*info.work] = true
			}
			for _, t := range info.tags {
				tagsSet[t] = true
			}
		}
		result.Works = sortedKeys(worksSet)
		result.Tags = sortedKeys(tagsSet)
	}
	stats.WithoutTags = stats.TotalCharacters - stats.WithTags

	// マスタへ書き出し（2 スペース・現行同等）。
	path, err := s.resolver.ResolveForCreateMkdirAll(s.filtersFile, config.DirPerm)
	if err != nil {
		return result, stats, err
	}
	if err := jsonstore.WriteJSON(path, result); err != nil {
		return result, stats, err
	}
	return result, stats, nil
}

// resolveExistingIfExists は logical（ファイル/ディレクトリ問わず）が存在すれば
// 実体境界確認済み絶対パスを返す。未存在は ok=false。
func (s *Store) resolveExistingIfExists(logical string) (string, bool, error) {
	lexical, err := s.resolver.ResolveLexical(logical)
	if err != nil {
		return "", false, err
	}
	if _, statErr := os.Lstat(lexical); errors.Is(statErr, fs.ErrNotExist) {
		return "", false, nil
	}
	abs, err := s.resolver.ResolveExisting(logical)
	if err != nil {
		return "", false, err
	}
	return abs, true, nil
}

// toStringSlice は any（[]any）を []string へ変換する。非文字列は無視。
func toStringSlice(v any) []string {
	out := []string{}
	if arr, ok := v.([]any); ok {
		for _, e := range arr {
			if s, ok := e.(string); ok {
				out = append(out, s)
			}
		}
	}
	return out
}

// sortedKeys は集合のキーをソートして返す。
func sortedKeys(set map[string]bool) []string {
	out := make([]string, 0, len(set))
	for k := range set {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
