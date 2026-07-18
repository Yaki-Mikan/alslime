package pwasettings

import (
	"context"
	"testing"

	"alslime/internal/config"
	"alslime/internal/storage/paths"
	storage "alslime/internal/storage/pwasettings"
)

func TestService_Update_OFFからONでCalendarUpdaterを呼ぶ(t *testing.T) {
	store := storage.New(paths.NewResolver(t.TempDir()), config.PWASettingsFile)
	updater := &fakeCalendarUpdater{}
	svc := New(store).WithCalendarUpdater(updater)

	got, err := svc.Update(map[string]any{
		"uiLanguage":             config.I18NDefaultLang,
		"holidayCalendarEnabled": true,
	})
	if err != nil {
		t.Fatalf("Update failed: %v", err)
	}
	if got["holidayCalendarEnabled"] != true {
		t.Fatalf("holidayCalendarEnabled mismatch: %#v", got["holidayCalendarEnabled"])
	}
	if updater.called != 1 {
		t.Fatalf("called=%d want=1", updater.called)
	}
}

func TestService_Update_日本語以外なら祝日機能をOFFにする(t *testing.T) {
	store := storage.New(paths.NewResolver(t.TempDir()), config.PWASettingsFile)
	updater := &fakeCalendarUpdater{}
	svc := New(store).WithCalendarUpdater(updater)

	got, err := svc.Update(map[string]any{
		"uiLanguage":             "en",
		"holidayCalendarEnabled": true,
	})
	if err != nil {
		t.Fatalf("Update failed: %v", err)
	}
	if got["holidayCalendarEnabled"] != false {
		t.Fatalf("holidayCalendarEnabled mismatch: %#v", got["holidayCalendarEnabled"])
	}
	if updater.called != 0 {
		t.Fatalf("called=%d want=0", updater.called)
	}
}

type fakeCalendarUpdater struct {
	called int
}

func (f *fakeCalendarUpdater) CheckAndUpdate(context.Context) error {
	f.called++
	return nil
}
