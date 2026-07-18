package calendar

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"alslime/internal/config"
	calendarstore "alslime/internal/storage/calendar"
	globalsettingsstore "alslime/internal/storage/globalsettings"
	"alslime/internal/storage/paths"
	pwasettingsstore "alslime/internal/storage/pwasettings"
)

func TestService_CheckAndUpdate_30日以上なら取得して保存する(t *testing.T) {
	root := t.TempDir()
	resolver := paths.NewResolver(root)
	calendarStore := calendarstore.New(resolver, config.CalendarFile)
	settingsStore := globalsettingsstore.New(resolver)
	pwaStore := pwasettingsstore.New(resolver, config.PWASettingsFile)
	enableHolidayCalendar(t, pwaStore, config.I18NDefaultLang)
	now := time.Date(2026, 6, 30, 12, 0, 0, 0, time.UTC)

	called := 0
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called++
		w.Header().Set(config.HTTPHeaderContentType, config.MediaTypeJSONUTF8)
		_, _ = w.Write([]byte(`{"2026-01-01":"元日"}`))
	}))
	defer api.Close()

	svc := New(calendarStore, settingsStore, pwaStore)
	svc.apiURL = api.URL
	svc.now = func() time.Time { return now }
	svc.client = api.Client()

	if err := svc.CheckAndUpdate(context.Background()); err != nil {
		t.Fatalf("CheckAndUpdate failed: %v", err)
	}
	if called != 1 {
		t.Fatalf("called=%d want=1", called)
	}
	got, err := calendarStore.HolidayName(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("HolidayName failed: %v", err)
	}
	if got != "元日" {
		t.Fatalf("holiday=%q want=%q", got, "元日")
	}
	settings, err := settingsStore.Load()
	if err != nil {
		t.Fatalf("settings load failed: %v", err)
	}
	if settings[calendarLastUpdateKey] == "" {
		t.Fatalf("calendarLastUpdate が保存されていない: %#v", settings)
	}
	assertFileExists(t, filepath.Join(root, filepath.FromSlash(config.CalendarLogFile)))
}

func TestService_CheckAndUpdate_30日未満なら取得しない(t *testing.T) {
	root := t.TempDir()
	resolver := paths.NewResolver(root)
	calendarStore := calendarstore.New(resolver, config.CalendarFile)
	settingsStore := globalsettingsstore.New(resolver)
	pwaStore := pwasettingsstore.New(resolver, config.PWASettingsFile)
	enableHolidayCalendar(t, pwaStore, config.I18NDefaultLang)
	now := time.Date(2026, 6, 30, 12, 0, 0, 0, time.UTC)
	if _, err := settingsStore.Merge(map[string]any{
		calendarLastUpdateKey: now.Add(-10 * 24 * time.Hour).Format(time.RFC3339Nano),
	}); err != nil {
		t.Fatalf("settings save failed: %v", err)
	}

	called := 0
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called++
		_, _ = w.Write([]byte(`{}`))
	}))
	defer api.Close()

	svc := New(calendarStore, settingsStore, pwaStore)
	svc.apiURL = api.URL
	svc.now = func() time.Time { return now }
	svc.client = api.Client()

	if err := svc.CheckAndUpdate(context.Background()); err != nil {
		t.Fatalf("CheckAndUpdate failed: %v", err)
	}
	if called != 0 {
		t.Fatalf("called=%d want=0", called)
	}
}

func TestService_CheckAndUpdate_設定OFFなら取得しない(t *testing.T) {
	root := t.TempDir()
	resolver := paths.NewResolver(root)
	calendarStore := calendarstore.New(resolver, config.CalendarFile)
	settingsStore := globalsettingsstore.New(resolver)
	pwaStore := pwasettingsstore.New(resolver, config.PWASettingsFile)

	called := 0
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called++
		_, _ = w.Write([]byte(`{}`))
	}))
	defer api.Close()

	svc := New(calendarStore, settingsStore, pwaStore)
	svc.apiURL = api.URL
	svc.client = api.Client()

	if err := svc.CheckAndUpdate(context.Background()); err != nil {
		t.Fatalf("CheckAndUpdate failed: %v", err)
	}
	if called != 0 {
		t.Fatalf("called=%d want=0", called)
	}
}

func TestService_CheckAndUpdate_日本語以外なら取得しない(t *testing.T) {
	root := t.TempDir()
	resolver := paths.NewResolver(root)
	calendarStore := calendarstore.New(resolver, config.CalendarFile)
	settingsStore := globalsettingsstore.New(resolver)
	pwaStore := pwasettingsstore.New(resolver, config.PWASettingsFile)
	enableHolidayCalendar(t, pwaStore, "en")

	called := 0
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called++
		_, _ = w.Write([]byte(`{}`))
	}))
	defer api.Close()

	svc := New(calendarStore, settingsStore, pwaStore)
	svc.apiURL = api.URL
	svc.client = api.Client()

	if err := svc.CheckAndUpdate(context.Background()); err != nil {
		t.Fatalf("CheckAndUpdate failed: %v", err)
	}
	if called != 0 {
		t.Fatalf("called=%d want=0", called)
	}
}

func TestService_HolidayName_設定OFFなら空文字(t *testing.T) {
	root := t.TempDir()
	resolver := paths.NewResolver(root)
	calendarStore := calendarstore.New(resolver, config.CalendarFile)
	settingsStore := globalsettingsstore.New(resolver)
	pwaStore := pwasettingsstore.New(resolver, config.PWASettingsFile)
	if err := calendarStore.SaveAll(map[string]string{"2026-01-01": "元日"}); err != nil {
		t.Fatalf("calendar save failed: %v", err)
	}

	svc := New(calendarStore, settingsStore, pwaStore)
	got, err := svc.HolidayName(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("HolidayName failed: %v", err)
	}
	if got != "" {
		t.Fatalf("got=%q want empty", got)
	}
}

func assertFileExists(t *testing.T, path string) {
	t.Helper()
	if _, err := filepath.Abs(path); err != nil {
		t.Fatalf("invalid path: %v", err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("file does not exist: %s: %v", path, err)
	}
}

func enableHolidayCalendar(t *testing.T, store *pwasettingsstore.Store, lang string) {
	t.Helper()
	if _, err := store.Merge(map[string]any{
		"uiLanguage":             lang,
		"holidayCalendarEnabled": true,
	}); err != nil {
		t.Fatalf("enable holiday calendar failed: %v", err)
	}
}
