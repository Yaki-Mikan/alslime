package coreapi

import "strconv"

// ImageGeneratePayload は ImageGen ジョブの Payload（12番 Phase C）。
//
// 正本を coreapi に置く理由: ジョブ投入（public の generate-from-chat ハンドラ）と
// 実行（core の comfyui ドメイン / サイドカーモジュール）の両方が参照する境界型のため。
// comfyui ドメイン側はエイリアスで互換を保つ。JSON シリアライズ可能を保つこと
//（サイドカー RPC で素通しされる）。
type ImageGeneratePayload struct {
	SessionID string `json:"sessionId"`
	MessageID string `json:"messageId"`
	// TurnID / TurnIndex は生成対象のチャットバブル（TURN）指定。TurnID 優先・
	// TurnIndex はID無し旧メッセージ用のフォールバック。両方未指定は従来動作
	//（メッセージ全体・先頭TURN話者）。TurnIndex を *int にするのは
	// 「未指定」と「0番TURN指定」を区別するため。
	TurnID        string            `json:"turnId,omitempty"`
	TurnIndex     *int              `json:"turnIndex,omitempty"`
	CharacterName string            `json:"characterName,omitempty"`
	TemplateName  string            `json:"templateName,omitempty"`
	AITags        map[string]string `json:"aiTags,omitempty"`
	DirectTags    map[string]string `json:"directTags,omitempty"`
	SelectedKeys  map[string]string `json:"selectedKeys,omitempty"`
}

// ImageGenDedupeKey は ImageGen ジョブの重複投入判定キーを組み立てる。
// TURN 指定がある場合はキーへ含め、同一メッセージ内の別 TURN の生成は許可しつつ
// 同一 TURN の二重押しだけを重複として弾く。TURN 指定なしは従来キーのまま
//（サイドカー／in-process の両ハンドラで同一の規則を共有するためここに置く）。
func ImageGenDedupeKey(sessionID, messageID, turnID string, turnIndex *int) string {
	key := sessionID + "\x00" + messageID
	if turnID != "" {
		return key + "\x00" + turnID
	}
	if turnIndex != nil {
		return key + "\x00" + strconv.Itoa(*turnIndex)
	}
	return key
}
