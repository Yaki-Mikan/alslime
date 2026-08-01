package update

import (
	"archive/zip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"alslime/internal/storage/paths"
)

// 直接アップデートの防御まわり（交換日記 005-1 / 005-7 のテスト推奨に対応）。

func TestApplyState_初期値はidle(t *testing.T) {
	svc := New(nil)
	state := svc.ApplyState()
	if state.Phase != ApplyIdle {
		t.Fatalf("初期 phase は idle のはず: %q", state.Phase)
	}
	if state.Current == "" {
		t.Fatal("current が空で返った")
	}
}

func TestApplyState_空phaseはidleへ正規化される(t *testing.T) {
	svc := New(nil)
	svc.applyMu.Lock()
	svc.applyState = ApplyStatus{}
	svc.applyMu.Unlock()
	if got := svc.ApplyState().Phase; got != ApplyIdle {
		t.Fatalf("空 phase が正規化されなかった: %q", got)
	}
}

func TestFetchSums_CRLFとアスタリスクを許容(t *testing.T) {
	body := "abc123  alslime-9.9.9-windows-amd64.zip\r\ndef456 *starred.zip\r\n"
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(body))
	}))
	defer ts.Close()

	svc := New(nil)
	sums, err := svc.fetchSums(context.Background(), githubAsset{BrowserDownloadURL: ts.URL})
	if err != nil {
		t.Fatalf("fetchSums failed: %v", err)
	}
	if sums["alslime-9.9.9-windows-amd64.zip"] != "abc123" {
		t.Fatalf("CRLF 行のハッシュが読めていない: %#v", sums)
	}
	if sums["starred.zip"] != "def456" {
		t.Fatalf("アスタリスク付きファイル名が読めていない: %#v", sums)
	}
}

func TestExtractFixedExe_両区切りのzipエントリを扱える(t *testing.T) {
	for name, sep := range map[string]string{"スラッシュ": "/", "バックスラッシュ": `\`} {
		t.Run(name, func(t *testing.T) {
			dir := t.TempDir()
			zipPath := filepath.Join(dir, "pkg.zip")
			writeTestZip(t, zipPath, "alslime-9.9.9"+sep+fixedExeName(), []byte("new-binary"))

			dst := filepath.Join(dir, "out.exe")
			if err := extractFixedExe(zipPath, dst); err != nil {
				t.Fatalf("extract failed: %v", err)
			}
			got, err := os.ReadFile(dst)
			if err != nil || string(got) != "new-binary" {
				t.Fatalf("展開内容が一致しない: %q, err=%v", got, err)
			}
		})
	}
}

func TestExtractFixedExe_固定名が無ければエラー(t *testing.T) {
	dir := t.TempDir()
	zipPath := filepath.Join(dir, "pkg.zip")
	writeTestZip(t, zipPath, "alslime-9.9.9/README.md", []byte("doc"))
	if err := extractFixedExe(zipPath, filepath.Join(dir, "out.exe")); err == nil {
		t.Fatal("固定名 exe の無い zip でエラーにならなかった")
	}
}

func TestFindApplyAssets_zipとSUMSが揃った時だけ有効(t *testing.T) {
	zipName := fmt.Sprintf("alslime-9.9.9-%s-%s.zip", runtime.GOOS, runtime.GOARCH)
	both := githubRelease{Assets: []githubAsset{{Name: zipName}, {Name: "SHA256SUMS.txt"}}}
	if _, _, ok := findApplyAssets(both, "9.9.9"); !ok {
		t.Fatal("両アセットが揃っているのに ok=false")
	}
	zipOnly := githubRelease{Assets: []githubAsset{{Name: zipName}}}
	if _, _, ok := findApplyAssets(zipOnly, "9.9.9"); ok {
		t.Fatal("SUMS 無し（旧形式リリース）で ok=true になった")
	}
}

func TestStartApply_進行中とジョブ実行中は拒否(t *testing.T) {
	zipName := fmt.Sprintf("alslime-9.9.9-%s-%s.zip", runtime.GOOS, runtime.GOARCH)
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"tag_name": "v9.9.9",
			"assets": []map[string]any{
				{"name": zipName, "browser_download_url": "http://127.0.0.1:1/x", "size": 1},
				{"name": "SHA256SUMS.txt", "browser_download_url": "http://127.0.0.1:1/y", "size": 1},
			},
		})
	}))
	defer ts.Close()

	newSvc := func(begin func() bool) *Service {
		svc := New(nil)
		svc.releaseURL = ts.URL
		svc.devOverride = true // dev ビルドのテストでも checkEnabled を通す
		svc.applyDeps = ApplyDeps{
			Resolver:         paths.NewResolver(t.TempDir()),
			BeginMaintenance: begin,
			RequestRestart:   func(string) {},
		}
		return svc
	}

	// 進行中フェーズがあれば ErrApplyInProgress。
	svc := newSvc(func() bool { return true })
	svc.applyMu.Lock()
	svc.applyState = ApplyStatus{Phase: ApplyDownloading}
	svc.applyMu.Unlock()
	if err := svc.StartApply(context.Background()); !errors.Is(err, ErrApplyInProgress) {
		t.Fatalf("進行中の二重開始が拒否されなかった: %v", err)
	}

	// 実行中ジョブ（BeginMaintenance=false）なら ErrJobsRunning。
	svc = newSvc(func() bool { return false })
	if err := svc.StartApply(context.Background()); !errors.Is(err, ErrJobsRunning) {
		t.Fatalf("ジョブ実行中の開始が拒否されなかった: %v", err)
	}
}

// writeTestZip は1エントリの zip を作る（エントリ名の区切りは呼び出し側指定のまま格納）。
func writeTestZip(t *testing.T, path, entryName string, content []byte) {
	t.Helper()
	f, err := os.Create(path)
	if err != nil {
		t.Fatalf("zip create failed: %v", err)
	}
	zw := zip.NewWriter(f)
	w, err := zw.Create(entryName)
	if err != nil {
		t.Fatalf("zip entry failed: %v", err)
	}
	if _, err := w.Write(content); err != nil {
		t.Fatalf("zip write failed: %v", err)
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("zip close failed: %v", err)
	}
	if err := f.Close(); err != nil {
		t.Fatalf("file close failed: %v", err)
	}
}
