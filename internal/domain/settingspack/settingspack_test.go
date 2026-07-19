package settingspack

import (
	"strings"
	"testing"

	"alslime/internal/config"
)

func TestClassify_分類テーブル(t *testing.T) {
	cases := []struct {
		name      string
		rel       string
		wantClass Class
		wantKind  string
	}{
		{"キャラクター", "roleplay/characters/雪/settings/base.md", ClassRoleplay, "character"},
		{"シチュエーション", "roleplay/global/situations/カフェ.md", ClassRoleplay, "situation"},
		{"職業は背景より優先（最長一致）", "roleplay/global/backgrounds/occupations/教師.md", ClassRoleplay, "occupation"},
		{"背景", "roleplay/global/backgrounds/教室.md", ClassRoleplay, "background"},
		{"文体設定", config.WritingStylesDir + "/default_v7.md", ClassRoleplay, "writingStyle"},
		{"AIプロバイダ指示（Claude）はC分類", config.ProviderInstructionClaudeFile, ClassConfig, "providerInstructions"},
		{"AIプロバイダ指示（Antigravity）はC分類", config.ProviderInstructionAntigravityFile, ClassConfig, "providerInstructions"},
		{"AIプロバイダ指示（Gemini）はC分類", config.ProviderInstructionGeminiFile, ClassConfig, "providerInstructions"},
		{"デフォルト項目設定", config.ParameterSchemaDefaultFile, ClassSchema, "parameterSchemas"},
		{"カスタム項目設定", config.ParameterSchemaCustomDir + "/parameter-schema-abc.json", ClassSchema, "parameterSchemas"},
		{"パラメータプリセット", config.ParameterNormalModePresetDir + "/parameter-presets-abc.json", ClassSchema, "parameterPresets"},
		{"SSRPプリセット", config.PresetSSRPAllDir + "/デート.json", ClassSchema, "ssrpPresets"},
		{"日付時刻プリセット", config.DateTimePresetsFile, ClassSchema, "datetimePresets"},
		{"キャラフィルタ", config.CharacterFiltersFile, ClassConfig, "characterFilters"},
		{"生成プロファイル", config.ComfyUIProfileDir + "/nsfw.json", ClassImageGen, "comfyProfiles"},
		{"タグ判定指示", config.ComfyUIDirectiveDanbooruFile, ClassImageGen, "comfyDirectives"},
		{"環境依存: ComfyUI接続", config.ComfyUIConfigFile, ClassEnv, ""},
		{"環境依存: サーバー設定", config.ServerSettingsFile, ClassEnv, ""},
		{"絶対除外: 認証", config.AuthDir + "/claude/.credentials.json", ClassForbidden, ""},
		{"絶対除外: 履歴", "roleplay/history/unified_sessions/a.json", ClassForbidden, ""},
		{"絶対除外: ComfyUIデバッグ", config.ComfyUIDebugDir + "/tag_judge_responses/a.json", ClassForbidden, ""},
		{"未認識", "roleplay/unknown/what.md", "", ""},
		{"プレフィックス誤判定なし", "roleplay/global2/evil.md", "", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := Classify(c.rel)
			if got.Class != c.wantClass {
				t.Fatalf("Class: got=%q want=%q", got.Class, c.wantClass)
			}
			kindID := ""
			if got.Kind != nil {
				kindID = got.Kind.ID
			}
			if kindID != c.wantKind {
				t.Fatalf("Kind: got=%q want=%q", kindID, c.wantKind)
			}
		})
	}
}

func TestCharacterSubdir_判定(t *testing.T) {
	if !IsCharacterInternal("roleplay/characters/雪/internal/image_hashes.json") {
		t.Fatal("internal 配下を検出できていない")
	}
	if IsCharacterInternal("roleplay/characters/雪/settings/base.md") {
		t.Fatal("settings を internal と誤検出")
	}
	if !IsCharacterImage("roleplay/characters/雪/images/originals/a.png") {
		t.Fatal("images 配下を検出できていない")
	}
	if IsCharacterImage("roleplay/global/situations/images.md") {
		t.Fatal("キャラ外パスを images と誤検出")
	}
}

func TestBuildPlan_アクション判定(t *testing.T) {
	entries := []Entry{
		{Path: "roleplay/global/situations/新規.md", SizeBytes: 10},
		{Path: "roleplay/global/situations/既存.md", SizeBytes: 20},
		{Path: config.ServerSettingsFile, SizeBytes: 30},
		{Path: "roleplay/unknown/謎.md", SizeBytes: 40},
		{Path: config.ComfyUIProfileDir + "/p.json", SizeBytes: 50},
		{Path: "roleplay/characters/雪/internal/cache.json", SizeBytes: 60},
		{Path: "../escape.md", SizeBytes: 70, Invalid: true},
	}
	exists := func(rel string) bool { return rel == "roleplay/global/situations/既存.md" }
	plan := BuildPlan(entries, nil, PlanOptions{Exists: exists, ImageGenAllowed: false})

	wantActions := []struct {
		action Action
		reason string
	}{
		{ActionNew, ""},
		{ActionConflict, ""},
		{ActionSkip, ReasonEnvironment},
		{ActionSkip, ReasonUnrecognized},
		{ActionSkip, ReasonTier},
		{ActionSkip, ReasonCharacterInternal},
		{ActionSkip, ReasonInvalidPath},
	}
	if len(plan.Entries) != len(wantActions) {
		t.Fatalf("エントリ数: got=%d want=%d", len(plan.Entries), len(wantActions))
	}
	for i, w := range wantActions {
		if plan.Entries[i].Action != w.action || plan.Entries[i].ReasonKey != w.reason {
			t.Fatalf("entries[%d]: got=(%s,%s) want=(%s,%s)",
				i, plan.Entries[i].Action, plan.Entries[i].ReasonKey, w.action, w.reason)
		}
	}
	if plan.Blocked {
		t.Fatal("auth を含まないのに Blocked")
	}
	if plan.Summary[ActionNew] != 1 || plan.Summary[ActionConflict] != 1 || plan.Summary[ActionSkip] != 5 {
		t.Fatalf("Summary が不正: %+v", plan.Summary)
	}
}

func TestBuildPlan_指示ファイルは常時上書きフラグ(t *testing.T) {
	plan := BuildPlan([]Entry{
		{Path: config.ProviderInstructionClaudeFile},
		{Path: "roleplay/global/situations/既存.md"},
	}, nil, PlanOptions{Exists: func(string) bool { return true }})
	if plan.Entries[0].Action != ActionConflict || !plan.Entries[0].Forced {
		t.Fatalf("指示ファイルは conflict+forced になるべき: %+v", plan.Entries[0])
	}
	if plan.Entries[1].Action != ActionConflict || plan.Entries[1].Forced {
		t.Fatalf("通常種別の衝突に forced が付いてはいけない: %+v", plan.Entries[1])
	}

	// 既存が無ければただの new（forced は衝突時のみ意味を持つ）。
	plan = BuildPlan([]Entry{{Path: config.ProviderInstructionGeminiFile}}, nil, PlanOptions{})
	if plan.Entries[0].Action != ActionNew || plan.Entries[0].Forced {
		t.Fatalf("既存無しの指示ファイルは new になるべき: %+v", plan.Entries[0])
	}
}

func TestBuildPlan_認証パスでパック全体拒否(t *testing.T) {
	plan := BuildPlan([]Entry{
		{Path: "roleplay/global/situations/ok.md"},
		{Path: config.AuthDir + "/gemini/oauth_creds.json"},
	}, nil, PlanOptions{})
	if !plan.Blocked || plan.BlockedKey != BlockedAuth {
		t.Fatalf("auth 検知でブロックされるべき: %+v", plan)
	}
}

func TestBuildPlan_tier許可でD分類が通る(t *testing.T) {
	plan := BuildPlan([]Entry{
		{Path: config.ComfyUIProfileDir + "/p.json"},
	}, nil, PlanOptions{ImageGenAllowed: true})
	if plan.Entries[0].Action != ActionNew {
		t.Fatalf("tier 許可時は new になるべき: %+v", plan.Entries[0])
	}
}

func TestBuildPlan_孤児プリセット警告(t *testing.T) {
	// スキーマ無しのプリセット → 警告。
	plan := BuildPlan([]Entry{
		{Path: config.ParameterNormalModePresetDir + "/parameter-presets-lost.json"},
	}, nil, PlanOptions{})
	if !hasWarning(plan.Warnings, WarnOrphanPreset) {
		t.Fatalf("孤児プリセット警告が出るべき: %+v", plan.Warnings)
	}

	// パック内にスキーマ同梱 → 警告なし。
	plan = BuildPlan([]Entry{
		{Path: config.ParameterNormalModePresetDir + "/parameter-presets-abc.json"},
		{Path: config.ParameterSchemaCustomDir + "/parameter-schema-abc.json"},
	}, nil, PlanOptions{})
	if hasWarning(plan.Warnings, WarnOrphanPreset) {
		t.Fatalf("スキーマ同梱時は警告不要: %+v", plan.Warnings)
	}

	// default スキーマは常に存在扱い → 警告なし。
	plan = BuildPlan([]Entry{
		{Path: config.ParameterNormalModePresetDir + "/parameter-presets-default.json"},
	}, nil, PlanOptions{})
	if hasWarning(plan.Warnings, WarnOrphanPreset) {
		t.Fatalf("default スキーマのプリセットは警告不要: %+v", plan.Warnings)
	}
}

func TestBuildPlan_プロファイルとdirectiveのセット警告(t *testing.T) {
	plan := BuildPlan([]Entry{
		{Path: config.ComfyUIProfileDir + "/p.json"},
	}, nil, PlanOptions{ImageGenAllowed: true})
	if !hasWarning(plan.Warnings, WarnProfileWithoutDirective) {
		t.Fatalf("directive 無しプロファイルは警告が出るべき: %+v", plan.Warnings)
	}

	// 環境側に directive があれば警告なし。
	plan = BuildPlan([]Entry{
		{Path: config.ComfyUIProfileDir + "/p.json"},
	}, nil, PlanOptions{
		ImageGenAllowed: true,
		Exists:          func(rel string) bool { return rel == config.ComfyUIDirectiveDanbooruFile },
	})
	if hasWarning(plan.Warnings, WarnProfileWithoutDirective) {
		t.Fatalf("環境に directive がある場合は警告不要: %+v", plan.Warnings)
	}
}

func TestBuildPlan_骨だけキャラ警告(t *testing.T) {
	plan := BuildPlan([]Entry{
		{Path: "roleplay/characters/骨/images/originals/a.png"},
	}, nil, PlanOptions{})
	if !hasWarning(plan.Warnings, WarnCharacterWithoutSetting) {
		t.Fatalf("settings 無しキャラは警告が出るべき: %+v", plan.Warnings)
	}

	plan = BuildPlan([]Entry{
		{Path: "roleplay/characters/雪/settings/base.md"},
		{Path: "roleplay/characters/雪/images/originals/a.png"},
	}, nil, PlanOptions{})
	if hasWarning(plan.Warnings, WarnCharacterWithoutSetting) {
		t.Fatalf("settings 同梱キャラは警告不要: %+v", plan.Warnings)
	}
}

func TestParseManifest(t *testing.T) {
	m, err := ParseManifest([]byte(`{"packFormat":1,"name":"テスト"}`))
	if err != nil {
		t.Fatalf("正常なマニフェストでエラー: %v", err)
	}
	if m.Name != "テスト" {
		t.Fatalf("Name: got=%q", m.Name)
	}

	// packFormat 省略は 1 とみなす。
	m, err = ParseManifest([]byte(`{}`))
	if err != nil || m.PackFormat != 1 {
		t.Fatalf("省略時は packFormat=1: m=%+v err=%v", m, err)
	}

	if _, err := ParseManifest([]byte(`{"packFormat":99}`)); err != ErrPackFormatTooNew {
		t.Fatalf("新しすぎる packFormat は拒否すべき: %v", err)
	}
	if _, err := ParseManifest([]byte(`{broken`)); err != ErrManifestInvalid {
		t.Fatalf("壊れた JSON は拒否すべき: %v", err)
	}
}

func TestLooseAliases_代表エイリアス(t *testing.T) {
	aliases := LooseAliases()
	cases := map[string]string{
		"キャラクター":         "roleplay/characters",
		"character":      "roleplay/characters",
		"シチュエーション":       "roleplay/global/situations",
		"situations":     "roleplay/global/situations",
		"項目設定":           config.ParameterSchemaCustomDir,
		"文体設定":           config.WritingStylesDir,
		"writing_styles": config.WritingStylesDir,
	}
	for key, want := range cases {
		if got := aliases[key]; got != want {
			t.Fatalf("aliases[%q]: got=%q want=%q", key, got, want)
		}
	}
}

func TestKinds_EとFを含まない(t *testing.T) {
	for _, k := range Kinds() {
		if k.Class == ClassEnv || k.Class == ClassForbidden {
			t.Fatalf("Kinds に E/F 分類が混入: %+v", k)
		}
		for _, root := range k.Roots {
			if strings.HasPrefix(root, config.AuthDir) {
				t.Fatalf("Kinds の Roots に AuthDir 配下: %+v", k)
			}
		}
	}
}

func hasWarning(warnings []Warning, key string) bool {
	for _, w := range warnings {
		if w.Key == key {
			return true
		}
	}
	return false
}
