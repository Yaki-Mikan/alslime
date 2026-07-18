// Package paths は WORKSPACE_ROOT を基準にした安全なパス解決を提供する。
//
// 現行 Node 版は各ハンドラで strings.HasPrefix 相当の境界チェックを
// コピーしていたが、これは "/foo" に対して "/foobar" を誤って許可するなど
// プレフィックス一致の落とし穴があった。本パッケージでは filepath.Rel を使い、
// セパレータ境界を正しく見たうえで ".." による脱出を拒否する。
//
// さらに、利用者が WORKSPACE_ROOT 配下に外部ディレクトリへの symlink / junction を
// 置いた場合、字句的な ".." 判定だけでは実体パスの脱出を検出できない。
// 配布版はローカル Web アプリで LAN 公開や Lightsail 配置もあり得るため、
// 既存パスを触る処理は EvalSymlinks 後の実体パスでも root 配下かを確認する。
//
// 用途別に解決メソッドを分ける:
//   - ResolveExisting:  読み込み・更新・削除など、対象が既に存在する処理。
//     対象自身を EvalSymlinks して実体で境界を確認する。
//   - ResolveForCreate: 新規作成など、対象がまだ存在しない処理。
//     親ディレクトリを EvalSymlinks して実体で境界を確認する。
//   - ResolveLexical:   一覧表示・未存在チェックなど、実体確認ができない場面限定。
//     字句的な境界チェックのみで、symlink 脱出は検出しない。
package paths

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

const errKeyPathForbidden = "error.pathForbidden"

// ErrOutsideWorkspace は解決後のパスが WORKSPACE_ROOT の外へ出る場合に返る。
var ErrOutsideWorkspace = errors.New(errKeyPathForbidden)

// Resolver は特定の WORKSPACE_ROOT に束縛されたパス解決器。
// root は呼び出し側で絶対パス・Clean 済みであることを前提とする。
type Resolver struct {
	// root は字句的な基準パス（表示・結合用）。Clean 済みの絶対パス。
	root string
	// realRoot は root を EvalSymlinks した実体パス。symlink 境界判定の基準。
	// root 自身が symlink 経由だと生の root とズレるため、別に保持する。
	// root を実体化できない場合（未作成など）は root と同値にしておく。
	realRoot string
}

// NewResolver は root を基準とする Resolver を生成する。
// root は config.Load で確定済みの絶対パスを渡すこと。
func NewResolver(root string) *Resolver {
	clean := filepath.Clean(root)
	real, err := filepath.EvalSymlinks(clean)
	if err != nil {
		// root がまだ存在しない等で実体化できない場合は字句パスで代用する。
		real = clean
	}
	return &Resolver{root: clean, realRoot: real}
}

// Root は基準となる WORKSPACE_ROOT を返す。
func (r *Resolver) Root() string {
	return r.root
}

// Resolve は ResolveLexical の別名。後方互換のため残す。
// 字句チェックのみで symlink 脱出は検出しないため、既存パスを触る処理では
// ResolveExisting / ResolveForCreate を使うこと。
func (r *Resolver) Resolve(rel string) (string, error) {
	return r.ResolveLexical(rel)
}

// ResolveLexical は字句的な境界チェックのみで rel を絶対パスへ変換する。
//
// rel はフロントから来る "/" 区切りの論理パスでも、OS 依存区切りでも受け付ける。
// ".." による脱出は拒否するが、symlink 経由の脱出は検出しない。
// 一覧表示・未存在チェックなど、実体確認ができない場面限定で使う。
func (r *Resolver) ResolveLexical(rel string) (string, error) {
	abs := r.join(rel)
	if err := r.withinLexical(r.root, abs); err != nil {
		return "", err
	}
	return abs, nil
}

// ResolveExisting は対象自身を実体化したうえで境界を確認する。
//
// 読み込み・更新・削除など、対象が既に存在する処理で使う。
// 字句チェックを通したあと EvalSymlinks し、実体パスでも root 配下かを確認する。
func (r *Resolver) ResolveExisting(rel string) (string, error) {
	abs, err := r.ResolveLexical(rel)
	if err != nil {
		return "", err
	}
	real, err := filepath.EvalSymlinks(abs)
	if err != nil {
		// 実体化できない（存在しない等）場合は脱出を保証できないため拒否する。
		return "", ErrOutsideWorkspace
	}
	if err := r.withinLexical(r.realRoot, real); err != nil {
		return "", err
	}
	return abs, nil
}

// ResolveForCreate は親ディレクトリを実体化したうえで境界を確認する。
//
// 新規作成など、対象自身はまだ存在しない処理で使う。
// 親ディレクトリを EvalSymlinks し、その実体が root 配下かを確認することで、
// symlink ディレクトリ経由の脱出を防ぐ。返す絶対パスは作成先（字句結合）。
func (r *Resolver) ResolveForCreate(rel string) (string, error) {
	abs, err := r.ResolveLexical(rel)
	if err != nil {
		return "", err
	}
	parent := filepath.Dir(abs)
	realParent, err := filepath.EvalSymlinks(parent)
	if err != nil {
		// 親も存在しない場合は実体確認できないため拒否する。
		// 多階層の新規作成が必要なら、呼び出し側で段階的に作成・確認すること。
		return "", ErrOutsideWorkspace
	}
	if err := r.withinLexical(r.realRoot, realParent); err != nil {
		return "", err
	}
	return abs, nil
}

// ResolveForCreateMkdirAll は親ディレクトリを作成してから作成先の絶対パスを返す。
//
// 多階層配下のファイルを新規作成する際、親ディレクトリがまだ無いケースで使う。
//
// 重要（副作用の封じ込め）:
// 旧実装は os.MkdirAll で親を一括作成していたが、これは親パス途中に root 外へ
// 向く symlink / junction があると、拒否する前にリンク先へ実ディレクトリを
// 作ってしまう恐れがあった（配布版の安全パス解決として不可）。
//
// 本実装は root から 1 段ずつ辿り、各段で:
//   - 既存なら Lstat で symlink を見抜き、EvalSymlinks 後の実体が root 配下かを確認。
//     root 外を指す symlink は、その先へ一切書き込まず即拒否する。
//   - 未存在なら、その 1 段だけを os.Mkdir で作る（リンクを辿らない）。
//
// これにより「拒否が必要なケースでは外部へ副作用を出さない」ことを保証する。
// dirPerm は作成するディレクトリのパーミッション。返す絶対パスは作成先（字句結合）。
func (r *Resolver) ResolveForCreateMkdirAll(rel string, dirPerm os.FileMode) (string, error) {
	abs, err := r.ResolveLexical(rel)
	if err != nil {
		return "", err
	}
	parent := filepath.Dir(abs)
	if err := r.mkdirAllSafe(parent, dirPerm); err != nil {
		return "", err
	}
	// 親を安全に用意できたので、最終確認は既存の ResolveForCreate に委ねる。
	return r.ResolveForCreate(rel)
}

// ResolveDirForMkdirAll は rel が指すディレクトリ自身を安全に作成し、その絶対パスを返す。
//
// ResolveForCreateMkdirAll が「ファイル作成先の親」を作るのに対し、本メソッドは
// 「rel そのものをディレクトリとして作る」用途（/api/files/mkdir 等）。
// 疑似ファイル（path + "/.keep"）扱いを避け、mkdir 用に明示する（交換日記 28）。
//
// 副作用の封じ込めは ResolveForCreateMkdirAll と同じく mkdirAllSafe に委ねる。
// 既に存在するディレクトリへの呼び出しは冪等（何も壊さず絶対パスを返す）。
func (r *Resolver) ResolveDirForMkdirAll(rel string, dirPerm os.FileMode) (string, error) {
	abs, err := r.ResolveLexical(rel)
	if err != nil {
		return "", err
	}
	if err := r.mkdirAllSafe(abs, dirPerm); err != nil {
		return "", err
	}
	return abs, nil
}

// mkdirAllSafe は target（root 配下の絶対パス）までを root から 1 段ずつ安全に作る。
//
// MkdirAll と違い、symlink を辿った先へ副作用を出さない。target 自身および途中の
// 各要素について、既存 symlink が root 外を指す場合は何も作らず拒否する。
func (r *Resolver) mkdirAllSafe(target string, dirPerm os.FileMode) error {
	// target は root 配下である前提（呼び出し側が ResolveLexical 済み）。
	// root からの相対を部品へ分解し、root へ 1 段ずつ積み上げて確認・作成する。
	rel, err := filepath.Rel(r.root, target)
	if err != nil {
		return ErrOutsideWorkspace
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return ErrOutsideWorkspace
	}
	// root 自身が対象（rel == "."）なら作るものはない。
	if rel == "." {
		return r.assertWithinRealRoot(r.root)
	}

	cur := r.root
	for _, part := range strings.Split(rel, string(filepath.Separator)) {
		if part == "" {
			continue
		}
		cur = filepath.Join(cur, part)

		info, statErr := os.Lstat(cur)
		switch {
		case statErr == nil:
			// 既存要素。symlink なら実体を境界確認したうえで通過する。
			if info.Mode()&os.ModeSymlink != 0 {
				if err := r.assertWithinRealRoot(cur); err != nil {
					return err
				}
				continue
			}
			// symlink でない既存要素は、ディレクトリでなければ拒否する。
			// 途中に通常ファイル・デバイス等があると、その下へは掘れない（後段の
			// CreateTemp 等で別エラーになる前に、パス解決層の責務として安全側で弾く）。
			if !info.IsDir() {
				return ErrOutsideWorkspace
			}
			// 既存が通常ディレクトリの場合は、root 配下であることは字句的に保証済み。
		case errors.Is(statErr, fs.ErrNotExist):
			// 未存在。この 1 段だけを作る（リンクは辿らない）。
			if err := os.Mkdir(cur, dirPerm); err != nil {
				return err
			}
		default:
			return statErr
		}
	}
	return nil
}

// assertWithinRealRoot は path の実体（EvalSymlinks 後）が root 配下かを確認する。
// root 外を指す場合は ErrOutsideWorkspace。実体化できない場合も安全側で拒否する。
func (r *Resolver) assertWithinRealRoot(path string) error {
	real, err := filepath.EvalSymlinks(path)
	if err != nil {
		return ErrOutsideWorkspace
	}
	return r.withinLexical(r.realRoot, real)
}

// join は "/" 区切り・OS 依存区切りいずれの rel も root へ安全に結合する。
func (r *Resolver) join(rel string) string {
	cleaned := filepath.FromSlash(rel)
	return filepath.Join(r.root, cleaned)
}

// withinLexical は abs が base と同一、または base 配下にあることを字句的に検証する。
func (r *Resolver) withinLexical(base, abs string) error {
	relToBase, err := filepath.Rel(base, abs)
	if err != nil {
		return ErrOutsideWorkspace
	}
	// base 自身は "." になる。配下なら ".." を含まない。
	if relToBase == ".." || strings.HasPrefix(relToBase, ".."+string(filepath.Separator)) {
		return ErrOutsideWorkspace
	}
	return nil
}

// ToSlash は WORKSPACE_ROOT からの相対パスを "/" 区切りで返す。
// API レスポンスで返す相対パスはこの形式に統一する。
func (r *Resolver) ToSlash(abs string) (string, error) {
	rel, err := filepath.Rel(r.root, abs)
	if err != nil {
		return "", ErrOutsideWorkspace
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", ErrOutsideWorkspace
	}
	return filepath.ToSlash(rel), nil
}
