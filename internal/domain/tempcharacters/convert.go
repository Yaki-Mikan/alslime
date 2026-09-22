package tempcharacters

import (
	"strings"

	"alslime/internal/domain/charname"
)

// FromSSRP は会話設定（map[string]any）から一時キャラクターの map を取り出す。
// 要素は JSON 由来の map[string]any でも Go 側で入れた TempCharacter でも受け付ける。
func FromSSRP(ssrp map[string]any) map[string]TempCharacter {
	out := map[string]TempCharacter{}
	if ssrp == nil {
		return out
	}
	raw, ok := ssrp[SSRPKey].(map[string]any)
	if !ok {
		if typed, ok2 := ssrp[SSRPKey].(map[string]TempCharacter); ok2 {
			for k, v := range typed {
				out[k] = v
			}
		}
		return out
	}
	for key, value := range raw {
		switch v := value.(type) {
		case TempCharacter:
			out[key] = v
		case map[string]any:
			out[key] = fromMap(v)
		}
	}
	return out
}

func fromMap(m map[string]any) TempCharacter {
	str := func(key string) string {
		v, _ := m[key].(string)
		return v
	}
	return TempCharacter{
		ID:              str("id"),
		Name:            str("name"),
		Content:         str("content"),
		CreatedAt:       str("createdAt"),
		SourceSessionID: str("sourceSessionId"),
		TemplateName:    str("templateName"),
		RegisteredPath:  str("registeredPath"),
	}
}

func toMap(tc TempCharacter) map[string]any {
	m := map[string]any{
		"id":              tc.ID,
		"name":            tc.Name,
		"content":         tc.Content,
		"createdAt":       tc.CreatedAt,
		"sourceSessionId": tc.SourceSessionID,
	}
	if tc.TemplateName != "" {
		m["templateName"] = tc.TemplateName
	}
	if tc.RegisteredPath != "" {
		m["registeredPath"] = tc.RegisteredPath
	}
	return m
}

// ToSSRP は一時キャラクターの map を会話設定へ入れる形（map[string]any）に変換する。
func ToSSRP(m map[string]TempCharacter) map[string]any {
	out := map[string]any{}
	for key, tc := range m {
		out[key] = toMap(tc)
	}
	return out
}

// ContentMap は仮想パス → 設定本文の対応を返す（プロンプト組み立て用）。
// 本文が空のものは含めない。
func ContentMap(ssrp map[string]any) map[string]string {
	out := map[string]string{}
	for key, tc := range FromSSRP(ssrp) {
		if strings.TrimSpace(tc.Content) == "" {
			continue
		}
		out[key] = tc.Content
	}
	return out
}

// Get は仮想パスに対応する一時キャラクターを返す。
func Get(ssrp map[string]any, virtualPath string) (TempCharacter, bool) {
	tc, ok := FromSSRP(ssrp)[virtualPath]
	return tc, ok
}

// Set は一時キャラクターを会話設定へ書き込む（既存があれば置き換える）。
func Set(ssrp map[string]any, virtualPath string, tc TempCharacter) {
	all := FromSSRP(ssrp)
	all[virtualPath] = tc
	ssrp[SSRPKey] = ToSSRP(all)
}

// Delete は仮想パスの一時キャラクターを会話設定から取り除く。
func Delete(ssrp map[string]any, virtualPath string) bool {
	all := FromSSRP(ssrp)
	if _, ok := all[virtualPath]; !ok {
		return false
	}
	delete(all, virtualPath)
	ssrp[SSRPKey] = ToSSRP(all)
	return true
}

// FindByName は表示名が照合用正規化で一致する一時キャラクターを探す。
func FindByName(ssrp map[string]any, name string) (string, TempCharacter, bool) {
	want := charname.NormalizeMatchName(name)
	if want == "" {
		return "", TempCharacter{}, false
	}
	for key, tc := range FromSSRP(ssrp) {
		if charname.NormalizeMatchName(tc.Name) == want {
			return key, tc, true
		}
	}
	return "", TempCharacter{}, false
}
