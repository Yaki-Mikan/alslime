// Package calendar は祝日カレンダーの自動更新と利用判定を担う。
package calendar

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"alslime/internal/config"
	calendarstore "alslime/internal/storage/calendar"
	globalsettingsstore "alslime/internal/storage/globalsettings"
	pwasettingsstore "alslime/internal/storage/pwasettings"
)

const calendarLastUpdateKey = "calendarLastUpdate"
const holidayCalendarEnabledKey = "holidayCalendarEnabled"

// Service は holidays-jp の祝日情報を必要に応じて取得し、calendar.json へ保存する。
type Service struct {
	store          *calendarstore.Store
	settings       *globalsettingsstore.Store
	pwaSettings    *pwasettingsstore.Store
	client         *http.Client
	now            func() time.Time
	apiURL         string
	updateInterval time.Duration
}

// New は既定設定の Service を生成する。
func New(store *calendarstore.Store, settings *globalsettingsstore.Store, pwaSettings *pwasettingsstore.Store) *Service {
	return &Service{
		store:          store,
		settings:       settings,
		pwaSettings:    pwaSettings,
		client:         &http.Client{Timeout: 15 * time.Second},
		now:            time.Now,
		apiURL:         config.CalendarAPIURL,
		updateInterval: config.CalendarUpdateIntervalDays * 24 * time.Hour,
	}
}

// CheckAndUpdate は最終更新から既定日数以上経っている場合だけ calendar.json を更新する。
//
// 起動時処理から呼ばれるため、呼び出し側はエラーをログに留めて起動継続する。
func (s *Service) CheckAndUpdate(ctx context.Context) error {
	enabled, err := s.Enabled()
	if err != nil {
		return err
	}
	if !enabled {
		return nil
	}
	settings, err := s.settings.Load()
	if err != nil {
		return err
	}
	lastUpdate := parseLastUpdate(settings[calendarLastUpdateKey])
	now := s.now()
	if !lastUpdate.IsZero() && now.Sub(lastUpdate) < s.updateInterval {
		return nil
	}
	if err := s.fetchAndSave(ctx, now); err != nil {
		_ = s.log("error", fmt.Sprintf("カレンダー更新エラー: %v", err))
		return err
	}
	return nil
}

// HolidayName は祝日反映機能が有効なときだけ祝日名を返す。
// 日本語以外、または設定 OFF の場合は常に空文字を返す。
func (s *Service) HolidayName(t time.Time) (string, error) {
	enabled, err := s.Enabled()
	if err != nil {
		return "", err
	}
	if !enabled {
		return "", nil
	}
	return s.store.HolidayName(t)
}

// Enabled は PWA 設定上で祝日反映機能が有効かを返す。
// 機能は日本語 UI 専用のため、uiLanguage が ja 以外なら常に無効。
func (s *Service) Enabled() (bool, error) {
	if s.pwaSettings == nil {
		return false, nil
	}
	settings, err := s.pwaSettings.Load()
	if err != nil {
		return false, err
	}
	return enabledFromPWASettings(settings), nil
}

func (s *Service) fetchAndSave(ctx context.Context, now time.Time) error {
	_ = s.log("info", "カレンダー情報の更新を開始します")
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.apiURL, nil)
	if err != nil {
		return err
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("HTTP error: status %d", resp.StatusCode)
	}
	var holidays map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&holidays); err != nil {
		return err
	}
	if holidays == nil {
		holidays = map[string]string{}
	}
	if err := s.store.SaveAll(holidays); err != nil {
		return err
	}
	if _, err := s.settings.Merge(map[string]any{
		calendarLastUpdateKey: now.UTC().Format(time.RFC3339Nano),
	}); err != nil {
		return err
	}
	_ = s.log("info", "カレンダー情報を正常に更新しました")
	return nil
}

func (s *Service) log(level, message string) error {
	line := fmt.Sprintf("[%s] [%s] %s\n", s.now().UTC().Format(time.RFC3339Nano), strings.ToUpper(level), message)
	return s.store.AppendLog(line)
}

func parseLastUpdate(value any) time.Time {
	text, ok := value.(string)
	if !ok || strings.TrimSpace(text) == "" {
		return time.Time{}
	}
	t, err := time.Parse(time.RFC3339Nano, text)
	if err != nil {
		return time.Time{}
	}
	return t
}

func enabledFromPWASettings(settings map[string]any) bool {
	if settings == nil {
		return false
	}
	lang, _ := settings["uiLanguage"].(string)
	if strings.TrimSpace(lang) != config.I18NDefaultLang {
		return false
	}
	enabled, _ := settings[holidayCalendarEnabledKey].(bool)
	return enabled
}
