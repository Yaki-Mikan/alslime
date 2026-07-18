package presets

import "alslime/internal/i18n"

// プリセット API の path parameter 名。
const pathParamName = "name"

// プリセット API が返す利用者向けエラーの i18n キー。
const (
	errKeyInvalidJSONBody    = i18n.KeyErrorInvalidJSONBody
	errKeyNameRequired       = i18n.KeyErrorNameRequired
	errKeyDataRequired       = i18n.KeyErrorDataRequired
	errKeyPresetNotFound     = i18n.KeyErrorPresetNotFound
	errKeyPresetNameConflict = i18n.KeyErrorPresetNameConflict
	errKeyPresetNameInvalid  = i18n.KeyErrorPresetNameInvalid
)
