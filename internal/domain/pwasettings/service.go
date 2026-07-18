// Package pwasettings は PWA（アプリ表示）設定のユースケースを担う service 層。
//
// 現行 Node 版の GET/POST /api/settings を移植する。
//   - Get:    既定値補完済みの設定を返す。
//   - Update: パーシャルマージして保存し、保存後の全体を返す。
//
// ビジネスロジックは薄い（マージのみ）。保存先・既定値補完は storage に委ねる。
package pwasettings

import (
	"context"

	"alslime/internal/config"
	storage "alslime/internal/storage/pwasettings"
)

const holidayCalendarEnabledKey = "holidayCalendarEnabled"

// CalendarUpdater は祝日カレンダーの取得更新を行う境界。
type CalendarUpdater interface {
	CheckAndUpdate(ctx context.Context) error
}

// Service は PWA 設定のユースケースを提供する。
type Service struct {
	store           *storage.Store
	calendarUpdater CalendarUpdater
}

// New は Service を生成する。
func New(store *storage.Store) *Service {
	return &Service{store: store}
}

// WithCalendarUpdater は祝日反映設定が OFF から ON へ変わった時の更新処理を差し込む。
func (s *Service) WithCalendarUpdater(updater CalendarUpdater) *Service {
	s.calendarUpdater = updater
	return s
}

// Get は既定値補完済みの PWA 設定を返す。
func (s *Service) Get() (map[string]any, error) {
	settings, err := s.store.Load()
	if err != nil {
		return nil, err
	}
	return normalizeHolidayCalendarSettings(settings), nil
}

// Update は patch をパーシャルマージして保存し、保存後の全体を返す。
func (s *Service) Update(patch map[string]any) (map[string]any, error) {
	if patch == nil {
		patch = map[string]any{}
	}
	before, err := s.store.Load()
	if err != nil {
		return nil, err
	}
	beforeEnabled := holidayCalendarEnabled(before)

	updated, err := s.store.Merge(patch)
	if err != nil {
		return nil, err
	}
	updated = normalizeHolidayCalendarSettings(updated)
	if _, ok := patch["uiLanguage"]; ok {
		if normalized, err := s.store.Merge(map[string]any{
			"uiLanguage":              updated["uiLanguage"],
			holidayCalendarEnabledKey: updated[holidayCalendarEnabledKey],
		}); err == nil {
			updated = normalizeHolidayCalendarSettings(normalized)
		} else {
			return nil, err
		}
	}

	if !beforeEnabled && holidayCalendarEnabled(updated) && s.calendarUpdater != nil {
		// 設定保存は完了しているため、カレンダー更新失敗で設定反映自体は巻き戻さない。
		_ = s.calendarUpdater.CheckAndUpdate(context.Background())
	}
	return updated, nil
}

func normalizeHolidayCalendarSettings(settings map[string]any) map[string]any {
	if settings == nil {
		return settings
	}
	if !isJapaneseUI(settings) {
		settings[holidayCalendarEnabledKey] = false
	}
	return settings
}

func holidayCalendarEnabled(settings map[string]any) bool {
	if !isJapaneseUI(settings) {
		return false
	}
	enabled, _ := settings[holidayCalendarEnabledKey].(bool)
	return enabled
}

func isJapaneseUI(settings map[string]any) bool {
	lang, _ := settings["uiLanguage"].(string)
	return lang == config.I18NDefaultLang
}
