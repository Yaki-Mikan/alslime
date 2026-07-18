package paths

import (
	"os"
	"path/filepath"
	"testing"
)

// newTempResolver は実在する一時ディレクトリを root とする Resolver を返す。
// EvalSymlinks をかけて realRoot のズレ（macOS の /var→/private/var 等）を吸収する。
func newTempResolver(t *testing.T) (*Resolver, string) {
	t.Helper()
	root := t.TempDir()
	real, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatalf("EvalSymlinks(root) 失敗: %v", err)
	}
	return NewResolver(real), real
}

// trySymlink は symlink を作成し、権限不足等で作れない場合は Skip する。
// Windows では開発者モードか管理者権限がないと symlink を作れないため。
func trySymlink(t *testing.T, oldname, newname string) {
	t.Helper()
	if err := os.Symlink(oldname, newname); err != nil {
		t.Skipf("symlink を作成できない環境のためスキップ: %v", err)
	}
}

func TestResolveLexical_正常系(t *testing.T) {
	r, real := newTempResolver(t)

	cases := []struct {
		name string
		rel  string
		want string
	}{
		{"単純なファイル", "a.txt", filepath.Join(real, "a.txt")},
		{"スラッシュ区切り", "dir/sub/a.txt", filepath.Join(real, "dir", "sub", "a.txt")},
		{"先頭スラッシュ", "/dir/a.txt", filepath.Join(real, "dir", "a.txt")},
		{"root自身(空)", "", real},
		{"root自身(ドット)", ".", real},
		{"内部の..は許容", "dir/../a.txt", filepath.Join(real, "a.txt")},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := r.ResolveLexical(c.rel)
			if err != nil {
				t.Fatalf("予期しないエラー: %v", err)
			}
			if got != c.want {
				t.Fatalf("got=%q want=%q", got, c.want)
			}
		})
	}
}

func TestResolveLexical_脱出を拒否(t *testing.T) {
	r, _ := newTempResolver(t)

	cases := []string{
		"../escape.txt",
		"dir/../../escape.txt",
		"/../escape.txt",
		"..",
	}
	for _, rel := range cases {
		t.Run(rel, func(t *testing.T) {
			if _, err := r.ResolveLexical(rel); err != ErrOutsideWorkspace {
				t.Fatalf("脱出を拒否すべき rel=%q だが err=%v", rel, err)
			}
		})
	}
}

// プレフィックス誤判定の回帰テスト。
// root が ".../ws" のとき ".../ws-evil" を配下と誤認しないこと。
func TestWithinLexical_プレフィックス誤判定を防ぐ(t *testing.T) {
	r, real := newTempResolver(t)

	sibling := real + "-evil"
	if err := r.withinLexical(r.root, sibling); err != ErrOutsideWorkspace {
		t.Fatalf("兄弟ディレクトリ %q を配下と誤認した: err=%v", sibling, err)
	}
}

func TestResolve_はLexicalの別名(t *testing.T) {
	r, _ := newTempResolver(t)

	gotResolve, errResolve := r.Resolve("dir/a.txt")
	gotLexical, errLexical := r.ResolveLexical("dir/a.txt")
	if gotResolve != gotLexical || errResolve != errLexical {
		t.Fatalf("Resolve と ResolveLexical の結果が一致しない: (%q,%v) vs (%q,%v)",
			gotResolve, errResolve, gotLexical, errLexical)
	}
}

func TestResolveExisting_存在するファイル(t *testing.T) {
	r, real := newTempResolver(t)

	target := filepath.Join(real, "exists.txt")
	if err := os.WriteFile(target, []byte("x"), 0o600); err != nil {
		t.Fatalf("ファイル作成失敗: %v", err)
	}

	got, err := r.ResolveExisting("exists.txt")
	if err != nil {
		t.Fatalf("予期しないエラー: %v", err)
	}
	if got != target {
		t.Fatalf("got=%q want=%q", got, target)
	}
}

func TestResolveExisting_存在しないと拒否(t *testing.T) {
	r, _ := newTempResolver(t)

	// 実体化できないため拒否される。
	if _, err := r.ResolveExisting("missing.txt"); err != ErrOutsideWorkspace {
		t.Fatalf("存在しないファイルは拒否すべき: err=%v", err)
	}
}

// symlink ディレクトリ経由で root 外の既存ファイルへ到達する脱出を拒否すること。
func TestResolveExisting_symlink脱出を拒否(t *testing.T) {
	r, real := newTempResolver(t)

	// root の外に実ファイルを置く。
	outsideDir := t.TempDir()
	outsideReal, err := filepath.EvalSymlinks(outsideDir)
	if err != nil {
		t.Fatalf("EvalSymlinks(outside) 失敗: %v", err)
	}
	secret := filepath.Join(outsideReal, "secret.txt")
	if err := os.WriteFile(secret, []byte("secret"), 0o600); err != nil {
		t.Fatalf("外部ファイル作成失敗: %v", err)
	}

	// root 配下に外部ディレクトリへの symlink を張る。
	link := filepath.Join(real, "leak")
	trySymlink(t, outsideReal, link)

	// 字句的には root 配下だが、実体は root 外なので拒否されるべき。
	if _, err := r.ResolveExisting("leak/secret.txt"); err != ErrOutsideWorkspace {
		t.Fatalf("symlink 経由の脱出を拒否すべき: err=%v", err)
	}
}

// root 配下を指す symlink は許可されること（正常系）。
func TestResolveExisting_root内symlinkは許可(t *testing.T) {
	r, real := newTempResolver(t)

	realFile := filepath.Join(real, "real.txt")
	if err := os.WriteFile(realFile, []byte("ok"), 0o600); err != nil {
		t.Fatalf("ファイル作成失敗: %v", err)
	}
	link := filepath.Join(real, "alias.txt")
	trySymlink(t, realFile, link)

	got, err := r.ResolveExisting("alias.txt")
	if err != nil {
		t.Fatalf("root 内 symlink は許可すべき: err=%v", err)
	}
	if got != link {
		t.Fatalf("got=%q want=%q", got, link)
	}
}

func TestResolveForCreate_既存親への新規作成(t *testing.T) {
	r, real := newTempResolver(t)

	// 親（real）は存在し、対象ファイルはまだ無い状態。
	got, err := r.ResolveForCreate("new.txt")
	if err != nil {
		t.Fatalf("予期しないエラー: %v", err)
	}
	if got != filepath.Join(real, "new.txt") {
		t.Fatalf("got=%q", got)
	}
}

func TestResolveForCreate_親が無いと拒否(t *testing.T) {
	r, _ := newTempResolver(t)

	// 親ディレクトリ "missingdir" が存在しないため拒否される。
	if _, err := r.ResolveForCreate("missingdir/new.txt"); err != ErrOutsideWorkspace {
		t.Fatalf("親が無い場合は拒否すべき: err=%v", err)
	}
}

// symlink ディレクトリ配下への新規作成（脱出）を拒否すること。
func TestResolveForCreate_symlink親経由の脱出を拒否(t *testing.T) {
	r, real := newTempResolver(t)

	outsideDir := t.TempDir()
	outsideReal, err := filepath.EvalSymlinks(outsideDir)
	if err != nil {
		t.Fatalf("EvalSymlinks(outside) 失敗: %v", err)
	}

	link := filepath.Join(real, "leakdir")
	trySymlink(t, outsideReal, link)

	// leakdir の実体は root 外なので、その下への新規作成は拒否されるべき。
	if _, err := r.ResolveForCreate("leakdir/new.txt"); err != ErrOutsideWorkspace {
		t.Fatalf("symlink 親経由の新規作成を拒否すべき: err=%v", err)
	}
}

func TestResolveForCreateMkdirAll_多階層親を作成して作成先を返す(t *testing.T) {
	r, real := newTempResolver(t)

	got, err := r.ResolveForCreateMkdirAll("a/b/c/new.json", 0o755)
	if err != nil {
		t.Fatalf("予期しないエラー: %v", err)
	}
	want := filepath.Join(real, "a", "b", "c", "new.json")
	if got != want {
		t.Fatalf("got=%q want=%q", got, want)
	}
	// 親ディレクトリが実際に作られていること。
	if st, statErr := os.Stat(filepath.Join(real, "a", "b", "c")); statErr != nil || !st.IsDir() {
		t.Fatalf("親ディレクトリが作成されていない: err=%v", statErr)
	}
}

// 既存の通常ディレクトリが途中にある多階層作成でも、既存を壊さず
// 不足分だけを 1 段ずつ作れること（mkdirAllSafe の段階作成の検証。symlink 非依存）。
func TestResolveForCreateMkdirAll_既存ディレクトリを尊重して段階作成(t *testing.T) {
	r, real := newTempResolver(t)

	// 途中まで（a/b）を先に作り、目印ファイルを置く。
	existing := filepath.Join(real, "a", "b")
	if err := os.MkdirAll(existing, 0o755); err != nil {
		t.Fatalf("既存ディレクトリ作成失敗: %v", err)
	}
	marker := filepath.Join(existing, "marker.txt")
	if err := os.WriteFile(marker, []byte("keep"), 0o600); err != nil {
		t.Fatalf("目印ファイル作成失敗: %v", err)
	}

	// a/b/c/d/new.json を作成。a/b は既存、c/d は新規。
	got, err := r.ResolveForCreateMkdirAll("a/b/c/d/new.json", 0o755)
	if err != nil {
		t.Fatalf("予期しないエラー: %v", err)
	}
	if got != filepath.Join(real, "a", "b", "c", "d", "new.json") {
		t.Fatalf("作成先が想定外: %q", got)
	}
	// 新規分が作られていること。
	if st, statErr := os.Stat(filepath.Join(real, "a", "b", "c", "d")); statErr != nil || !st.IsDir() {
		t.Fatalf("新規ディレクトリが作られていない: err=%v", statErr)
	}
	// 既存の目印が壊れていないこと（既存を作り直していない）。
	if _, statErr := os.Stat(marker); statErr != nil {
		t.Fatalf("既存ディレクトリの中身が失われた: err=%v", statErr)
	}
}

// 親パス途中に通常ファイルがある場合、その下へは掘らず拒否すること
// （非ディレクトリの安全側拒否。燈レビュー対応確認の指摘）。
func TestResolveForCreateMkdirAll_途中に通常ファイルがあると拒否(t *testing.T) {
	r, real := newTempResolver(t)

	// "a" を通常ファイルとして作る。
	fileAsDir := filepath.Join(real, "a")
	if err := os.WriteFile(fileAsDir, []byte("x"), 0o600); err != nil {
		t.Fatalf("ファイル作成失敗: %v", err)
	}

	// a/b/new.json を作ろうとすると、"a" がディレクトリでないため拒否される。
	if _, err := r.ResolveForCreateMkdirAll("a/b/new.json", 0o755); err != ErrOutsideWorkspace {
		t.Fatalf("途中の通常ファイルは拒否すべき: err=%v", err)
	}
	// "a" が壊されていない（ディレクトリへ作り替えられていない）こと。
	if st, statErr := os.Lstat(fileAsDir); statErr != nil || st.IsDir() {
		t.Fatalf("既存ファイルが壊された: err=%v", statErr)
	}
}

func TestResolveForCreateMkdirAll_脱出を拒否(t *testing.T) {
	r, _ := newTempResolver(t)

	if _, err := r.ResolveForCreateMkdirAll("../escape/new.json", 0o755); err != ErrOutsideWorkspace {
		t.Fatalf("脱出を拒否すべき: err=%v", err)
	}
}

// symlink ディレクトリ配下への多階層作成（脱出）を拒否すること。
func TestResolveForCreateMkdirAll_symlink親経由の脱出を拒否(t *testing.T) {
	r, real := newTempResolver(t)

	outsideDir := t.TempDir()
	outsideReal, err := filepath.EvalSymlinks(outsideDir)
	if err != nil {
		t.Fatalf("EvalSymlinks(outside) 失敗: %v", err)
	}
	link := filepath.Join(real, "leakdir")
	trySymlink(t, outsideReal, link)

	// leakdir の実体は root 外なので、その配下への作成は拒否されるべき。
	if _, err := r.ResolveForCreateMkdirAll("leakdir/sub/new.json", 0o755); err != ErrOutsideWorkspace {
		t.Fatalf("symlink 親経由の作成を拒否すべき: err=%v", err)
	}
}

// symlink 親が root 外を指す場合、拒否するだけでなく、リンク先（外部）へ
// 一切ディレクトリを作らないこと（副作用の封じ込め。燈レビュー指摘1）。
func TestResolveForCreateMkdirAll_symlink先へ副作用を出さない(t *testing.T) {
	r, real := newTempResolver(t)

	outsideDir := t.TempDir()
	outsideReal, err := filepath.EvalSymlinks(outsideDir)
	if err != nil {
		t.Fatalf("EvalSymlinks(outside) 失敗: %v", err)
	}
	link := filepath.Join(real, "leakdir")
	trySymlink(t, outsideReal, link)

	// 多階層（leakdir/sub/deep/new.json）の作成を試みて拒否されること。
	if _, err := r.ResolveForCreateMkdirAll("leakdir/sub/deep/new.json", 0o755); err != ErrOutsideWorkspace {
		t.Fatalf("symlink 親経由の作成を拒否すべき: err=%v", err)
	}

	// リンク先（外部実体）に sub / deep が作られていないことを確認する。
	// 旧 MkdirAll 実装ではここに外部ディレクトリが残ってしまっていた。
	for _, leaked := range []string{
		filepath.Join(outsideReal, "sub"),
		filepath.Join(outsideReal, "sub", "deep"),
	} {
		if _, statErr := os.Lstat(leaked); statErr == nil {
			t.Fatalf("拒否前に外部へディレクトリを作ってしまった: %q", leaked)
		}
	}
}

// 多階層の途中に root 内 symlink ディレクトリがある場合は、副作用を出さずに
// その配下へ正しく作成できること（root 内 symlink は許可しつつ実体境界は守る）。
func TestResolveForCreateMkdirAll_root内symlink配下は作成可(t *testing.T) {
	r, real := newTempResolver(t)

	// root 配下に実ディレクトリ realdir を作り、root 配下から alias でリンクする。
	realDir := filepath.Join(real, "realdir")
	if err := os.Mkdir(realDir, 0o755); err != nil {
		t.Fatalf("realdir 作成失敗: %v", err)
	}
	alias := filepath.Join(real, "alias")
	trySymlink(t, realDir, alias)

	// alias の実体は root 配下なので、その下への多階層作成は許可される。
	got, err := r.ResolveForCreateMkdirAll("alias/sub/new.json", 0o755)
	if err != nil {
		t.Fatalf("root 内 symlink 配下の作成は許可すべき: err=%v", err)
	}
	if got != filepath.Join(real, "alias", "sub", "new.json") {
		t.Fatalf("作成先パスが想定外: %q", got)
	}
	// 実体側（realdir/sub）に作られていること。
	if st, statErr := os.Stat(filepath.Join(realDir, "sub")); statErr != nil || !st.IsDir() {
		t.Fatalf("実体ディレクトリ配下に作成されていない: err=%v", statErr)
	}
}

func TestToSlash(t *testing.T) {
	r, real := newTempResolver(t)

	t.Run("配下を/区切りで返す", func(t *testing.T) {
		abs := filepath.Join(real, "dir", "a.txt")
		got, err := r.ToSlash(abs)
		if err != nil {
			t.Fatalf("予期しないエラー: %v", err)
		}
		if got != "dir/a.txt" {
			t.Fatalf("got=%q want=%q", got, "dir/a.txt")
		}
	})

	t.Run("root外は拒否", func(t *testing.T) {
		outside := real + "-evil"
		if _, err := r.ToSlash(outside); err != ErrOutsideWorkspace {
			t.Fatalf("root 外は拒否すべき: err=%v", err)
		}
	})
}
