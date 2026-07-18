package serversettings

import (
	"errors"
	"testing"

	"alslime/internal/config"
	"alslime/internal/storage/paths"
	storage "alslime/internal/storage/serversettings"
)

func TestGet_未作成なら既定値を返す(t *testing.T) {
	service := newTestService(t)

	got, err := service.Get()
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if got.Port != config.DefaultPort {
		t.Fatalf("port default mismatch: %d", got.Port)
	}
	if got.BindAddress != config.DefaultHost {
		t.Fatalf("bindAddress default mismatch: %q", got.BindAddress)
	}
	if got.LANPublic {
		t.Fatal("lanPublic default should be false")
	}
}

func TestUpdate_部分更新して保存できる(t *testing.T) {
	service := newTestService(t)
	port := 3100
	bindAddress := "0.0.0.0"
	lanPublic := true

	got, err := service.Update(Patch{
		Port:        &port,
		BindAddress: &bindAddress,
		LANPublic:   &lanPublic,
	})
	if err != nil {
		t.Fatalf("Update failed: %v", err)
	}
	if got.Port != port || got.BindAddress != bindAddress || got.LANPublic != lanPublic {
		t.Fatalf("updated settings mismatch: %#v", got)
	}

	loaded, err := service.Get()
	if err != nil {
		t.Fatalf("Get after update failed: %v", err)
	}
	if loaded != got {
		t.Fatalf("saved settings mismatch: got=%#v loaded=%#v", got, loaded)
	}
}

func TestUpdate_LANPublicは既定BindAddressを全IFへ補正する(t *testing.T) {
	service := newTestService(t)
	lanPublic := true

	got, err := service.Update(Patch{LANPublic: &lanPublic})
	if err != nil {
		t.Fatalf("Update failed: %v", err)
	}
	if got.BindAddress != config.DefaultLANHost {
		t.Fatalf("bindAddress should become LAN host: %q", got.BindAddress)
	}
}

func TestUpdate_不正なポートを拒否する(t *testing.T) {
	service := newTestService(t)
	port := 70000

	if _, err := service.Update(Patch{Port: &port}); !errors.Is(err, ErrInvalidPort) {
		t.Fatalf("expected ErrInvalidPort, got %v", err)
	}
}

func TestUpdate_危険なBindAddressを拒否する(t *testing.T) {
	service := newTestService(t)
	bindAddress := "../bad"

	if _, err := service.Update(Patch{BindAddress: &bindAddress}); !errors.Is(err, ErrInvalidBindAddress) {
		t.Fatalf("expected ErrInvalidBindAddress, got %v", err)
	}
}

func TestUpdate_CLIPathsを部分更新して保存できる(t *testing.T) {
	service := newTestService(t)
	gemini := "/usr/local/bin/gemini"
	antigravity := "/home/ubuntu/.local/bin/agy"

	got, err := service.Update(Patch{CLIPaths: &CLIPathsPatch{
		Gemini:      &gemini,
		Antigravity: &antigravity,
	}})
	if err != nil {
		t.Fatalf("Update failed: %v", err)
	}
	if got.CLIPaths.Gemini != gemini || got.CLIPaths.Antigravity != antigravity {
		t.Fatalf("cliPaths mismatch: %#v", got.CLIPaths)
	}
	// 触っていない claude は未設定のまま。
	if got.CLIPaths.Claude != "" {
		t.Fatalf("claude should stay unset: %q", got.CLIPaths.Claude)
	}

	loaded, err := service.Get()
	if err != nil {
		t.Fatalf("Get after update failed: %v", err)
	}
	if loaded.CLIPaths != got.CLIPaths {
		t.Fatalf("saved cliPaths mismatch: got=%#v loaded=%#v", got.CLIPaths, loaded.CLIPaths)
	}
}

func TestUpdate_CLIPathsはTrimSpaceされ空文字で未設定へ戻せる(t *testing.T) {
	service := newTestService(t)
	first := "  /usr/local/bin/claude  "
	if _, err := service.Update(Patch{CLIPaths: &CLIPathsPatch{Claude: &first}}); err != nil {
		t.Fatalf("first update failed: %v", err)
	}

	got, err := service.Get()
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if got.CLIPaths.Claude != "/usr/local/bin/claude" {
		t.Fatalf("claude should be trimmed: %q", got.CLIPaths.Claude)
	}

	// 空文字で未設定へ戻す。
	empty := ""
	got2, err := service.Update(Patch{CLIPaths: &CLIPathsPatch{Claude: &empty}})
	if err != nil {
		t.Fatalf("reset update failed: %v", err)
	}
	if got2.CLIPaths.Claude != "" {
		t.Fatalf("claude should be reset to unset: %q", got2.CLIPaths.Claude)
	}
}

func newTestService(t *testing.T) *Service {
	t.Helper()
	return New(storage.New(paths.NewResolver(t.TempDir()), config.ServerSettingsFile))
}
