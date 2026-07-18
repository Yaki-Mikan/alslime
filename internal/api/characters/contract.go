package characters

import "alslime/internal/i18n"

// キャラクター系 API の route 断片。
// config.APIPrefix や config.CharacterImagesRoute と組み合わせて登録する。
const (
	routeCharacterTags           = "/character-tags"
	routeCharacterFilters        = "/character-filters"
	routeCharacterFiltersRebuild = "/character-filters/rebuild"
	routeCharacterEmotions       = "/characters/emotions"
	routeCharacterImages         = "/characters/{name}/images"
	routeCharacterImageUpload    = "/characters/{name}/images/upload"
	routeCharacterImageCrop      = "/characters/{name}/images/crop"
	routeCharacterImageDelete    = "/characters/{name}/images/{emotion}"
	routeStaticCharacterImage    = "/{name}/{path...}"
)

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
