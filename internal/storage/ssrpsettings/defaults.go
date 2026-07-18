package ssrpsettings

import "time"

// isoMillisUTC は現行 Node 版 new Date().toISOString() 互換の時刻形式。
// ミリ秒付き UTC（例: 2026-06-26T13:55:11.123Z）。
const isoMillisUTC = "2006-01-02T15:04:05.000Z07:00"

// defaultRelationships は relation_options.json 未存在時に返す既定の関係性オプション。
// 現行 Node 版 core/ssrp.ts の後方互換デフォルトと同一内容・同一順序。
func defaultRelationships() []any {
	return []any{
		map[string]any{"label": "実母", "value": "実母"},
		map[string]any{"label": "義母", "value": "義母"},
		map[string]any{"label": "友人", "value": "友人"},
		map[string]any{"label": "恋人", "value": "恋人"},
		map[string]any{"label": "その他", "value": "その他"},
	}
}

// defaultReplacementConfig は replacement_config.json 未存在時に返す既定の置換設定。
// 現行 Node 版 core/replacement-config.ts の DEFAULT_REPLACEMENT_CONFIG に揃える。
func defaultReplacementConfig() map[string]any {
	return map[string]any{
		"version":      "2.0",
		"replacements": []any{},
		"lastModified": time.Now().UTC().Format(isoMillisUTC),
	}
}
