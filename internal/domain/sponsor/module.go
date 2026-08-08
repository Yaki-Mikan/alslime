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
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"alslime/internal/buildinfo"
	"alslime/internal/config"
	"alslime/internal/logging"
	"alslime/internal/semver"
	"alslime/internal/storage/jsonstore"
)

// サイドカーモジュールの取得・検証・配置（12番 5章 / 14番 6章。複数モジュール対応）。
//
// entitlement サーバーの署名付きマニフェスト（SHA-256 + Ed25519）を検証してから
// バイナリを配置する。署名鍵は entitlement トークンと同じ埋め込み公開鍵系で、
// 検証実体は core（featuresimpl）に閉じ、本パッケージは注入された関数だけを呼ぶ。
// 対象モジュールは ConfigureModules で注入されたレジストリ（module.IDs()）に限る。

// ErrModuleNoToken はモジュール取得に必要なトークンが無い。
var ErrModuleNoToken = errors.New("sponsor: no token for module download")

// ErrModuleUnavailable はサーバー側にモジュール配布が無い（404）。
var ErrModuleUnavailable = errors.New("sponsor: module not available on server")

// ErrModuleRejected はサーバーがトークンを拒否した（401/403）。
var ErrModuleRejected = errors.New("sponsor: module download rejected by server")

// ErrModuleUnknown は取得対象がレジストリに無い（本体が知らないモジュールID）。
var ErrModuleUnknown = errors.New("sponsor: unknown module id")

// ErrModuleBusy はモジュール変更操作（install / clean）が既に進行中（409）。
var ErrModuleBusy = errors.New("sponsor: module operation in progress")

// ErrModuleNeedsNewerApp は本体が古すぎてモジュールを配置できない（MinAppVersion 未満）。
var ErrModuleNeedsNewerApp = errors.New("sponsor: module requires newer app")

// ErrModuleIncompatible は OS/Arch 不一致または本体が新しすぎる（MaxAppVersion 超過）。
var ErrModuleIncompatible = errors.New("sponsor: module incompatible with this app")

// moduleManifest は entitlement サーバーが返す署名付きマニフェスト。
// サーバー側 httpapi.Manifest と同一契約で、署名対象の正規化 JSON は
// Sig を空にした本構造体の json.Marshal（フィールド順も一致させること）。
type moduleManifest struct {
	Version       string `json:"version"`
	OS            string `json:"os"`
	Arch          string `json:"arch"`
	SHA256        string `json:"sha256"`
	MinAppVersion string `json:"minAppVersion"`
	MaxAppVersion string `json:"maxAppVersion"`
	Sig           string `json:"sig"`
}

type companionPackManifest struct {
	Module    string `json:"module"`
	Version   string `json:"version"`
	SHA256    string `json:"sha256"`
	SizeBytes int64  `json:"sizeBytes"`
	Sig       string `json:"sig"`
}

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

// InstallModule は entitlement サーバーから指定モジュールを取得・検証して配置する。
// 成功時はマニフェストのバージョンを返す。配置の有効化には本体の再起動が必要。
// 同時実行は ErrModuleBusy で拒否する（交換日記 005-3）。
func (s *Service) InstallModule(ctx context.Context, moduleID string) (ModuleInstallResult, error) {
	if !s.moduleOpMu.TryLock() {
		return ModuleInstallResult{}, ErrModuleBusy
	}
	defer s.moduleOpMu.Unlock()
	return s.installModuleLocked(ctx, moduleID)
}

// installModuleLocked は取得・検証・配置の実体（moduleOpMu 保持中に呼ぶこと）。
func (s *Service) installModuleLocked(ctx context.Context, moduleID string) (ModuleInstallResult, error) {
	if len(s.modules) == 0 || s.verifySig == nil {
		return ModuleInstallResult{}, errors.New("sponsor: module install is not configured")
	}
	target, ok := s.modules[moduleID]
	if !ok {
		return ModuleInstallResult{}, ErrModuleUnknown
	}
	tok := s.store.Current()
	if tok == "" {
		return ModuleInstallResult{}, ErrModuleNoToken
	}

	query := fmt.Sprintf("?os=%s&arch=%s", runtime.GOOS, runtime.GOARCH)

	// 1. 署名付きマニフェスト取得
	manifest, err := s.fetchModuleManifest(ctx, tok, moduleID, query)
	if err != nil {
		return ModuleInstallResult{}, err
	}

	// 2. 署名検証（Sig を除いた正規化 JSON への Ed25519 署名）
	payload := manifest
	payload.Sig = ""
	canonical, err := json.Marshal(payload)
	if err != nil {
		return ModuleInstallResult{}, err
	}
	if err := s.verifySig(canonical, manifest.Sig); err != nil {
		return ModuleInstallResult{}, fmt.Errorf("sponsor: module manifest verification failed: %w", err)
	}

	// 互換性の強制検証（交換日記 005-5）。UI の表示条件に依存せず、配置前に必ず拒否する。
	// OS/Arch は常時、バージョン範囲は release ビルドのみ（dev の 0.0.0-dev は
	// 常に範囲外になり、ローカル検証を阻害するため）。
	if manifest.OS != runtime.GOOS || manifest.Arch != runtime.GOARCH {
		return ModuleInstallResult{}, ErrModuleIncompatible
	}
	if buildinfo.IsRelease() {
		current := buildinfo.Snapshot().Version
		if manifest.MinAppVersion != "" && semver.IsNewer(manifest.MinAppVersion, current) {
			return ModuleInstallResult{}, ErrModuleNeedsNewerApp
		}
		if manifest.MaxAppVersion != "" && semver.IsNewer(current, manifest.MaxAppVersion) {
			return ModuleInstallResult{}, ErrModuleIncompatible
		}
	}

	// 3. バイナリ取得（一時ファイルへ書きつつ SHA-256 を計算）
	tmpPath := target.InstallPath + ".download"
	sum, err := s.downloadModuleBinary(ctx, tok, moduleID, query, tmpPath)
	if err != nil {
		_ = os.Remove(tmpPath)
		return ModuleInstallResult{}, err
	}

	// 4. ハッシュ照合 → 配置（atomic rename）
	if !strings.EqualFold(sum, manifest.SHA256) {
		_ = os.Remove(tmpPath)
		return ModuleInstallResult{}, errors.New("sponsor: module binary hash mismatch")
	}
	if err := os.Chmod(tmpPath, 0o755); err != nil {
		_ = os.Remove(tmpPath)
		return ModuleInstallResult{}, err
	}
	// 実行中サイドカーの待避（01番 6.3）。Windows は実行中 exe への上書き rename が
	// 失敗する。停止 API は無いため .old へ退避し、旧実体は本体再起動まで動き続ける。
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
		// 中途状態になる（ウイルス対策の一時ロック等。交換日記 005-4）。
		if usedBackup {
			if rbErr := os.Rename(oldPath, target.InstallPath); rbErr != nil {
				logging.Error("sponsor: module %s rollback failed: %v", moduleID, rbErr)
				err = errors.Join(err, rbErr)
			}
		}
		_ = os.Remove(tmpPath)
		return ModuleInstallResult{}, err
	}
	logging.Info("sponsor: module %s installed (version %s)", moduleID, manifest.Version)
	result := ModuleInstallResult{
		Version:                        manifest.Version,
		CompanionPackConfigured:        target.InstallCompanionPack != nil,
		CompanionPackWorkflowTemplates: []string{},
		FirstInstall:                   !usedBackup,
	}
	receipt := moduleReceipt{
		Module:      moduleID,
		Version:     manifest.Version,
		SHA256:      manifest.SHA256,
		InstalledAt: time.Now().Format(time.RFC3339),
	}
	if target.InstallCompanionPack != nil {
		packVersion, workflowTemplates, err := s.installCompanionPack(ctx, tok, moduleID, target.InstallCompanionPack)
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
			Version: packVersion,
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

// installCompanionPack は付属パックを取得・検証して適用する。
// 戻り値は（パックのバージョン, 利用可能になった workflow テンプレート名, error）。
// バージョンはレシートの companion pack 版数として記録される（01番 6.1）。
func (s *Service) installCompanionPack(
	ctx context.Context,
	tok string,
	moduleID string,
	install func(zipPath string) ([]string, error),
) (string, []string, error) {
	manifest, err := s.fetchCompanionPackManifest(ctx, tok, moduleID)
	if err != nil {
		return "", nil, err
	}
	payload := manifest
	payload.Sig = ""
	canonical, err := json.Marshal(payload)
	if err != nil {
		return "", nil, err
	}
	if err := s.verifySig(canonical, manifest.Sig); err != nil {
		return "", nil, fmt.Errorf("sponsor: companion pack manifest verification failed: %w", err)
	}
	if manifest.Module != moduleID || manifest.SHA256 == "" || manifest.SizeBytes <= 0 ||
		manifest.SizeBytes > config.SettingsPackMaxUploadBytes {
		return "", nil, errors.New("sponsor: incomplete companion pack manifest")
	}
	tmp, err := os.CreateTemp("", "alslime-companion-pack-*.zip")
	if err != nil {
		return "", nil, err
	}
	tmpPath := tmp.Name()
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpPath)
		return "", nil, err
	}
	defer func() { _ = os.Remove(tmpPath) }()
	sum, size, err := s.downloadCompanionPack(ctx, tok, moduleID, tmpPath, manifest.SizeBytes)
	if err != nil {
		return "", nil, err
	}
	if size != manifest.SizeBytes || !strings.EqualFold(sum, manifest.SHA256) {
		return "", nil, errors.New("sponsor: companion pack hash or size mismatch")
	}
	templates, err := install(tmpPath)
	if err != nil {
		return "", nil, err
	}
	return manifest.Version, templates, nil
}

func (s *Service) fetchCompanionPackManifest(
	ctx context.Context,
	tok string,
	moduleID string,
) (companionPackManifest, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		s.serverURL+"/modules/"+moduleID+"/companion-pack", nil)
	if err != nil {
		return companionPackManifest{}, err
	}
	req.Header.Set("Authorization", "Bearer "+tok)
	resp, err := s.client.Do(req)
	if err != nil {
		return companionPackManifest{}, err
	}
	defer func() { _ = resp.Body.Close() }()
	if err := moduleResponseError(resp.StatusCode); err != nil {
		return companionPackManifest{}, err
	}
	var manifest companionPackManifest
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&manifest); err != nil {
		return companionPackManifest{}, err
	}
	return manifest, nil
}

func (s *Service) downloadCompanionPack(
	ctx context.Context,
	tok string,
	moduleID string,
	dst string,
	expectedSize int64,
) (string, int64, error) {
	if expectedSize <= 0 {
		return "", 0, errors.New("sponsor: invalid companion pack size")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		s.serverURL+"/modules/"+moduleID+"/companion-pack/download", nil)
	if err != nil {
		return "", 0, err
	}
	req.Header.Set("Authorization", "Bearer "+tok)
	resp, err := s.client.Do(req)
	if err != nil {
		return "", 0, err
	}
	defer func() { _ = resp.Body.Close() }()
	if err := moduleResponseError(resp.StatusCode); err != nil {
		return "", 0, err
	}
	f, err := os.OpenFile(dst, os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return "", 0, err
	}
	h := sha256.New()
	written, copyErr := io.Copy(io.MultiWriter(f, h), io.LimitReader(resp.Body, expectedSize+1))
	closeErr := f.Close()
	if copyErr != nil {
		return "", written, copyErr
	}
	if closeErr != nil {
		return "", written, closeErr
	}
	if written > expectedSize {
		return "", written, errors.New("sponsor: companion pack exceeds signed size")
	}
	return hex.EncodeToString(h.Sum(nil)), written, nil
}

// fetchModuleManifest はマニフェスト API を叩いて検証前のマニフェストを返す。
func (s *Service) fetchModuleManifest(ctx context.Context, tok, moduleID, query string) (moduleManifest, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.serverURL+"/modules/"+moduleID+query, nil)
	if err != nil {
		return moduleManifest{}, err
	}
	req.Header.Set("Authorization", "Bearer "+tok)
	resp, err := s.client.Do(req)
	if err != nil {
		return moduleManifest{}, err
	}
	defer func() { _ = resp.Body.Close() }()
	if err := moduleResponseError(resp.StatusCode); err != nil {
		return moduleManifest{}, err
	}
	var m moduleManifest
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&m); err != nil {
		return moduleManifest{}, err
	}
	if m.SHA256 == "" || m.Sig == "" {
		return moduleManifest{}, errors.New("sponsor: incomplete module manifest")
	}
	return m, nil
}

// downloadModuleBinary はモジュールバイナリを dst へ保存し SHA-256（hex）を返す。
func (s *Service) downloadModuleBinary(ctx context.Context, tok, moduleID, query, dst string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.serverURL+"/modules/"+moduleID+"/download"+query, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+tok)
	resp, err := s.client.Do(req)
	if err != nil {
		return "", err
	}
	defer func() { _ = resp.Body.Close() }()
	if err := moduleResponseError(resp.StatusCode); err != nil {
		return "", err
	}

	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return "", err
	}
	f, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o755)
	if err != nil {
		return "", err
	}
	h := sha256.New()
	_, copyErr := io.Copy(io.MultiWriter(f, h), resp.Body)
	closeErr := f.Close()
	if copyErr != nil {
		return "", copyErr
	}
	if closeErr != nil {
		return "", closeErr
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// moduleResponseError はモジュール API の HTTP ステータスをエラーへ変換する。
// moduleReceipt は配置レシート（01番 6.1）。配置済みバージョンの正本で、
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
	// Incompatible は本体が新しすぎる等で配布モジュールが対応していない
	//（MaxAppVersion 超過。取得・更新の操作は無効化する。交換日記 005-5）。
	Incompatible bool `json:"incompatible"`
}

// moduleIndexEntry / moduleIndex はサーバーの一括インデックス契約。
// 署名対象の正規化 JSON はフィールド順に依存するため、サーバー側
// httpapi.IndexEntry / Index とフィールド順を含めて一致させること（02番 2.3）。
type moduleIndexEntry struct {
	ID                   string `json:"id"`
	Version              string `json:"version"`
	MinAppVersion        string `json:"minAppVersion"`
	MaxAppVersion        string `json:"maxAppVersion"`
	CompanionPackVersion string `json:"companionPackVersion"`
}

type moduleIndex struct {
	Modules []moduleIndexEntry `json:"modules"`
	Sig     string             `json:"sig"`
}

// ModulesUpdateInfo は配置済みモジュールの更新有無を返す（01番 6.2）。
// appVersion は本体の現行バージョン（minAppVersion 判定に使う）。
// トークンが無い場合は ErrModuleNoToken（呼び出し側はモジュール部分を省いて応答する）。
func (s *Service) ModulesUpdateInfo(ctx context.Context, appVersion string) ([]ModuleUpdateEntry, error) {
	if len(s.modules) == 0 || s.verifySig == nil {
		return nil, errors.New("sponsor: module update check is not configured")
	}
	tok := s.store.Current()
	if tok == "" {
		return nil, ErrModuleNoToken
	}
	latest, err := s.fetchModulesIndex(ctx, tok)
	if errors.Is(err, ErrModuleUnavailable) {
		// 旧サーバー（/modules/index 未実装）へのフォールバック: 個別マニフェスト照会。
		latest, err = s.fetchModulesIndexFallback(ctx, tok)
	}
	if err != nil {
		return nil, err
	}
	out := make([]ModuleUpdateEntry, 0, len(s.moduleIDs))
	for _, id := range s.moduleIDs {
		target, ok := s.modules[id]
		if !ok {
			continue
		}
		if _, statErr := os.Stat(target.InstallPath); statErr != nil {
			continue // 未配置モジュールは対象外（新着案内は既存導線に任せる）
		}
		entry := ModuleUpdateEntry{ID: id}
		idx, found := latest[id]
		if !found {
			out = append(out, entry) // サーバー側に配布なし → 更新なし表示
			continue
		}
		entry.LatestVersion = idx.Version
		if idx.MinAppVersion != "" && semver.IsNewer(idx.MinAppVersion, appVersion) {
			entry.NeedsAppUpdate = true
		}
		if idx.MaxAppVersion != "" && semver.IsNewer(appVersion, idx.MaxAppVersion) {
			entry.Incompatible = true
		}
		if receipt, receiptOK := s.readReceipt(target.ReceiptPath); receiptOK {
			entry.InstalledVersion = receipt.Version
			entry.HasUpdate = idx.Version != "" && idx.Version != receipt.Version
			if idx.CompanionPackVersion != "" {
				entry.CompanionPackUpdate = receipt.CompanionPack == nil ||
					receipt.CompanionPack.Version != idx.CompanionPackVersion
			}
		} else {
			// レシート無し旧環境: exe の SHA-256 実測と個別マニフェストで判定（01番 6.2）。
			entry.HasUpdate, entry.CompanionPackUpdate =
				s.legacyUpdateCheck(ctx, tok, id, target.InstallPath, idx)
		}
		out = append(out, entry)
	}
	return out, nil
}

// fetchModulesIndex は署名付き一括インデックスを取得・検証して ID 引きの map で返す。
// 404（旧サーバー）は ErrModuleUnavailable。
func (s *Service) fetchModulesIndex(ctx context.Context, tok string) (map[string]moduleIndexEntry, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.serverURL+"/modules/index", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+tok)
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	if err := moduleResponseError(resp.StatusCode); err != nil {
		return nil, err
	}
	var idx moduleIndex
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&idx); err != nil {
		return nil, err
	}
	// 署名検証（受信 JSON の配列順のまま Sig を空にした正規化 JSON に対して行う）。
	payload := idx
	payload.Sig = ""
	canonical, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	if err := s.verifySig(canonical, idx.Sig); err != nil {
		return nil, fmt.Errorf("sponsor: module index verification failed: %w", err)
	}
	out := make(map[string]moduleIndexEntry, len(idx.Modules))
	for _, entry := range idx.Modules {
		out[entry.ID] = entry
	}
	return out, nil
}

// fetchModulesIndexFallback は配置済みモジュールを個別マニフェストで照会する。
// companion pack の版数は取得しない（フォールバックは本体版数の主判定のみ）。
func (s *Service) fetchModulesIndexFallback(ctx context.Context, tok string) (map[string]moduleIndexEntry, error) {
	query := fmt.Sprintf("?os=%s&arch=%s", runtime.GOOS, runtime.GOARCH)
	out := map[string]moduleIndexEntry{}
	for _, id := range s.moduleIDs {
		target, ok := s.modules[id]
		if !ok {
			continue
		}
		if _, statErr := os.Stat(target.InstallPath); statErr != nil {
			continue
		}
		manifest, err := s.fetchModuleManifest(ctx, tok, id, query)
		if errors.Is(err, ErrModuleUnavailable) {
			continue
		}
		if err != nil {
			return nil, err
		}
		payload := manifest
		payload.Sig = ""
		canonical, err := json.Marshal(payload)
		if err != nil {
			return nil, err
		}
		if err := s.verifySig(canonical, manifest.Sig); err != nil {
			return nil, fmt.Errorf("sponsor: module manifest verification failed: %w", err)
		}
		out[id] = moduleIndexEntry{
			ID:            id,
			Version:       manifest.Version,
			MinAppVersion: manifest.MinAppVersion,
			MaxAppVersion: manifest.MaxAppVersion,
		}
	}
	return out, nil
}

// legacyUpdateCheck はレシート無し環境の更新判定（exe の SHA-256 実測と
// 個別マニフェストの SHA256 照合）。判定不能は「更新なし」へ倒す。
// companion pack はレシートが無いと版数比較できないため、配布があれば更新あり扱い。
func (s *Service) legacyUpdateCheck(
	ctx context.Context, tok, moduleID, installPath string, idx moduleIndexEntry,
) (hasUpdate, packUpdate bool) {
	query := fmt.Sprintf("?os=%s&arch=%s", runtime.GOOS, runtime.GOARCH)
	manifest, err := s.fetchModuleManifest(ctx, tok, moduleID, query)
	if err != nil {
		return false, false
	}
	payload := manifest
	payload.Sig = ""
	canonical, err := json.Marshal(payload)
	if err != nil {
		return false, false
	}
	if err := s.verifySig(canonical, manifest.Sig); err != nil {
		return false, false
	}
	sum, err := fileSHA256(installPath)
	if err != nil {
		return false, false
	}
	return !strings.EqualFold(sum, manifest.SHA256), idx.CompanionPackVersion != ""
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

func moduleResponseError(status int) error {
	switch {
	case status == http.StatusOK:
		return nil
	case status == http.StatusUnauthorized || status == http.StatusForbidden:
		return ErrModuleRejected
	case status == http.StatusNotFound:
		return ErrModuleUnavailable
	default:
		return fmt.Errorf("sponsor: module server status %d", status)
	}
}
