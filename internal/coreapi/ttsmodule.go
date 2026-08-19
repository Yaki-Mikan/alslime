package coreapi

// 音声読み上げ（Irodori-TTS連携）サイドカーモジュールと本体の間の RPC 契約。
//
// 画像生成（module.go）・行動選択肢（choicemodule.go）と独立した支援者向け機能のため、
// 契約もここへ分離する。起動・認証・ポート報告のインフラ規約
// （ModuleAuthHeader / ModuleSecretEnv / ModulePortPrefix / ModuleHealthzRoute）は
// module.go の共通定数を再利用する。境界を渡る型は JSON シリアライズ可能を保つ。

// 設定・接続確認・ボイス管理などの利用者向け API（/api/tts/*）は、comfy と同様に
// 本体側ゲート（ttsgate）からサイドカーへパスそのまま転送し、実ハンドラは
// core 側の tts.RegisterModuleRoutes が持つ（in-process と共用）。
// ここには本体ジョブ Runner が使う内部 RPC ルートと、境界を渡る型を置く。
// 実装（tts パッケージ）はこれらの型をエイリアスで参照する（二重定義の禁止）。

import "fmt"

const (
	// ModuleTTSPlanRoute は読み上げ計画（TURN分割・Voice解決）の内部 RPC ルート。
	ModuleTTSPlanRoute = "/module/tts-plan"
	// ModuleTTSSynthesizeRoute は一件の音声合成（チャンクストリーミング応答）の内部 RPC ルート。
	ModuleTTSSynthesizeRoute = "/module/tts-synthesize"
	// ModuleTTSLatentEncodeRoute は参照音声のLatent変換の内部 RPC ルート。
	ModuleTTSLatentEncodeRoute = "/module/tts-latent-encode"
)

// TTSPresetVoiceDesign は会話設定側のVoiceDesign（会話設定プリセット由来。要件6.5）。
type TTSPresetVoiceDesign struct {
	// Mode は "append"（追記。既定）または "replace"（置換）。
	Mode string `json:"mode"`
	Text string `json:"text"`
}

// TTSPlanRequest は読み上げ計画の要求。
type TTSPlanRequest struct {
	SessionID string `json:"sessionId"`
	MessageID string `json:"messageId"`
	// TurnID を指定するとそのTURNだけを計画する（TURN単位ボタン）。空は1応答全体。
	TurnID string `json:"turnId,omitempty"`
	// PresetVoiceDesign はキャラクター名→会話設定側VoiceDesign（フロントが同梱）。
	PresetVoiceDesign map[string]TTSPresetVoiceDesign `json:"presetVoiceDesign,omitempty"`
}

// TTSSegment は分割済みの読み上げ1セグメント（送信順。要件9.5）。
type TTSSegment struct {
	Text string `json:"text"`
	// Narration は地の文セグメントの印。計画の Narrator が非 nil のとき、
	// Runner はこのセグメントだけナレーター用 Voice で合成する（要件4章）。
	Narration bool `json:"narration,omitempty"`
}

// TTSPlanItem は1TURN分の計画。Skipped のTURNは生成要求を送らない。
type TTSPlanItem struct {
	TurnID          string  `json:"turnId"`
	TurnIndex       int     `json:"turnIndex"`
	CharacterName   string  `json:"characterName"`
	Skipped         bool    `json:"skipped,omitempty"`
	SkipReason      string  `json:"skipReason,omitempty"`
	VoiceID         string  `json:"voiceId,omitempty"`
	Caption         string  `json:"caption,omitempty"`
	CfgScaleCaption float64 `json:"cfgScaleCaption,omitempty"`
	CfgScaleSpeaker float64 `json:"cfgScaleSpeaker,omitempty"`
	VolumeGain      float64 `json:"volumeGain,omitempty"`
	// Segments は分割済みの読み上げセグメント（送信順。要件9.5）。
	Segments []TTSSegment `json:"segments,omitempty"`
}

// TTSNarrator は地の文セグメントへ適用するナレーター用Voiceの合成条件（要件4章）。
// ナレーターはキャラクター単位の設定を持たないため、キャプションは付けず
// CFG値は全体既定値を使う。
type TTSNarrator struct {
	VoiceID         string  `json:"voiceId"`
	CfgScaleCaption float64 `json:"cfgScaleCaption,omitempty"`
	CfgScaleSpeaker float64 `json:"cfgScaleSpeaker,omitempty"`
}

// TTSPlanItem のスキップ理由。
const (
	TTSSkipReasonEmpty           = "empty"
	TTSSkipReasonReadDisabled    = "readDisabled"
	TTSSkipReasonVoiceUnresolved = "voiceUnresolved"
	// TTSSkipReasonAlreadyGenerated は本体側が生成済みTURNを除外した印
	//（1応答全体の読み上げでのスキップ。要件9.3）。
	TTSSkipReasonAlreadyGenerated = "alreadyGenerated"
)

// TTSPlanResponse は計画の結果。合成要求の組み立てに使う設定値も併せて返す。
type TTSPlanResponse struct {
	Items               []TTSPlanItem `json:"items"`
	Speed               float64       `json:"speed"`
	ResponseFormat      string        `json:"responseFormat"`
	ChunkSilenceSeconds float64       `json:"chunkSilenceSeconds"`
	SaveMergedAudio     bool          `json:"saveMergedAudio"`
	// Narrator は地の文ナレーター読みの適用情報。地の文ナレーター読みが有効かつ
	// ナレーター用Voiceが設定済みのときのみ非 nil。未設定のときは nil のままとし、
	// 既定の動作（そのTURNのキャラクターのVoiceで読む）に落ちる（要件4章）。
	Narrator *TTSNarrator `json:"narrator,omitempty"`
}

// TTSSynthesizeRequest は一件の合成要求（計画の1セグメント分）。
type TTSSynthesizeRequest struct {
	Text            string  `json:"text"`
	VoiceID         string  `json:"voiceId"`
	Caption         string  `json:"caption,omitempty"`
	CfgScaleCaption float64 `json:"cfgScaleCaption,omitempty"`
	CfgScaleSpeaker float64 `json:"cfgScaleSpeaker,omitempty"`
	Speed           float64 `json:"speed,omitempty"`
	ResponseFormat  string  `json:"responseFormat,omitempty"`
}

// TTSChunk は完成した1チャンク（個別に完結した音声ファイル）。
type TTSChunk struct {
	Index  int    `json:"index"`
	Format string `json:"format"`
	Audio  []byte `json:"audio"`
}

// TTSReadPayload は TypeTTS ジョブの Payload（読み上げ実行の計画保持。要件9.3）。
// 本体は再解釈せず Runner だけが読む。
type TTSReadPayload struct {
	SessionID string `json:"sessionId"`
	MessageID string `json:"messageId"`
	// TurnID は TURN 単位実行のときのみ非空（実行種別の区別。要件9.3）。
	TurnID string          `json:"turnId,omitempty"`
	Plan   TTSPlanResponse `json:"plan"`
}

// TTSDedupeKey は読み上げ実行の重複排除キー（要件9.7 の同一対象重複開始の拒否）。
// 1応答全体は messageId 単位、TURN 単位は turnId まで含める。
func TTSDedupeKey(sessionID, messageID, turnID string) string {
	if turnID == "" {
		return fmt.Sprintf("tts:%s:%s", sessionID, messageID)
	}
	return fmt.Sprintf("tts:%s:%s:%s", sessionID, messageID, turnID)
}
