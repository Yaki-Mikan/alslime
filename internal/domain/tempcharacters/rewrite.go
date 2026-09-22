package tempcharacters

// pathKeyedSettings は会話設定の中で「キャラクターのパスをキーにする」設定のキー一覧。
// キャラ設定登録で仮想パスを実パスへ付け替えるときに、同じ付け替えを行う。
var pathKeyedSettings = []string{"characterDetails", "voiceDesignByCharacter"}

// RewriteForRegistered は一時キャラクターがキャラ設定登録された後の会話設定の書き換えを行う。
//   - characters 配列の仮想パスを実パスへ置き換える（実パスが既にあれば仮想パスを取り除く）
//   - パスをキーにする設定（個別設定・声の設計）のキーを付け替える
//   - tempCharacters の該当要素に registeredPath を記録する
//
// 変更があれば true を返す。
func RewriteForRegistered(ssrp map[string]any, virtualPath, registeredPath string) bool {
	if ssrp == nil || virtualPath == "" || registeredPath == "" || virtualPath == registeredPath {
		return false
	}
	changed := false
	if rewriteCharacters(ssrp, virtualPath, registeredPath) {
		changed = true
	}
	for _, key := range pathKeyedSettings {
		if rewriteKeyedMap(ssrp, key, virtualPath, registeredPath) {
			changed = true
		}
	}
	all := FromSSRP(ssrp)
	if tc, ok := all[virtualPath]; ok && tc.RegisteredPath != registeredPath {
		tc.RegisteredPath = registeredPath
		all[virtualPath] = tc
		ssrp[SSRPKey] = ToSSRP(all)
		changed = true
	}
	return changed
}

func rewriteCharacters(ssrp map[string]any, from, to string) bool {
	raw, ok := ssrp["characters"]
	if !ok {
		return false
	}
	var items []string
	switch v := raw.(type) {
	case []string:
		items = append(items, v...)
	case []any:
		for _, item := range v {
			if s, ok := item.(string); ok {
				items = append(items, s)
			}
		}
	default:
		return false
	}
	hasTo := false
	for _, item := range items {
		if item == to {
			hasTo = true
			break
		}
	}
	out := make([]any, 0, len(items))
	changed := false
	for _, item := range items {
		if item != from {
			out = append(out, item)
			continue
		}
		changed = true
		if hasTo {
			continue
		}
		out = append(out, to)
		hasTo = true
	}
	if !changed {
		return false
	}
	ssrp["characters"] = out
	return true
}

func rewriteKeyedMap(ssrp map[string]any, key, from, to string) bool {
	m, ok := ssrp[key].(map[string]any)
	if !ok {
		return false
	}
	value, ok := m[from]
	if !ok {
		return false
	}
	if _, exists := m[to]; !exists {
		m[to] = value
	}
	delete(m, from)
	return true
}
