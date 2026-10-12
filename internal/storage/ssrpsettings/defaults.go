package ssrpsettings

import "time"

// isoMillisUTC は現行 Node 版 new Date().toISOString() 互換の時刻形式。
// ミリ秒付き UTC（例: 2026-06-26T13:55:11.123Z）。
const isoMillisUTC = "2006-01-02T15:04:05.000Z07:00"

// defaultReplacementConfig は replacement_config.json 未存在時に返す既定の置換設定。
// 現行 Node 版 core/replacement-config.ts の DEFAULT_REPLACEMENT_CONFIG に揃える。
func defaultReplacementConfig() map[string]any {
	return map[string]any{
		"version":      "2.0",
		"replacements": []any{},
		"lastModified": time.Now().UTC().Format(isoMillisUTC),
	}
}
