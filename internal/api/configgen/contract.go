package configgen

import (
	"time"

	"alslime/internal/i18n"
)

// config-gen API の route 断片。
const (
	routeSubmit   = "/config-gen/submit"
	routeStatus   = "/config-gen/status/{jobId}"
	routeCancel   = "/config-gen/cancel/{jobId}"
	routeResearch     = "/config-gen/research/{categoryId}/{dirName}/{characterName}"
	routeResearchList = "/config-gen/research-list/{categoryId}"
	routeActive       = "/config-gen/active"

	pathParamJobID         = "jobId"
	pathParamCategoryID    = "categoryId"
	pathParamDirName       = "dirName"
	pathParamCharacterName = "characterName"
	queryParamSince        = "since"
)

// labelKeyConfigGen はジョブ一覧表示用ラベルの i18n キー。
const labelKeyConfigGen = i18n.KeyLabelConfigGen

func nowUnixMilli() int64 {
	return time.Now().UnixMilli()
}
