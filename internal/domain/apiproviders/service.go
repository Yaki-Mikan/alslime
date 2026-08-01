package apiproviders

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"sync"

	"alslime/internal/logging"
	apistorage "alslime/internal/storage/apiproviders"
	"alslime/internal/storage/paths"
)

// idPattern はサーバー生成 Connection ID の文字集合（`/`・`:` を含まない）。
var idPattern = regexp.MustCompile(`^conn-[a-z0-9]+$`)

// idGenMaxAttempts は ID 採番の衝突時再試行上限。
const idGenMaxAttempts = 10

// cascadeTotalSteps は削除カスケードの総ステップ数。
const cascadeTotalSteps = 5

// CascadeDeps は削除カスケード・整合性チェックが触る他ドメインへの読み出し口。
//
// domain/usermodels は接続先実在確認で本パッケージを参照するため、逆方向は
// 関数注入で受けて循環参照を避ける（結線は app/routes.go）。
type CascadeDeps struct {
	// ListUserModelIDsByConnection は接続先を参照するユーザーモデル ID を列挙する。
	ListUserModelIDsByConnection func(connectionID string) ([]string, error)
	// RemoveUserModelsByConnection は該当 ConnectionID の行を削除し、削除した
	// モデル ID を返す（既に無ければ空で成功。冪等）。
	RemoveUserModelsByConnection func(connectionID string) ([]string, error)
	// DefaultOpenAICompatModel は defaultModels["openai_compat"] の現在値を返す。
	DefaultOpenAICompatModel func() (string, error)
	// ClearDefaultOpenAICompatModel は defaultModels["openai_compat"] を空にする。
	ClearDefaultOpenAICompatModel func() error
	// ListUserModelConnectionIDs は UserModel が参照する全 ConnectionID を返す
	//（起動時整合性チェックの宙吊り検出用）。
	ListUserModelConnectionIDs func() ([]string, error)
}

// Service は openai_compat 接続先のユースケースを提供する。
type Service struct {
	meta     *apistorage.MetaStore
	secrets  *apistorage.SecretStore
	resolver *paths.Resolver
	// idGen は英数字（[a-z0-9]）の識別子片を返す生成器（newJobID と同系。
	// "conn-" 前置は本パッケージが行う）。
	idGen   func() string
	cascade CascadeDeps

	// mu は作成・更新・削除・カスケードの操作全体を直列化する（
	// 接続テスト・一覧取得は対象外）。
	mu sync.Mutex
}

// New は Service を生成する。
func New(meta *apistorage.MetaStore, secrets *apistorage.SecretStore, resolver *paths.Resolver, idGen func() string, cascade CascadeDeps) *Service {
	return &Service{meta: meta, secrets: secrets, resolver: resolver, idGen: idGen, cascade: cascade}
}

// ConnectionView は一覧・保存応答用の接続先表現（メタデータ＋hasApiKey のみ。
// キー値・マスク文字列は返さない）。
type ConnectionView struct {
	apistorage.Connection
	HasAPIKey bool `json:"hasApiKey"`
}

// Input は作成・更新で受けるメタデータ入力。
type Input struct {
	Preset            string
	Label             string
	BaseURL           string
	AuthScheme        string
	Enabled           bool
	ForceNonStreaming bool
	ExtraParams       map[string]any
}

// DeleteResult は削除（dryRun 含む）の影響列挙。
type DeleteResult struct {
	UserModels               []string `json:"userModels"`
	IsDefaultModel           bool     `json:"isDefaultModel"`
	DeletesConnectionPrompts bool     `json:"deletesConnectionPrompts"`
}

// CascadeError は削除カスケードの途中失敗（どのステップまで完了したか）。
type CascadeError struct {
	Step  int    // 失敗したステップ（1 始まり）
	Total int    // 総ステップ数
	Name  string // 失敗ステップの内部名（ログ用）
	Inner error
}

func (e *CascadeError) Error() string {
	return fmt.Sprintf("apiproviders: cascade step %d/%d (%s) failed: %v", e.Step, e.Total, e.Name, e.Inner)
}

func (e *CascadeError) Unwrap() error { return e.Inner }

// List は接続先一覧を hasApiKey 付きで返す。
func (s *Service) List() ([]ConnectionView, error) {
	data, err := s.meta.Load()
	if err != nil {
		return nil, err
	}
	out := make([]ConnectionView, 0, len(data.Connections))
	for _, conn := range data.Connections {
		has, err := s.secrets.HasAPIKey(conn.ID)
		if err != nil {
			return nil, err
		}
		out = append(out, ConnectionView{Connection: conn, HasAPIKey: has})
	}
	return out, nil
}

// Get は ID の接続先を返す（存在しなければ ok=false）。
func (s *Service) Get(id string) (apistorage.Connection, bool, error) {
	data, err := s.meta.Load()
	if err != nil {
		return apistorage.Connection{}, false, err
	}
	for _, conn := range data.Connections {
		if conn.ID == id {
			return conn, true, nil
		}
	}
	return apistorage.Connection{}, false, nil
}

// validateInput は Input を検証し、正規化済みの Connection（ID 未設定）を返す。
func validateInput(in Input) (apistorage.Connection, error) {
	preset, ok := PresetByID(strings.TrimSpace(in.Preset))
	if !ok {
		return apistorage.Connection{}, ErrInvalidPreset
	}
	baseURL, err := ValidateBaseURL(in.BaseURL)
	if err != nil {
		return apistorage.Connection{}, err
	}
	scheme := strings.TrimSpace(in.AuthScheme)
	if scheme == "" {
		scheme = preset.AuthScheme
	}
	if err := ValidateAuthScheme(scheme); err != nil {
		return apistorage.Connection{}, err
	}
	if err := ValidateExtraParams(in.ExtraParams); err != nil {
		return apistorage.Connection{}, err
	}
	label := strings.TrimSpace(in.Label)
	if label == "" {
		label = preset.ID
	}
	return apistorage.Connection{
		Preset:            preset.ID,
		Label:             label,
		BaseURL:           baseURL,
		AuthScheme:        scheme,
		Enabled:           in.Enabled,
		ForceNonStreaming: in.ForceNonStreaming,
		ExtraParams:       in.ExtraParams,
	}, nil
}

// newConnectionID は既存 ID と衝突しない新しい Connection ID を採番する。
func (s *Service) newConnectionID(existing map[string]bool) (string, error) {
	for range idGenMaxAttempts {
		id := "conn-" + strings.ToLower(strings.TrimSpace(s.idGen()))
		if !idPattern.MatchString(id) {
			return "", fmt.Errorf("apiproviders: ID 生成器の出力が文字集合 [a-z0-9] に反する")
		}
		if !existing[id] {
			return id, nil
		}
	}
	return "", fmt.Errorf("apiproviders: 接続先 ID の採番が %d 回連続で衝突", idGenMaxAttempts)
}

// Create は接続先を新規作成する（apiKey は空なら未設定のまま）。
//
// 書き込み順序: 1) 接続別追加指示 ja/en → 2) secrets → 3) meta。
// meta 書き込み失敗時は同一操作内で secrets・追加指示の補償削除を試みる。
func (s *Service) Create(in Input, apiKey string) (ConnectionView, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	conn, err := validateInput(in)
	if err != nil {
		return ConnectionView{}, err
	}

	data, err := s.meta.Load()
	if err != nil {
		return ConnectionView{}, err
	}
	existing := make(map[string]bool, len(data.Connections))
	for _, c := range data.Connections {
		existing[c.ID] = true
	}
	id, err := s.newConnectionID(existing)
	if err != nil {
		return ConnectionView{}, err
	}
	conn.ID = id

	// 1) 接続別追加指示 ja/en を空で生成。
	if err := s.createEmptyInstructions(id); err != nil {
		return ConnectionView{}, err
	}
	// 2) secrets（キー指定時のみ）。
	apiKey = strings.TrimSpace(apiKey)
	if apiKey != "" {
		if err := s.secrets.Set(id, apistorage.ConnectionSecret{APIKey: apiKey}); err != nil {
			s.compensateCreate(id, false)
			return ConnectionView{}, err
		}
	}
	// 3) meta（存在すること＝完全成立の印）。
	data.Connections = append(data.Connections, conn)
	if err := s.meta.Save(data); err != nil {
		s.compensateCreate(id, apiKey != "")
		return ConnectionView{}, err
	}
	return ConnectionView{Connection: conn, HasAPIKey: apiKey != ""}, nil
}

// compensateCreate は Create 途中失敗時の補償削除。
// 補償自体の失敗は孤児として起動時整合性チェック（StartupCheck）に委ねる。
func (s *Service) compensateCreate(id string, secretWritten bool) {
	if secretWritten {
		if err := s.secrets.Delete(id); err != nil {
			logging.Warn("apiproviders: 補償削除（secret）に失敗。起動時チェックで回収する (id=%s): %v", id, err)
		}
	}
	if err := s.removeInstructionDir(id); err != nil {
		logging.Warn("apiproviders: 補償削除（接続別追加指示）に失敗。起動時チェックで回収する (id=%s): %v", id, err)
	}
}

// Update は接続先を更新する。apiKey は 3 値区別（nil=維持／非 nil 非空=上書き／
// clearAPIKey=削除。同時指定は ErrKeyConflict）。
//
// 書き込み順序: 1) secrets（変更時のみ）→ 2) meta。
func (s *Service) Update(id string, in Input, apiKey *string, clearAPIKey bool) (ConnectionView, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if clearAPIKey && apiKey != nil && strings.TrimSpace(*apiKey) != "" {
		return ConnectionView{}, ErrKeyConflict
	}

	conn, err := validateInput(in)
	if err != nil {
		return ConnectionView{}, err
	}

	data, err := s.meta.Load()
	if err != nil {
		return ConnectionView{}, err
	}
	idx := -1
	for i, c := range data.Connections {
		if c.ID == id {
			idx = i
			break
		}
	}
	if idx < 0 {
		return ConnectionView{}, ErrConnectionNotFound
	}
	conn.ID = id

	// 1) secrets（変更時のみ）。
	switch {
	case clearAPIKey:
		if err := s.secrets.Delete(id); err != nil {
			return ConnectionView{}, err
		}
	case apiKey != nil && strings.TrimSpace(*apiKey) != "":
		if err := s.secrets.Set(id, apistorage.ConnectionSecret{APIKey: strings.TrimSpace(*apiKey)}); err != nil {
			return ConnectionView{}, err
		}
	}
	// 2) meta。
	data.Connections[idx] = conn
	if err := s.meta.Save(data); err != nil {
		return ConnectionView{}, err
	}
	has, err := s.secrets.HasAPIKey(id)
	if err != nil {
		return ConnectionView{}, err
	}
	return ConnectionView{Connection: conn, HasAPIKey: has}, nil
}

// DryRunDelete は削除の影響列挙のみ返す（実削除は行わない）。
func (s *Service) DryRunDelete(id string) (DeleteResult, error) {
	if _, ok, err := s.Get(id); err != nil {
		return DeleteResult{}, err
	} else if !ok {
		return DeleteResult{}, ErrConnectionNotFound
	}
	return s.enumerateDelete(id)
}

// enumerateDelete は削除で影響を受ける参照を列挙する。
func (s *Service) enumerateDelete(id string) (DeleteResult, error) {
	userModels, err := s.cascade.ListUserModelIDsByConnection(id)
	if err != nil {
		return DeleteResult{}, err
	}
	if userModels == nil {
		userModels = []string{}
	}
	defaultModel, err := s.cascade.DefaultOpenAICompatModel()
	if err != nil {
		return DeleteResult{}, err
	}
	isDefault := false
	for _, m := range userModels {
		if defaultModel != "" && m == defaultModel {
			isDefault = true
			break
		}
	}
	return DeleteResult{
		UserModels:               userModels,
		IsDefaultModel:           isDefault,
		DeletesConnectionPrompts: true,
	}, nil
}

// Delete は接続先を確認済みカスケードで削除する。
//
// 順序: 1) defaults 解除 → 2) user-models → 3) meta → 4) secrets → 5) 接続別追加指示
// （参照を先に消す）。各ステップは冪等で、途中失敗時は CascadeError を返し、
// 同じ削除要求の再実行で残りが完了する（前方回復）。
func (s *Service) Delete(id string) (DeleteResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok, err := s.Get(id); err != nil {
		return DeleteResult{}, err
	} else if !ok {
		return DeleteResult{}, ErrConnectionNotFound
	}
	result, err := s.enumerateDelete(id)
	if err != nil {
		return DeleteResult{}, err
	}

	// 1) defaults 解除。
	if result.IsDefaultModel {
		if err := s.cascade.ClearDefaultOpenAICompatModel(); err != nil {
			return DeleteResult{}, &CascadeError{Step: 1, Total: cascadeTotalSteps, Name: "defaults", Inner: err}
		}
	}
	// 2) user-models から該当 ConnectionID の行を削除。
	if _, err := s.cascade.RemoveUserModelsByConnection(id); err != nil {
		return DeleteResult{}, &CascadeError{Step: 2, Total: cascadeTotalSteps, Name: "user-models", Inner: err}
	}
	// 3) meta。
	data, err := s.meta.Load()
	if err != nil {
		return DeleteResult{}, &CascadeError{Step: 3, Total: cascadeTotalSteps, Name: "meta", Inner: err}
	}
	kept := make([]apistorage.Connection, 0, len(data.Connections))
	for _, c := range data.Connections {
		if c.ID != id {
			kept = append(kept, c)
		}
	}
	data.Connections = kept
	if err := s.meta.Save(data); err != nil {
		return DeleteResult{}, &CascadeError{Step: 3, Total: cascadeTotalSteps, Name: "meta", Inner: err}
	}
	// 4) secrets。
	if err := s.secrets.Delete(id); err != nil {
		return DeleteResult{}, &CascadeError{Step: 4, Total: cascadeTotalSteps, Name: "secrets", Inner: err}
	}
	// 5) 接続別追加指示。
	if err := s.removeInstructionDir(id); err != nil {
		return DeleteResult{}, &CascadeError{Step: 5, Total: cascadeTotalSteps, Name: "connection-prompts", Inner: err}
	}
	return result, nil
}

// StartupCheck は起動時の整合性チェックを行う。
//
// 回収不能な異常は警告ログに留め、起動自体は失敗させない（ログにキー値は出さない）。
func (s *Service) StartupCheck() {
	data, err := s.meta.Load()
	if err != nil {
		logging.Warn("apiproviders: 起動時チェック: メタデータ読み込みに失敗: %v", err)
		return
	}
	known := make(map[string]bool, len(data.Connections))
	for _, c := range data.Connections {
		known[c.ID] = true
	}

	// 孤児 secret（meta に無い ID）: 復元不能のため自動削除。
	if ids, err := s.secrets.IDs(); err != nil {
		logging.Warn("apiproviders: 起動時チェック: 秘密ストア読み込みに失敗: %v", err)
	} else {
		for _, id := range ids {
			if known[id] {
				continue
			}
			logging.Warn("apiproviders: 孤児 secret を削除する (id=%s)", id)
			if err := s.secrets.Delete(id); err != nil {
				logging.Warn("apiproviders: 孤児 secret の削除に失敗 (id=%s): %v", id, err)
			}
		}
	}

	// 孤児の接続別追加指示ディレクトリ: 自動削除。
	if dirs, err := s.listInstructionDirs(); err != nil {
		logging.Warn("apiproviders: 起動時チェック: 接続別追加指示の列挙に失敗: %v", err)
	} else {
		for _, dir := range dirs {
			if known[dir] {
				continue
			}
			logging.Warn("apiproviders: 孤児の接続別追加指示を削除する (id=%s)", dir)
			if err := s.removeInstructionDir(dir); err != nil {
				logging.Warn("apiproviders: 孤児の接続別追加指示の削除に失敗 (id=%s): %v", dir, err)
			}
		}
	}

	// 接続別追加指示の欠落: 欠落ファイルだけを空で再生成（既存は上書きしない）。
	for _, c := range data.Connections {
		if err := s.ensureInstructionFiles(c.ID); err != nil {
			logging.Warn("apiproviders: 接続別追加指示の再生成に失敗 (id=%s): %v", c.ID, err)
		}
	}

	// UserModel の宙吊り参照: 警告ログのみ（自動削除しない。送信時に明示エラー）。
	if s.cascade.ListUserModelConnectionIDs != nil {
		if refs, err := s.cascade.ListUserModelConnectionIDs(); err == nil {
			for _, id := range refs {
				if id != "" && !known[id] {
					logging.Warn("apiproviders: ユーザーモデルが存在しない接続先を参照している (id=%s)", id)
				}
			}
		}
	}
}

// IsValidationError は err が保存時検証エラー（BadRequest 相当）かどうかを返す。
func IsValidationError(err error) bool {
	for _, target := range []error{
		ErrInvalidBaseURL,
		ErrHTTPNotAllowed,
		ErrInvalidAuthScheme,
		ErrInvalidPreset,
		ErrExtraParamsReservedKey,
		ErrExtraParamsSecretKey,
		ErrExtraParamsEmptyKey,
		ErrKeyConflict,
		ErrRemoteModelInvalid,
		ErrInstructionTooLarge,
		ErrInstructionInvalidUTF8,
	} {
		if errors.Is(err, target) {
			return true
		}
	}
	return false
}
