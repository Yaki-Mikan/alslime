package update

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"alslime/internal/buildinfo"
	"alslime/internal/config"
	"alslime/internal/i18n"
	"alslime/internal/logging"
	"alslime/internal/semver"
	"alslime/internal/storage/paths"
)

// 本体の直接アップデート（ファイル自動更新、確認 01番 5章）。
//
// ダウンロード → SHA256SUMS 照合 → 固定名 exe のステージング（.new）→
// リネーム待避（.old）で入れ替え → 本体へ再起動要求、の順で進む。
// Windows は実行中 exe の削除・上書きは不可だがリネームは可能なため、
// 待避方式で固定名（alslime.exe）を保ったまま入れ替えられる。

// StartApply が返すエラー（ハンドラが HTTP ステータスへ変換する）。
var (
	// ErrApplyUnavailable は直接アップデートを実行できない
	// （dev ビルド・更新なし・対象アセットなしのいずれか）。
	ErrApplyUnavailable = errors.New("update: apply unavailable")
	// ErrApplyInProgress は更新処理が既に実行中。
	ErrApplyInProgress = errors.New("update: apply already in progress")
	// ErrJobsRunning は実行中ジョブがあるため更新を開始できない。
	ErrJobsRunning = errors.New("update: jobs running")
)

// ApplyPhase は更新処理の進行フェーズ。
type ApplyPhase string

const (
	ApplyIdle        ApplyPhase = "idle"
	ApplyDownloading ApplyPhase = "downloading"
	ApplyVerifying   ApplyPhase = "verifying"
	ApplyStaging     ApplyPhase = "staging"
	ApplyRestarting  ApplyPhase = "restarting"
	ApplyError       ApplyPhase = "error"
)

// ApplyStatus は GET /api/update/status の応答（進捗ポーリング用）。
type ApplyStatus struct {
	Phase ApplyPhase `json:"phase"`
	// Percent はダウンロード進捗（downloading 中のみ 0-100。他フェーズは 0）。
	Percent int `json:"percent"`
	// MessageKey は失敗時の表示文言キー（phase=error のときのみ）。
	MessageKey string `json:"messageKey,omitempty"`
	// Current は応答したプロセスの本体バージョン。フロントの復帰判定は
	// 「Current が更新先バージョンに変わったか」で行う（graceful shutdown 中の
	// 旧プロセスが Keep-Alive で応答してくる期間があるため、phase だけでは
	// 新旧を決定的に区別できない。交換日記 002）。
	Current string `json:"current"`
}

// ApplyDeps は適用時依存（routes.go で注入する）。
type ApplyDeps struct {
	// Resolver は一時ディレクトリ（temp/updates）の解決に使う。
	Resolver *paths.Resolver
	// BeginMaintenance は「既存ジョブ無しの確認」と「新規ジョブ投入の拒否開始」を
	// 同一の排他境界で行う（jobs.Queue.BeginMaintenance。実行中ジョブがあれば false）。
	// 適用中にジョブが開始されて再起動で切断される競合を防ぐ（交換日記 005-2）。
	BeginMaintenance func() bool
	// EndMaintenance は適用失敗時に投入停止を解除する（成功時は再起動するため不要）。
	EndMaintenance func()
	// RequestRestart は入れ替え完了後の再起動要求（graceful shutdown → exePath を起動）。
	RequestRestart func(exePath string)
}

// ConfigureApply は直接アップデートの依存を注入する（未注入なら StartApply は不可）。
func (s *Service) ConfigureApply(deps ApplyDeps) {
	s.applyDeps = deps
	s.dlClient = &http.Client{Timeout: config.AppReleaseDownloadTimeoutSeconds * time.Second}
}

// ApplyState は現在の更新進捗のスナップショットを返す。
func (s *Service) ApplyState() ApplyStatus {
	s.applyMu.Lock()
	defer s.applyMu.Unlock()
	state := s.applyState
	if state.Phase == "" {
		// 契約の防衛: 初期化漏れがあっても空 phase を外へ出さない（交換日記 005-1）。
		state.Phase = ApplyIdle
	}
	state.Current = buildinfo.Snapshot().Version
	return state
}

func (s *Service) setApplyState(state ApplyStatus) {
	s.applyMu.Lock()
	s.applyState = state
	s.applyMu.Unlock()
}

// StartApply は前提を検査して更新処理を開始する（実処理は goroutine で進み、
// 進捗は ApplyState で取れる）。
func (s *Service) StartApply(ctx context.Context) error {
	if !s.checkEnabled() || s.applyDeps.RequestRestart == nil || s.applyDeps.Resolver == nil {
		return ErrApplyUnavailable
	}
	release, err := s.fetchLatestRelease(ctx)
	if err != nil {
		return fmt.Errorf("update: release check failed: %w", err)
	}
	latest := semver.Normalize(release.TagName)
	current := buildinfo.Snapshot().Version
	zipAsset, sumsAsset, ok := findApplyAssets(release, latest)
	if !ok || !semver.IsNewer(latest, current) {
		return ErrApplyUnavailable
	}

	// 二重起動防止（進行中フェーズがあれば拒否し、開始を確定させてから goroutine へ）。
	s.applyMu.Lock()
	switch s.applyState.Phase {
	case ApplyDownloading, ApplyVerifying, ApplyStaging, ApplyRestarting:
		s.applyMu.Unlock()
		return ErrApplyInProgress
	}
	// 開始確定の直前に投入停止を開始する（確認と停止が同一排他境界。以後、
	// 適用の失敗時は endMaintenance で解除し、成功時は再起動で消える）。
	if s.applyDeps.BeginMaintenance != nil && !s.applyDeps.BeginMaintenance() {
		s.applyMu.Unlock()
		return ErrJobsRunning
	}
	s.applyState = ApplyStatus{Phase: ApplyDownloading}
	s.applyMu.Unlock()

	// リクエスト ctx に縛らない（応答後も処理を続けるため）。
	go s.runApply(zipAsset, sumsAsset)
	return nil
}

// endMaintenance は適用失敗時のジョブ投入停止解除（未注入なら何もしない）。
func (s *Service) endMaintenance() {
	if s.applyDeps.EndMaintenance != nil {
		s.applyDeps.EndMaintenance()
	}
}

// runApply はダウンロードから再起動要求までを実行する。失敗は phase=error に畳む。
func (s *Service) runApply(zipAsset, sumsAsset githubAsset) {
	fail := func(step string, err error) {
		logging.Error("update: apply failed (%s): %v", step, err)
		s.setApplyState(ApplyStatus{Phase: ApplyError, MessageKey: i18n.KeyErrorUpdateApplyFailed})
		// 適用失敗＝再起動しないので、ジョブ投入停止を解除する（交換日記 005-2）。
		s.endMaintenance()
	}

	tempDir, err := s.applyDeps.Resolver.ResolveDirForMkdirAll(config.UpdateTempDir, config.DirPerm)
	if err != nil {
		fail("tempdir", err)
		return
	}
	ctx := context.Background()

	// ダウンロード（zip は進捗を出す。SHA256SUMS は小さいので通常クライアント）。
	zipPath := filepath.Join(tempDir, zipAsset.Name)
	if err := s.downloadAsset(ctx, zipAsset, zipPath); err != nil {
		fail("download", err)
		return
	}
	defer func() { _ = os.Remove(zipPath) }()
	s.setApplyState(ApplyStatus{Phase: ApplyVerifying})
	sums, err := s.fetchSums(ctx, sumsAsset)
	if err != nil {
		fail("sums", err)
		return
	}

	// 検証: SHA256SUMS.txt の該当行と zip 実体のハッシュ照合。
	want, ok := sums[zipAsset.Name]
	if !ok {
		fail("verify", fmt.Errorf("no sums entry for %s", zipAsset.Name))
		return
	}
	got, err := fileSHA256(zipPath)
	if err != nil {
		fail("verify", err)
		return
	}
	if !strings.EqualFold(want, got) {
		fail("verify", fmt.Errorf("sha256 mismatch for %s", zipAsset.Name))
		return
	}

	// ステージング: zip から固定名 exe を取り出し、現行 exe の隣へ .new として置く。
	s.setApplyState(ApplyStatus{Phase: ApplyStaging})
	exePath, err := os.Executable()
	if err != nil {
		fail("staging", err)
		return
	}
	target := filepath.Join(filepath.Dir(exePath), fixedExeName())
	newPath := target + ".new"
	if err := extractFixedExe(zipPath, newPath); err != nil {
		fail("staging", err)
		return
	}

	// 入れ替え: 現行 exe が固定名そのものならリネーム待避してから配置する
	// （バージョン入り名からの移行時は名前が衝突しないため待避不要。旧 exe は
	// ユーザー資産として残し、自動削除しない。01番 5.1・11章）。
	oldPath := target + ".old"
	usedBackup := false
	if samePath(exePath, target) {
		if err := os.Rename(target, oldPath); err != nil {
			_ = os.Remove(newPath)
			fail("swap", err)
			return
		}
		usedBackup = true
	}
	if err := os.Rename(newPath, target); err != nil {
		if usedBackup {
			// ロールバック: 待避した現行 exe を戻す。
			if rbErr := os.Rename(oldPath, target); rbErr != nil {
				logging.Error("update: rollback failed: %v", rbErr)
			}
		}
		_ = os.Remove(newPath)
		fail("swap", err)
		return
	}

	// 再起動要求（graceful shutdown → 新 exe 起動は app 層が行う）。
	// .old の掃除は新プロセス起動時の CleanupStagedBinaries が担う。
	logging.Info("update: staged %s, requesting restart", target)
	s.setApplyState(ApplyStatus{Phase: ApplyRestarting})
	s.applyDeps.RequestRestart(target)
}

// downloadAsset は zip アセットを進捗を出しながら path へ保存する。
func (s *Service) downloadAsset(ctx context.Context, asset githubAsset, path string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, asset.BrowserDownloadURL, nil)
	if err != nil {
		return err
	}
	resp, err := s.dlClient.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download status %d", resp.StatusCode)
	}
	out, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, config.FilePerm)
	if err != nil {
		return err
	}
	defer func() { _ = out.Close() }()

	total := asset.Size
	if total <= 0 {
		total = resp.ContentLength
	}
	var done int64
	buf := make([]byte, 256<<10)
	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			if _, writeErr := out.Write(buf[:n]); writeErr != nil {
				return writeErr
			}
			done += int64(n)
			if total > 0 {
				s.setApplyState(ApplyStatus{
					Phase:   ApplyDownloading,
					Percent: int(done * 100 / total),
				})
			}
		}
		if readErr == io.EOF {
			return nil
		}
		if readErr != nil {
			return readErr
		}
	}
}

// fetchSums は SHA256SUMS.txt を取得して「ファイル名 → hex ハッシュ」で返す。
// 行形式は "hex  filename"（バイナリ印 * 付きも許容）。
func (s *Service) fetchSums(ctx context.Context, asset githubAsset) (map[string]string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, asset.BrowserDownloadURL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("sums status %d", resp.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	sums := make(map[string]string)
	for _, line := range strings.Split(string(raw), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		name := strings.TrimPrefix(fields[len(fields)-1], "*")
		sums[name] = fields[0]
	}
	return sums, nil
}

// extractFixedExe は zip 内の固定名 exe（例 alslime-<ver>/alslime.exe）を dst へ書き出す。
// エントリ名の区切りは / と \ の両方を許容する（Compress-Archive は \ 区切りで格納する）。
func extractFixedExe(zipPath, dst string) error {
	reader, err := zip.OpenReader(zipPath)
	if err != nil {
		return err
	}
	defer func() { _ = reader.Close() }()
	want := fixedExeName()
	for _, entry := range reader.File {
		name := strings.ReplaceAll(entry.Name, "\\", "/")
		if entry.FileInfo().IsDir() || filepath.Base(name) != want {
			continue
		}
		src, err := entry.Open()
		if err != nil {
			return err
		}
		defer func() { _ = src.Close() }()
		out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
		if err != nil {
			return err
		}
		// zip 爆弾対策の上限（1GiB）。実配布物は数十 MB。
		_, copyErr := io.Copy(out, io.LimitReader(src, 1<<30))
		closeErr := out.Close()
		if copyErr != nil {
			_ = os.Remove(dst)
			return copyErr
		}
		if closeErr != nil {
			_ = os.Remove(dst)
			return closeErr
		}
		return nil
	}
	return fmt.Errorf("fixed exe %q not found in %s", want, filepath.Base(zipPath))
}

// CleanupStagedBinaries は入れ替えの残骸（固定名 exe の .old / .new）を削除する。
// 起動時に background から1回呼ぶ（失敗しても次回起動で再試行される。01番 5.1）。
func (s *Service) CleanupStagedBinaries() {
	exePath, err := os.Executable()
	if err != nil {
		return
	}
	target := filepath.Join(filepath.Dir(exePath), fixedExeName())
	for _, stale := range []string{target + ".old", target + ".new"} {
		if err := os.Remove(stale); err == nil {
			logging.Info("update: removed stale file %s", stale)
		}
	}
}

// findApplyAssets は直接アップデートに必要なアセット（対象 OS/ARCH の zip と
// SHA256SUMS.txt）を探す。揃っていなければ ok=false（canApply=false になる）。
func findApplyAssets(release githubRelease, version string) (zipAsset, sumsAsset githubAsset, ok bool) {
	zipName := fmt.Sprintf("alslime-%s-%s-%s.zip", version, runtime.GOOS, runtime.GOARCH)
	var zipFound, sumsFound bool
	for _, asset := range release.Assets {
		switch asset.Name {
		case zipName:
			zipAsset, zipFound = asset, true
		case config.AppReleaseSumsAssetName:
			sumsAsset, sumsFound = asset, true
		}
	}
	return zipAsset, sumsAsset, zipFound && sumsFound
}

// fixedExeName は配布 zip 内・配置先の固定実行ファイル名を返す。
func fixedExeName() string {
	if runtime.GOOS == "windows" {
		return config.AppFixedExeBase + ".exe"
	}
	return config.AppFixedExeBase
}

// samePath は2つのパスが同一ファイルを指すかを返す（Windows は大文字小文字を無視）。
func samePath(a, b string) bool {
	a, b = filepath.Clean(a), filepath.Clean(b)
	if runtime.GOOS == "windows" {
		return strings.EqualFold(a, b)
	}
	return a == b
}

// SpawnDetached は新しい exe を切り離して起動する（app 層の再起動処理から呼ぶ）。
//
//   - workspaceRoot は現行プロセスの確定済みワークスペース。作業ディレクトリと
//     環境変数 WORKSPACE_ROOT の両方で明示的に引き継ぐ（ワークスペース解決は
//     「環境変数 > カレントディレクトリ」のため、exe と別の場所で起動していた
//     構成でも再起動後にワークスペースが変わらない）。
//   - ブラウザ自動起動は抑止する — フロントは接続復帰で自動リロードするため、
//     新プロセス側でタブを二重に開かない（01番 5.1）。
func SpawnDetached(exePath, workspaceRoot string) error {
	cmd := exec.Command(exePath)
	cmd.Dir = workspaceRoot
	cmd.Env = append(os.Environ(),
		"ALSLIME_NO_BROWSER=1",
		"WORKSPACE_ROOT="+workspaceRoot,
	)
	return cmd.Start()
}

// fileSHA256 は path の SHA-256（hex 小文字）を返す。
func fileSHA256(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer func() { _ = f.Close() }()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}
