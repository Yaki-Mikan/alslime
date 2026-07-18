package workspacefs

import (
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"alslime/internal/storage/paths"
)

func newStore(t *testing.T) (*Store, string) {
	t.Helper()
	root := t.TempDir()
	real, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatalf("EvalSymlinks: %v", err)
	}
	return New(paths.NewResolver(real)), real
}

func TestList_ルートとcurrentPath(t *testing.T) {
	s, root := newStore(t)
	// ファイルとディレクトリを置く。
	if err := os.MkdirAll(filepath.Join(root, "dir1"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "a.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	entries, current, err := s.List("")
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if current != "." {
		t.Fatalf("ルートの currentPath は \".\" であるべき: %q", current)
	}
	// ディレクトリ優先 → 名前順。
	if len(entries) != 2 || !entries[0].IsDirectory || entries[0].Name != "dir1" {
		t.Fatalf("ソート想定外: %#v", entries)
	}
	// path は "/" 区切り相対。
	if entries[0].Path != "dir1" || entries[1].Path != "a.txt" {
		t.Fatalf("path 想定外: %#v", entries)
	}
}

func TestList_日本語パス(t *testing.T) {
	s, root := newStore(t)
	jp := filepath.Join(root, "roleplay", "characters")
	if err := os.MkdirAll(jp, 0o755); err != nil {
		t.Fatal(err)
	}
	entries, current, err := s.List("roleplay")
	if err != nil {
		t.Fatalf("List(日本語): %v", err)
	}
	if current != "roleplay" {
		t.Fatalf("currentPath 想定外: %q", current)
	}
	if len(entries) != 1 || entries[0].Name != "characters" || entries[0].Path != "roleplay/characters" {
		t.Fatalf("日本語 path 想定外: %#v", entries)
	}
}

func TestList_脱出は拒否(t *testing.T) {
	s, _ := newStore(t)
	if _, _, err := s.List("../"); !errors.Is(err, paths.ErrOutsideWorkspace) {
		t.Fatalf("脱出 List は拒否すべき: %v", err)
	}
}

func TestReadWriteContent(t *testing.T) {
	s, _ := newStore(t)
	// 多階層への書き込み（親作成）。
	if err := s.Write("sub/dir/note.txt", "こんにちは"); err != nil {
		t.Fatalf("Write: %v", err)
	}
	got, err := s.ReadContent("sub/dir/note.txt")
	if err != nil {
		t.Fatalf("ReadContent: %v", err)
	}
	if got != "こんにちは" {
		t.Fatalf("内容想定外: %q", got)
	}
}

func TestWrite_空文字も書ける(t *testing.T) {
	s, _ := newStore(t)
	if err := s.Write("empty.txt", ""); err != nil {
		t.Fatalf("空文字 Write: %v", err)
	}
	got, err := s.ReadContent("empty.txt")
	if err != nil || got != "" {
		t.Fatalf("空文字の読み戻し失敗: got=%q err=%v", got, err)
	}
}

func TestWrite_脱出は拒否(t *testing.T) {
	s, _ := newStore(t)
	if err := s.Write("../escape.txt", "x"); !errors.Is(err, paths.ErrOutsideWorkspace) {
		t.Fatalf("脱出 Write は拒否すべき: %v", err)
	}
}

func TestMkdir(t *testing.T) {
	s, root := newStore(t)
	if err := s.Mkdir("a/b/c"); err != nil {
		t.Fatalf("Mkdir: %v", err)
	}
	if st, err := os.Stat(filepath.Join(root, "a", "b", "c")); err != nil || !st.IsDir() {
		t.Fatalf("ディレクトリが作られていない: err=%v", err)
	}
	// 冪等（既存への再作成）。
	if err := s.Mkdir("a/b/c"); err != nil {
		t.Fatalf("既存 Mkdir は冪等であるべき: %v", err)
	}
}

func TestMkdir_脱出は拒否(t *testing.T) {
	s, _ := newStore(t)
	if err := s.Mkdir("../escape"); !errors.Is(err, paths.ErrOutsideWorkspace) {
		t.Fatalf("脱出 Mkdir は拒否すべき: %v", err)
	}
}

func TestSearch_名前部分一致と上限と除外(t *testing.T) {
	s, root := newStore(t)
	// マッチするファイルを複数 + 除外ディレクトリ内にも置く。
	for _, p := range []string{"alpha.txt", "beta-alpha.md", "sub/alpha2.txt"} {
		full := filepath.Join(root, filepath.FromSlash(p))
		_ = os.MkdirAll(filepath.Dir(full), 0o755)
		_ = os.WriteFile(full, []byte("x"), 0o644)
	}
	// 除外ディレクトリ内の alpha は結果に出ない。
	_ = os.MkdirAll(filepath.Join(root, "node_modules"), 0o755)
	_ = os.WriteFile(filepath.Join(root, "node_modules", "alpha-excluded.txt"), []byte("x"), 0o644)

	got, err := s.Search("alpha")
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	sort.Strings(got)
	// 3 件（node_modules 内は除外）。
	if len(got) != 3 {
		t.Fatalf("マッチ件数想定外（除外が効いていない可能性）: %#v", got)
	}
	for _, g := range got {
		if g == "node_modules/alpha-excluded.txt" {
			t.Fatalf("除外ディレクトリ内がヒットしている: %#v", got)
		}
	}
}

func TestSearch_空クエリは空(t *testing.T) {
	s, _ := newStore(t)
	got, err := s.Search("")
	if err != nil || len(got) != 0 {
		t.Fatalf("空クエリは空であるべき: got=%#v err=%v", got, err)
	}
}

// root 外を指す symlink ディレクトリ配下のファイルは検索に出ないこと
// （再帰の各段で ResolveExisting を通すため。燈レビュー30 指摘1）。
// symlink を作れない環境（Windows 非管理者など）は Skip する。
func TestSearch_root外symlink配下は検索しない(t *testing.T) {
	s, root := newStore(t)

	// root 内のマッチファイル。
	if err := os.WriteFile(filepath.Join(root, "alpha-in.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	// root 外にマッチ名のファイルを置き、root 内から symlink で参照する。
	outside := t.TempDir()
	outsideReal, err := filepath.EvalSymlinks(outside)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(outsideReal, "alpha-leak.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "leakdir")
	if err := os.Symlink(outsideReal, link); err != nil {
		t.Skipf("symlink を作成できない環境のためスキップ: %v", err)
	}

	got, err := s.Search("alpha")
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	for _, g := range got {
		if strings.Contains(g, "alpha-leak") || strings.Contains(g, "leakdir") {
			t.Fatalf("root 外 symlink 配下が検索に出ている: %#v", got)
		}
	}
	// root 内のファイルは出る。
	found := false
	for _, g := range got {
		if g == "alpha-in.txt" {
			found = true
		}
	}
	if !found {
		t.Fatalf("root 内のマッチが出ていない: %#v", got)
	}
}
