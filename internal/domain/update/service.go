// Package update は本体アップデート確認のユースケースを担う
// （ファイル自動更新、確認 01番 4章）。
//
// 最新リリースを GitHub Releases API で照会し、buildinfo の自バージョンと
// semver 比較する。照会失敗は CheckFailed に畳んで返す（起動時チェックは静かに
// 無視し、手動確認時だけフロントが文言表示する。誤通知より無通知を優先）。
package update

import (
	"context"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"alslime/internal/buildinfo"
	"alslime/internal/config"
	"alslime/internal/logging"
	"alslime/internal/semver"
	storage "alslime/internal/storage/updatesettings"
)

// AppUpdateInfo は本体の更新確認結果（GET /api/update/check の app 部）。
type AppUpdateInfo struct {
	// Enabled は更新確認が有効か（release ビルドのみ true。dev では常に false）。
	Enabled bool `json:"enabled"`
	// Current は動作中の本体バージョン（buildinfo）。
	Current string `json:"current"`
	// Latest は照会できた最新バージョン（v 無しの正規化形）。
	Latest string `json:"latest"`
	// HasUpdate は Latest が Current より新しいか。
	HasUpdate bool `json:"hasUpdate"`
	// Skipped は Latest が「このバージョンの告知をスキップ」済みか。
	// 起動時モーダルの表示可否はフロントが判定する（手動確認時はスキップ無視）。
	Skipped bool `json:"skipped"`
	// PostponedToday は「後で」を押した当日か（当日中は起動時モーダルを出さない。
	// Skipped と同じく表示可否の判定材料としてフロントへ渡す）。
	PostponedToday bool `json:"postponedToday"`
	// CanApply は直接アップデートを実行できるか（Phase 2 で実装。現状は常に false）。
	CanApply bool `json:"canApply"`
	// NotesURL はリリースページの URL。
	NotesURL string `json:"notesUrl"`
	// Notes はリリースノート本文。
	Notes string `json:"notes"`
	// CheckFailed は照会に失敗したか（オフライン・レート超過等）。
	CheckFailed bool `json:"checkFailed"`
}

// SettingsView は更新確認設定の API 表現（autoCheck は保存形の無効化フラグを反転）。
type SettingsView struct {
	AutoCheck      bool   `json:"autoCheck"`
	SkippedVersion string `json:"skippedVersion"`
}

// SettingsPatch は POST /api/update/settings の部分更新。
type SettingsPatch struct {
	AutoCheck      *bool   `json:"autoCheck"`
	SkippedVersion *string `json:"skippedVersion"`
	// PostponeToday が true のとき「後で」の日付をサーバー側の現在日付で記録する
	// （日付の出所をバックエンドに固定し、フロントからは真偽値だけ受ける）。
	PostponeToday *bool `json:"postponeToday"`
	// ApproveModuleUpdates は一括全更新の承認時に、本体更新後でないと適用
	// できないモジュール ID を記録する（本体更新後の起動時に一度だけ適用）。
	// 空配列は記録のクリア。
	ApproveModuleUpdates *[]string `json:"approveModuleUpdates"`
}

// Service は本体アップデート確認と設定の読み書きを担う。
type Service struct {
	store      *storage.Store
	client     *http.Client
	releaseURL string
	now        func() time.Time
	// devOverride は dev ビルドで照会先を環境変数上書きしたか。上書き時は
	// dev でも更新確認・適用を有効化する（ローカル検証用。sponsor と同じ流儀）。
	devOverride bool

	// 直接アップデート（apply.go）。deps は ConfigureApply で注入する。
	applyDeps  ApplyDeps
	dlClient   *http.Client
	applyMu    sync.Mutex
	applyState ApplyStatus

	// 承認済みモジュール更新の適用進行（RunApprovedModuleUpdates が更新する）。
	moduleApplyMu    sync.Mutex
	moduleApplyState ModuleApplyStatus
}

// New は Service を生成する。
//
// リリース照会先は本体埋め込み定数を正本とし、dev ビルドに限り環境変数
// ALSLIME_RELEASE_API で上書きできる（ローカル検証用。release は見ない）。
func New(store *storage.Store) *Service {
	s := &Service{
		store:      store,
		client:     &http.Client{Timeout: config.AppReleaseCheckTimeoutSeconds * time.Second},
		releaseURL: config.AppReleaseAPIURL,
		now:        time.Now,
		// phase の API 契約に空文字は無い。ゼロ値のまま返すとフロントの
		// applying 判定が崩れてボタンロックが外れる（交換日記 005-1）。
		applyState: ApplyStatus{Phase: ApplyIdle},
	}
	if !buildinfo.IsRelease() {
		if override := strings.TrimSpace(os.Getenv(config.EnvReleaseAPIURL)); override != "" {
			s.releaseURL = override
			s.devOverride = true
		}
	}
	return s
}

// checkEnabled は更新確認・適用が有効か（release ビルド、または dev の照会先上書き時）。
func (s *Service) checkEnabled() bool {
	return buildinfo.IsRelease() || s.devOverride
}

// postponeDateLayout は PostponedDate の保存形式（端末ローカル日付）。
const postponeDateLayout = "2006-01-02"

// CheckApp は本体の更新有無を返す。
// 照会失敗はエラーではなく CheckFailed=true の結果として返す（設定読み込み等の
// 内部エラーのみ error）。
func (s *Service) CheckApp(ctx context.Context) (AppUpdateInfo, error) {
	info := AppUpdateInfo{
		Enabled: s.checkEnabled(),
		Current: buildinfo.Snapshot().Version,
	}
	if !info.Enabled {
		return info, nil
	}
	settings, err := s.store.Load()
	if err != nil {
		return AppUpdateInfo{}, err
	}
	release, err := s.fetchLatestRelease(ctx)
	if err != nil {
		info.CheckFailed = true
		return info, nil
	}
	info.Latest = semver.Normalize(release.TagName)
	info.HasUpdate = semver.IsNewer(info.Latest, info.Current)
	info.Skipped = info.HasUpdate && info.Latest == settings.SkippedVersion
	info.PostponedToday = settings.PostponedDate == s.now().Format(postponeDateLayout)
	// 直接アップデートは、対象 OS/ARCH の zip と SHA256SUMS.txt が揃った
	// 新形式リリース（固定名 exe）だけを対象にする（01番 5章）。
	_, _, hasAssets := findApplyAssets(release, info.Latest)
	info.CanApply = info.HasUpdate && hasAssets
	info.NotesURL = release.HTMLURL
	info.Notes = release.Body
	return info, nil
}

// AutoCheckEnabled は自動確認が有効かを返す（check レスポンスへの同梱用）。
func (s *Service) AutoCheckEnabled() (bool, error) {
	settings, err := s.store.Load()
	if err != nil {
		return false, err
	}
	return !settings.AutoCheckDisabled, nil
}

// Settings は保存済みの更新確認設定を返す。
func (s *Service) Settings() (SettingsView, error) {
	settings, err := s.store.Load()
	if err != nil {
		return SettingsView{}, err
	}
	return toView(settings), nil
}

// UpdateSettings は patch を反映して保存後の値を返す。
// SkippedVersion は v 無しへ正規化して保存する（空文字はスキップ解除）。
func (s *Service) UpdateSettings(patch SettingsPatch) (SettingsView, error) {
	current, err := s.store.Load()
	if err != nil {
		return SettingsView{}, err
	}
	if patch.AutoCheck != nil {
		current.AutoCheckDisabled = !*patch.AutoCheck
	}
	if patch.SkippedVersion != nil {
		current.SkippedVersion = semver.Normalize(strings.TrimSpace(*patch.SkippedVersion))
	}
	if patch.PostponeToday != nil {
		if *patch.PostponeToday {
			current.PostponedDate = s.now().Format(postponeDateLayout)
		} else {
			current.PostponedDate = ""
		}
	}
	if patch.ApproveModuleUpdates != nil {
		ids := make([]string, 0, len(*patch.ApproveModuleUpdates))
		for _, id := range *patch.ApproveModuleUpdates {
			if trimmed := strings.TrimSpace(id); trimmed != "" {
				ids = append(ids, trimmed)
			}
		}
		current.PendingModuleUpdates = ids
	}
	saved, err := s.store.Save(current)
	if err != nil {
		return SettingsView{}, err
	}
	return toView(saved), nil
}

// ModuleApplyStatus は承認済みモジュール更新の適用進行
// （GET /api/update/status の moduleApply 部）。
type ModuleApplyStatus struct {
	// Applying は適用が進行中か。
	Applying bool `json:"applying"`
	// CurrentID は適用中のモジュール ID（進行中のみ）。
	CurrentID string `json:"currentId,omitempty"`
	// Done はこの起動での適用が完了したか（適用が行われた場合のみ true）。
	Done bool `json:"done"`
	// CompletedAt は完了時刻（RFC3339）。フロントの完了報告は再読み込み時の
	// 再表示を直近数分に留めるため、この時刻で判定する。
	CompletedAt string `json:"completedAt,omitempty"`
	// FailedIDs は適用に失敗したモジュール ID（空なら全て成功）。
	FailedIDs []string `json:"failedIds,omitempty"`
}

// ModuleApplyState は承認済みモジュール更新の適用進行のスナップショットを返す。
func (s *Service) ModuleApplyState() ModuleApplyStatus {
	s.moduleApplyMu.Lock()
	defer s.moduleApplyMu.Unlock()
	state := s.moduleApplyState
	state.FailedIDs = append([]string(nil), s.moduleApplyState.FailedIDs...)
	return state
}

// RunApprovedModuleUpdates は一括全更新でユーザーが承認済みのモジュール更新を
// 適用する（本体更新後の起動時に一度だけ呼ぶ）。承認記録が無ければ何もしない。
// 承認の取り出しと進行状態の設定は同期で行い（ページ読み込みが適用より先に
// 完了しても「適用中」を取りこぼさない）、適用本体はバックグラウンドで進む。
// install は 1 モジュールの取得・配置・サイドカー再起動の実体（組み立て層で注入）。
func (s *Service) RunApprovedModuleUpdates(ctx context.Context, install func(ctx context.Context, moduleID string) error) {
	ids, err := s.ConsumePendingModuleUpdates()
	if err != nil {
		logging.Error("update: approved module updates load failed: %v", err)
		return
	}
	if len(ids) == 0 {
		return
	}
	s.moduleApplyMu.Lock()
	s.moduleApplyState = ModuleApplyStatus{Applying: true, CurrentID: ids[0]}
	s.moduleApplyMu.Unlock()
	go func() {
		failed := make([]string, 0, len(ids))
		for _, id := range ids {
			s.moduleApplyMu.Lock()
			s.moduleApplyState.CurrentID = id
			s.moduleApplyMu.Unlock()
			if err := install(ctx, id); err != nil {
				logging.Error("update: approved module %s update failed: %v", id, err)
				failed = append(failed, id)
				continue
			}
			logging.Info("update: approved module %s update applied", id)
		}
		s.moduleApplyMu.Lock()
		s.moduleApplyState = ModuleApplyStatus{
			Done:        true,
			CompletedAt: s.now().Format(time.RFC3339),
			FailedIDs:   failed,
		}
		s.moduleApplyMu.Unlock()
	}()
}

// ConsumePendingModuleUpdates は承認済みモジュール更新の一覧を取り出し、記録を
// クリアする（本体更新後の起動時に一度だけ呼ぶ）。適用の試行は一度きりとし、
// 失敗した分は通常の更新告知の経路に戻す（起動のたびの再試行はしない）。
func (s *Service) ConsumePendingModuleUpdates() ([]string, error) {
	settings, err := s.store.Load()
	if err != nil {
		return nil, err
	}
	if len(settings.PendingModuleUpdates) == 0 {
		return nil, nil
	}
	ids := settings.PendingModuleUpdates
	settings.PendingModuleUpdates = nil
	if _, err := s.store.Save(settings); err != nil {
		return nil, err
	}
	return ids, nil
}

func toView(settings storage.Settings) SettingsView {
	return SettingsView{
		AutoCheck:      !settings.AutoCheckDisabled,
		SkippedVersion: settings.SkippedVersion,
	}
}
