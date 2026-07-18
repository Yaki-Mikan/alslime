package pwasettings

import "alslime/internal/config"

// defaultSettings は PWA（アプリ表示）設定の既定値。
//
// 現行 Node 版 settings.ts の DEFAULT_SETTINGS を移植する。
// GET 時に既定値へ実ファイル内容をマージして「不足キー補完」を行うため、
// ここに正本を持つ。値・型は現行と揃える（JSON 数値は float64 で保持）。
func defaultSettings() map[string]any {
	return map[string]any{
		"fontFamily":                               "system-ui, -apple-system, sans-serif",
		"fontSize":                                 14.0,
		"emptyLineHeight":                          1.0,
		"collapseEmptyLines":                       false,
		"theme":                                    "dark",
		"temperature":                              1.0,
		"enableFirstResponseBackup":                false,
		"enableResponseBackup":                     false,
		"enableBackgroundImage":                    false,
		"backgroundImageOpacity":                   1.0,
		"backgroundImageFit":                       "cover",
		"backgroundImageScope":                     "history",
		"backgroundChatInputAreaOpacity":           0.45,
		"backgroundChatInputAreaMatchImageOpacity": false,
		"messageBubbleOpacity":                     0.8,
		"uiLanguage":                               config.I18NDefaultLang,
		"holidayCalendarEnabled":                   false,
		"defaultUserName":                          "",
	}
}
