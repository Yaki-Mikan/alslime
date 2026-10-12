package i18n

import "testing"

// TestBuiltinCatalogs_一時キャラクター取り込みのキーはja_en双方にある は、
// セッションからの一時キャラクター取り込みで追加したキーが ja / en の両辞書に揃っていることを検査する。
// 片方にだけ足すと、UI 言語を切り替えたときにキー名がそのまま表示される。
func TestBuiltinCatalogs_一時キャラクター取り込みのキーはja_en双方にある(t *testing.T) {
	keys := []string{
		KeyErrorTempCharSessionNotFound,
		KeyErrorTempCharNotFound,
		KeyErrorTempCharInvalidName,
		KeyErrorTempCharAlreadyExists,
		KeyErrorTempCharContentTooLarge,
		KeyConfigGenProgressFromSession,
		KeyConfigGenProgressTempCharAdded,
		KeyLabelTempCharacterImport,
		// キャラクター容姿プロンプト作成。
		KeyErrorAppearanceSettingNotFound,
		KeyErrorAppearanceInvalidProvider,
		KeyErrorAppearanceInvalidPayload,
		KeyErrorAppearanceParseFailed,
		KeyErrorAppearanceNoTags,
		KeyLabelAppearancePrompt,
	}
	// フロント（constants/i18n.ts の SSRP_I18N_KEYS）と同じ接頭辞のキーも ja / en で揃っていること。
	ja := builtinCatalogs["ja"]
	en := builtinCatalogs["en"]
	for key := range ja {
		if hasTempCharacterPrefix(key) {
			keys = append(keys, key)
		}
	}
	for key := range en {
		if hasTempCharacterPrefix(key) {
			keys = append(keys, key)
		}
	}
	seen := map[string]bool{}
	for _, key := range keys {
		if seen[key] {
			continue
		}
		seen[key] = true
		if _, ok := ja[key]; !ok {
			t.Errorf("ja に無い: %s", key)
		}
		if _, ok := en[key]; !ok {
			t.Errorf("en に無い: %s", key)
		}
	}
}

func hasTempCharacterPrefix(key string) bool {
	for _, prefix := range []string{"ssrp.tempImport.", "ssrp.tempCharacter.", "error.tempchar.", "error.appearance.", "comfyui.appearancePrompt."} {
		if len(key) >= len(prefix) && key[:len(prefix)] == prefix {
			return true
		}
	}
	return false
}

// TestBuiltinCatalogs_骨組みのキーはja_en双方にある は、画面の骨組み（切り替え列・会話の見出し・
// 空の状態・履歴の画面）で足したキーが ja / en の両辞書に揃っていることを検査する。
func TestBuiltinCatalogs_骨組みのキーはja_en双方にある(t *testing.T) {
	prefixes := []string{"shell.", "chat.header.", "chat.empty.", "history.", "sessionTime.elapsedDays", "settings.category.", "settings.unsaved.", "settings.group.", "settings.media.", "ssrp.panel.", "ssrp.tab.", "ssrp.detail.", "material."}
	ja := builtinCatalogs["ja"]
	en := builtinCatalogs["en"]
	found := 0
	for _, pair := range []struct {
		name       string
		from, into map[string]string
	}{{"en", ja, en}, {"ja", en, ja}} {
		for key := range pair.from {
			if !hasAnyPrefix(key, prefixes) {
				continue
			}
			found++
			if _, ok := pair.into[key]; !ok {
				t.Errorf("%s に無い: %s", pair.name, key)
			}
		}
	}
	if found == 0 {
		t.Fatal("骨組みのキーが1件も無い")
	}
}

func hasAnyPrefix(key string, prefixes []string) bool {
	for _, prefix := range prefixes {
		if len(key) >= len(prefix) && key[:len(prefix)] == prefix {
			return true
		}
	}
	return false
}
