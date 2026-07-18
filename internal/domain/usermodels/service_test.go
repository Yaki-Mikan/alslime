package usermodels

import (
	"errors"
	"testing"

	"alslime/internal/domain/models"
	usermodelsstore "alslime/internal/storage/usermodels"
)

type fakeStore struct {
	data  usermodelsstore.Data
	saved *usermodelsstore.Data
}

func (f *fakeStore) Load() (usermodelsstore.Data, error) { return f.data, nil }
func (f *fakeStore) Save(data usermodelsstore.Data) error {
	f.saved = &data
	return nil
}

func TestUpdateValidatesAndNormalizes(t *testing.T) {
	store := &fakeStore{}
	svc := New(store)

	saved, err := svc.Update(usermodelsstore.Data{
		Added: []models.UserModel{
			{ID: "  gemini-4.0-pro  ", Name: " 4.0 Pro "},
			{ID: "flash4-think", GeminiBase: "gemini-4.0-flash", ThinkingLevel: "High"},
		},
		Hidden: []string{"gemini-2.5-flash", "unknown-id", "", "gemini-2.5-flash"},
	})
	if err != nil {
		t.Fatalf("Update failed: %v", err)
	}
	if saved.Added[0].ID != "gemini-4.0-pro" || saved.Added[0].Name != "4.0 Pro" {
		t.Errorf("トリムされていない: %+v", saved.Added[0])
	}
	if saved.Added[1].ThinkingLevel != "high" {
		t.Errorf("thinkingLevel は小文字へ正規化されるはず: %q", saved.Added[1].ThinkingLevel)
	}
	if len(saved.Hidden) != 1 || saved.Hidden[0] != "gemini-2.5-flash" {
		t.Errorf("hidden は内蔵実在 ID のみ・重複除去されるはず: %v", saved.Hidden)
	}
	if store.saved == nil {
		t.Fatal("Save が呼ばれていない")
	}
}

func TestUpdateRejectsInvalid(t *testing.T) {
	svc := New(&fakeStore{})
	cases := []struct {
		name string
		data usermodelsstore.Data
		want error
	}{
		{"空ID", usermodelsstore.Data{Added: []models.UserModel{{ID: "  "}}}, ErrModelIDRequired},
		{"重複", usermodelsstore.Data{Added: []models.UserModel{{ID: "x"}, {ID: "x"}}}, ErrModelIDDuplicate},
		{"内蔵衝突", usermodelsstore.Data{Added: []models.UserModel{{ID: "gemini-2.5-flash"}}}, ErrModelIDConflictsBuiltIn},
		{"Thinking片方", usermodelsstore.Data{Added: []models.UserModel{{ID: "x", GeminiBase: "gemini-3.5-flash"}}}, ErrThinkingPairIncomplete},
		{"Level不正", usermodelsstore.Data{Added: []models.UserModel{{ID: "x", GeminiBase: "gemini-3.5-flash", ThinkingLevel: "ultra"}}}, ErrInvalidThinkingLevel},
		{"Gemini以外へThinking", usermodelsstore.Data{Added: []models.UserModel{{ID: "claude-x", GeminiBase: "gemini-3.5-flash", ThinkingLevel: "high"}}}, ErrThinkingNotGemini},
	}
	for _, tc := range cases {
		if _, err := svc.Update(tc.data); !errors.Is(err, tc.want) {
			t.Errorf("%s: err = %v, want %v", tc.name, err, tc.want)
		}
	}
}

func TestUpdateAcceptsExplicitProvider(t *testing.T) {
	svc := New(&fakeStore{})
	defer models.SetUserKinds(nil)

	updated, err := svc.Update(usermodelsstore.Data{
		Added: []models.UserModel{{ID: "opus-latest", Provider: " Claude "}},
	})
	if err != nil {
		t.Fatalf("Update failed: %v", err)
	}
	if updated.Added[0].Provider != "claude" {
		t.Errorf("provider は小文字へ正規化されるはず: %q", updated.Added[0].Provider)
	}
	// 保存後は種別判定へ反映され、チャット投入経路が指定どおりになること。
	if got := models.KindOf("opus-latest"); got != models.KindClaude {
		t.Errorf("KindOf へのオーバーライド反映漏れ: %q", got)
	}
}

func TestUpdateRejectsUnknownProvider(t *testing.T) {
	svc := New(&fakeStore{})
	_, err := svc.Update(usermodelsstore.Data{
		Added: []models.UserModel{{ID: "some-model", Provider: "openai"}},
	})
	if !errors.Is(err, ErrInvalidProvider) {
		t.Errorf("未知 provider は ErrInvalidProvider のはず: %v", err)
	}
	if !IsValidationError(err) {
		t.Error("ErrInvalidProvider は検証エラー扱いのはず")
	}
}

func TestUpdateThinkingUsesExplicitProvider(t *testing.T) {
	svc := New(&fakeStore{})
	defer models.SetUserKinds(nil)

	// claude- プレフィックスでも明示 gemini 指定なら Thinking を許可する。
	if _, err := svc.Update(usermodelsstore.Data{
		Added: []models.UserModel{{ID: "claude-style-alias", Provider: "gemini", GeminiBase: "gemini-3.5-flash", ThinkingLevel: "high"}},
	}); err != nil {
		t.Errorf("明示 gemini 指定の Thinking が拒否された: %v", err)
	}

	// 明示 claude 指定なら Gemini 向け Thinking 設定は拒否する。
	if _, err := svc.Update(usermodelsstore.Data{
		Added: []models.UserModel{{ID: "gemini-like", Provider: "claude", GeminiBase: "gemini-3.5-flash", ThinkingLevel: "high"}},
	}); !errors.Is(err, ErrThinkingNotGemini) {
		t.Errorf("明示 claude 指定への Thinking は ErrThinkingNotGemini のはず: %v", err)
	}
}

func TestNewSyncsStoredProviderOverrides(t *testing.T) {
	store := &fakeStore{data: usermodelsstore.Data{
		Added: []models.UserModel{{ID: "boot-model", Provider: "antigravity"}},
	}}
	defer models.SetUserKinds(nil)

	New(store)
	if got := models.KindOf("boot-model"); got != models.KindAntigravity {
		t.Errorf("起動時同期漏れ: %q", got)
	}
}

func TestGeminiAliases(t *testing.T) {
	store := &fakeStore{data: usermodelsstore.Data{
		Added: []models.UserModel{
			{ID: "flash4-think", GeminiBase: "gemini-4.0-flash", ThinkingLevel: "high"},
			{ID: "plain-model"},
		},
	}}
	svc := New(store)
	aliases, err := svc.GeminiAliases()
	if err != nil {
		t.Fatalf("GeminiAliases failed: %v", err)
	}
	if len(aliases) != 1 {
		t.Fatalf("aliases length = %d, want 1", len(aliases))
	}
	got := aliases["flash4-think"]
	if got.BaseModel != "gemini-4.0-flash" || got.Level != "HIGH" {
		t.Errorf("alias = %+v, want BaseModel=gemini-4.0-flash Level=HIGH", got)
	}
}

func TestMergedUsesStoreData(t *testing.T) {
	store := &fakeStore{data: usermodelsstore.Data{
		Added:  []models.UserModel{{ID: "my-model"}},
		Hidden: []string{"gemini-2.5-flash"},
	}}
	svc := New(store)
	merged, err := svc.Merged()
	if err != nil {
		t.Fatalf("Merged failed: %v", err)
	}
	var hasAdded, hasHidden bool
	for _, m := range merged {
		if m.ID == "my-model" {
			hasAdded = true
		}
		if m.ID == "gemini-2.5-flash" {
			hasHidden = true
		}
	}
	if !hasAdded || hasHidden {
		t.Errorf("マージ結果が不正: hasAdded=%v hasHidden=%v", hasAdded, hasHidden)
	}
}
