package cliexecutable

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"alslime/internal/config"
	serversettingssvc "alslime/internal/domain/serversettings"
	"alslime/internal/storage/locations"
	"alslime/internal/storage/paths"
	serversettingsstore "alslime/internal/storage/serversettings"
	"alslime/internal/system/cliresolve"
)

// newSettings は一時ワークスペースの server-settings を読む Service を返す。
// antigravity が空でなければ cliPaths.antigravity として保存する。
func newSettings(t *testing.T, antigravity string) *serversettingssvc.Service {
	t.Helper()
	root := t.TempDir()
	svc := serversettingssvc.New(serversettingsstore.New(paths.NewResolver(root), locations.NewResolver().MustPath(locations.ServerSettingsFile)))
	if antigravity != "" {
		if _, err := svc.Update(serversettingssvc.Patch{CLIPaths: &serversettingssvc.CLIPathsPatch{Antigravity: &antigravity}}); err != nil {
			t.Fatal(err)
		}
	}
	return svc
}

// makeExecutable は dir に実行可能なファイルを作り、その絶対パスを返す。
func makeExecutable(t *testing.T, dir, base string) string {
	t.Helper()
	name := base
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte("x"), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestAntigravity_設定パスを最優先で使う(t *testing.T) {
	configured := makeExecutable(t, t.TempDir(), "agy-configured")
	t.Setenv(config.EnvAntigravityPath, makeExecutable(t, t.TempDir(), "agy-env"))
	got, err := Antigravity(newSettings(t, configured))()
	if err != nil || got != configured {
		t.Fatalf("expected %s, got %q (%v)", configured, got, err)
	}
}

func TestAntigravity_設定パスが存在しなければ他へ切り替えず失敗する(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "missing", "agy.exe")
	t.Setenv(config.EnvAntigravityPath, makeExecutable(t, t.TempDir(), "agy-env"))
	got, err := Antigravity(newSettings(t, missing))()
	if !errors.Is(err, cliresolve.ErrConfiguredPathInvalid) || got != "" {
		t.Fatalf("expected ErrConfiguredPathInvalid, got %q (%v)", got, err)
	}
}

func TestAntigravity_設定が空ならAGY_PATHを使う(t *testing.T) {
	envPath := makeExecutable(t, t.TempDir(), "agy-env")
	t.Setenv(config.EnvAntigravityPath, envPath)
	got, err := Antigravity(newSettings(t, ""))()
	if err != nil || got != envPath {
		t.Fatalf("expected %s, got %q (%v)", envPath, got, err)
	}
}

func TestAntigravity_設定とAGY_PATHが空ならOSの既定候補を使う(t *testing.T) {
	t.Setenv(config.EnvAntigravityPath, "")
	var want string
	if runtime.GOOS == "windows" {
		home := t.TempDir()
		t.Setenv("USERPROFILE", home)
		want = makeExecutable(t, filepath.Join(home, "AppData", "Local", "agy", "bin"), "agy")
	} else {
		bin := t.TempDir()
		t.Setenv("PATH", bin)
		want = makeExecutable(t, bin, "agy")
	}
	for name, svc := range map[string]*serversettingssvc.Service{
		"設定ファイル無し":  newSettings(t, ""),
		"Service無し": nil,
	} {
		t.Run(name, func(t *testing.T) {
			got, err := Antigravity(svc)()
			if err != nil || got != want {
				t.Fatalf("expected %s, got %q (%v)", want, got, err)
			}
		})
	}
}
