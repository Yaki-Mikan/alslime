package presets

import (
	"errors"
	"testing"
	"time"

	"alslime/internal/storage/paths"
	"alslime/internal/storage/presetstore"
)

const baseDir = "roleplay/global/presets/SSRP_Mode"

func newService(t *testing.T, meta MetaPolicy) *Service {
	t.Helper()
	root := t.TempDir()
	resolver := paths.NewResolver(root)
	return New(presetstore.New(resolver, baseDir), meta)
}

// getMap は Get の結果を map として取り出すテスト用ヘルパ。
// service の Get は契約上 (正本名, any, err) を返すが、ディレクトリ列挙型の data は常に map。
func getMap(t *testing.T, svc *Service, name string) map[string]any {
	t.Helper()
	_, v, err := svc.Get(name)
	if err != nil {
		t.Fatalf("取得失敗: %v", err)
	}
	m, ok := v.(map[string]any)
	if !ok {
		t.Fatalf("Get の結果が map ではない: %#v", v)
	}
	return m
}

func TestSave_MetaNone_メタを付与しない(t *testing.T) {
	svc := newService(t, MetaNone)
	if _, err := svc.Save("preset", map[string]any{"v": 1.0}); err != nil {
		t.Fatalf("保存失敗: %v", err)
	}
	got := getMap(t, svc, "preset")
	if _, ok := got[keyCreatedAt]; ok {
		t.Fatalf("MetaNone では createdAt を付与しないべき: %#v", got)
	}
	if _, ok := got[keyUpdatedAt]; ok {
		t.Fatalf("MetaNone では updatedAt を付与しないべき: %#v", got)
	}
}

func TestSave_MetaTimestamps_新規でcreatedAtとupdatedAtを付与(t *testing.T) {
	svc := newService(t, MetaTimestamps)

	before := time.Now().UTC()
	// クライアントが嘘の createdAt/updatedAt を送ってきても盲信しない。
	if _, err := svc.Save("preset", map[string]any{
		"v":         1.0,
		"createdAt": "1999-01-01T00:00:00.000Z",
		"updatedAt": "1999-01-01T00:00:00.000Z",
	}); err != nil {
		t.Fatalf("保存失敗: %v", err)
	}
	after := time.Now().UTC()

	got := getMap(t, svc, "preset")
	created, _ := got[keyCreatedAt].(string)
	updated, _ := got[keyUpdatedAt].(string)
	if created == "1999-01-01T00:00:00.000Z" || updated == "1999-01-01T00:00:00.000Z" {
		t.Fatalf("クライアント値が残っている: created=%q updated=%q", created, updated)
	}
	assertWithin(t, created, before, after)
	assertWithin(t, updated, before, after)
}

func TestSave_MetaTimestamps_createdAtは維持しupdatedAtのみ更新(t *testing.T) {
	svc := newService(t, MetaTimestamps)

	// 1 回目の保存。
	if _, err := svc.Save("preset", map[string]any{"v": 1.0}); err != nil {
		t.Fatalf("初回保存失敗: %v", err)
	}
	first := getMap(t, svc, "preset")
	firstCreated, _ := first[keyCreatedAt].(string)
	firstUpdated, _ := first[keyUpdatedAt].(string)

	// 時刻が進んだことを保証するため、now を固定で進める。
	svc.now = func() time.Time { return time.Now().Add(2 * time.Second) }

	// 2 回目の保存（上書き更新）。
	if _, err := svc.Save("preset", map[string]any{"v": 2.0}); err != nil {
		t.Fatalf("再保存失敗: %v", err)
	}
	second := getMap(t, svc, "preset")
	secondCreated, _ := second[keyCreatedAt].(string)
	secondUpdated, _ := second[keyUpdatedAt].(string)

	if secondCreated != firstCreated {
		t.Fatalf("createdAt は維持されるべき: first=%q second=%q", firstCreated, secondCreated)
	}
	if secondUpdated == firstUpdated {
		t.Fatalf("updatedAt は更新されるべき: first=%q second=%q", firstUpdated, secondUpdated)
	}
}

func TestGet_存在しないものはErrNotFound(t *testing.T) {
	svc := newService(t, MetaNone)
	if _, _, err := svc.Get("無い"); !errors.Is(err, presetstore.ErrNotFound) {
		t.Fatalf("存在しない Get は ErrNotFound: %v", err)
	}
}

func TestSave_正規化名を返す(t *testing.T) {
	svc := newService(t, MetaNone)

	// 前後に ASCII 空白を含む名前で保存すると、正本名（trim 後）が返る（燈レビュー指摘2）。
	saved, err := svc.Save("  夜の設定  ", map[string]any{"v": 1.0})
	if err != nil {
		t.Fatalf("保存失敗: %v", err)
	}
	if saved != "夜の設定" {
		t.Fatalf("正規化名を返すべき: got=%q want=夜の設定", saved)
	}
	// 正本名で取得できること（化け名で保存されていない）。
	if _, _, err := svc.Get("夜の設定"); err != nil {
		t.Fatalf("正本名で取得できるべき: %v", err)
	}
}

func TestGet_正規化名を返す(t *testing.T) {
	svc := newService(t, MetaNone)
	if _, err := svc.Save("夜の設定", map[string]any{"v": 1.0}); err != nil {
		t.Fatalf("保存失敗: %v", err)
	}
	// 前後空白付きで取得しても、正本名（trim 後）が返る（燈レビュー対応確認）。
	normalized, _, err := svc.Get("  夜の設定  ")
	if err != nil {
		t.Fatalf("取得失敗: %v", err)
	}
	if normalized != "夜の設定" {
		t.Fatalf("Get は正規化名を返すべき: got=%q", normalized)
	}
}

func TestSave_不正名はエラーを返す(t *testing.T) {
	svc := newService(t, MetaNone)
	if _, err := svc.Save("../etc", map[string]any{"v": 1.0}); err == nil {
		t.Fatalf("不正名の Save はエラーを返すべき")
	}
}

// assertWithin は ts が [before-1s, after+1s] の範囲に収まることを検証する。
func assertWithin(t *testing.T, ts string, before, after time.Time) {
	t.Helper()
	parsed, err := time.Parse(isoMillisUTC, ts)
	if err != nil {
		t.Fatalf("時刻形式が想定外 (%q): %v", ts, err)
	}
	if parsed.Before(before.Add(-time.Second)) || parsed.After(after.Add(time.Second)) {
		t.Fatalf("時刻がサーバー範囲外: %q", ts)
	}
}
