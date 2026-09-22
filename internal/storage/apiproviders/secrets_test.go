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

func TestSecretStore_順に更新する別ストアの変更を取り込んでから書く(t *testing.T) {
	// 同じファイルを別々のストアが順に更新する状況（同時ではない）で、古いキャッシュで
	// 相手の変更を上書きしないことを確かめる。同時保存の排他は担わない（画像生成トークンは
	// 別ファイルに分けて書込元を一つにしている）。
	resolver := paths.NewResolver(t.TempDir())
	first := NewSecretStore(resolver)
	second := NewSecretStore(resolver)

	// 両方が先に読み込む（キャッシュを持つ）。
	if _, err := first.IDs(); err != nil {
		t.Fatal(err)
	}
	if _, err := second.IDs(); err != nil {
		t.Fatal(err)
	}
	if err := first.Set("conn-a", ConnectionSecret{APIKey: "sk-a"}); err != nil {
		t.Fatal(err)
	}
	if err := second.Set("conn-b", ConnectionSecret{APIKey: "sk-b"}); err != nil {
		t.Fatal(err)
	}
	reloaded := NewSecretStore(resolver)
	for _, id := range []string{"conn-a", "conn-b"} {
		if has, _ := reloaded.HasAPIKey(id); !has {
			t.Fatalf("順に更新した相手のキーが消えている: %s", id)
		}
	}
	// 古いキャッシュを持つ側からも、相手の保存が見える。
	if has, _ := first.HasAPIKey("conn-b"); !has {
		t.Fatal("相手の更新が見えない")
	}
	// 削除も取り込む（削除済みのキーが古いキャッシュで復活しない）。
	if err := first.Delete("conn-a"); err != nil {
		t.Fatal(err)
	}
	if err := second.Set("conn-c", ConnectionSecret{APIKey: "sk-c"}); err != nil {
		t.Fatal(err)
	}
	if has, _ := NewSecretStore(resolver).HasAPIKey("conn-a"); has {
		t.Fatal("削除済みのキーが古いキャッシュで復活している")
	}
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
