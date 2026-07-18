// Package workspacefs は WORKSPACE_ROOT 配下の汎用ファイル操作を境界付きで提供する。
//
// 現行 Node 版 routes/files.ts の /api/files・/api/content・write・mkdir・search を移植する。
// 現行は各所で path.normalize + startsWith の弱い境界判定をしていたが、
// 本パッケージは paths.Resolver を正本にし、プレフィックス誤判定・symlink 脱出を塞ぐ。
//
//   - 既存読み（list / read / search 走査）: ResolveExisting
//   - 新規書き込み: ResolveForCreateMkdirAll
//   - ディレクトリ作成: ResolveDirForMkdirAll
package workspacefs

import (
	"os"
	"path/filepath"
	"sort"
	"strings"

	"alslime/internal/config"
	"alslime/internal/storage/jsonstore"
	"alslime/internal/storage/paths"
)

// searchExcludeDirs は検索時に再帰しないディレクトリ名（現行踏襲。交換日記 28）。
// locations ではなく Files 用の定数としてここに集約する。
var searchExcludeDirs = map[string]bool{
	"node_modules": true,
	".git":         true,
	"dist":         true,
	".gemini":      true,
}

// searchMaxResults は検索結果の上限（現行踏襲）。
const searchMaxResults = 10

// Entry は一覧の 1 項目。path は WORKSPACE_ROOT 相対・"/" 区切り。
type Entry struct {
	Name        string `json:"name"`
	IsDirectory bool   `json:"isDirectory"`
	Path        string `json:"path"`
}

// Store は WORKSPACE_ROOT 配下のファイル操作を担う。
type Store struct {
	resolver *paths.Resolver
}

// New は Store を生成する。
func New(resolver *paths.Resolver) *Store {
	return &Store{resolver: resolver}
}

// List は rel ディレクトリの直下要素を返す。
//
// 返す各 Entry.Path と currentPath は WORKSPACE_ROOT 相対・"/" 区切り。
// ルートは "."（現行互換）。ディレクトリ優先 → 名前順でソートする。
func (s *Store) List(rel string) (entries []Entry, currentPath string, err error) {
	if rel == "" {
		rel = "."
	}
	abs, err := s.resolver.ResolveExisting(rel)
	if err != nil {
		return nil, "", err
	}
	dirents, err := os.ReadDir(abs)
	if err != nil {
		return nil, "", err
	}

	out := make([]Entry, 0, len(dirents))
	for _, d := range dirents {
		childAbs := filepath.Join(abs, d.Name())
		slash, serr := s.resolver.ToSlash(childAbs)
		if serr != nil {
			continue
		}
		out = append(out, Entry{Name: d.Name(), IsDirectory: d.IsDir(), Path: slash})
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].IsDirectory != out[j].IsDirectory {
			return out[i].IsDirectory // ディレクトリ優先
		}
		return out[i].Name < out[j].Name
	})

	cur, err := s.resolver.ToSlash(abs)
	if err != nil {
		return nil, "", err
	}
	if cur == "" {
		cur = "."
	}
	return out, cur, nil
}

// ReadContent は rel ファイルを UTF-8 文字列として返す。
func (s *Store) ReadContent(rel string) (string, error) {
	abs, err := s.resolver.ResolveExisting(rel)
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// Write は rel へ content を書き込む（親ディレクトリは作成）。
func (s *Store) Write(rel, content string) error {
	abs, err := s.resolver.ResolveForCreateMkdirAll(rel, config.DirPerm)
	if err != nil {
		return err
	}
	return os.WriteFile(abs, []byte(content), config.FilePerm)
}

// Mkdir は rel ディレクトリを再帰作成する。
func (s *Store) Mkdir(rel string) error {
	_, err := s.resolver.ResolveDirForMkdirAll(rel, config.DirPerm)
	return err
}

// Search は WORKSPACE_ROOT 全体を再帰走査し、ファイル名・相対パスが query を
// 部分一致で含むファイルを最大 searchMaxResults 件返す（現行踏襲・名前部分一致）。
//
// query は呼び出し側で小文字化済みであること。除外ディレクトリは再帰しない。
// アクセスできないディレクトリは無視する。
//
// 各ディレクトリの再帰前に ResolveExisting で実体境界を確認する（燈レビュー30 指摘1）。
// これにより、WORKSPACE_ROOT 配下に紛れた root 外を指す symlink / junction の先を
// 走査しない（生の os.ReadDir 再帰だと外部へ漏れる余地があった）。
func (s *Store) Search(query string) ([]string, error) {
	if query == "" {
		return []string{}, nil
	}
	results := make([]string, 0, searchMaxResults)
	s.searchDir(".", query, &results)
	return results, nil
}

// searchDir は論理相対パス rel のディレクトリ配下を再帰走査する。
//
// rel は WORKSPACE_ROOT 相対・"/" 区切り（ルートは "."）。各呼び出しで
// ResolveExisting(rel) を通し、実体が root 配下のディレクトリであることを確認してから読む。
func (s *Store) searchDir(rel, query string, results *[]string) {
	if len(*results) >= searchMaxResults {
		return
	}
	abs, err := s.resolver.ResolveExisting(rel)
	if err != nil {
		return // 境界外（root 外 symlink 等）・アクセス不可は走査しない
	}
	dirents, err := os.ReadDir(abs)
	if err != nil {
		return // アクセスできないディレクトリは無視（現行踏襲）
	}
	for _, d := range dirents {
		if len(*results) >= searchMaxResults {
			return
		}
		name := d.Name()
		if d.IsDir() && searchExcludeDirs[name] {
			continue
		}
		childRel := name
		if rel != "." {
			childRel = rel + "/" + name
		}
		if d.IsDir() {
			s.searchDir(childRel, query, results)
			continue
		}
		if strings.Contains(strings.ToLower(name), query) || strings.Contains(strings.ToLower(childRel), query) {
			*results = append(*results, childRel)
		}
	}
}

// ReadJSONRaw は rel の JSON をマップとして読む（charfilters 等の補助）。
// 未存在・破損は呼び出し側で扱えるよう、エラーをそのまま返す。
func (s *Store) ReadJSONRaw(rel string) (map[string]any, error) {
	abs, err := s.resolver.ResolveExisting(rel)
	if err != nil {
		return nil, err
	}
	return jsonstore.ReadRaw(abs)
}
