package tempcharacters

// Reconcile はセッションや会話設定プリセットを開いたときの ID 照合を行う。
// registered は登録済みキャラクターの「一時キャラ ID → 設定ファイルのパス」。
// 未登録扱いの一時キャラクターのうち ID が一致するものを登録済みキャラクターへ書き換える。
// 変更があれば true を返す。
func Reconcile(ssrp map[string]any, registered map[string]string) bool {
	if ssrp == nil || len(registered) == 0 {
		return false
	}
	changed := false
	for virtualPath, tc := range FromSSRP(ssrp) {
		if tc.RegisteredPath != "" {
			continue
		}
		path, ok := registered[tc.ID]
		if !ok || path == "" {
			continue
		}
		if RewriteForRegistered(ssrp, virtualPath, path) {
			changed = true
		}
	}
	return changed
}
