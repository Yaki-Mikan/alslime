package coreapi

import (
	"strconv"

	"alslime/internal/domain/models"
	"alslime/internal/i18n"
	"alslime/internal/jobs"
)

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

// ImageRenderPayload は分析済みの画像生成要求（生成ジョブの Payload）。
//
// 分析ジョブがタグ判定とタグ解決を終えた結果をそのまま持ち、生成ジョブは ComfyUI への
// 投入・保存・添付だけを行う。投入側（public）と実行側（core / サイドカー）の両方が
// 参照する境界型のため coreapi に置く。JSON シリアライズ可能を保つこと。
type ImageRenderPayload struct {
	SessionID     string `json:"sessionId"`
	MessageID     string `json:"messageId"`
	TurnID        string `json:"turnId,omitempty"`
	TurnIndex     *int   `json:"turnIndex,omitempty"`
	CharacterName string `json:"characterName,omitempty"`
	TemplateName  string `json:"templateName"`
	// TagSelections はタグカテゴリごとの解決済みプロンプト。DirectTags は直接指定タグ。
	TagSelections map[string]string `json:"tagSelections,omitempty"`
	DirectTags    map[string]string `json:"directTags,omitempty"`
	SelectedKeys  map[string]string `json:"selectedKeys,omitempty"`
	// AdditionalLoras / AdditionalNegativePrompts はタグ解決で一致した LoRA とネガティブ。
	AdditionalLoras           []ImageLora `json:"additionalLoras,omitempty"`
	AdditionalNegativePrompts []string    `json:"additionalNegativePrompts,omitempty"`
	// ExtraReplacements は生成プロファイル・プレースホルダプリセット由来の機構的な注入。
	ExtraReplacements map[string]string `json:"extraReplacements,omitempty"`
}

// ImageLora は生成要求に載せる LoRA 指定（comfyui ドメインの CharacterLora と同じ項目）。
type ImageLora struct {
	Name          string  `json:"name"`
	StrengthModel float64 `json:"strengthModel"`
	StrengthClip  float64 `json:"strengthClip"`
	TriggerWords  string  `json:"triggerWords,omitempty"`
}

// ImageRenderSpec は分析ジョブの完了時に投入する生成ジョブの Spec を組み立てる。
//
// in-process とサイドカーで同じ Spec になるようここに置く。Kind は ComfyUI 専用枠、
// DedupeKey は分析ジョブと同じ規則（分析ジョブは完了済みなので重複にならず、生成ジョブが
// active な間の同一 TURN 再投入だけを弾く）。SessionID は所属セッションの記録用で、
// 同セッション排他（チャット系同士のみ）の対象にはならない。
func ImageRenderSpec(prepared ImageRenderPayload) jobs.Spec {
	return jobs.Spec{
		Type:      jobs.TypeImageRender,
		Kind:      models.KindComfyUI,
		Label:     i18n.KeyLabelImageRender,
		SessionID: prepared.SessionID,
		DedupeKey: ImageGenDedupeKey(prepared.SessionID, prepared.MessageID, prepared.TurnID, prepared.TurnIndex),
		Payload:   prepared,
	}
}
