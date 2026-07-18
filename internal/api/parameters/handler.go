// Package parameters は項目設定（schema）とパラメータプリセットの HTTP ハンドラを提供する。
//
// API 契約は現行 Node 版維持（交換日記 17）。統一プリセット契約へは寄せない。
//   - GET    /api/parameters/schemas              -> { schemas: [{ id, name }] }
//   - GET    /api/parameters/schema/{schemaId}    -> { schema }
//   - POST   /api/parameters/schemas              body: ParameterSchema -> { success, message, schemaId }
//   - PUT    /api/parameters/schemas/{schemaId}   body: ParameterSchema -> { success, message, schemaId }
//   - DELETE /api/parameters/schemas/{schemaId}   -> { success, message }
//   - GET    /api/parameters/presets/{schemaId}          -> { presets: string[] }
//   - GET    /api/parameters/presets/{schemaId}/{name}   -> { preset }
//   - POST   /api/parameters/presets/{schemaId}          body: { name, parameterGroups } -> { success, preset }
//   - DELETE /api/parameters/presets/{schemaId}/{name}   -> { success }
//
// handler は薄く保ち、検証・永続化は domain/parameters service へ委譲する。
package parameters

import (
	"encoding/json"
	"errors"
	"net/http"

	"alslime/internal/api/apierror"
	"alslime/internal/api/apiresponse"
	"alslime/internal/config"
	paramsvc "alslime/internal/domain/parameters"
	storage "alslime/internal/storage/parameters"
	"alslime/internal/storage/presetname"
)

// Register は Parameters 系ルートを mux へ登録する。
func Register(mux *http.ServeMux, svc *paramsvc.Service) {
	base := config.APIPrefix + routeBase
	mux.HandleFunc(http.MethodGet+" "+base+routeSchemas, handleListSchemas(svc))
	mux.HandleFunc(http.MethodGet+" "+base+routeSchema, handleGetSchema(svc))
	mux.HandleFunc(http.MethodPost+" "+base+routeSchemas, handleCreateSchema(svc))
	mux.HandleFunc(http.MethodPut+" "+base+routeSchemaByID, handleUpdateSchema(svc))
	mux.HandleFunc(http.MethodDelete+" "+base+routeSchemaByID, handleDeleteSchema(svc))

	mux.HandleFunc(http.MethodGet+" "+base+routePresets, handleListPresets(svc))
	mux.HandleFunc(http.MethodGet+" "+base+routePresetByName, handleGetPreset(svc))
	mux.HandleFunc(http.MethodPost+" "+base+routePresets, handleSavePreset(svc))
	mux.HandleFunc(http.MethodDelete+" "+base+routePresetByName, handleDeletePreset(svc))
}

// ---- schema handlers ----

type schemaListItemJSON struct {
	ID   string `json:"id"`
	Name any    `json:"name"`
}

func handleListSchemas(svc *paramsvc.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		items, err := svc.ListSchemas()
		if err != nil {
			apierror.Write(w, apierror.Internal(err))
			return
		}
		out := make([]schemaListItemJSON, 0, len(items))
		for _, it := range items {
			out = append(out, schemaListItemJSON{ID: it.ID, Name: it.Name})
		}
		writeJSON(w, schemasResponse{Schemas: out})
	}
}

func handleGetSchema(svc *paramsvc.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue(pathParamSchemaID)
		schema, err := svc.GetSchema(id)
		if err != nil {
			writeSchemaError(w, err)
			return
		}
		writeJSON(w, schemaResponse{Schema: schema})
	}
}

func handleCreateSchema(svc *paramsvc.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		data, err := decodeObject(r)
		if err != nil {
			apierror.Write(w, apierror.BadRequestKey(errKeyInvalidJSONBody))
			return
		}
		id, err := svc.CreateSchema(data)
		if err != nil {
			writeSchemaError(w, err)
			return
		}
		writeJSON(w, newKeyedMessageResponse(msgKeySchemaCreated, id))
	}
}

func handleUpdateSchema(svc *paramsvc.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pathID := r.PathValue(pathParamSchemaID)
		data, err := decodeObject(r)
		if err != nil {
			apierror.Write(w, apierror.BadRequestKey(errKeyInvalidJSONBody))
			return
		}
		id, err := svc.UpdateSchema(pathID, data)
		if err != nil {
			writeSchemaError(w, err)
			return
		}
		writeJSON(w, newKeyedMessageResponse(msgKeySchemaUpdated, id))
	}
}

func handleDeleteSchema(svc *paramsvc.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue(pathParamSchemaID)
		if err := svc.DeleteSchema(id); err != nil {
			writeSchemaError(w, err)
			return
		}
		writeJSON(w, newKeyedMessageResponse(msgKeySchemaDeleted, ""))
	}
}

// ---- preset handlers ----

func handleListPresets(svc *paramsvc.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sid := r.PathValue(pathParamSchemaID)
		names, err := svc.ListPresets(sid)
		if err != nil {
			writePresetError(w, err)
			return
		}
		if names == nil {
			names = []string{}
		}
		writeJSON(w, presetsResponse{Presets: names})
	}
}

func handleGetPreset(svc *paramsvc.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sid := r.PathValue(pathParamSchemaID)
		name := r.PathValue(pathParamPresetName)
		preset, err := svc.GetPreset(sid, name)
		if err != nil {
			writePresetError(w, err)
			return
		}
		writeJSON(w, presetResponse{Preset: preset})
	}
}

type savePresetRequest struct {
	Name            string `json:"name"`
	ParameterGroups any    `json:"parameterGroups"`
}

func handleSavePreset(svc *paramsvc.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sid := r.PathValue(pathParamSchemaID)
		var req savePresetRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			apierror.Write(w, apierror.BadRequestKey(errKeyInvalidJSONBody))
			return
		}
		if req.Name == "" {
			apierror.Write(w, apierror.BadRequestKey(errKeyPresetNameInvalid))
			return
		}
		if req.ParameterGroups == nil {
			apierror.Write(w, apierror.BadRequestKey(errKeyParameterGroupsRequired))
			return
		}
		savedName, err := svc.SavePreset(sid, req.Name, req.ParameterGroups)
		if err != nil {
			writePresetError(w, err)
			return
		}
		// 現行は { success, preset } を返す。preset.name は保存された正本名（正規化後）。
		// 例: "  朝  " 保存でファイル・レスポンスとも "朝"（レビュー20 指摘1）。
		writeJSON(w, savePresetResponse{
			Success: true,
			Preset:  savedPresetBody{Name: savedName, ParameterGroups: req.ParameterGroups},
		})
	}
}

func handleDeletePreset(svc *paramsvc.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sid := r.PathValue(pathParamSchemaID)
		name := r.PathValue(pathParamPresetName)
		if err := svc.DeletePreset(sid, name); err != nil {
			writePresetError(w, err)
			return
		}
		writeJSON(w, successResponse{Success: true})
	}
}

// ---- error mapping ----

// writeSchemaError は schema 系ドメインエラーを HTTP ステータスへ変換する。
func writeSchemaError(w http.ResponseWriter, err error) {
	var invalid *paramsvc.SchemaInvalidError
	switch {
	case errors.As(err, &invalid):
		// 400 + バリデーション詳細（現行 { error, details }）。
		apierror.WriteWithDetails(w, http.StatusBadRequest, errKeySchemaInvalid, invalid.Errors)
	case errors.Is(err, paramsvc.ErrSchemaIDInvalid):
		apierror.Write(w, apierror.BadRequestKey(errKeySchemaIDInvalid))
	case errors.Is(err, paramsvc.ErrSchemaIDMismatch):
		apierror.Write(w, apierror.BadRequestKey(errKeySchemaIDMismatch))
	case errors.Is(err, paramsvc.ErrSchemaNotFound):
		apierror.Write(w, apierror.NotFoundKey(errKeySchemaNotFound))
	case errors.Is(err, paramsvc.ErrSchemaIDConflict):
		apierror.Write(w, apierror.NewKey(http.StatusConflict, errKeySchemaIDConflict))
	case errors.Is(err, paramsvc.ErrDefaultNotDeletable):
		apierror.Write(w, apierror.ForbiddenKey(errKeyDefaultNotDeletable))
	default:
		apierror.Write(w, apierror.Internal(err))
	}
}

// writePresetError は preset 系ドメインエラーを HTTP ステータスへ変換する。
func writePresetError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, paramsvc.ErrSchemaIDInvalid):
		apierror.Write(w, apierror.BadRequestKey(errKeySchemaIDInvalid))
	case errors.Is(err, storage.ErrPresetNotFound):
		apierror.Write(w, apierror.NotFoundKey(errKeyPresetNotFound))
	case errors.Is(err, storage.ErrNameConflict):
		apierror.Write(w, apierror.NewKey(http.StatusConflict, errKeyPresetNameConflict))
	case isPresetNameError(err):
		apierror.Write(w, apierror.BadRequestKey(errKeyPresetNameInvalid))
	default:
		apierror.Write(w, apierror.Internal(err))
	}
}

// isPresetNameError は presetname の検証エラー（利用者起因の 400 相当）かを返す。
func isPresetNameError(err error) bool {
	return errors.Is(err, presetname.ErrEmpty) ||
		errors.Is(err, presetname.ErrTooLong) ||
		errors.Is(err, presetname.ErrInvalidChar) ||
		errors.Is(err, presetname.ErrReserved) ||
		errors.Is(err, presetname.ErrTrailing)
}

// decodeObject はリクエストボディを JSON オブジェクトとして読む。
func decodeObject(r *http.Request) (map[string]any, error) {
	var data map[string]any
	if err := json.NewDecoder(r.Body).Decode(&data); err != nil {
		return nil, err
	}
	if data == nil {
		return nil, errors.New("empty body")
	}
	return data, nil
}

// writeJSON は 200 で JSON を書き出す。
func writeJSON(w http.ResponseWriter, v any) {
	if err := apiresponse.WriteJSON(w, http.StatusOK, v); err != nil {
		apierror.Write(w, apierror.Internal(err))
	}
}
