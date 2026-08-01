package apiproviders

import (
	"os"
	"runtime"
	"testing"

	"alslime/internal/config"
	"alslime/internal/storage/paths"
)

func newSecretStore(t *testing.T) (*SecretStore, *paths.Resolver) {
	t.Helper()
	resolver := paths.NewResolver(t.TempDir())
	return NewSecretStore(resolver), resolver
}

func TestSecretStore_未存在は空として正常(t *testing.T) {
	store, _ := newSecretStore(t)
	if has, err := store.HasAPIKey("conn-x"); err != nil || has {
		t.Fatalf("初回起動は空の正常扱いのはず: has=%v err=%v", has, err)
	}
	ids, err := store.IDs()
	if err != nil || len(ids) != 0 {
		t.Fatalf("空一覧のはず: %v err=%v", ids, err)
	}
}

func TestSecretStore_破損はエラー(t *testing.T) {
	store, resolver := newSecretStore(t)
	abs, err := resolver.ResolveForCreateMkdirAll(config.APIProviderSecretsFile, config.SecretDirPerm)
	if err != nil {
		t.Fatalf("パス解決に失敗: %v", err)
	}
	if err := os.WriteFile(abs, []byte("{broken"), config.SecretFilePerm); err != nil {
		t.Fatalf("破損ファイルの準備に失敗: %v", err)
	}
	// キー消失を「未設定」と誤認させない（エラー返却）。
	if _, err := store.HasAPIKey("conn-x"); err == nil {
		t.Fatalf("破損はエラーのはず")
	}
}

func TestSecretStore_SetGetDelete(t *testing.T) {
	store, resolver := newSecretStore(t)
	if err := store.Set("conn-a", ConnectionSecret{APIKey: "sk-a"}); err != nil {
		t.Fatalf("Set failed: %v", err)
	}
	secret, ok, err := store.Get("conn-a")
	if err != nil || !ok || secret.APIKey != "sk-a" {
		t.Fatalf("Get が不正: %+v ok=%v err=%v", secret, ok, err)
	}
	// 秘密ファイルは所有者限定パーミッションで作成される（Windows ではモードが
	// 意味を持たないため Unix 系でのみ検証）。
	if runtime.GOOS != "windows" {
		abs, _ := resolver.ResolveExisting(config.APIProviderSecretsFile)
		info, err := os.Stat(abs)
		if err != nil || info.Mode().Perm() != config.SecretFilePerm {
			t.Fatalf("0600 で保存されるべき: %v err=%v", info.Mode(), err)
		}
	}
	// Delete は冪等（不存在でも成功）。
	if err := store.Delete("conn-a"); err != nil {
		t.Fatalf("Delete failed: %v", err)
	}
	if err := store.Delete("conn-a"); err != nil {
		t.Fatalf("再 Delete は冪等のはず: %v", err)
	}
	if has, _ := store.HasAPIKey("conn-a"); has {
		t.Fatalf("削除後は未設定のはず")
	}
}

func TestSecretStore_再起動後も読める(t *testing.T) {
	resolver := paths.NewResolver(t.TempDir())
	store := NewSecretStore(resolver)
	if err := store.Set("conn-a", ConnectionSecret{APIKey: "sk-persist"}); err != nil {
		t.Fatalf("Set failed: %v", err)
	}
	// 新しい Store インスタンス（プロセス再起動相当）でファイルから読める。
	reloaded := NewSecretStore(resolver)
	secret, ok, err := reloaded.Get("conn-a")
	if err != nil || !ok || secret.APIKey != "sk-persist" {
		t.Fatalf("再読込に失敗: %+v ok=%v err=%v", secret, ok, err)
	}
}
