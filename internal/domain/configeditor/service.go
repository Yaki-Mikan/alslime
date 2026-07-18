package configeditor

import (
	"errors"
	"fmt"

	storage "alslime/internal/storage/configeditor"
	"alslime/internal/storage/safename"
)

const (
	errKeyUnknownCategory            = "error.unknownCategory"
	errKeyUnknownProviderInstruction = "error.unknownProviderInstruction"
	errKeyUnknownComfyDirective      = "error.unknownComfyDirective"
)

// ErrUnknownCategory は未知の categoryId が指定された場合に返る（handler が 400 へ）。
var ErrUnknownCategory = errors.New(errKeyUnknownCategory)

// ErrUnknownProviderInstruction は未知のプロバイダ指示ファイル id が指定された場合に返る。
var ErrUnknownProviderInstruction = errors.New(errKeyUnknownProviderInstruction)

// ErrUnknownComfyDirective は未知のタグ判定指示ファイル id が指定された場合に返る。
var ErrUnknownComfyDirective = errors.New(errKeyUnknownComfyDirective)

// validateTemplateName はテンプレート名を safename で検証する。
// SaveDefault の非空 templateName 事前検証に使う（保存系と同じ規則）。
func validateTemplateName(name string) (string, error) {
	return safename.Validate(name)
}

// Service は Config Editor のユースケースを提供する。
type Service struct {
	store *storage.Store
}

// New は Service を生成する。
func New(store *storage.Store) *Service {
	return &Service{store: store}
}

// resolveCategory は categoryId を検証して storage 用カテゴリを返す。未知は ErrUnknownCategory。
//
// storage は domain を import できない（循環回避）ため、保存先解決に必要な値だけを
// storage.Category へ詰め替えて返す。Label は storage では不要なので渡さない。
func resolveCategory(id string) (storage.Category, error) {
	cat, ok := FindCategory(id)
	if !ok {
		return storage.Category{}, ErrUnknownCategory
	}
	return storage.Category{
		Dir:             cat.Dir,
		TemplateDirName: cat.TemplateDirName,
		IsCharacter:     cat.IsCharacter,
	}, nil
}

// ---- 設定ファイル ----

// ListFiles はカテゴリ配下の設定ファイル一覧を返す。
func (s *Service) ListFiles(categoryID string) ([]storage.FileEntry, error) {
	cat, err := resolveCategory(categoryID)
	if err != nil {
		return nil, err
	}
	return s.store.ListFiles(cat)
}

// ReadFile は設定ファイル内容を返す。
func (s *Service) ReadFile(categoryID, dirName, fileName string) (string, error) {
	cat, err := resolveCategory(categoryID)
	if err != nil {
		return "", err
	}
	return s.store.ReadFile(cat, dirName, fileName)
}

// FileExists は設定ファイルの存在確認。
func (s *Service) FileExists(categoryID, dirName, fileName string) (bool, error) {
	cat, err := resolveCategory(categoryID)
	if err != nil {
		return false, err
	}
	return s.store.FileExists(cat, dirName, fileName)
}

// WriteFile は設定ファイルを書き込む。
func (s *Service) WriteFile(categoryID, dirName, fileName, content string) error {
	cat, err := resolveCategory(categoryID)
	if err != nil {
		return err
	}
	return s.store.WriteFile(cat, dirName, fileName, content)
}

// DeleteFile は設定ファイルを削除する。
func (s *Service) DeleteFile(categoryID, dirName, fileName string) error {
	cat, err := resolveCategory(categoryID)
	if err != nil {
		return err
	}
	return s.store.DeleteFile(cat, dirName, fileName)
}

// WriteFileUnique は同名衝突時に「名前 (2)」形式の空き名へリネームして保存し、
// 実際に保存したファイル名を返す（D&D 個別インポート用。設計 §7）。
//
// 確認モーダルを出さず黙って上書きもしない、という D&D の要件を
// 「必ず新規名で追加する」ことで満たす。dirName はファイル名と連動して振り直す
// （character カテゴリの新規保存は dirName == fileName の現行規約に合わせる）。
func (s *Service) WriteFileUnique(categoryID, fileName, content string) (string, error) {
	cat, err := resolveCategory(categoryID)
	if err != nil {
		return "", err
	}
	name := fileName
	for n := 2; ; n++ {
		exists, err := s.store.FileExists(cat, name, name)
		if err != nil {
			return "", err
		}
		if !exists {
			break
		}
		if n >= 1000 {
			return "", fmt.Errorf("configeditor: 空き名を確保できない: %s", fileName)
		}
		name = fmt.Sprintf("%s (%d)", fileName, n)
	}
	if err := s.store.WriteFile(cat, name, name, content); err != nil {
		return "", err
	}
	return name, nil
}

// ---- AIプロバイダ指示ファイル（固定ファイル種別。設計 §8） ----

// resolveProviderInstruction は id を検証して定義を返す。未知は ErrUnknownProviderInstruction。
func resolveProviderInstruction(id string) (ProviderInstruction, error) {
	p, ok := FindProviderInstruction(id)
	if !ok {
		return ProviderInstruction{}, ErrUnknownProviderInstruction
	}
	return p, nil
}

// ProviderInstructionStatus は一覧 API 用の 1 件（存在有無付き）。
type ProviderInstructionStatus struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	File   string `json:"file"`
	Exists bool   `json:"exists"`
}

// ListProviderInstructions は指示ファイル定義と存在有無を返す。
func (s *Service) ListProviderInstructions() ([]ProviderInstructionStatus, error) {
	defs := ProviderInstructions()
	out := make([]ProviderInstructionStatus, 0, len(defs))
	for _, p := range defs {
		exists, err := s.store.FixedFileExists(p.File)
		if err != nil {
			return nil, err
		}
		out = append(out, ProviderInstructionStatus{ID: p.ID, Label: p.Label, File: p.File, Exists: exists})
	}
	return out, nil
}

// ReadProviderInstruction は指示ファイル内容を返す。未作成は空文字
// （固定ファイルのため 404 にせず、エディタでは空から書き始められる）。
func (s *Service) ReadProviderInstruction(id string) (string, error) {
	p, err := resolveProviderInstruction(id)
	if err != nil {
		return "", err
	}
	content, exists, rerr := s.store.ReadFixedFile(p.File)
	if rerr != nil {
		return "", rerr
	}
	if !exists {
		return "", nil
	}
	return content, nil
}

// WriteProviderInstruction は指示ファイルを上書き保存する（唯一の変更手段）。
func (s *Service) WriteProviderInstruction(id, content string) error {
	p, err := resolveProviderInstruction(id)
	if err != nil {
		return err
	}
	return s.store.WriteFixedFile(p.File, content)
}

// ---- タグ判定指示ファイル（設計 §9。固定ファイル機構の流用） ----

// ComfyDirectiveStatus は一覧 API 用の 1 件（存在有無付き）。
type ComfyDirectiveStatus struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	File   string `json:"file"`
	Exists bool   `json:"exists"`
}

// resolveComfyDirective は id を検証して定義を返す。未知は ErrUnknownComfyDirective。
func resolveComfyDirective(id string) (ComfyDirective, error) {
	d, ok := FindComfyDirective(id)
	if !ok {
		return ComfyDirective{}, ErrUnknownComfyDirective
	}
	return d, nil
}

// ListComfyDirectives はタグ判定指示ファイル定義と存在有無を返す。
func (s *Service) ListComfyDirectives() ([]ComfyDirectiveStatus, error) {
	defs := ComfyDirectives()
	out := make([]ComfyDirectiveStatus, 0, len(defs))
	for _, d := range defs {
		exists, err := s.store.FixedFileExists(d.File)
		if err != nil {
			return nil, err
		}
		out = append(out, ComfyDirectiveStatus{ID: d.ID, Label: d.Label, File: d.File, Exists: exists})
	}
	return out, nil
}

// ReadComfyDirective は指示ファイル内容を返す。未作成は空文字。
func (s *Service) ReadComfyDirective(id string) (string, error) {
	d, err := resolveComfyDirective(id)
	if err != nil {
		return "", err
	}
	content, exists, rerr := s.store.ReadFixedFile(d.File)
	if rerr != nil {
		return "", rerr
	}
	if !exists {
		return "", nil
	}
	return content, nil
}

// WriteComfyDirective は指示ファイルを上書き保存する。
func (s *Service) WriteComfyDirective(id, content string) error {
	d, err := resolveComfyDirective(id)
	if err != nil {
		return err
	}
	return s.store.WriteFixedFile(d.File, content)
}

// ---- テンプレート ----

// ListTemplates はテンプレート名一覧を返す。
func (s *Service) ListTemplates(categoryID string) ([]string, error) {
	cat, err := resolveCategory(categoryID)
	if err != nil {
		return nil, err
	}
	return s.store.ListTemplates(cat)
}

// ReadTemplate はテンプレート内容を返す。
func (s *Service) ReadTemplate(categoryID, name string) (string, error) {
	cat, err := resolveCategory(categoryID)
	if err != nil {
		return "", err
	}
	return s.store.ReadTemplate(cat, name)
}

// TemplateExists はテンプレートの存在確認。
func (s *Service) TemplateExists(categoryID, name string) (bool, error) {
	cat, err := resolveCategory(categoryID)
	if err != nil {
		return false, err
	}
	return s.store.TemplateExists(cat, name)
}

// WriteTemplate はテンプレートを書き込む。
func (s *Service) WriteTemplate(categoryID, name, content string) error {
	cat, err := resolveCategory(categoryID)
	if err != nil {
		return err
	}
	return s.store.WriteTemplate(cat, name, content)
}

// DeleteTemplate はテンプレートを削除する。
func (s *Service) DeleteTemplate(categoryID, name string) error {
	cat, err := resolveCategory(categoryID)
	if err != nil {
		return err
	}
	return s.store.DeleteTemplate(cat, name)
}

// ---- defaults / 初期本文 ----

// Defaults はデフォルトテンプレート設定を返す。
func (s *Service) Defaults() (map[string]string, error) {
	return s.store.LoadDefaults()
}

// SaveDefault は categoryId のデフォルトテンプレート名を保存する。
//
// categoryId は必須・ホワイトリスト。templateName は空（デフォルト解除）を許可し、
// 非空なら storage 側の safename 検証を通す（WriteTemplate 等と同じ規則）。
// 存在しないテンプレート名でも保存は許可する（現行互換。resolveInitialContent で吸収）。
func (s *Service) SaveDefault(categoryID, templateName string) error {
	if _, err := resolveCategory(categoryID); err != nil {
		return err
	}
	if templateName != "" {
		if _, err := validateTemplateName(templateName); err != nil {
			return err
		}
	}
	return s.store.SaveDefault(categoryID, templateName)
}

// InitialContent はカテゴリ選択時の初期本文を解決する（現行 resolveInitialContent 移植）。
//
//  1. defaults[categoryId] のテンプレートがあればその内容。
//  2. 無ければテンプレートが 1 件だけならその内容（自動適用）。
//  3. それも無ければ空文字。
func (s *Service) InitialContent(categoryID string) (string, error) {
	cat, err := resolveCategory(categoryID)
	if err != nil {
		return "", err
	}

	defaults, err := s.store.LoadDefaults()
	if err != nil {
		return "", err
	}
	if name := defaults[categoryID]; name != "" {
		if content, rerr := s.store.ReadTemplate(cat, name); rerr == nil {
			return content, nil
		}
	}

	templates, err := s.store.ListTemplates(cat)
	if err != nil {
		return "", err
	}
	if len(templates) == 1 {
		if content, rerr := s.store.ReadTemplate(cat, templates[0]); rerr == nil {
			return content, nil
		}
	}
	return "", nil
}
