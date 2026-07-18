package ssrpsettings

import (
	"testing"
	"time"

	"alslime/internal/storage/paths"
	storage "alslime/internal/storage/ssrpsettings"
)

// newService は一時ワークスペースに紐づく Service を返す。
func newService(t *testing.T) *Service {
	t.Helper()
	root := t.TempDir()
	resolver := paths.NewResolver(root)
	return New(storage.New(resolver))
}

func TestValidLang(t *testing.T) {
	cases := []struct {
		lang string
		want bool
	}{
		{"ja", true},
		{"en", true},
		{"ja-JP", true},
		{"zh_Hant", true},
		{"JA", true},
		{"a", true},
		{"", false},
		{".", false},
		{"..", false},
		{"foo..bar", false}, // ".." を含む
		{"a/b", false},      // パス区切り
		{"a\\b", false},     // Windows 区切り
		{"ja.json", false},  // ドット不可（拡張子は付けない前提）
		{"ja JP", false},    // 空白不可
		{"日本語", false},      // 非 ASCII 不可
		{"a%2e%2e", false},  // パーセントは許可文字外
	}
	for _, c := range cases {
		t.Run(c.lang, func(t *testing.T) {
			if got := validLang(c.lang); got != c.want {
				t.Fatalf("validLang(%q)=%v want=%v", c.lang, got, c.want)
			}
		})
	}
}

func TestValidLang_長さ上限(t *testing.T) {
	ok := make([]byte, maxLangLen)
	for i := range ok {
		ok[i] = 'a'
	}
	if !validLang(string(ok)) {
		t.Fatalf("上限ちょうど(%d文字)は許可すべき", maxLangLen)
	}
	if validLang(string(ok) + "a") {
		t.Fatalf("上限超過(%d文字)は拒否すべき", maxLangLen+1)
	}
}

func TestLanguage_不正コードはErrInvalidLang(t *testing.T) {
	svc := newService(t)
	if _, err := svc.Language("../etc"); err != ErrInvalidLang {
		t.Fatalf("不正コードは ErrInvalidLang を返すべき: err=%v", err)
	}
}

func TestSaveReplacementConfig_lastModifiedをサーバーで上書き(t *testing.T) {
	svc := newService(t)

	// クライアントが古い・空の lastModified を送ってきた状況を再現する。
	before := time.Now().UTC()
	if err := svc.SaveReplacementConfig(map[string]any{
		"version":      "2.0",
		"replacements": []any{},
		"lastModified": "1999-01-01T00:00:00.000Z",
	}); err != nil {
		t.Fatalf("保存失敗: %v", err)
	}
	after := time.Now().UTC()

	got, err := svc.ReplacementConfig()
	if err != nil {
		t.Fatalf("読み込み失敗: %v", err)
	}

	lm, ok := got["lastModified"].(string)
	if !ok {
		t.Fatalf("lastModified が string でない: %#v", got["lastModified"])
	}
	if lm == "1999-01-01T00:00:00.000Z" {
		t.Fatalf("クライアント値がそのまま残っている: %q", lm)
	}
	// サーバー時刻で上書きされ、保存前後の時刻範囲に収まること。
	parsed, perr := time.Parse(isoMillisUTC, lm)
	if perr != nil {
		t.Fatalf("lastModified が想定形式でない (%q): %v", lm, perr)
	}
	if parsed.Before(before.Add(-time.Second)) || parsed.After(after.Add(time.Second)) {
		t.Fatalf("lastModified がサーバー時刻範囲外: %q", lm)
	}
}

func TestSaveReplacementConfig_nilは空オブジェクト扱い(t *testing.T) {
	svc := newService(t)

	if err := svc.SaveReplacementConfig(nil); err != nil {
		t.Fatalf("nil 保存でエラー: %v", err)
	}
	got, err := svc.ReplacementConfig()
	if err != nil {
		t.Fatalf("読み込み失敗: %v", err)
	}
	// nil でも lastModified だけは付与されて保存される。
	if _, ok := got["lastModified"].(string); !ok {
		t.Fatalf("nil 保存時も lastModified が付くべき: %#v", got)
	}
}
