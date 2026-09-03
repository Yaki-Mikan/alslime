package characters

import (
	"regexp"

	"alslime/internal/i18n"
)

// samplePackLangPattern はサンプルパック取得の lang（UI 言語コード）の許容書式。
// パック ID の一部になるため、小文字英字とハイフンだけに絞る。
var samplePackLangPattern = regexp.MustCompile(`^[a-z]{2,8}(-[a-z0-9]{1,8})?$`)

// キャラクター系 API の route 断片。
// config.APIPrefix や config.CharacterImagesRoute と組み合わせて登録する。
const (
	routeCharacterTags           = "/character-tags"
	routeCharacterFilters        = "/character-filters"
	routeCharacterFiltersRebuild = "/character-filters/rebuild"
	routeCharacterEmotions       = "/characters/emotions"
	routeEmotionCatalog          = "/characters/emotion-catalog"
	routeEmotionImagePrune       = "/characters/emotion-images/prune"
	routeCharacterImages         = "/characters/{name}/images"
	routeCharacterImageUpload    = "/characters/{name}/images/upload"
	routeCharacterImageCrop      = "/characters/{name}/images/crop"
	routeCharacterImageDelete    = "/characters/{name}/images/{emotion}"
	routeStaticCharacterImage    = "/{name}/{path...}"
	routeCharacterTagsByDir      = "/character-tags/{dirName}"
	routeCharacterLinkedSettings = "/characters/{name}/linked-settings"
	routeEmotionPrompts          = "/characters/emotion-prompts"
	routeEmotionPromptsSample    = "/characters/emotion-prompts/download-sample"
	// emotionPromptsPackIDPrefix は認証サーバー上の表情プロンプトサンプルパック ID の接頭辞。
	// 言語ごとに別パック（emotion-prompts-ja / emotion-prompts-en …）とし、UI 言語のものを取る。
	emotionPromptsPackIDPrefix = "emotion-prompts-"
)

// emotionPromptsSampleRequest は POST /api/characters/emotion-prompts/download-sample の入力。
type emotionPromptsSampleRequest struct {
	Lang string `json:"lang"`
}

// emotionPromptsSampleResponse はサンプルパック取り込みの結果。
type emotionPromptsSampleResponse struct {
	Version string `json:"version"`
	Added   int    `json:"added"`
	Skipped int    `json:"skipped"`
	Prompts any    `json:"prompts"`
}

// pathParamDirName は tags.json 書き込み先のキャラディレクトリ名。
const pathParamDirName = "dirName"

// errKeyCharacterNotFound はキャラディレクトリ未存在（未保存キャラへの付随設定書き込み）。
const errKeyCharacterNotFound = i18n.KeyErrorCharacterNotFound

// saveTagsRequest は PUT /api/character-tags/{dirName} の入力。
type saveTagsRequest struct {
	Work *string  `json:"work"`
	Tags []string `json:"tags"`
}

// saveTagsResponse は書き込んだ tags と再構築後のマスタ。
type saveTagsResponse struct {
	Work    *string  `json:"work"`
	Tags    []string `json:"tags"`
	Filters any      `json:"filters"`
	Stats   any      `json:"stats"`
}

// path / form のフィールド名。
// handler とテストで意味がずれないよう、文字列はここに集約する。
const (
	pathParamCharacterName = "name"
	pathParamImagePath     = "path"
	pathParamEmotion       = "emotion"
	formFieldEmotion       = "emotion"
	formFieldImage         = "image"
)

// キャラクター画像 API が返す利用者向けエラーの i18n キー。
const (
	errKeyInvalidImageUploadForm   = i18n.KeyErrorInvalidImageUploadForm
	errKeyImageFileRequired        = i18n.KeyErrorImageFileRequired
	errKeyImageCropDataRequired    = i18n.KeyErrorImageCropDataRequired
	errKeySourceImageNotFound      = i18n.KeyErrorSourceImageNotFound
	errKeyUnsupportedCropImageType = i18n.KeyErrorUnsupportedCropImageType
	errKeyInvalidCropData          = i18n.KeyErrorInvalidCropData
	errKeyImageEmotionRequired     = i18n.KeyErrorImageEmotionRequired
	errKeyImageTooLarge            = i18n.KeyErrorImageTooLarge
	errKeyUnsupportedImageType     = i18n.KeyErrorUnsupportedImageType
	errKeyInvalidImagePath         = i18n.KeyErrorInvalidImagePath
	errKeyInvalidName              = i18n.KeyErrorInvalidName
	errKeyEmotionNameInvalid       = i18n.KeyErrorEmotionNameInvalid
	errKeyEmotionNameDuplicate     = i18n.KeyErrorEmotionNameDuplicate
	errKeyEmotionDefaultRequired   = i18n.KeyErrorEmotionDefaultRequired
	errKeyEmotionCatalogMissing    = i18n.KeyErrorEmotionCatalogMissing
)

// multipartReaderOverheadBytes は multipart の境界・ヘッダ分を許容する余白。
const multipartReaderOverheadBytes = 1024 * 1024

// charactersResponse は /api/character-tags の互換レスポンス。
type charactersResponse struct {
	Characters any `json:"characters"`
}

// apiDataResponse は画像系 API の共通成功レスポンス。
type apiDataResponse struct {
	Success bool `json:"success"`
	Data    any  `json:"data"`
}
