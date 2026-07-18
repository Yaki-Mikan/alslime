package configeditor

import "alslime/internal/i18n"

// Config Editor API の route / path 断片。
const (
	routeBase             = "/config-editor"
	routeCategories       = "/categories"
	routeFiles            = "/files/{categoryId}"
	routeFile             = "/file/{categoryId}/{dirName}/{fileName}"
	routeFileExists       = "/file/{categoryId}/{dirName}/{fileName}/exists"
	routeTemplates        = "/templates/{categoryId}"
	routeTemplate         = "/template/{categoryId}/{name}"
	routeTemplateExists   = "/template/{categoryId}/{name}/exists"
	routeDefaults         = "/defaults"
	routeInitialContent   = "/initial-content/{categoryId}"
	pathParamCategoryID   = "categoryId"
	pathParamDirName      = "dirName"
	pathParamFileName     = "fileName"
	pathParamTemplateName = "name"

	// AIプロバイダ指示ファイル（固定ファイル種別。設計 §8）。
	// 編集のみ許可のため GET/POST だけを登録し、DELETE ルートは存在させない。
	routeProviderInstructions = "/provider-instructions"
	routeProviderInstruction  = "/provider-instruction/{providerId}"
	pathParamProviderID       = "providerId"

	// タグ判定指示ファイル（固定ファイル機構の流用。設計 §9）。
	// D 分類のため FeatureComfyUI の gate を通す。こちらも GET/POST のみ。
	routeComfyDirectives = "/comfy-directives"
	routeComfyDirective  = "/comfy-directive/{directiveId}"
	pathParamDirectiveID = "directiveId"
)

// Config Editor API が返す利用者向けエラーの i18n キー。
const (
	errKeyInvalidJSONBody  = i18n.KeyErrorInvalidJSONBody
	errKeyCategoryRequired = i18n.KeyErrorCategoryRequired
	errKeyContentRequired  = i18n.KeyErrorContentRequired
	errKeyUnknownCategory  = i18n.KeyErrorUnknownCategory
	errKeyInvalidName      = i18n.KeyErrorInvalidName
	errKeyPathForbidden    = i18n.KeyErrorPathForbidden
	errKeyTargetNotFound   = i18n.KeyErrorTargetNotFound
)

type contentResponse struct {
	Content string `json:"content"`
}

type existsResponse struct {
	Exists bool `json:"exists"`
}

type successResponse struct {
	Success bool `json:"success"`
}

// savedResponse は保存結果（重複時リネームで確定した名前を返す）。
type savedResponse struct {
	Success bool   `json:"success"`
	Name    string `json:"name"`
}
