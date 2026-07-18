package coreapi

// ImageGeneratePayload は ImageGen ジョブの Payload（12番 Phase C）。
//
// 正本を coreapi に置く理由: ジョブ投入（public の generate-from-chat ハンドラ）と
// 実行（core の comfyui ドメイン / サイドカーモジュール）の両方が参照する境界型のため。
// comfyui ドメイン側はエイリアスで互換を保つ。JSON シリアライズ可能を保つこと
//（サイドカー RPC で素通しされる）。
type ImageGeneratePayload struct {
	SessionID     string            `json:"sessionId"`
	MessageID     string            `json:"messageId"`
	CharacterName string            `json:"characterName,omitempty"`
	TemplateName  string            `json:"templateName,omitempty"`
	AITags        map[string]string `json:"aiTags,omitempty"`
	DirectTags    map[string]string `json:"directTags,omitempty"`
	SelectedKeys  map[string]string `json:"selectedKeys,omitempty"`
}
