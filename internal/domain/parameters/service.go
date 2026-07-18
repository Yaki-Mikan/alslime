// Package parameters は項目設定（schema）とパラメータプリセットのユースケースを担う。
//
// 現行 Node 版 routes/parameters.ts のビジネスロジックを service へ移す:
//   - schema: 一覧 / 取得 / 作成（重複 409）/ 更新（path/body 不一致 400）/ 削除（default 403）
//   - preset: schemaId 単位の一覧 / 取得 / 保存 / 削除
//
// HTTP の詳細（ステータス・レスポンス形）は api/parameters handler が持ち、
// service はドメインのエラー（型）を返す。
package parameters

import (
	"errors"

	storage "alslime/internal/storage/parameters"
	"alslime/internal/storage/parameters/schemaid"
)

const (
	errKeySchemaInvalid       = "error.schemaInvalid"
	errKeySchemaIDInvalid     = "error.schemaIdInvalid"
	errKeySchemaNotFound      = "error.schemaNotFound"
	errKeySchemaIDConflict    = "error.schemaIdConflict"
	errKeySchemaIDMismatch    = "error.schemaIdMismatch"
	errKeyDefaultNotDeletable = "error.defaultNotDeletable"
)

// ドメインエラー。handler が HTTP ステータスへマッピングする。
var (
	// ErrSchemaInvalid は schema バリデーション失敗。詳細は ValidationError 群で返す。
	ErrSchemaInvalid = errors.New(errKeySchemaInvalid)
	// ErrSchemaIDInvalid は schemaId 形式が不正。
	ErrSchemaIDInvalid = errors.New(errKeySchemaIDInvalid)
	// ErrSchemaNotFound は指定 schemaId が見つからない。
	ErrSchemaNotFound = errors.New(errKeySchemaNotFound)
	// ErrSchemaIDConflict は作成時に schemaId が既存と重複。
	ErrSchemaIDConflict = errors.New(errKeySchemaIDConflict)
	// ErrSchemaIDMismatch は更新時に path と body の schemaId が食い違う。
	ErrSchemaIDMismatch = errors.New(errKeySchemaIDMismatch)
	// ErrDefaultNotDeletable はデフォルト項目設定の削除を拒否する。
	ErrDefaultNotDeletable = errors.New(errKeyDefaultNotDeletable)
)

// SchemaInvalidError はバリデーション詳細を保持するエラー。
type SchemaInvalidError struct {
	Errors []ValidationError
}

func (e *SchemaInvalidError) Error() string { return ErrSchemaInvalid.Error() }
func (e *SchemaInvalidError) Unwrap() error { return ErrSchemaInvalid }

// Service は Parameters 系のユースケースを提供する。
type Service struct {
	schemas *storage.SchemaStore
	presets *storage.PresetStore
}

// New は Service を生成する。
func New(schemas *storage.SchemaStore, presets *storage.PresetStore) *Service {
	return &Service{schemas: schemas, presets: presets}
}

// ---- schema ----

// ListSchemas は {id, name} 一覧を返す。
func (s *Service) ListSchemas() ([]storage.ListItem, error) {
	return s.schemas.List()
}

// GetSchema は schemaId の schema 全体を返す。
//
// schemaId 形式を検証し、見つからなければ ErrSchemaNotFound、
// 内容が不正なら *SchemaInvalidError を返す。
func (s *Service) GetSchema(id string) (map[string]any, error) {
	validID, err := schemaid.Validate(id)
	if err != nil {
		return nil, ErrSchemaIDInvalid
	}
	data, _, ok, err := s.schemas.Find(validID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrSchemaNotFound
	}
	if verrs := ValidateSchema(data); len(verrs) > 0 {
		return nil, &SchemaInvalidError{Errors: verrs}
	}
	return data, nil
}

// CreateSchema は新規 schema を作成する。
//
// バリデーション → schemaId 形式 → 既存重複（409）→ 保存。
// 戻り値は保存された schemaId。
func (s *Service) CreateSchema(data map[string]any) (string, error) {
	if verrs := ValidateSchema(data); len(verrs) > 0 {
		return "", &SchemaInvalidError{Errors: verrs}
	}
	id, _ := data["schemaId"].(string)
	validID, err := schemaid.Validate(id)
	if err != nil {
		return "", ErrSchemaIDInvalid
	}
	exists, err := s.schemas.Exists(validID)
	if err != nil {
		return "", err
	}
	if exists {
		return "", ErrSchemaIDConflict
	}
	if err := s.schemas.Save(validID, data); err != nil {
		return "", err
	}
	return validID, nil
}

// UpdateSchema は既存 schema を更新する。
//
// path の schemaId と body の schemaId が食い違う場合は ErrSchemaIDMismatch。
// 既存が無ければ ErrSchemaNotFound。更新は元の場所（論理パス）へ上書きする。
func (s *Service) UpdateSchema(pathID string, data map[string]any) (string, error) {
	validPathID, err := schemaid.Validate(pathID)
	if err != nil {
		return "", ErrSchemaIDInvalid
	}
	if verrs := ValidateSchema(data); len(verrs) > 0 {
		return "", &SchemaInvalidError{Errors: verrs}
	}
	bodyID, _ := data["schemaId"].(string)
	validBodyID, err := schemaid.Validate(bodyID)
	if err != nil {
		return "", ErrSchemaIDInvalid
	}
	// path と body の schemaId 不一致は 400（交換日記 17）。
	if validBodyID != validPathID {
		return "", ErrSchemaIDMismatch
	}

	_, logical, ok, err := s.schemas.Find(validPathID)
	if err != nil {
		return "", err
	}
	if !ok {
		return "", ErrSchemaNotFound
	}
	if err := s.schemas.SaveAt(logical, data); err != nil {
		return "", err
	}
	return validPathID, nil
}

// DeleteSchema は custom schema を削除する。
//
// default は削除不可（ErrDefaultNotDeletable）。見つからなければ ErrSchemaNotFound。
func (s *Service) DeleteSchema(id string) error {
	validID, err := schemaid.Validate(id)
	if err != nil {
		return ErrSchemaIDInvalid
	}
	if schemaid.IsDefault(validID) {
		return ErrDefaultNotDeletable
	}
	ok, err := s.schemas.Delete(validID)
	if err != nil {
		return err
	}
	if !ok {
		return ErrSchemaNotFound
	}
	return nil
}

// ---- preset ----

// ListPresets は schemaId のプリセット名一覧を返す。
func (s *Service) ListPresets(sid string) ([]string, error) {
	validID, err := schemaid.Validate(sid)
	if err != nil {
		return nil, ErrSchemaIDInvalid
	}
	return s.presets.List(validID)
}

// GetPreset は schemaId 内の name のプリセット要素（{name, parameterGroups}）を返す。
func (s *Service) GetPreset(sid, name string) (map[string]any, error) {
	validID, err := schemaid.Validate(sid)
	if err != nil {
		return nil, ErrSchemaIDInvalid
	}
	return s.presets.Get(validID, name)
}

// SavePreset は schemaId 内へ preset を保存し、保存された正規化済み正本名を返す。
//
// 入力 name は前後空白等を含み得るため、保存された正本名を返す
// （プリセット CRUD と同じく「保存された正本名」を契約とする。レビュー20 指摘1）。
func (s *Service) SavePreset(sid, name string, parameterGroups any) (string, error) {
	validID, err := schemaid.Validate(sid)
	if err != nil {
		return "", ErrSchemaIDInvalid
	}
	return s.presets.Save(validID, name, parameterGroups)
}

// DeletePreset は schemaId 内の name を削除する。
func (s *Service) DeletePreset(sid, name string) error {
	validID, err := schemaid.Validate(sid)
	if err != nil {
		return ErrSchemaIDInvalid
	}
	return s.presets.Delete(validID, name)
}
