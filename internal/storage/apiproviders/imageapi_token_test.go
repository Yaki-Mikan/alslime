package apiproviders

import (
	"sync"
	"testing"

	"alslime/internal/storage/paths"
)

func TestImageAPITokenStore_保存と取得と削除(t *testing.T) {
	resolver := paths.NewResolver(t.TempDir())
	store := NewImageAPITokenStore(resolver)
	if _, ok, err := store.Get("novelai"); err != nil || ok {
		t.Fatalf("未保存は ok=false のはず: ok=%v err=%v", ok, err)
	}
	if err := store.Set("novelai", " pst-x "); err != nil {
		t.Fatal(err)
	}
	if token, ok, _ := store.Get("novelai"); !ok || token != "pst-x" {
		t.Fatalf("保存したトークンが読めない: %q %v", token, ok)
	}
	// 新しい置き場（別インスタンス）からも読める。
	if token, ok, _ := NewImageAPITokenStore(resolver).Get("novelai"); !ok || token != "pst-x" {
		t.Fatalf("別インスタンスから読めない: %q %v", token, ok)
	}
	if err := store.Set("novelai", ""); err != nil {
		t.Fatal(err)
	}
	if _, ok, _ := NewImageAPITokenStore(resolver).Get("novelai"); ok {
		t.Fatal("空で保存したら削除されるはず")
	}
}

func TestImageAPITokenStore_旧配置のトークンを読んで移す(t *testing.T) {
	resolver := paths.NewResolver(t.TempDir())
	legacy := NewSecretStore(resolver)
	if err := legacy.Set(imageAPITokenID("novelai"), ConnectionSecret{APIKey: "pst-old"}); err != nil {
		t.Fatal(err)
	}
	store := NewImageAPITokenStore(resolver)
	if token, ok, err := store.Get("novelai"); err != nil || !ok || token != "pst-old" {
		t.Fatalf("旧配置のトークンが読めない: %q %v %v", token, ok, err)
	}
	// 移した後は自分のファイルから読む（旧配置を消しても残る）。
	if err := legacy.Delete(imageAPITokenID("novelai")); err != nil {
		t.Fatal(err)
	}
	if token, ok, _ := NewImageAPITokenStore(resolver).Get("novelai"); !ok || token != "pst-old" {
		t.Fatalf("移したトークンが残っていない: %q %v", token, ok)
	}
	// 削除後は旧配置に値が残っていても復活しない。
	if err := legacy.Set(imageAPITokenID("novelai"), ConnectionSecret{APIKey: "pst-old"}); err != nil {
		t.Fatal(err)
	}
	if err := store.Delete("novelai"); err != nil {
		t.Fatal(err)
	}
	if _, ok, _ := NewImageAPITokenStore(resolver).Get("novelai"); ok {
		t.Fatal("削除後に旧配置の値で復活してはならない")
	}
}

func TestImageAPITokenStore_接続先の秘密ストアと同時に書いても互いに消えない(t *testing.T) {
	// 本体（接続先の秘密情報）と画像生成モジュール（トークン）は別ファイルへ書くため、
	// 同時に保存しても相手の更新を消さない。
	resolver := paths.NewResolver(t.TempDir())
	const rounds = 40
	for i := 0; i < rounds; i++ {
		main := NewSecretStore(resolver)
		module := NewImageAPITokenStore(resolver)
		var wg sync.WaitGroup
		wg.Add(2)
		var mainErr, moduleErr error
		go func() {
			defer wg.Done()
			mainErr = main.Set("conn-"+itoa(i), ConnectionSecret{APIKey: "sk-" + itoa(i)})
		}()
		go func() {
			defer wg.Done()
			moduleErr = module.Set("svc-"+itoa(i), "pst-"+itoa(i))
		}()
		wg.Wait()
		if mainErr != nil || moduleErr != nil {
			t.Fatalf("round %d: main=%v module=%v", i, mainErr, moduleErr)
		}
	}
	secrets := NewSecretStore(resolver)
	tokens := NewImageAPITokenStore(resolver)
	for i := 0; i < rounds; i++ {
		if has, _ := secrets.HasAPIKey("conn-" + itoa(i)); !has {
			t.Fatalf("接続先のキーが消えている: conn-%d", i)
		}
		if token, ok, _ := tokens.Get("svc-" + itoa(i)); !ok || token != "pst-"+itoa(i) {
			t.Fatalf("トークンが消えている: svc-%d (%q %v)", i, token, ok)
		}
	}
}

func itoa(i int) string {
	const digits = "0123456789"
	if i == 0 {
		return "0"
	}
	out := ""
	for i > 0 {
		out = string(digits[i%10]) + out
		i /= 10
	}
	return out
}
