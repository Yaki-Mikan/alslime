package parameters

import "alslime/internal/i18n"

// Parameters API の route / path 断片。
const (
	routeBase           = "/parameters"
	routeSchemas        = "/schemas"
	routeSchema         = "/schema/{schemaId}"
	routeSchemaByID     = "/schemas/{schemaId}"
	routePresets        = "/presets/{schemaId}"
	routePresetByName   = "/presets/{schemaId}/{name}"
	pathParamSchemaID   = "schemaId"
	pathParamPresetName = "name"
)

// Parameters API が返す利用者向けエラー・メッセージの i18n キー。
const (
	errKeyInvalidJSONBody         = i18n.KeyErrorInvalidJSONBody
	errKeyPresetNameInvalid       = i18n.KeyErrorPresetNameInvalid
	errKeyParameterGroupsRequired = i18n.KeyErrorParameterGroupsRequired
	errKeySchemaInvalid           = i18n.KeyErrorSchemaInvalid
	errKeySchemaIDInvalid         = i18n.KeyErrorSchemaIDInvalid
	errKeySchemaIDMismatch        = i18n.KeyErrorSchemaIDMismatch
	errKeySchemaNotFound          = i18n.KeyErrorSchemaNotFound
	errKeySchemaIDConflict        = i18n.KeyErrorSchemaIDConflict
	errKeyDefaultNotDeletable     = i18n.KeyErrorDefaultNotDeletable
	errKeyPresetNotFound          = i18n.KeyErrorPresetNotFound
	errKeyPresetNameConflict      = i18n.KeyErrorPresetNameConflict
	msgKeySchemaCreated           = i18n.KeyMessageSchemaCreated
	msgKeySchemaUpdated           = i18n.KeyMessageSchemaUpdated
	msgKeySchemaDeleted           = i18n.KeyMessageSchemaDeleted
)

// keyedMessageResponse は旧互換 message と i18n 用 messageKey を返す成功レスポンス。
type keyedMessageResponse struct {
	Success    bool   `json:"success"`
	Message    string `json:"message"`
	MessageKey string `json:"messageKey"`
	SchemaID   string `json:"schemaId,omitempty"`
}

type schemasResponse struct {
	Schemas []schemaListItemJSON `json:"schemas"`
}

type schemaResponse struct {
	Schema any `json:"schema"`
}

type presetsResponse struct {
	Presets []string `json:"presets"`
}

type presetResponse struct {
	Preset any `json:"preset"`
}

type savedPresetBody struct {
	Name            string `json:"name"`
	ParameterGroups any    `json:"parameterGroups"`
}

type savePresetResponse struct {
	Success bool            `json:"success"`
	Preset  savedPresetBody `json:"preset"`
}

type successResponse struct {
	Success bool `json:"success"`
}

// newKeyedMessageResponse は message と messageKey を同じキーで埋める。
func newKeyedMessageResponse(messageKey string, schemaID string) keyedMessageResponse {
	return keyedMessageResponse{Success: true, Message: messageKey, MessageKey: messageKey, SchemaID: schemaID}
}
