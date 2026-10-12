package ssrpsettings

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"alslime/internal/config"
	"alslime/internal/i18n"
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

// relationValues は関係性オプションの value を並び順どおりに取り出す。
func relationValues(t *testing.T, options []any) []string {
	t.Helper()
	values := make([]string, 0, len(options))
	for _, option := range options {
		m, ok := option.(map[string]any)
		if !ok {
			t.Fatalf("関係性オプションの形が不正: %#v", option)
		}
		value, _ := m["value"].(string)
		if label, _ := m["label"].(string); label != value {
			t.Fatalf("初期の選択肢は表示名と値が同じであるべき: %#v", m)
		}
		values = append(values, value)
	}
	return values
}

func TestRelationships_ファイルが無ければ表示言語の名前を表示名と値に使う(t *testing.T) {
	svc := newService(t).WithMessages(func() map[string]string {
		return i18n.BuiltinMessages("en")
	})
	got, err := svc.Relationships()
	if err != nil {
		t.Fatalf("読み込み失敗: %v", err)
	}
	want := []string{"Biological mother", "Stepmother", "Friend", "Lover", "Other"}
	if values := relationValues(t, got); !reflect.DeepEqual(values, want) {
		t.Fatalf("初期の選択肢 = %v, want %v", values, want)
	}
}

func TestRelationships_辞書が無ければ日本語の既定を使う(t *testing.T) {
	got, err := newService(t).Relationships()
	if err != nil {
		t.Fatalf("読み込み失敗: %v", err)
	}
	want := []string{"実母", "義母", "友人", "恋人", "その他"}
	if values := relationValues(t, got); !reflect.DeepEqual(values, want) {
		t.Fatalf("初期の選択肢 = %v, want %v", values, want)
	}
}

func TestRelationships_ファイルがあれば表示言語に関係なくその内容を返す(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, filepath.FromSlash(config.RelationOptionsFile))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(`[{"label":"幼馴染","value":"幼馴染"}]`), 0o644); err != nil {
		t.Fatal(err)
	}
	svc := New(storage.New(paths.NewResolver(root))).WithMessages(func() map[string]string {
		return i18n.BuiltinMessages("en")
	})
	got, err := svc.Relationships()
	if err != nil {
		t.Fatalf("読み込み失敗: %v", err)
	}
	if values := relationValues(t, got); !reflect.DeepEqual(values, []string{"幼馴染"}) {
		t.Fatalf("ファイルの内容 = %v, want [幼馴染]", values)
	}
}
