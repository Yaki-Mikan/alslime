package apiproviders

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"alslime/internal/config"
	"alslime/internal/coreapi"
	apistorage "alslime/internal/storage/apiproviders"
	"alslime/internal/storage/paths"
)

// fakeCascade はカスケード先（usermodels / globalsettings）の記録付きフェイク。
type fakeCascade struct {
	models       []string
	defaultModel string
	// 呼び出し順の記録（順序検証用）。
	calls []string
	// 特定ステップを失敗させる（前方回復の検証用）。
	failRemoveModels bool
}

func (f *fakeCascade) deps() CascadeDeps {
	return CascadeDeps{
		ListUserModelIDsByConnection: func(string) ([]string, error) {
			return append([]string(nil), f.models...), nil
		},
		RemoveUserModelsByConnection: func(string) ([]string, error) {
			f.calls = append(f.calls, "user-models")
			if f.failRemoveModels {
				return nil, errors.New("boom")
			}
			removed := f.models
			f.models = nil
			return removed, nil
		},
		DefaultOpenAICompatModel: func() (string, error) { return f.defaultModel, nil },
		ClearDefaultOpenAICompatModel: func() error {
			f.calls = append(f.calls, "defaults")
			f.defaultModel = ""
			return nil
		},
		ListUserModelConnectionIDs: func() ([]string, error) { return nil, nil },
	}
}

// newTestService は実ファイルストア（TempDir）と決定的 ID 生成器で Service を作る。
func newTestService(t *testing.T, cascade *fakeCascade) (*Service, *paths.Resolver) {
	t.Helper()
	resolver := paths.NewResolver(t.TempDir())
	seq := 0
	idGen := func() string {
		seq++
		return fmt.Sprintf("id%04d", seq)
	}
	if cascade == nil {
		cascade = &fakeCascade{}
	}
	svc := New(
		apistorage.NewMetaStore(resolver),
		apistorage.NewSecretStore(resolver),
		resolver,
		idGen,
		cascade.deps(),
	)
	return svc, resolver
}

func validInput() Input {
	return Input{
		Preset:     PresetOpenRouter,
		Label:      "メイン",
		BaseURL:    "https://openrouter.ai/api/v1",
		AuthScheme: AuthSchemeBearer,
		Enabled:    true,
	}
}

func TestCreate_採番と空指示ファイル生成(t *testing.T) {
	svc, resolver := newTestService(t, nil)
	view, err := svc.Create(validInput(), "sk-or-secret")
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}
	if !strings.HasPrefix(view.ID, "conn-") || !view.HasAPIKey {
		t.Fatalf("view が不正: %+v", view)
	}
	// 接続作成時に ja/en の空指示ファイルが同一操作内で生成される。
	for _, locale := range InstructionLocales {
		abs, err := resolver.ResolveExisting(config.OpenAICompatConnectionPromptFile(view.ID, locale))
		if err != nil {
			t.Fatalf("接続別追加指示 %s が生成されていない: %v", locale, err)
		}
		data, _ := os.ReadFile(abs)
		if len(data) != 0 {
			t.Fatalf("初期値は空のはず: %q", data)
		}
	}
}

func TestList_キー値を返さない(t *testing.T) {
	svc, _ := newTestService(t, nil)
	if _, err := svc.Create(validInput(), "sk-or-LEAKCHECK"); err != nil {
		t.Fatalf("Create failed: %v", err)
	}
	views, err := svc.List()
	if err != nil {
		t.Fatalf("List failed: %v", err)
	}
	raw, err := json.Marshal(views)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}
	// 一覧応答の全走査でキー値が含まれない（hasApiKey の 2 値のみ）。
	if strings.Contains(string(raw), "LEAKCHECK") {
		t.Fatalf("一覧応答へキー値が漏えい: %s", raw)
	}
	if !views[0].HasAPIKey {
		t.Fatalf("hasApiKey が導出されるべき: %+v", views[0])
	}
}

func TestUpdate_APIKeyの3値区別(t *testing.T) {
	svc, _ := newTestService(t, nil)
	created, err := svc.Create(validInput(), "sk-first")
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	// nil = 既存維持。
	view, err := svc.Update(created.ID, validInput(), nil, false)
	if err != nil || !view.HasAPIKey {
		t.Fatalf("nil は維持のはず: %+v err=%v", view, err)
	}
	// 非空 = 上書き（維持されていることは hasApiKey で確認）。
	newKey := "sk-second"
	if view, err = svc.Update(created.ID, validInput(), &newKey, false); err != nil || !view.HasAPIKey {
		t.Fatalf("上書きに失敗: %+v err=%v", view, err)
	}
	// clear = 削除。
	if view, err = svc.Update(created.ID, validInput(), nil, true); err != nil || view.HasAPIKey {
		t.Fatalf("clear で削除されるべき: %+v err=%v", view, err)
	}
	// clear と非空の同時指定は検証エラー。
	conflict := "sk-third"
	if _, err = svc.Update(created.ID, validInput(), &conflict, true); !errors.Is(err, ErrKeyConflict) {
		t.Fatalf("同時指定は ErrKeyConflict のはず: %v", err)
	}
	// 不存在 ID は ErrConnectionNotFound。
	if _, err = svc.Update("conn-missing", validInput(), nil, false); !errors.Is(err, ErrConnectionNotFound) {
		t.Fatalf("不存在は ErrConnectionNotFound のはず: %v", err)
	}
}

func TestDelete_カスケード順序と前方回復(t *testing.T) {
	cascade := &fakeCascade{}
	svc, resolver := newTestService(t, cascade)
	created, err := svc.Create(validInput(), "sk-x")
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}
	modelID := "openai_compat:" + created.ID + "/deepseek/deepseek-chat"
	cascade.models = []string{modelID}
	cascade.defaultModel = modelID

	// dryRun は列挙のみ（実削除しない）。
	dryRun, err := svc.DryRunDelete(created.ID)
	if err != nil {
		t.Fatalf("DryRunDelete failed: %v", err)
	}
	if len(dryRun.UserModels) != 1 || !dryRun.IsDefaultModel || !dryRun.DeletesConnectionPrompts {
		t.Fatalf("dryRun 列挙が不正: %+v", dryRun)
	}
	if _, ok, _ := svc.Get(created.ID); !ok {
		t.Fatalf("dryRun で実削除されてはならない")
	}

	// ステップ2（user-models）で失敗させ、診断エラーと前方回復を確認する。
	cascade.failRemoveModels = true
	_, err = svc.Delete(created.ID)
	var cascadeErr *CascadeError
	if !errors.As(err, &cascadeErr) || cascadeErr.Step != 2 || cascadeErr.Total != cascadeTotalSteps {
		t.Fatalf("ステップ番号付き診断エラーのはず: %v", err)
	}
	// 参照を先に消す順序: defaults がステップ1で完了している。
	if len(cascade.calls) == 0 || cascade.calls[0] != "defaults" {
		t.Fatalf("defaults 解除が先行するべき: %v", cascade.calls)
	}
	if _, ok, _ := svc.Get(created.ID); !ok {
		t.Fatalf("途中失敗では meta が残るべき（完全成立の印）")
	}

	// 再実行（同じ削除要求）で残りが完了する（冪等・前方回復）。
	cascade.failRemoveModels = false
	if _, err = svc.Delete(created.ID); err != nil {
		t.Fatalf("再実行で完了するべき: %v", err)
	}
	if _, ok, _ := svc.Get(created.ID); ok {
		t.Fatalf("meta が削除されるべき")
	}
	if has, _ := svc.secrets.HasAPIKey(created.ID); has {
		t.Fatalf("secret が削除されるべき")
	}
	if _, err := resolver.ResolveExisting(config.OpenAICompatConnectionPromptDir(created.ID)); err == nil {
		t.Fatalf("接続別追加指示ディレクトリが削除されるべき")
	}
}

func TestStartupCheck_孤児回収と欠落再生成(t *testing.T) {
	cascade := &fakeCascade{}
	svc, resolver := newTestService(t, cascade)
	created, err := svc.Create(validInput(), "")
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	// 孤児 secret（meta に無い ID）と孤児指示ディレクトリを仕込む。
	if err := svc.secrets.Set("conn-orphan", apistorage.ConnectionSecret{APIKey: "sk-orphan"}); err != nil {
		t.Fatalf("孤児 secret の準備に失敗: %v", err)
	}
	orphanDir, err := resolver.ResolveForCreateMkdirAll(config.OpenAICompatConnectionPromptFile("conn-ghost", "ja"), config.DirPerm)
	if err != nil {
		t.Fatalf("孤児指示の準備に失敗: %v", err)
	}
	if err := os.WriteFile(orphanDir, []byte("ghost"), config.FilePerm); err != nil {
		t.Fatalf("孤児指示の書き込みに失敗: %v", err)
	}
	// 実在接続の en 指示を欠落させる。
	enAbs, err := resolver.ResolveExisting(config.OpenAICompatConnectionPromptFile(created.ID, "en"))
	if err != nil {
		t.Fatalf("en 指示の解決に失敗: %v", err)
	}
	if err := os.Remove(enAbs); err != nil {
		t.Fatalf("en 指示の削除に失敗: %v", err)
	}
	// ja 指示には本文を入れて、上書きされないことを確認する。
	jaAbs, _ := resolver.ResolveExisting(config.OpenAICompatConnectionPromptFile(created.ID, "ja"))
	if err := os.WriteFile(jaAbs, []byte("編集済み"), config.FilePerm); err != nil {
		t.Fatalf("ja 指示の編集に失敗: %v", err)
	}

	svc.StartupCheck()

	if has, _ := svc.secrets.HasAPIKey("conn-orphan"); has {
		t.Fatalf("孤児 secret は自動削除されるべき")
	}
	if _, err := resolver.ResolveExisting(config.OpenAICompatConnectionPromptDir("conn-ghost")); err == nil {
		t.Fatalf("孤児の接続別追加指示は自動削除されるべき")
	}
	if data, err := os.ReadFile(filepath.Dir(enAbs) + string(os.PathSeparator) + "system.en.md"); err != nil || len(data) != 0 {
		t.Fatalf("欠落した en 指示だけが空で再生成されるべき: data=%q err=%v", data, err)
	}
	if data, _ := os.ReadFile(jaAbs); string(data) != "編集済み" {
		t.Fatalf("既存の ja 指示は上書きされないべき: %q", data)
	}
}

func TestInstruction_保存と検証(t *testing.T) {
	svc, _ := newTestService(t, nil)
	created, err := svc.Create(validInput(), "")
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	// 保存 → 表示名を変更しても同じ Connection ID の本文を読む。
	if err := svc.PutInstruction(created.ID, "ja", "接続固有の指示"); err != nil {
		t.Fatalf("PutInstruction failed: %v", err)
	}
	renamed := validInput()
	renamed.Label = "改名後"
	if _, err := svc.Update(created.ID, renamed, nil, false); err != nil {
		t.Fatalf("Update failed: %v", err)
	}
	if content, err := svc.GetInstruction(created.ID, "ja"); err != nil || content != "接続固有の指示" {
		t.Fatalf("改名後も同じ本文を読むべき: %q err=%v", content, err)
	}
	// 空保存は正常（接続固有指示なしの状態）。
	if err := svc.PutInstruction(created.ID, "ja", ""); err != nil {
		t.Fatalf("空保存は許容されるべき: %v", err)
	}
	// サイズ上限・UTF-8 検証。
	if err := svc.PutInstruction(created.ID, "ja", strings.Repeat("a", config.OpenAICompatInstructionMaxBytes+1)); !errors.Is(err, ErrInstructionTooLarge) {
		t.Fatalf("上限超過は拒否されるべき: %v", err)
	}
	if err := svc.PutInstruction(created.ID, "ja", string([]byte{0xff, 0xfe})); !errors.Is(err, ErrInstructionInvalidUTF8) {
		t.Fatalf("不正 UTF-8 は拒否されるべき: %v", err)
	}
	// locale は ja/en のみ。
	if IsValidInstructionLocale("fr") || !IsValidInstructionLocale("ja") || !IsValidInstructionLocale("en") {
		t.Fatalf("locale 判定が不正")
	}
}

func TestResolveConnectionInfo_失敗契約(t *testing.T) {
	svc, _ := newTestService(t, nil)
	created, err := svc.Create(validInput(), "sk-key")
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	// 正常: プリセット由来の CacheKeyParam が載る。
	info, err := svc.ResolveConnectionInfo(created.ID)
	if err != nil {
		t.Fatalf("ResolveConnectionInfo failed: %v", err)
	}
	if info.APIKey != "sk-key" || info.CacheKeyParam != CacheKeyParamSessionID {
		t.Fatalf("info が不正: %+v", info)
	}

	assertFailure := func(id, wantType string) {
		t.Helper()
		_, err := svc.ResolveConnectionInfo(id)
		var pf *coreapi.ProviderFailure
		if !errors.As(err, &pf) || pf.Type != wantType || pf.MessageKey == "" {
			t.Fatalf("ProviderFailure(%s) のはず: %v", wantType, err)
		}
	}
	// 不存在。
	assertFailure("conn-missing", coreapi.APIErrorConnectionUnavailable)
	// 無効（Enabled=false）。
	disabled := validInput()
	disabled.Enabled = false
	if _, err := svc.Update(created.ID, disabled, nil, false); err != nil {
		t.Fatalf("無効化に失敗: %v", err)
	}
	assertFailure(created.ID, coreapi.APIErrorConnectionUnavailable)
	// キー未設定（AuthScheme≠none）。
	enabled := validInput()
	if _, err := svc.Update(created.ID, enabled, nil, true); err != nil {
		t.Fatalf("キー削除に失敗: %v", err)
	}
	assertFailure(created.ID, coreapi.APIErrorKeyMissing)
	// AuthScheme=none はキー未設定でも解決できる。
	noneInput := validInput()
	noneInput.AuthScheme = AuthSchemeNone
	if _, err := svc.Update(created.ID, noneInput, nil, false); err != nil {
		t.Fatalf("none への更新に失敗: %v", err)
	}
	if _, err := svc.ResolveConnectionInfo(created.ID); err != nil {
		t.Fatalf("none はキー未設定でも解決できるべき: %v", err)
	}
}

func TestPutInstruction_削除済み接続を再作成しない(t *testing.T) {
	cascade := &fakeCascade{}
	svc, resolver := newTestService(t, cascade)
	created, err := svc.Create(validInput(), "")
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}
	if _, err := svc.Delete(created.ID); err != nil {
		t.Fatalf("Delete failed: %v", err)
	}

	// 削除カスケードと同じ排他内で実在を再確認するため、削除済み接続への
	// 指示保存は拒否され、指示ディレクトリが再作成されない。
	if err := svc.PutInstruction(created.ID, "ja", "ghost"); !errors.Is(err, ErrConnectionNotFound) {
		t.Fatalf("削除済み接続への保存は拒否されるべき: %v", err)
	}
	if _, err := resolver.ResolveExisting(config.OpenAICompatConnectionPromptDir(created.ID)); err == nil {
		t.Fatalf("削除済み接続の指示ディレクトリが再作成された")
	}
}

func TestCreateUpdateDelete_直列化(t *testing.T) {
	svc, _ := newTestService(t, nil)
	// 並行する作成要求が mutex で直列化され、全件が採番衝突なく成立すること。
	const n = 8
	var wg sync.WaitGroup
	errs := make([]error, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, errs[i] = svc.Create(validInput(), "")
		}(i)
	}
	wg.Wait()
	for i, err := range errs {
		if err != nil {
			t.Fatalf("並行作成 %d が失敗: %v", i, err)
		}
	}
	views, err := svc.List()
	if err != nil || len(views) != n {
		t.Fatalf("全件成立するべき: %d err=%v", len(views), err)
	}
}
