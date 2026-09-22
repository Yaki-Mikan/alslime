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
	TurnID        string `json:"turnId,omitempty"`
	TurnIndex     *int   `json:"turnIndex,omitempty"`
	CharacterName string `json:"characterName,omitempty"`
	TemplateName  string `json:"templateName,omitempty"`
	// PresetName は API サービスの生成プリセット名の明示指定（テスト生成・表情画像生成用）。
	// 空なら分析段が会話設定・形式・共通の順で決める。
	PresetName   string            `json:"presetName,omitempty"`
	AITags       map[string]string `json:"aiTags,omitempty"`
	DirectTags   map[string]string `json:"directTags,omitempty"`
	SelectedKeys map[string]string `json:"selectedKeys,omitempty"`
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

// 画像生成バックエンドの識別子。設定（imageBackend）と分析済み要求（backend）で共用する。
// 投入側（public）と実行側（core / サイドカー）の両方が参照するため境界型と同じ場所に置く。
const (
	// ImageBackendComfyUI は ComfyUI 連携（ワークフロー投入）。既定。
	ImageBackendComfyUI = "comfyui"
	// ImageBackendAPI は外部の画像生成 API サービス（NovelAI 等）への送信。
	ImageBackendAPI = "api"
)

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
	// Backend は生成段が使うバックエンド（ImageBackendComfyUI / ImageBackendAPI）。
	// 空は ComfyUI（旧ペイロードとの互換）。生成ジョブの同時実行枠の振り分けにも使う。
	Backend string `json:"backend,omitempty"`
	// TemplateName は ComfyUI のワークフローテンプレート名。API サービスでは空でよい。
	TemplateName string `json:"templateName"`
	// PresetName は API サービスの生成プリセット名。ComfyUI では空。
	PresetName string `json:"presetName,omitempty"`
	// Model は分析段で確定した API サービスの使用モデル。生成段はこの値をそのまま使い、
	// 生成プリセットや設定から取り直さない。ComfyUI では空。
	Model string `json:"model,omitempty"`
	// TagSelections はタグカテゴリごとの解決済みプロンプト。DirectTags は直接指定タグ。
	TagSelections map[string]string `json:"tagSelections,omitempty"`
	DirectTags    map[string]string `json:"directTags,omitempty"`
	SelectedKeys  map[string]string `json:"selectedKeys,omitempty"`
	// AdditionalLoras / AdditionalNegativePrompts はタグ解決で一致した LoRA とネガティブ。
	AdditionalLoras           []ImageLora `json:"additionalLoras,omitempty"`
	AdditionalNegativePrompts []string    `json:"additionalNegativePrompts,omitempty"`
	// ExtraReplacements は生成プロファイル・プレースホルダプリセット由来の機構的な注入。
	ExtraReplacements map[string]string `json:"extraReplacements,omitempty"`
	// Persons は分析段で解決した登場人物（API サービス生成で使う。ComfyUI 連携では空）。
	// PersonsTag は画面全体側の人数タグ（1girl, 1boy 等）。
	Persons    []ImagePerson `json:"persons,omitempty"`
	PersonsTag string        `json:"personsTag,omitempty"`
	// Warnings は分析段で出た利用者向けの注意（i18n キー）。生成結果の警告に合流する。
	Warnings []string `json:"warnings,omitempty"`
	// SoundEffects は分析段の検査を通った効果音。SoundEffectsStatus はその判定結果の種別
	//（ImageSoundEffects*。空は判定なし）。API サービス生成で使う。ComfyUI では空。
	SoundEffects       []ImageSoundEffect `json:"soundEffects,omitempty"`
	SoundEffectsStatus string             `json:"soundEffectsStatus,omitempty"`
}

// ImageSoundEffect は絵に描く効果音 1 個分。
type ImageSoundEffect struct {
	// Text は絵に描く文言（擬音）。Style はどこに、どんな形で描くかの説明。
	Text  string `json:"text"`
	Style string `json:"style,omitempty"`
}

// 自動効果音の判定結果の種別。空文字は「判定なし」（判定を行わなかった生成・古い画像）。
// 「AI が不要と判定した」と「不備で採用できなかった」を取り違えないために分ける。
const (
	// ImageSoundEffectsSpecified は検査を通った効果音が 1 個以上ある（一部だけ採用した場合を含む）。
	ImageSoundEffectsSpecified = "specified"
	// ImageSoundEffectsNotNeeded は効果音の部分が正しい形で返り、中身が空だった。
	ImageSoundEffectsNotNeeded = "notNeeded"
	// ImageSoundEffectsRejected は判定結果を採用できなかった（形の不備・全部が空・上限で全部を省いた）。
	ImageSoundEffectsRejected = "rejected"
)

// ImagePerson は分析段で解決した登場人物 1 人分。
type ImagePerson struct {
	// Kind は ImagePersonKindCharacter / ImagePersonKindUser / ImagePersonKindUnknown。
	Kind string `json:"kind"`
	// CharacterDir はキャラ設定ディレクトリ名（Kind が character のとき）。
	CharacterDir string `json:"characterDir,omitempty"`
	// DisplayName は判定 AI が出した名前。未登録の人物はこれだけを人物プロンプトに使う。
	DisplayName string `json:"displayName"`
	// Tags / SelectedKeys は人物に紐づく区分（表情・体位・行動・身体状態・服装）の解決結果。
	Tags         map[string]string `json:"tags,omitempty"`
	SelectedKeys map[string]string `json:"selectedKeys,omitempty"`
	// NegativePrompts はタグ解決で一致したネガティブ。
	NegativePrompts []string `json:"negativePrompts,omitempty"`
	// Interaction は人物間の相互作用タグ（source#hug / target#hug 等）。
	Interaction string `json:"interaction,omitempty"`
}

// 登場人物の種別。
const (
	ImagePersonKindCharacter = "character"
	ImagePersonKindUser      = "user"
	ImagePersonKindUnknown   = "unknown"
)

// ImageLora は生成要求に載せる LoRA 指定（comfyui ドメインの CharacterLora と同じ項目）。
type ImageLora struct {
	Name          string  `json:"name"`
	StrengthModel float64 `json:"strengthModel"`
	StrengthClip  float64 `json:"strengthClip"`
	TriggerWords  string  `json:"triggerWords,omitempty"`
}

// ImageRenderKind は生成段のバックエンドに応じた同時実行枠の種別を返す。
// 空・未知の値は ComfyUI（旧ペイロードとの互換）。
func ImageRenderKind(backend string) models.Kind {
	if backend == ImageBackendAPI {
		return models.KindImageAPI
	}
	return models.KindComfyUI
}

// ImageRenderSpec は分析ジョブの完了時に投入する生成ジョブの Spec を組み立てる。
//
// in-process とサイドカーで同じ Spec になるようここに置く。Kind はバックエンドごとの
// 専用枠（ComfyUI / 画像 API サービス）、DedupeKey は分析ジョブと同じ規則（分析ジョブは
// 完了済みなので重複にならず、生成ジョブが active な間の同一 TURN 再投入だけを弾く）。
// SessionID は所属セッションの記録用で、同セッション排他（チャット系同士のみ）の対象には
// ならない。
func ImageRenderSpec(prepared ImageRenderPayload) jobs.Spec {
	return jobs.Spec{
		Type:      jobs.TypeImageRender,
		Kind:      ImageRenderKind(prepared.Backend),
		Label:     i18n.KeyLabelImageRender,
		SessionID: prepared.SessionID,
		DedupeKey: ImageGenDedupeKey(prepared.SessionID, prepared.MessageID, prepared.TurnID, prepared.TurnIndex),
		Payload:   prepared,
	}
}
