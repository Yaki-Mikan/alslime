// Package sessions は配布版の統一セッション読み書きを扱う。
//
// Phase 9 初期段階では、外部 CLI のネイティブ履歴同期はまだ行わない。
// WORKSPACE_ROOT 配下の unified_sessions を正本として読み書きし、
// Chat / Session API の契約を先に固める。
package sessions

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"alslime/internal/config"
	"alslime/internal/domain/models"
	"alslime/internal/i18n"
	"alslime/internal/storage/jsonstore"
	"alslime/internal/storage/paths"
	"alslime/internal/storage/safename"
)

// ModelType はセッションが最後に使う provider 種別。
type ModelType string

const (
	ModelGemini      ModelType = "gemini"
	ModelClaude      ModelType = "claude"
	ModelAntigravity ModelType = "antigravity"
)

var (
	// ErrInvalidUnifiedSession は統一セッション JSON が正しい構造でない場合のエラー。
	ErrInvalidUnifiedSession = errors.New(i18n.KeyErrorInvalidUnifiedSession)
	// ErrMessageNotFound は履歴更新対象の messageId が存在しない場合のエラー。
	ErrMessageNotFound = errors.New(i18n.KeyErrorMessageNotFound)
)

// Message はフロントへ返す履歴メッセージ。
type Message struct {
	ID          string `json:"id,omitempty"`
	Role        string `json:"role"`
	Content     string `json:"content"`
	Model       string `json:"model,omitempty"`
	Timestamp   string `json:"timestamp,omitempty"`
	SessionTime any    `json:"sessionTime,omitempty"`
	TurnTimes   any    `json:"turnTimes,omitempty"`
	ErrorType   string `json:"errorType,omitempty"`
}

// Binding は provider ごとのネイティブ sessionId を保持する。
type Binding struct {
	NativeSessionID string `json:"nativeSessionId"`
}

// Bindings は統一セッションの provider 紐付け。
type Bindings struct {
	ActiveModelType ModelType `json:"activeModelType"`
	Gemini          *Binding  `json:"gemini,omitempty"`
	Claude          *Binding  `json:"claude,omitempty"`
	Antigravity     *Binding  `json:"antigravity,omitempty"`
}

// UnifiedSession は配布版の統一セッション正本。
type UnifiedSession struct {
	SchemaVersion  int            `json:"schemaVersion"`
	SessionID      string         `json:"sessionId"`
	Title          string         `json:"title"`
	CreatedAt      string         `json:"createdAt,omitempty"`
	LastUpdated    string         `json:"lastUpdated"`
	IsSSRP         bool           `json:"isSSRP"`
	SSRPSettings   map[string]any `json:"ssrpSettings,omitempty"`
	UIState        map[string]any `json:"uiState,omitempty"`
	Bindings       Bindings       `json:"bindings"`
	ContextEntries []any          `json:"contextEntries"`
	Messages       []Message      `json:"messages"`
	Generation     any            `json:"generation,omitempty"`
	ImportState    any            `json:"importState,omitempty"`
}

// sessionMeta は一覧・ネイティブID収集用の軽量デコード先。
// UnifiedSession 全体（Messages 本文・ContextEntries 等で数十KB〜数MB/件）を
// デコードすると一覧表示がセッション数に比例して重くなるため、必要なメタ情報だけ取り出す。
// Messages は validSessionMeta の存在確認（validSession と同等の判定）のためだけに
// 要素を空 struct で捨てて走査し、本文のアロケーションを避ける。
type sessionMeta struct {
	SchemaVersion int        `json:"schemaVersion"`
	SessionID     string     `json:"sessionId"`
	Title         string     `json:"title"`
	LastUpdated   string     `json:"lastUpdated"`
	IsSSRP        bool       `json:"isSSRP"`
	Bindings      Bindings   `json:"bindings"`
	Messages      []struct{} `json:"messages"`
}

// validSessionMeta は validSession と同じ判定を軽量デコード結果に対して行う。
func validSessionMeta(session sessionMeta) bool {
	return session.SchemaVersion == 1 && session.SessionID != "" && session.Messages != nil
}

// ListItem は /api/sessions が返す一覧要素。
type ListItem struct {
	Index     int       `json:"index"`
	Title     string    `json:"title"`
	TimeAgo   string    `json:"timeAgo"`
	ID        string    `json:"id"`
	Timestamp int64     `json:"timestamp,omitempty"`
	IsSSRP    bool      `json:"isSSRP,omitempty"`
	ModelType ModelType `json:"modelType,omitempty"`
}

// NewSessionState は /api/sessions/new で次回送信用に保持する軽い状態。
type NewSessionState struct {
	ModelType    ModelType      `json:"modelType"`
	SSRPSettings map[string]any `json:"ssrpSettings,omitempty"`
	UpdatedAt    string         `json:"updatedAt"`
}

// Service は統一セッションの読み書きサービス。
type Service struct {
	resolver *paths.Resolver
	mu       sync.Mutex
	pending  map[ModelType]NewSessionState
	// locks はセッションIDごとの read-modify-write 直列化用ミューテックス。
	// Go の net/http はリクエスト毎に並行実行されるため、同一セッションへの
	// 「読み→変更→全置換保存」が重なると片方の更新が消える（Node はシングル
	// スレッドだったので不要だった防御）。単一プロセス前提のプロセス内ロック。
	locks sync.Map // map[string]*sync.Mutex
	// legacyMu / legacyStamp は legacy セッション取り込みの mtime ガード。
	// ディレクトリが前回取り込み時から変わっていなければ走査をスキップする。
	legacyMu      sync.Mutex
	legacyChecked bool
	legacyStamp   time.Time
}

// New は Service を生成する。
func New(resolver *paths.Resolver) *Service {
	return &Service{
		resolver: resolver,
		pending:  make(map[ModelType]NewSessionState),
	}
}

// List は統一セッション一覧を lastUpdated 降順で返す。
func (s *Service) List() ([]ListItem, error) {
	dir, err := s.ensureDir()
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []ListItem{}, nil
		}
		return nil, err
	}

	items := make([]ListItem, 0, len(entries))
	for _, entry := range entries {
		// jsonstore の一時ファイルは ".tmp-*.json"（接頭辞 .tmp-）。
		// クラッシュで残った一時ファイルをセッションとして列挙しない。
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") || strings.HasPrefix(entry.Name(), ".tmp") {
			continue
		}
		var session sessionMeta
		if err := jsonstore.ReadJSON(filepath.Join(dir, entry.Name()), &session); err != nil {
			continue
		}
		if !validSessionMeta(session) {
			continue
		}
		ts := parseTimeMs(session.LastUpdated)
		items = append(items, ListItem{
			Index:     0,
			Title:     session.Title,
			TimeAgo:   timeAgo(ts),
			ID:        session.SessionID,
			Timestamp: ts,
			IsSSRP:    session.IsSSRP,
			ModelType: session.Bindings.ActiveModelType,
		})
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Timestamp > items[j].Timestamp })
	return items, nil
}

// History は指定セッションの履歴を返す。
func (s *Service) History(sessionID string) ([]Message, error) {
	session, err := s.Read(sessionID)
	if err != nil {
		return nil, err
	}
	return session.Messages, nil
}

// Config は指定セッションの SSRP 設定を返す。
func (s *Service) Config(sessionID string) (map[string]any, bool, error) {
	session, err := s.Read(sessionID)
	if err != nil {
		return nil, false, err
	}
	if session.SSRPSettings == nil {
		return nil, false, nil
	}
	return session.SSRPSettings, session.IsSSRP, nil
}

// LiveNativeSessionIDs は現存する全統一セッションが参照するネイティブセッションID集合を
// モデル種別ごとに返す。
//
// ハウスキーピングが「正本（統一セッション）から到達できないネイティブ履歴のみ削除する」
// ためのガード材料。中間ファイル正本が存在する＝再生成可能なので、ここに含まれないネイティブは
// 安全に掃除できる。読み取り失敗したセッションは安全側でスキップする（消し過ぎ防止）。
func (s *Service) LiveNativeSessionIDs() (map[ModelType]map[string]struct{}, error) {
	live := map[ModelType]map[string]struct{}{
		ModelGemini:      {},
		ModelClaude:      {},
		ModelAntigravity: {},
	}
	dir, err := s.ensureDir()
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return live, nil
		}
		return nil, err
	}
	add := func(model ModelType, binding *Binding) {
		if binding == nil {
			return
		}
		id := strings.TrimSpace(binding.NativeSessionID)
		if id != "" {
			live[model][id] = struct{}{}
		}
	}
	for _, entry := range entries {
		// jsonstore の一時ファイルは ".tmp-*.json"（接頭辞 .tmp-）。
		// クラッシュで残った一時ファイルをセッションとして列挙しない。
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") || strings.HasPrefix(entry.Name(), ".tmp") {
			continue
		}
		var session sessionMeta
		if err := jsonstore.ReadJSON(filepath.Join(dir, entry.Name()), &session); err != nil {
			continue
		}
		if !validSessionMeta(session) {
			continue
		}
		add(ModelGemini, session.Bindings.Gemini)
		add(ModelClaude, session.Bindings.Claude)
		add(ModelAntigravity, session.Bindings.Antigravity)
	}
	return live, nil
}

// Read は統一セッションを読み込む。
func (s *Service) Read(sessionID string) (UnifiedSession, error) {
	path, err := s.filePath(sessionID, false)
	if err != nil {
		return UnifiedSession{}, err
	}
	var session UnifiedSession
	if err := jsonstore.ReadJSON(path, &session); err != nil {
		return UnifiedSession{}, err
	}
	if !validSession(session) {
		return UnifiedSession{}, ErrInvalidUnifiedSession
	}
	return session, nil
}

func (s *Service) sessionLock(sessionID string) *sync.Mutex {
	actual, _ := s.locks.LoadOrStore(sessionID, &sync.Mutex{})
	return actual.(*sync.Mutex)
}

// Update は sessionID の正本をロック下で「読み→mutate→保存」し、保存後の姿を返す。
//
// タイトル変更・履歴編集・SSRP設定反映・ジョブ成果の書き込みなど、既存内容へ
// 変更を加える保存は必ずこの経路を使うこと（Save 直呼びの全置換は、並行する
// 他の更新を巻き戻すロストアップデートの原因になる）。
// セッションが存在しない場合は Read のエラー（os.ErrNotExist 等）を返す。
func (s *Service) Update(sessionID string, mutate func(*UnifiedSession) error) (UnifiedSession, error) {
	lock := s.sessionLock(sessionID)
	lock.Lock()
	defer lock.Unlock()
	session, err := s.Read(sessionID)
	if err != nil {
		return UnifiedSession{}, err
	}
	if err := mutate(&session); err != nil {
		return UnifiedSession{}, err
	}
	if err := s.saveLocked(session); err != nil {
		return UnifiedSession{}, err
	}
	return session, nil
}

// Save は統一セッションを書き込む（全置換）。
//
// 新規作成、または呼び出し側が正本の最新性に責任を持つ場合のみ使うこと。
// 既存セッションへの変更適用は Update を使う。
func (s *Service) Save(session UnifiedSession) error {
	lock := s.sessionLock(session.SessionID)
	lock.Lock()
	defer lock.Unlock()
	return s.saveLocked(session)
}

func (s *Service) saveLocked(session UnifiedSession) error {
	if session.SchemaVersion == 0 {
		session.SchemaVersion = 1
	}
	if session.CreatedAt == "" {
		session.CreatedAt = nowISO()
	}
	session.LastUpdated = nowISO()
	if session.ContextEntries == nil {
		session.ContextEntries = []any{}
	}
	if session.Messages == nil {
		session.Messages = []Message{}
	}
	if session.Title == "" {
		session.Title = "新規セッション"
	}
	if session.Bindings.ActiveModelType == "" {
		session.Bindings.ActiveModelType = ModelGemini
	}
	path, err := s.filePath(session.SessionID, true)
	if err != nil {
		return err
	}
	return jsonstore.WriteJSON(path, session)
}

// Delete は統一セッション正本を削除し、削除されたセッションを返す。
//
// 返り値のセッション（特に Bindings）は、呼び出し側が紐づくネイティブ履歴・sidecar を
// 連動掃除するための材料。中間ファイル正本が消える＝そのネイティブは再生成元を失うため、
// 同時にネイティブを掃除しないと残骸化する。掃除の実行は呼び出し側の責務とする
// （ドメインの sessions はホーム配下のネイティブを直接触らない）。
func (s *Service) Delete(sessionID string) (UnifiedSession, error) {
	session, err := s.Read(sessionID)
	if err != nil {
		return UnifiedSession{}, err
	}
	path, err := s.filePath(sessionID, false)
	if err != nil {
		return UnifiedSession{}, err
	}
	if err := os.Remove(path); err != nil {
		return UnifiedSession{}, err
	}
	return session, nil
}

// StartNew は次回送信用の新規セッション状態を保持する。
func (s *Service) StartNew(modelType ModelType, ssrpSettings map[string]any) NewSessionState {
	if modelType == "" {
		modelType = ModelGemini
	}
	state := NewSessionState{
		ModelType:    modelType,
		SSRPSettings: ssrpSettings,
		UpdatedAt:    nowISO(),
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pending[modelType] = state
	return state
}

// UpdateTitle はタイトルを更新する。
func (s *Service) UpdateTitle(sessionID, title string) (string, error) {
	title = strings.TrimSpace(title)
	if title == "" {
		title = "新規セッション"
	}
	runes := []rune(title)
	if len(runes) > 100 {
		title = string(runes[:100])
	}
	if _, err := s.Update(sessionID, func(session *UnifiedSession) error {
		session.Title = title
		return nil
	}); err != nil {
		return "", err
	}
	return title, nil
}

// ApplySSRPSettings はフロントの最新 SSRP 設定をセッション正本へ明示反映する。
//
// ssrpSettings が非 nil なら保存済み設定へ浅くマージ（フロント値優先）する。
// suppressConfirm が非 nil なら uiState.suppressSSRPApplyConfirm を更新する。
// 確認抑制フラグを SSRPSettings に置かないのは、反映マージや IsSSRP 判定
// （len(SSRPSettings) > 0）へ影響させないため。
func (s *Service) ApplySSRPSettings(sessionID string, ssrpSettings map[string]any, suppressConfirm *bool) (UnifiedSession, error) {
	return s.Update(sessionID, func(session *UnifiedSession) error {
		if ssrpSettings != nil {
			if session.SSRPSettings == nil {
				session.SSRPSettings = map[string]any{}
			}
			for key, value := range ssrpSettings {
				session.SSRPSettings[key] = value
			}
			session.IsSSRP = len(session.SSRPSettings) > 0
		}
		if suppressConfirm != nil {
			if session.UIState == nil {
				session.UIState = map[string]any{}
			}
			session.UIState["suppressSSRPApplyConfirm"] = *suppressConfirm
		}
		return nil
	})
}

// UpdateMessageContent は履歴メッセージ本文を更新する。
func (s *Service) UpdateMessageContent(sessionID, messageID, content string) error {
	_, err := s.Update(sessionID, func(session *UnifiedSession) error {
		for i := range session.Messages {
			if session.Messages[i].ID == messageID {
				session.Messages[i].Content = content
				return nil
			}
		}
		return ErrMessageNotFound
	})
	return err
}

func (s *Service) ensureDir() (string, error) {
	dir, err := s.resolver.ResolveDirForMkdirAll(config.UnifiedSessionsDir, config.DirPerm)
	if err != nil {
		return "", err
	}
	if err := s.copyLegacySessions(dir); err != nil {
		return "", err
	}
	return dir, nil
}

func (s *Service) filePath(sessionID string, create bool) (string, error) {
	id, err := safename.Validate(sessionID)
	if err != nil {
		return "", err
	}
	rel := config.UnifiedSessionsDir + "/" + id + ".json"
	if create {
		return s.resolver.ResolveForCreateMkdirAll(rel, config.DirPerm)
	}
	abs, err := s.resolver.ResolveLexical(rel)
	if err != nil {
		return "", err
	}
	if _, err := os.Lstat(abs); err != nil {
		return abs, err
	}
	return s.resolver.ResolveExisting(rel)
}

func (s *Service) copyLegacySessions(newDir string) error {
	legacyDir, err := s.resolver.ResolveExisting(config.LegacyUnifiedSessionsDir)
	if err != nil {
		if errors.Is(err, paths.ErrOutsideWorkspace) || errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	// mtime ガード: 前回取り込み時からディレクトリが変わっていなければ、
	// 中身の走査（ReadDir + ファイル毎コピー判定）を丸ごとスキップする。
	// ディレクトリの mtime はエントリの追加・削除で更新されるため、稼働中に
	// 旧版の並行運用や手動コピーでファイルが置かれても次のアクセスで取り込まれる
	//（プロセス起動時1回方式と違い「後から置かれた」ケースを取りこぼさない）。
	info, err := os.Stat(legacyDir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	s.legacyMu.Lock()
	if s.legacyChecked && s.legacyStamp.Equal(info.ModTime()) {
		s.legacyMu.Unlock()
		return nil
	}
	s.legacyMu.Unlock()
	entries, err := os.ReadDir(legacyDir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	for _, entry := range entries {
		// jsonstore の一時ファイルは ".tmp-*.json"（接頭辞 .tmp-）。
		// クラッシュで残った一時ファイルをセッションとして列挙しない。
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") || strings.HasPrefix(entry.Name(), ".tmp") {
			continue
		}
		if err := copyLegacySessionFile(filepath.Join(legacyDir, entry.Name()), filepath.Join(newDir, entry.Name())); err != nil {
			return err
		}
	}
	// 取り込み成功後に mtime を記録する（走査開始前に取得した値。走査中に
	// 追加されたファイルは mtime 差分として次回検出される＝安全側）。
	s.legacyMu.Lock()
	s.legacyChecked = true
	s.legacyStamp = info.ModTime()
	s.legacyMu.Unlock()
	return nil
}

func copyLegacySessionFile(src, dst string) error {
	if _, err := os.Lstat(dst); err == nil {
		return nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_EXCL, config.FilePerm)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		closeErr := out.Close()
		_ = os.Remove(dst)
		if closeErr != nil {
			return closeErr
		}
		return err
	}
	return out.Close()
}

func validSession(session UnifiedSession) bool {
	return session.SchemaVersion == 1 && session.SessionID != "" && session.Messages != nil
}

func modelTypeFromKind(kind models.Kind) ModelType {
	switch kind {
	case models.KindClaude:
		return ModelClaude
	case models.KindAntigravity:
		return ModelAntigravity
	default:
		return ModelGemini
	}
}

// ModelTypeFromModelID は model id からセッション用 provider 種別を返す。
func ModelTypeFromModelID(modelID string) ModelType {
	return modelTypeFromKind(models.KindOf(modelID))
}

func nowISO() string {
	return time.Now().UTC().Format(time.RFC3339)
}

func parseTimeMs(value string) int64 {
	t, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return 0
	}
	return t.UnixMilli()
}

func timeAgo(ms int64) string {
	if ms <= 0 {
		return ""
	}
	d := time.Since(time.UnixMilli(ms))
	switch {
	case d < time.Minute:
		return "たった今"
	case d < time.Hour:
		return pluralJP(int(d.Minutes()), "分前")
	case d < 24*time.Hour:
		return pluralJP(int(d.Hours()), "時間前")
	default:
		return pluralJP(int(d.Hours()/24), "日前")
	}
}

func pluralJP(n int, suffix string) string {
	if n < 1 {
		n = 1
	}
	return strconv.Itoa(n) + suffix
}
