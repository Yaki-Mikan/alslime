package update

import (
	"testing"
	"time"

	"alslime/internal/config"
	"alslime/internal/storage/paths"
	storage "alslime/internal/storage/updatesettings"
)

func newNoticeTestService(t *testing.T) (*Service, *storage.Store) {
	t.Helper()
	store := storage.New(paths.NewResolver(t.TempDir()), config.UpdateSettingsFile)
	svc := New(store)
	svc.now = func() time.Time { return time.Date(2026, 9, 11, 12, 0, 0, 0, time.Local) }
	return svc, store
}

func TestModuleNoticeFlags_本体の後でとスキップはモジュールに波及しない(t *testing.T) {
	svc, _ := newNoticeTestService(t)
	later := true
	skipped := "9.9.9"
	if _, err := svc.UpdateSettings(SettingsPatch{PostponeToday: &later, SkippedVersion: &skipped}); err != nil {
		t.Fatal(err)
	}
	flags, err := svc.ModuleNoticeFlags([]ModuleNoticeQuery{{ID: "tts", Version: "1.2.0"}})
	if err != nil {
		t.Fatal(err)
	}
	if flags["tts"].Skipped || flags["tts"].PostponedToday {
		t.Fatalf("module notice must not be suppressed by app-side records: %+v", flags["tts"])
	}
}

func TestModuleNoticeFlags_モジュールの後では当該IDだけに効き本体へ波及しない(t *testing.T) {
	svc, store := newNoticeTestService(t)
	mods := []string{"tts"}
	if _, err := svc.UpdateSettings(SettingsPatch{PostponeModules: &mods}); err != nil {
		t.Fatal(err)
	}
	flags, err := svc.ModuleNoticeFlags([]ModuleNoticeQuery{{ID: "tts", Version: "1.2.0"}, {ID: "comfy", Version: "2.0.0"}})
	if err != nil {
		t.Fatal(err)
	}
	if !flags["tts"].PostponedToday {
		t.Fatalf("tts should be postponed today: %+v", flags["tts"])
	}
	if flags["comfy"].PostponedToday {
		t.Fatalf("comfy must not be postponed: %+v", flags["comfy"])
	}
	saved, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	if saved.PostponedDate != "" || saved.SkippedVersion != "" {
		t.Fatalf("app-side records must stay untouched: %+v", saved)
	}

	// 翌日になれば当日抑止は解除される。
	svc.now = func() time.Time { return time.Date(2026, 9, 12, 0, 0, 0, 0, time.Local) }
	flags, err = svc.ModuleNoticeFlags([]ModuleNoticeQuery{{ID: "tts", Version: "1.2.0"}})
	if err != nil {
		t.Fatal(err)
	}
	if flags["tts"].PostponedToday {
		t.Fatalf("postpone must expire next day: %+v", flags["tts"])
	}
}

func TestModuleNoticeFlags_スキップは版の組が一致する間だけ効く(t *testing.T) {
	svc, _ := newNoticeTestService(t)
	skip := []ModuleSkipPatch{{ID: "comfy", Version: "2.0.0", CompanionPackVersion: "1.1"}}
	if _, err := svc.UpdateSettings(SettingsPatch{SkipModules: &skip}); err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name string
		q    ModuleNoticeQuery
		want bool
	}{
		{"同一の組", ModuleNoticeQuery{ID: "comfy", Version: "2.0.0", CompanionPackVersion: "1.1"}, true},
		{"exeが上がった", ModuleNoticeQuery{ID: "comfy", Version: "2.1.0", CompanionPackVersion: "1.1"}, false},
		{"パックが上がった", ModuleNoticeQuery{ID: "comfy", Version: "2.0.0", CompanionPackVersion: "1.2"}, false},
		{"別モジュール", ModuleNoticeQuery{ID: "tts", Version: "2.0.0", CompanionPackVersion: "1.1"}, false},
	}
	for _, c := range cases {
		flags, err := svc.ModuleNoticeFlags([]ModuleNoticeQuery{c.q})
		if err != nil {
			t.Fatal(err)
		}
		if flags[c.q.ID].Skipped != c.want {
			t.Errorf("%s: skipped=%v want %v", c.name, flags[c.q.ID].Skipped, c.want)
		}
	}
}

func TestModuleNoticeFlags_記録の無いモジュールは抑止しない(t *testing.T) {
	svc, _ := newNoticeTestService(t)
	flags, err := svc.ModuleNoticeFlags([]ModuleNoticeQuery{{ID: "tts", Version: ""}})
	if err != nil {
		t.Fatal(err)
	}
	if flags["tts"].Skipped || flags["tts"].PostponedToday {
		t.Fatalf("no record must mean no suppression: %+v", flags["tts"])
	}
}
