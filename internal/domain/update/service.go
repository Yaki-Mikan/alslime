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
	saved, err := s.store.Save(current)
	if err != nil {
		return SettingsView{}, err
	}
	return toView(saved), nil
}

func toView(settings storage.Settings) SettingsView {
	return SettingsView{
		AutoCheck:      !settings.AutoCheckDisabled,
		SkippedVersion: settings.SkippedVersion,
	}
}
