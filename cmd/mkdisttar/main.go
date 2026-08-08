// Command mkdisttar は配布用 tar.gz を生成するビルド補助ツール。
//
// Windows のファイルシステムには Unix の実行ビットが無く、Windows 上の tar は
// 元ファイルから権限を写せない。本ツールは tar ヘッダのモードを明示して書き込む
// ことで（実行ファイル 0755・その他 0644）、どの環境でビルドしても展開後そのまま
// 実行できる配布物を生成する。
package main

import (
	"archive/tar"
	"compress/gzip"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
)

func main() {
	src := flag.String("src", "", "パッケージディレクトリ（この直下のファイルを格納する）")
	out := flag.String("out", "", "出力 tar.gz のパス")
	exe := flag.String("exe", "alslime", "0755 を与える実行ファイル名")
	flag.Parse()
	if *src == "" || *out == "" {
		fmt.Fprintln(os.Stderr, "usage: mkdisttar -src <dir> -out <file.tar.gz> [-exe <name>]")
		os.Exit(2)
	}
	if err := run(*src, *out, *exe); err != nil {
		fmt.Fprintf(os.Stderr, "mkdisttar: %v\n", err)
		os.Exit(1)
	}
}

func run(src, out, exe string) error {
	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			// 配布パッケージは平坦な構成のみ。サブディレクトリは想定外の
			// 混入としてエラーにする（黙って除外しない）。
			return fmt.Errorf("unexpected subdirectory in package dir: %s", entry.Name())
		}
		names = append(names, entry.Name())
	}
	if len(names) == 0 {
		return fmt.Errorf("package dir is empty: %s", src)
	}
	sort.Strings(names)

	f, err := os.Create(out)
	if err != nil {
		return err
	}
	// 途中失敗時は中途半端な出力を残さない。
	ok := false
	defer func() {
		if !ok {
			_ = f.Close()
			_ = os.Remove(out)
		}
	}()

	gz := gzip.NewWriter(f)
	tw := tar.NewWriter(gz)

	// エントリ名は zip 側と同じく「パッケージ名/ファイル名」（区切りは / 固定）。
	prefix := filepath.Base(filepath.Clean(src))
	dirInfo, err := os.Stat(src)
	if err != nil {
		return err
	}
	if err := tw.WriteHeader(&tar.Header{
		Typeflag: tar.TypeDir,
		Name:     prefix + "/",
		Mode:     0o755,
		ModTime:  dirInfo.ModTime(),
	}); err != nil {
		return err
	}

	for _, name := range names {
		path := filepath.Join(src, name)
		info, err := os.Stat(path)
		if err != nil {
			return err
		}
		mode := int64(0o644)
		if name == exe {
			mode = 0o755
		}
		if err := tw.WriteHeader(&tar.Header{
			Typeflag: tar.TypeReg,
			Name:     prefix + "/" + name,
			Mode:     mode,
			Size:     info.Size(),
			ModTime:  info.ModTime(),
		}); err != nil {
			return err
		}
		in, err := os.Open(path)
		if err != nil {
			return err
		}
		_, copyErr := io.Copy(tw, in)
		closeErr := in.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
	}

	if err := tw.Close(); err != nil {
		return err
	}
	if err := gz.Close(); err != nil {
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	ok = true
	return nil
}
