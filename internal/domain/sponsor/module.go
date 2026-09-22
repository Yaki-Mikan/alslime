package sponsor

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"runtime"
	"strings"
	"time"

	"alslime/internal/buildinfo"
	"alslime/internal/config"
	"alslime/internal/logging"
	"alslime/internal/semver"
	"alslime/internal/storage/jsonstore"
)

// サイドカーモジュールの取得・検証・配置（複数モジュール対応）。
//
// 配信用ドメインの署名付き一覧ファイルから、本体のバージョンが対応範囲に入る最新の
// バージョンを選び、entitlement サーバーが発行するダウンロード許可を付けて取得する。
// 取得後は一覧ファイルの SHA-256 とサイズで照合してから配置する。
// 一覧ファイルの署名検証の実体は core（featuresimpl）に閉じ、本パッケージは注入された
// 関数だけを呼ぶ。対象モジュールは ConfigureModules で注入されたレジストリに限る。

// ErrModuleNoToken はモジュール取得に必要なトークンが無い。
var ErrModuleNoToken = errors.New("sponsor: no token for module download")

// ErrModuleUnavailable は配布側に該当の配布物が無い（404・一覧に未掲載）。
var ErrModuleUnavailable = errors.New("sponsor: module not available on server")

// ErrModuleRejected は旧呼び出し元との互換用エラー。
var ErrModuleRejected = errors.New("sponsor: module download rejected by server")

// ErrTokenInvalid は認証サーバーがトークン無し・無効・失効として 401 を返した。
var ErrTokenInvalid = errors.New("sponsor: entitlement token invalid")

// ErrTierRejected はトークンは有効だが対象の取得権限が無いとして 403 を返した。
var ErrTierRejected = errors.New("sponsor: entitlement tier rejected")

// ErrModuleUnknown は取得対象がレジストリに無い（本体が知らないモジュールID）。
var ErrModuleUnknown = errors.New("sponsor: unknown module id")

// ErrModuleBusy はモジュール変更操作（install / clean）が既に進行中（409）。
var ErrModuleBusy = errors.New("sponsor: module operation in progress")

// ErrModuleNeedsNewerApp は本体が古すぎて、対応するバージョンのモジュールが無い。
var ErrModuleNeedsNewerApp = errors.New("sponsor: module requires newer app")

// ErrModuleIncompatible は OS/Arch 向けの配布が無い、または本体が新しすぎて対応するバージョンが無い。
var ErrModuleIncompatible = errors.New("sponsor: module incompatible with this app")

// ModuleInstallResult はバイナリと付属パックそれぞれの配置結果。
type ModuleInstallResult struct {
	Version                        string
	CompanionPackConfigured        bool
	CompanionPackInstalled         bool
	CompanionPackWorkflowTemplates []string
	// SidecarRestarted は配置後にサイドカーを新実体で起動し直せたか。
	// false は従来通り本体の再起動で有効化する（未起動モジュール・再起動失敗）。
	SidecarRestarted bool
	// FirstInstall は配置先に実行ファイルが無い状態からの導入か
	//（更新との文言出し分け用。クリーン再導入後の入れ直しも含む）。
	FirstInstall bool
}

// ModuleStatusEntry は 1 モジュールの配置状態（GET /api/sponsor/modules の要素）。
type ModuleStatusEntry struct {
	// ID はモジュールID（module レジストリの定数）。
	ID string `json:"id"`
	// Installed はモジュール実行ファイルが配置済みか。
	Installed bool `json:"installed"`
	// Active は現在のプロセスで当該サイドカーが起動しているか
	//（配置直後の自動起動・更新後の起こし直しも反映した実測値）。
	Active bool `json:"active"`
}

// ModulesStatus は全モジュールの配置状態を返す（ConfigureModules の ids 順）。
func (s *Service) ModulesStatus() []ModuleStatusEntry {
	out := make([]ModuleStatusEntry, 0, len(s.moduleIDs))
	for _, id := range s.moduleIDs {
		target, ok := s.modules[id]
		if !ok {
			continue
		}
		installed := false
		if _, err := os.Stat(target.InstallPath); err == nil {
			installed = true
		}
		active := target.Active != nil && target.Active()
		out = append(out, ModuleStatusEntry{ID: id, Installed: installed, Active: active})
	}
	return out
}

// InstallModule は指定モジュールを取得・検証して配置する。
// 成功時は配置したバージョンを返す。同時実行は ErrModuleBusy で拒否する。
func (s *Service) InstallModule(ctx context.Context, moduleID string) (ModuleInstallResult, error) {
	if !s.moduleOpMu.TryLock() {
		return ModuleInstallResult{}, ErrModuleBusy
	}
	defer s.moduleOpMu.Unlock()
	plan, err := s.planModuleInstall(ctx, moduleID)
	if err != nil {
		return ModuleInstallResult{}, err
	}
	return s.applyModuleInstall(ctx, plan)
}

// moduleInstallPlan は取得前に確定させる導入内容（どのバージョンのどのファイルを取るか）。
type moduleInstallPlan struct {
	moduleID string
	target   ModuleTarget
	token    string
	entry    dlModuleEntry
	file     dlModuleFile
}

// planModuleInstall は一覧ファイルを取得・検証し、導入するバージョンを決める
// （moduleOpMu 保持中に呼ぶこと）。配置物には触れないため、クリーン再導入は削除の前に
// これを済ませ、一覧ファイルが取れない・対応バージョンが無い状態で削除だけが進むのを防ぐ。
func (s *Service) planModuleInstall(ctx context.Context, moduleID string) (moduleInstallPlan, error) {
	if len(s.modules) == 0 {
		return moduleInstallPlan{}, errors.New("sponsor: module install is not configured")
	}
	target, ok := s.modules[moduleID]
	if !ok {
		return moduleInstallPlan{}, ErrModuleUnknown
	}
	tok := s.store.Current()
	if tok == "" {
		return moduleInstallPlan{}, ErrModuleNoToken
	}
	manifest, err := s.fetchDownloadManifest(ctx)
	if err != nil {
		return moduleInstallPlan{}, err
	}
	entries, listed := manifest.Modules[moduleID]
	if !listed || len(entries) == 0 {
		return moduleInstallPlan{}, ErrModuleUnavailable
	}
	// 互換性の強制検証。UI の表示条件に依存せず、配置前に必ず拒否する。
	// OS/Arch は常時、バージョン範囲は release ビルドのみ。
	selection := selectModule(entries, runtime.GOOS, runtime.GOARCH,
		buildinfo.Snapshot().Version, buildinfo.IsRelease())
	if selection.Entry == nil {
		if selection.NeedsNewerApp {
			return moduleInstallPlan{}, ErrModuleNeedsNewerApp
		}
		return moduleInstallPlan{}, ErrModuleIncompatible
	}
	return moduleInstallPlan{
		moduleID: moduleID, target: target, token: tok,
		entry: *selection.Entry, file: *selection.File,
	}, nil
}

// applyModuleInstall は許可の取得・ダウンロード・照合・配置の実体（moduleOpMu 保持中に呼ぶこと）。
func (s *Service) applyModuleInstall(ctx context.Context, plan moduleInstallPlan) (ModuleInstallResult, error) {
	moduleID, target := plan.moduleID, plan.target

	// 1. ダウンロード許可（実行ファイルと付属パックで共用）
	grant, err := s.requestDownloadGrant(ctx, plan.token, downloadKindModule, moduleID, plan.entry.Version)
	if err != nil {
		return ModuleInstallResult{}, err
	}
	folder := downloadFolder(downloadKindModule, moduleID, plan.entry.Version)

	// 2. バイナリ取得（一時ファイルへ書きつつ SHA-256 を計算）
	tmpPath := target.InstallPath + ".download"
	sum, size, err := s.downloadGranted(ctx, grant, folder, plan.file.Name, tmpPath, plan.file.Size, 0o755)
	if err != nil {
		_ = os.Remove(tmpPath)
		return ModuleInstallResult{}, err
	}

	// 3. ハッシュ・サイズ照合 → 配置（atomic rename）
	if size != plan.file.Size || !strings.EqualFold(sum, plan.file.SHA256) {
		_ = os.Remove(tmpPath)
		return ModuleInstallResult{}, errors.New("sponsor: module binary hash or size mismatch")
	}
	if err := os.Chmod(tmpPath, 0o755); err != nil {
		_ = os.Remove(tmpPath)
		return ModuleInstallResult{}, err
	}
	// 実行中サイドカーの待避。Windows は実行中 exe への上書き rename が失敗する。
	// 停止 API は無いため .old へ退避し、旧実体は本体再起動まで動き続ける。
	// .old の掃除は本体起動時の掃除処理（module.CleanupStaleFiles）が担う。
	oldPath := target.InstallPath + ".old"
	usedBackup := false
	if _, statErr := os.Stat(target.InstallPath); statErr == nil {
		_ = os.Remove(oldPath)
		if err := os.Rename(target.InstallPath, oldPath); err != nil {
			_ = os.Remove(tmpPath)
			return ModuleInstallResult{}, err
		}
		usedBackup = true
	}
	if err := os.Rename(tmpPath, target.InstallPath); err != nil {
		// 配置失敗時は待避した旧実体を戻す。戻せないと「配置先に何も無い」
		// 中途状態になる（ウイルス対策の一時ロック等）。
		if usedBackup {
			if rbErr := os.Rename(oldPath, target.InstallPath); rbErr != nil {
				logging.Error("sponsor: module %s rollback failed: %v", moduleID, rbErr)
				err = errors.Join(err, rbErr)
			}
		}
		_ = os.Remove(tmpPath)
		return ModuleInstallResult{}, err
	}
	logging.Info("sponsor: module %s installed (version %s)", moduleID, plan.entry.Version)
	result := ModuleInstallResult{
		Version:                        plan.entry.Version,
		CompanionPackConfigured:        target.InstallCompanionPack != nil,
		CompanionPackWorkflowTemplates: []string{},
		FirstInstall:                   !usedBackup,
	}
	receipt := moduleReceipt{
		Module:      moduleID,
		Version:     plan.entry.Version,
		SHA256:      plan.file.SHA256,
		InstalledAt: time.Now().Format(time.RFC3339),
	}
	if target.InstallCompanionPack != nil {
		workflowTemplates, err := s.installCompanionPack(ctx, grant, folder, plan.entry.CompanionPack, target.InstallCompanionPack)
		if err != nil {
			logging.Error("sponsor: module %s companion pack install failed: %v", moduleID, err)
			s.writeReceipt(target.ReceiptPath, receipt)
			// バイナリ自体は入れ替わっているため、再起動して新実体を有効化する。
			result.SidecarRestarted = s.restartSidecar(moduleID, target)
			return result, nil
		}
		result.CompanionPackInstalled = true
		if workflowTemplates != nil {
			result.CompanionPackWorkflowTemplates = append([]string{}, workflowTemplates...)
		}
		receipt.CompanionPack = &moduleReceiptPack{
			Version: plan.entry.CompanionPack.Version,
			Files:   append([]string{}, result.CompanionPackWorkflowTemplates...),
		}
	}
	s.writeReceipt(target.ReceiptPath, receipt)
	// 配置一式（バイナリ＋付属パック）が確定してから再起動する（新実体の即時有効化）。
	result.SidecarRestarted = s.restartSidecar(moduleID, target)
	return result, nil
}

// restartSidecar は配置済みの新実体でサイドカーを起動し直す（Restart 未設定は false）。
// 再起動の失敗は配置の成功を覆さない（本体再起動で有効化できるためログのみ）。
func (s *Service) restartSidecar(moduleID string, target ModuleTarget) bool {
	if target.Restart == nil {
		return false
	}
	if err := target.Restart(); err != nil {
		logging.Error("sponsor: module %s sidecar restart failed: %v", moduleID, err)
		return false
	}
	logging.Info("sponsor: module %s sidecar restarted", moduleID)
	return true
}

// installCompanionPack は付属パックを取得・照合して適用する。
// 戻り値は利用可能になった workflow テンプレート名。一覧ファイルに付属パックが無い
// バージョンはエラー（呼び出し側は付属パック未適用として配置を続ける）。
func (s *Service) installCompanionPack(
	ctx context.Context,
	grant string,
	folder string,
	pack *dlVersionedFile,
	install func(zipPath string) ([]string, error),
) ([]string, error) {
	if !validVersionedFile(pack) || pack.Size > config.SettingsPackMaxUploadBytes {
		return nil, errors.New("sponsor: companion pack is not listed or exceeds the size limit")
	}
	tmp, err := os.CreateTemp("", "alslime-companion-pack-*.zip")
	if err != nil {
		return nil, err
	}
	tmpPath := tmp.Name()
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpPath)
		return nil, err
	}
	defer func() { _ = os.Remove(tmpPath) }()
	sum, size, err := s.downloadGranted(ctx, grant, folder, pack.Name, tmpPath, pack.Size, 0o600)
	if err != nil {
		return nil, err
	}
	if size != pack.Size || !strings.EqualFold(sum, pack.SHA256) {
		return nil, errors.New("sponsor: companion pack hash or size mismatch")
	}
	return install(tmpPath)
}

// moduleReceipt は配置レシート。配置済みバージョンの正本で、
// 更新有無の判定とクリーン再導入の対象限定に使う。
type moduleReceipt struct {
	Module        string             `json:"module"`
	Version       string             `json:"version"`
	SHA256        string             `json:"sha256"`
	InstalledAt   string             `json:"installedAt"`
	CompanionPack *moduleReceiptPack `json:"companionPack,omitempty"`
}

// moduleReceiptPack はレシートの companion pack 部。
// Files は現状 workflow テンプレート名（Phase 3 のクリーン実装時に
// WORKSPACE_ROOT 相対パス一覧へ拡張する）。
type moduleReceiptPack struct {
	Version string   `json:"version"`
	Files   []string `json:"files"`
}

// writeReceipt は配置レシートを書き込む。path が空なら何もしない。
// 書き込み失敗は配置自体の成功を覆さない（ログのみ。次回配置で再作成される）。
func (s *Service) writeReceipt(path string, receipt moduleReceipt) {
	if path == "" {
		return
	}
	if err := jsonstore.WriteJSON(path, receipt); err != nil {
		logging.Error("sponsor: module %s receipt write failed: %v", receipt.Module, err)
	}
}

// readReceipt は配置レシートを読む。path が空・未作成・破損は ok=false。
func (s *Service) readReceipt(path string) (moduleReceipt, bool) {
	if path == "" {
		return moduleReceipt{}, false
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return moduleReceipt{}, false
	}
	var receipt moduleReceipt
	if err := json.Unmarshal(raw, &receipt); err != nil {
		return moduleReceipt{}, false
	}
	return receipt, true
}

// ModuleUpdateEntry は 1 モジュールの更新確認結果（GET /api/update/check の modules 要素）。
type ModuleUpdateEntry struct {
	ID                  string `json:"id"`
	InstalledVersion    string `json:"installedVersion"`
	LatestVersion       string `json:"latestVersion"`
	HasUpdate           bool   `json:"hasUpdate"`
	CompanionPackUpdate bool   `json:"companionPackUpdate"`
	NeedsAppUpdate      bool   `json:"needsAppUpdate"`
	// Incompatible は本体が新しすぎる等で、対応するバージョンのモジュールが配布されていない
	//（取得・更新の操作は無効化する）。
	Incompatible bool `json:"incompatible"`
	// LatestCompanionPackVersion は配布側の付属パック版（配布に無ければ空）。
	// 告知スキップの記録を exe 版と組で持つために露出する。
	LatestCompanionPackVersion string `json:"latestCompanionPackVersion"`
	// Skipped / PostponedToday はこのモジュールの告知抑止状態（スキップ済み・
	// 「後で」当日）。値は API 層が更新確認設定と突き合わせて設定する
	//（本パッケージでは判定しない。本体の告知状態とは独立）。
	Skipped        bool `json:"skipped"`
	PostponedToday bool `json:"postponedToday"`
}

// ModulesUpdateInfo は配置済みモジュールの更新有無を返す。
// appVersion は本体の現行バージョン（対応範囲の判定に使う）。
// トークンが無い場合は ErrModuleNoToken（呼び出し側はモジュール部分を省いて応答する）。
func (s *Service) ModulesUpdateInfo(ctx context.Context, appVersion string) ([]ModuleUpdateEntry, error) {
	if len(s.modules) == 0 {
		return nil, errors.New("sponsor: module update check is not configured")
	}
	if s.store.Current() == "" {
		return nil, ErrModuleNoToken
	}
	manifest, err := s.fetchDownloadManifest(ctx)
	if err != nil {
		return nil, err
	}
	enforceRange := buildinfo.IsRelease()
	out := make([]ModuleUpdateEntry, 0, len(s.moduleIDs))
	for _, id := range s.moduleIDs {
		target, ok := s.modules[id]
		if !ok {
			continue
		}
		if _, statErr := os.Stat(target.InstallPath); statErr != nil {
			continue // 未配置モジュールは対象外（新着案内は既存導線に任せる）
		}
		out = append(out, s.moduleUpdateEntry(id, target, manifest.Modules[id], appVersion, enforceRange))
	}
	return out, nil
}

// moduleUpdateEntry は 1 モジュールの更新確認結果を組み立てる。
//
// 比べる相手は、今の本体のバージョンが対応範囲に入るバージョンの中の最新だけ。
// 対応範囲の外にあるバージョンは、どれだけ新しくても更新として案内しない
// （LatestVersion にも出さない）。本体を更新したあとの入れ替えは、更新後の本体で
// 行う次の更新確認が受け持つ。使えるバージョンが 1 つも無いときは、バージョンを
// 出さずに NeedsAppUpdate か Incompatible の状態だけを返す。
func (s *Service) moduleUpdateEntry(
	id string, target ModuleTarget, entries []dlModuleEntry, appVersion string, enforceRange bool,
) ModuleUpdateEntry {
	entry := ModuleUpdateEntry{ID: id}
	receipt, receiptOK := s.readReceipt(target.ReceiptPath)
	if receiptOK {
		entry.InstalledVersion = receipt.Version
	}
	if len(entries) == 0 {
		return entry // 配布なし → 更新なし表示
	}
	selection := selectModule(entries, runtime.GOOS, runtime.GOARCH, appVersion, enforceRange)
	usable := selection.Entry
	if usable == nil {
		entry.NeedsAppUpdate = selection.NeedsNewerApp
		entry.Incompatible = selection.Incompatible
		return entry
	}
	entry.LatestVersion = usable.Version
	entry.LatestCompanionPackVersion = companionPackVersion(usable)
	if receiptOK {
		// 導入済みより新しければ更新あり。本体の更新で導入済みのバージョンが対応範囲から
		// 外れた場合は、対応するバージョンが導入済みより古くても更新として案内する。
		entry.HasUpdate = semver.IsNewer(usable.Version, receipt.Version) ||
			(usable.Version != receipt.Version &&
				moduleOutOfRange(entries, receipt.Version, appVersion, enforceRange))
	} else {
		entry.HasUpdate = s.installedDiffers(target, selection.File)
	}
	entry.CompanionPackUpdate = companionPackOutdated(receipt, receiptOK, usable)
	return entry
}

func companionPackVersion(entry *dlModuleEntry) string {
	if entry.CompanionPack == nil {
		return ""
	}
	return entry.CompanionPack.Version
}

// companionPackOutdated は付属パックの版がレシートと違うかを返す。レシートが無い旧環境は
// 版数比較できないため、配布があれば更新あり扱い。
func companionPackOutdated(receipt moduleReceipt, receiptOK bool, entry *dlModuleEntry) bool {
	latest := companionPackVersion(entry)
	if latest == "" {
		return false
	}
	if !receiptOK {
		return true
	}
	return receipt.CompanionPack == nil || receipt.CompanionPack.Version != latest
}

// installedDiffers はレシート無し旧環境の更新判定（exe の SHA-256 実測と一覧ファイルの
// ハッシュ値の照合）。判定不能は「更新なし」へ倒す。
func (s *Service) installedDiffers(target ModuleTarget, file *dlModuleFile) bool {
	if file == nil {
		return false
	}
	sum, err := fileSHA256(target.InstallPath)
	if err != nil {
		return false
	}
	return !strings.EqualFold(sum, file.SHA256)
}

// fileSHA256 はファイルの SHA-256（hex 小文字）を返す。
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

// moduleResponseError は entitlement サーバーの HTTP ステータスをエラーへ変換する。
func moduleResponseError(status int) error {
	switch {
	case status == http.StatusOK:
		return nil
	case status == http.StatusUnauthorized:
		return ErrTokenInvalid
	case status == http.StatusForbidden:
		return ErrTierRejected
	case status == http.StatusNotFound:
		return ErrModuleUnavailable
	default:
		return fmt.Errorf("sponsor: module server status %d", status)
	}
}
