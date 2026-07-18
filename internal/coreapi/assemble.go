package coreapi

import "time"

// プロンプト組み立て（chatflow の Assembler 群）が公開側サービスへ求める
// 読み取り境界。実装は公開側の各 service（parameters / ssrpsettings /
// calendar / workspacefs）が構造的に満たす。

// SchemaProvider is the narrow parameter schema lookup used by prompt assembly.
type SchemaProvider interface {
	GetSchema(id string) (map[string]any, error)
}

// ContentReader は SSRP プロンプト組み立て用の最小ファイル読み取り境界。
// 実装側で WORKSPACE_ROOT 外へ出ないことを保証する。
type ContentReader interface {
	ReadContent(rel string) (string, error)
}

// ReplacementProvider は送信時置換に必要な設定だけを見る境界。
type ReplacementProvider interface {
	ReplacementConfig() (map[string]any, error)
	Language(lang string) (map[string]any, error)
}

// HolidayLookup は日付時刻プロンプトへ祝日名を付与するための読み取り境界。
type HolidayLookup interface {
	HolidayName(t time.Time) (string, error)
}
