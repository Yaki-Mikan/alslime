package app

import (
	"errors"
	"testing"

	"alslime/internal/coreapi"
	apiproviderssvc "alslime/internal/domain/apiproviders"
	"alslime/internal/domain/models"
	usermodelssvc "alslime/internal/domain/usermodels"
	apiprovidersstore "alslime/internal/storage/apiproviders"
	"alslime/internal/storage/paths"
	usermodelsstore "alslime/internal/storage/usermodels"
)

// newTargetFixture は接続先 1 件と登録済みユーザーモデル 1 件を持つ実体一式を作る。
func newTargetFixture(t *testing.T) (userModelsSvc *usermodelssvc.Service, apiProvidersSvc *apiproviderssvc.Service, meta *apiprovidersstore.MetaStore, connectionID, modelID string) {
	t.Helper()
	resolver := paths.NewResolver(t.TempDir())
	meta = apiprovidersstore.NewMetaStore(resolver)
	seq := 0
	apiProvidersSvc = apiproviderssvc.New(
		meta,
		apiprovidersstore.NewSecretStore(resolver),
		resolver,
		func() string { seq++; return "fixedid" },
		apiproviderssvc.CascadeDeps{},
	)
	userModelsSvc = usermodelssvc.New(usermodelsstore.New(resolver), apiProvidersSvc.ConnectionExists)

	conn, err := apiProvidersSvc.Create(apiproviderssvc.Input{
		Preset:     apiproviderssvc.PresetOpenRouter,
		Label:      "メイン",
		BaseURL:    "https://openrouter.ai/api/v1",
		AuthScheme: apiproviderssvc.AuthSchemeBearer,
		Enabled:    true,
	}, "sk-x")
	if err != nil {
		t.Fatalf("接続作成に失敗: %v", err)
	}
	if _, err := userModelsSvc.Update(usermodelsstore.Data{
		Added: []models.UserModel{{
			Provider:      "openai_compat",
			ConnectionID:  conn.ID,
			RemoteModelID: "deepseek/deepseek-chat",
		}},
	}); err != nil {
		t.Fatalf("ユーザーモデル登録に失敗: %v", err)
	}
	t.Cleanup(func() { models.SetUserKinds(nil) })
	return userModelsSvc, apiProvidersSvc, meta, conn.ID, models.BuildOpenAICompatID(conn.ID, "deepseek/deepseek-chat")
}

func TestResolveAPIRequestTarget_正本のPresetを返す(t *testing.T) {
	userModelsSvc, apiProvidersSvc, _, connectionID, modelID := newTargetFixture(t)

	target, err := resolveAPIRequestTarget(userModelsSvc, apiProvidersSvc, modelID)
	if err != nil {
		t.Fatalf("resolveAPIRequestTarget failed: %v", err)
	}
	// Preset はモデル ID（クライアント入力）からではなく、接続先メタデータ正本
	// からのみ解決される（クライアント注入不能）。
	if target.ConnectionID != connectionID || target.RemoteModelID != "deepseek/deepseek-chat" || target.Preset != apiproviderssvc.PresetOpenRouter {
		t.Fatalf("target が不正: %+v", target)
	}
}

func TestResolveAPIRequestTarget_不正presetを送信前に拒否する(t *testing.T) {
	userModelsSvc, apiProvidersSvc, meta, connectionID, modelID := newTargetFixture(t)

	// 破損・手編集を模して、正本メタデータへ不正 preset を直接書き込む。
	data, err := meta.Load()
	if err != nil {
		t.Fatalf("meta 読み込みに失敗: %v", err)
	}
	for i := range data.Connections {
		if data.Connections[i].ID == connectionID {
			data.Connections[i].Preset = "broken-preset"
		}
	}
	if err := meta.Save(data); err != nil {
		t.Fatalf("meta 書き込みに失敗: %v", err)
	}

	// 固定指示を黙って省略せず、構成不備として送信前に明示エラーで止める。
	_, err = resolveAPIRequestTarget(userModelsSvc, apiProvidersSvc, modelID)
	var pf *coreapi.ProviderFailure
	if !errors.As(err, &pf) || pf.Type != coreapi.APIErrorInternalError {
		t.Fatalf("不正 preset は型付き内部エラーのはず: %v", err)
	}
}

func TestResolveAPIRequestTarget_失敗系(t *testing.T) {
	userModelsSvc, apiProvidersSvc, _, connectionID, modelID := newTargetFixture(t)

	assertUnavailable := func(t *testing.T, id string) {
		t.Helper()
		_, err := resolveAPIRequestTarget(userModelsSvc, apiProvidersSvc, id)
		var pf *coreapi.ProviderFailure
		if !errors.As(err, &pf) || pf.Type != coreapi.APIErrorConnectionUnavailable {
			t.Fatalf("api_connection_unavailable のはず: %v", err)
		}
	}
	// 形式不正・未登録モデル・不存在接続。
	assertUnavailable(t, "not-an-openai-compat-id")
	assertUnavailable(t, "openai_compat:"+connectionID+"/unregistered-model")
	assertUnavailable(t, "openai_compat:conn-missing/some/model")

	// 無効化された接続。
	disabled := apiproviderssvc.Input{
		Preset:     apiproviderssvc.PresetOpenRouter,
		Label:      "メイン",
		BaseURL:    "https://openrouter.ai/api/v1",
		AuthScheme: apiproviderssvc.AuthSchemeBearer,
		Enabled:    false,
	}
	if _, err := apiProvidersSvc.Update(connectionID, disabled, nil, false); err != nil {
		t.Fatalf("無効化に失敗: %v", err)
	}
	assertUnavailable(t, modelID)
}
