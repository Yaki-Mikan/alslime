package coreapi

// ThinkingAlias はユーザー定義の Gemini Thinking エイリアス（09番 5章）の中立表現。
//
// Level は "HIGH" 等へ正規化済みの値。settings.json への変換（JSON 構造の知識）は
// core 側（providers/gemini）に閉じる。
// （旧 gemini.ThinkingAlias。gemini 側はエイリアスで互換を保つ。）
type ThinkingAlias struct {
	BaseModel string
	Level     string
}
