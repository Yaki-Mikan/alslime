// Package configgen は設定ファイル自動作成（config-generate）API の入口を提供する。
//
// submit / status / cancel と、じっくり作成（2段階）でユーザーが手直しする
// 調査メモの取得・保存、対話作成のセッション操作を担う。実行本体は core 側
// （alslime-core/configgen）。
package configgen

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"alslime/internal/api/apierror"
	"alslime/internal/api/apiresponse"
	"alslime/internal/config"
	"alslime/internal/domain/charname"
	"alslime/internal/domain/configeditor"
	"alslime/internal/domain/configgendialog"
	"alslime/internal/domain/configgenjobs"
	"alslime/internal/domain/models"
	"alslime/internal/domain/sessions"
	"alslime/internal/domain/tempcharacters"
	"alslime/internal/i18n"
	jobsvc "alslime/internal/jobs"
	"alslime/internal/storage/paths"
	"alslime/internal/storage/safename"
)

// Deps は config-gen API の依存。
type Deps struct {
	Queue    *jobsvc.Queue
	Resolver *paths.Resolver
	// Dialog は対話作成のセッション履歴ストア。
	Dialog *configgendialog.Store
	// Sessions は会話セッションの正本（from-session の実在確認に使う）。
	Sessions *sessions.Service
	// NewID はセッション ID の採番（ジョブ ID と同じ採番器を使う）。
	NewID func() string
	// Now はテスト差し替え用（nil なら time.Now 相当を handler 内で使う）。
	NowUnixMilli func() int64
}

// Register は config-gen API を mux へ登録する。
func Register(mux *http.ServeMux, deps Deps) {
	mux.HandleFunc(http.MethodPost+" "+config.APIPrefix+routeSubmit, handleSubmit(deps))
	mux.HandleFunc(http.MethodGet+" "+config.APIPrefix+routeStatus, handleStatus(deps))
	mux.HandleFunc(http.MethodPost+" "+config.APIPrefix+routeCancel, handleCancel(deps))
	mux.HandleFunc(http.MethodGet+" "+config.APIPrefix+routeResearch, handleGetResearch(deps))
	mux.HandleFunc(http.MethodPost+" "+config.APIPrefix+routeResearch, handleSaveResearch(deps))
	mux.HandleFunc(http.MethodDelete+" "+config.APIPrefix+routeResearch, handleDeleteResearch(deps))
	mux.HandleFunc(http.MethodGet+" "+config.APIPrefix+routeResearchList, handleResearchList(deps))
	mux.HandleFunc(http.MethodGet+" "+config.APIPrefix+routeActive, handleActive(deps))
	mux.HandleFunc(http.MethodPost+" "+config.APIPrefix+routeDialogStart, handleDialogStart(deps))
	mux.HandleFunc(http.MethodPost+" "+config.APIPrefix+routeDialogSend, handleDialogSend(deps))
	mux.HandleFunc(http.MethodGet+" "+config.APIPrefix+routeDialog, handleDialogGet(deps))
	mux.HandleFunc(http.MethodDelete+" "+config.APIPrefix+routeDialog, handleDialogDelete(deps))
	mux.HandleFunc(http.MethodPost+" "+config.APIPrefix+routeFromSession, handleFromSession(deps))
}

// fromSessionRequest はセッションからの一時キャラクター取り込みの投入。
type fromSessionRequest struct {
	SessionID           string `json:"sessionId"`
	TargetCharacter     string `json:"targetCharacter"`
	// SettingTemplate は AI 用の設定ファイルテンプレート名、ManualTemplate は手動作成用の雛形名。
	// どちらか一方を送る（両方空なら AI 用の既定）。
	SettingTemplate     string `json:"settingTemplate,omitempty"`
	ManualTemplate      string `json:"manualTemplate,omitempty"`
	Model               string `json:"model,omitempty"`
	ClaudeEffort        string `json:"claudeEffort,omitempty"`
	AntigravityThinking string `json:"antigravityThinking,omitempty"`
	TimeoutMinutes      int    `json:"timeoutMinutes,omitempty"`
	Locale              string `json:"locale,omitempty"`
}

// handleFromSession は 1 キャラ分の分析ジョブを投入する。
// 同じセッション・同じ話者（照合用正規化で同一視）の二重投入は 409。
func handleFromSession(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req fromSessionRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorInvalidJSONBody))
			return
		}
		sessionID := strings.TrimSpace(req.SessionID)
		if sessionID == "" {
			apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorSessionIDRequired))
			return
		}
		target := strings.TrimSpace(req.TargetCharacter)
		if target == "" || len([]rune(target)) > inputMaxRunes {
			apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorConfigGenInvalidPayload))
			return
		}
		dirName, err := tempcharacters.SanitizeForDirName(target)
		if err != nil {
			apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorTempCharInvalidName))
			return
		}
		if deps.Sessions == nil {
			apierror.Write(w, apierror.NewKey(http.StatusInternalServerError, i18n.KeyErrorInternal))
			return
		}
		if _, err := deps.Sessions.Read(sessionID); err != nil {
			apierror.Write(w, apierror.NewKey(http.StatusNotFound, i18n.KeyErrorTempCharSessionNotFound))
			return
		}
		payload := configgenjobs.Payload{
			CategoryID:          "character",
			Method:              configgenjobs.MethodFromSession,
			CharacterName:       target,
			FileName:            dirName,
			DirName:             dirName,
			Model:               strings.TrimSpace(req.Model),
			ClaudeEffort:        strings.TrimSpace(req.ClaudeEffort),
			AntigravityThinking: strings.TrimSpace(req.AntigravityThinking),
			TimeoutMinutes:      req.TimeoutMinutes,
			Locale:              strings.TrimSpace(req.Locale),
			SessionID:           sessionID,
			TargetCharacter:     target,
			SettingTemplate:     strings.TrimSpace(req.SettingTemplate),
			ManualTemplate:      strings.TrimSpace(req.ManualTemplate),
		}
		enqueueWithSession(w, deps, payload, "temp-char:"+sessionID+":"+charname.NormalizeMatchName(target), sessionID)
	}
}

type submitRequest struct {
	CategoryID          string `json:"categoryId"`
	Method              string `json:"method"`
	Step                int    `json:"step,omitempty"`
	CharacterName       string `json:"characterName"`
	WorkTitle           string `json:"workTitle"`
	DirName             string `json:"dirName"`
	FileName            string `json:"fileName,omitempty"`
	Model               string `json:"model,omitempty"`
	ClaudeEffort        string `json:"claudeEffort,omitempty"`
	AntigravityThinking string `json:"antigravityThinking,omitempty"`
	TimeoutMinutes      int    `json:"timeoutMinutes,omitempty"`
	Locale              string `json:"locale,omitempty"`
	Notes               string `json:"notes,omitempty"`
	// EditorContent は左エディタの内容（入力項目テンプレートの差し込み）。
	EditorContent string `json:"editorContent,omitempty"`
	// SearchTemplate / SettingTemplate は使うテンプレート名（空なら既定）。
	SearchTemplate  string `json:"searchTemplate,omitempty"`
	SettingTemplate string `json:"settingTemplate,omitempty"`
}

// notesMaxRunes は設定作成備考の入力上限。
const notesMaxRunes = 2000

// editorContentMaxRunes は左エディタ内容の送信上限。
const editorContentMaxRunes = 20000

// messageMaxRunes は対話作成のユーザー発話の上限。
const messageMaxRunes = 4000

type submitResponse struct {
	JobID  string `json:"jobId"`
	Status string `json:"status"`
}

type duplicateResponse struct {
	Error         string `json:"error"`
	MessageKey    string `json:"messageKey"`
	ExistingJobID string `json:"existingJobId"`
}

type statusResponse struct {
	JobID          string                 `json:"jobId"`
	Status         string                 `json:"status"`
	Progress       []jobsvc.ProgressEntry `json:"progress,omitempty"`
	ElapsedSeconds int64                  `json:"elapsedSeconds"`
	Result         any                    `json:"result,omitempty"`
	Error          string                 `json:"error,omitempty"`
}

type researchResponse struct {
	Exists  bool   `json:"exists"`
	Content string `json:"content,omitempty"`
	// WorkTitle はメモ本文の基本情報「**作品**：」行から抽出した作品名
	// （フロントの欄自動復元用。テンプレートから外れた本文なら空）。
	WorkTitle string `json:"workTitle,omitempty"`
}

type saveResearchRequest struct {
	Content string `json:"content"`
}

// inputMaxRunes はキャラクター名・作品名の入力上限（暴走プロンプト防止の安全弁）。
const inputMaxRunes = 200

func handleSubmit(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req submitRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorInvalidJSONBody))
			return
		}
		category, ok := configeditor.FindCategory(req.CategoryID)
		if !ok {
			apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorConfigGenInvalidPayload))
			return
		}
		// ファイル名: キャラクターはキャラクター名、それ以外は fileName（互換で characterName も受ける）。
		fileName := strings.TrimSpace(req.FileName)
		if fileName == "" {
			fileName = strings.TrimSpace(req.CharacterName)
		}
		workTitle := strings.TrimSpace(req.WorkTitle)
		if fileName == "" || len([]rune(fileName)) > inputMaxRunes || len([]rune(workTitle)) > inputMaxRunes {
			apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorConfigGenInvalidPayload))
			return
		}
		if category.IsCharacter && workTitle == "" {
			apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorConfigGenInvalidPayload))
			return
		}
		// ファイル名（調査メモ・設定ファイル）に使うため safename で検証する。
		fileName, err := safename.Validate(fileName)
		if err != nil {
			apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorInvalidName))
			return
		}
		dirName := strings.TrimSpace(req.DirName)
		if dirName == "" {
			dirName = fileName
		}
		dirName, err = safename.Validate(dirName)
		if err != nil {
			apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorInvalidName))
			return
		}
		switch {
		case req.Method == configgenjobs.MethodOneShot:
		case req.Method == configgenjobs.MethodTwoStep && (req.Step == 1 || req.Step == 2):
			if !category.IsCharacter {
				apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorConfigGenMethodNotAllowed))
				return
			}
		default:
			apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorConfigGenInvalidPayload))
			return
		}
		// 2段階の2段階目は調査メモの存在を事前検証する（実行前に確実に弾く）。
		if req.Method == configgenjobs.MethodTwoStep && req.Step == 2 {
			if _, err := resolveResearch(deps.Resolver, category, dirName, fileName); err != nil {
				apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorConfigGenResearchMissing))
				return
			}
		}

		if len([]rune(req.Notes)) > notesMaxRunes || len([]rune(req.EditorContent)) > editorContentMaxRunes {
			apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorConfigGenInvalidPayload))
			return
		}
		payload := configgenjobs.Payload{
			CategoryID:          req.CategoryID,
			Method:              req.Method,
			Step:                req.Step,
			CharacterName:       fileName,
			FileName:            fileName,
			WorkTitle:           workTitle,
			DirName:             dirName,
			Model:               strings.TrimSpace(req.Model),
			ClaudeEffort:        strings.TrimSpace(req.ClaudeEffort),
			AntigravityThinking: strings.TrimSpace(req.AntigravityThinking),
			TimeoutMinutes:      req.TimeoutMinutes,
			Locale:              strings.TrimSpace(req.Locale),
			Notes:               req.Notes,
			EditorContent:       req.EditorContent,
			SearchTemplate:      strings.TrimSpace(req.SearchTemplate),
			SettingTemplate:     strings.TrimSpace(req.SettingTemplate),
		}
		enqueue(w, deps, payload, dedupeKey(req.CategoryID, dirName))
	}
}

// enqueue はペイロードをジョブキューへ投入し、結果を応答する（submit / dialog send 共通）。
func enqueue(w http.ResponseWriter, deps Deps, payload configgenjobs.Payload, dedupe string) {
	enqueueWithSession(w, deps, payload, dedupe, "")
}

// enqueueWithSession は所属セッション ID 付きで投入する（from-session 用）。
// 排他は DedupeKey で行い、SessionID は所属の記録（チャットの同セッション排他には乗せない）。
func enqueueWithSession(w http.ResponseWriter, deps Deps, payload configgenjobs.Payload, dedupe, sessionID string) {
	// ジョブの同時実行制御 Kind はモデルから判定する（空モデルは Claude 既定）。
	kind := models.KindOf(payload.Model)
	if payload.Model == "" {
		kind = models.KindClaude
	}
	label := labelKeyConfigGen
	if payload.Method == configgenjobs.MethodFromSession {
		label = i18n.KeyLabelTempCharacterImport
	}
	added := deps.Queue.Add(jobsvc.Spec{
		Type:      jobsvc.TypeConfigGen,
		Kind:      kind,
		Label:     label,
		SessionID: sessionID,
		DedupeKey: dedupe,
		Model:     payload.Model,
		Payload:   payload,
	})
	if added.MaintenanceRejected {
		apierror.Write(w, apierror.NewKey(http.StatusConflict, i18n.KeyErrorUpdateMaintenance))
		return
	}
	if added.Duplicate {
		_ = apiresponse.WriteJSON(w, http.StatusConflict, duplicateResponse{
			Error:         i18n.KeyErrorAlreadyProcessing,
			MessageKey:    i18n.KeyErrorAlreadyProcessing,
			ExistingJobID: added.ExistingJobID,
		})
		return
	}
	writeJSON(w, submitResponse{JobID: added.JobID, Status: string(jobsvc.StatusPending)})
}

func handleStatus(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		jobID := r.PathValue(pathParamJobID)
		job, ok := deps.Queue.Get(jobID)
		if !ok || job.Type != jobsvc.TypeConfigGen {
			apierror.Write(w, apierror.NotFoundKey(i18n.KeyErrorJobNotFound))
			return
		}
		since := 0
		if raw := r.URL.Query().Get(queryParamSince); raw != "" {
			if v, err := strconv.Atoi(raw); err == nil && v > 0 {
				since = v
			}
		}
		res := statusResponse{
			JobID:          job.JobID,
			Status:         string(job.Status),
			Progress:       deps.Queue.ProgressSince(jobID, since),
			ElapsedSeconds: elapsedSeconds(deps, job),
		}
		switch job.Status {
		case jobsvc.StatusCompleted:
			res.Result = resultFileFromOutput(job.Result)
		case jobsvc.StatusError, jobsvc.StatusCanceled:
			res.Error = job.Err
		}
		writeJSON(w, res)
	}
}

func handleCancel(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		jobID := r.PathValue(pathParamJobID)
		if job, ok := deps.Queue.Get(jobID); !ok || job.Type != jobsvc.TypeConfigGen {
			apierror.Write(w, apierror.NotFoundKey(i18n.KeyErrorJobNotFound))
			return
		}
		if !deps.Queue.Cancel(jobID) {
			apierror.Write(w, apierror.NewKey(http.StatusConflict, i18n.KeyErrorJobCancelUnavailable))
			return
		}
		writeJSON(w, map[string]bool{"success": true})
	}
}

func handleGetResearch(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		category, dirName, characterName, ok := researchParams(w, r)
		if !ok {
			return
		}
		abs, err := resolveResearch(deps.Resolver, category, dirName, characterName)
		if err != nil {
			writeJSON(w, researchResponse{Exists: false})
			return
		}
		content, err := os.ReadFile(abs)
		if err != nil {
			writeJSON(w, researchResponse{Exists: false})
			return
		}
		writeJSON(w, researchResponse{
			Exists:    true,
			Content:   string(content),
			WorkTitle: extractWorkTitle(string(content)),
		})
	}
}

// workTitlePattern は調査メモ本文の基本情報「**作品**：」行
// （全角/半角コロン許容。差別言語テンプレートの「**Work**:」行にも対応）。
var workTitlePattern = regexp.MustCompile(`\*\*(?:作品|Work)\*\*\s*[：:]\s*(.+)`)

// extractWorkTitle はメモ本文から作品名を抽出する（見つからなければ空）。
func extractWorkTitle(content string) string {
	m := workTitlePattern.FindStringSubmatch(content)
	if m == nil {
		return ""
	}
	return strings.TrimSpace(m[1])
}

// handleDeleteResearch は調査メモを削除する（選択モーダルの×・ゴミ箱ボタン用）。
// 削除後、設定作成前資料ディレクトリが空になればディレクトリも削除する。
func handleDeleteResearch(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		category, dirName, characterName, ok := researchParams(w, r)
		if !ok {
			return
		}
		abs, err := resolveResearch(deps.Resolver, category, dirName, characterName)
		if err != nil {
			apierror.Write(w, apierror.NotFoundKey(i18n.KeyErrorConfigGenResearchMissing))
			return
		}
		if err := os.Remove(abs); err != nil {
			apierror.Write(w, apierror.Internal(err))
			return
		}
		// 空になった設定作成前資料ディレクトリの掃除（残っていれば失敗して構わない）。
		_ = os.Remove(filepath.Dir(abs))
		writeJSON(w, map[string]bool{"success": true})
	}
}

type activeResponse struct {
	Active         bool   `json:"active"`
	JobID          string `json:"jobId,omitempty"`
	Status         string `json:"status,omitempty"`
	ElapsedSeconds int64  `json:"elapsedSeconds,omitempty"`
}

// handleActive は実行中（pending/processing）の config-generate ジョブを返す
// （タブを開き直したときの再接続用）。
func handleActive(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		for _, job := range deps.Queue.List() {
			if job.Type != jobsvc.TypeConfigGen || job.Status.IsTerminal() {
				continue
			}
			writeJSON(w, activeResponse{
				Active:         true,
				JobID:          job.JobID,
				Status:         string(job.Status),
				ElapsedSeconds: elapsedSeconds(deps, job),
			})
			return
		}
		writeJSON(w, activeResponse{Active: false})
	}
}

func handleSaveResearch(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		category, dirName, characterName, ok := researchParams(w, r)
		if !ok {
			return
		}
		var req saveResearchRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorInvalidJSONBody))
			return
		}
		rel := configgenjobs.ResearchMemoRelPath(category.Dir, dirName, characterName)
		abs, err := deps.Resolver.ResolveForCreateMkdirAll(rel, 0o755)
		if err != nil {
			apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorInvalidName))
			return
		}
		if err := os.WriteFile(abs, []byte(req.Content), 0o644); err != nil {
			apierror.Write(w, apierror.Internal(err))
			return
		}
		writeJSON(w, map[string]any{"success": true, "messageKey": i18n.KeyMessageFileWritten})
	}
}

type researchListEntry struct {
	DirName       string `json:"dirName"`
	CharacterName string `json:"characterName"`
	FileName      string `json:"fileName"`
}

// handleResearchList はカテゴリ内の全キャラディレクトリを走査し、保存済み
// 調査メモを列挙する（じっくり作成の「調査メモを開く」用）。
func handleResearchList(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		category, ok := configeditor.FindCategory(r.PathValue(pathParamCategoryID))
		if !ok || !category.IsCharacter {
			apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorConfigGenInvalidPayload))
			return
		}
		files := make([]researchListEntry, 0)
		categoryAbs, err := deps.Resolver.ResolveLexical(category.Dir)
		if err != nil {
			writeJSON(w, map[string]any{"files": files})
			return
		}
		dirs, err := os.ReadDir(categoryAbs)
		if err != nil {
			writeJSON(w, map[string]any{"files": files})
			return
		}
		for _, dir := range dirs {
			if !dir.IsDir() {
				continue
			}
			memoDir := filepath.Join(categoryAbs, dir.Name(), configgenjobs.ResearchDirName)
			memos, err := os.ReadDir(memoDir)
			if err != nil {
				continue
			}
			for _, memo := range memos {
				if memo.IsDir() {
					continue
				}
				name := memo.Name()
				if !strings.HasSuffix(name, configgenjobs.ResearchMemoSuffix+".md") {
					continue
				}
				files = append(files, researchListEntry{
					DirName:       dir.Name(),
					CharacterName: strings.TrimSuffix(name, configgenjobs.ResearchMemoSuffix+".md"),
					FileName:      strings.TrimSuffix(name, ".md"),
				})
			}
		}
		writeJSON(w, map[string]any{"files": files})
	}
}

// ---- 対話作成 ----

type dialogStartRequest struct {
	CategoryID    string `json:"categoryId"`
	DirName       string `json:"dirName,omitempty"`
	FileName      string `json:"fileName"`
	Provider      string `json:"provider,omitempty"`
	Model         string `json:"model,omitempty"`
	Locale        string `json:"locale,omitempty"`
	EditorContent string `json:"editorContent,omitempty"`
	// Reset が真なら既存セッションを削除して新しく始める。
	Reset bool `json:"reset,omitempty"`
}

type dialogSessionResponse struct {
	SessionID   string                    `json:"sessionId"`
	CategoryID  string                    `json:"categoryId"`
	DirName     string                    `json:"dirName"`
	FileName    string                    `json:"fileName"`
	IsNew       bool                      `json:"isNew"`
	FileHash    string                    `json:"fileHash"`
	FileContent string                    `json:"fileContent"`
	Messages    []configgendialog.Message `json:"messages"`
}

type dialogSendRequest struct {
	SessionID           string `json:"sessionId"`
	Message             string `json:"message"`
	EditorContent       string `json:"editorContent"`
	EditorHash          string `json:"editorHash"`
	Model               string `json:"model,omitempty"`
	ClaudeEffort        string `json:"claudeEffort,omitempty"`
	AntigravityThinking string `json:"antigravityThinking,omitempty"`
	TimeoutMinutes      int    `json:"timeoutMinutes,omitempty"`
	Locale              string `json:"locale,omitempty"`
	// SettingTemplate は使う設定ファイルテンプレート名（空なら既定）。
	SettingTemplate string `json:"settingTemplate,omitempty"`
}

// settingFileAbs は対象設定ファイルの正規位置（絶対パス）と相対パスを返す。
func settingFileAbs(deps Deps, category configeditor.Category, fileName string) (abs string, rel string, exists bool) {
	rel = configgenjobs.SettingRelPathFor(category.IsCharacter, category.Dir, fileName)
	abs, err := deps.Resolver.ResolveExisting(rel)
	if err != nil {
		return "", rel, false
	}
	if info, err := os.Stat(abs); err != nil || info.IsDir() {
		return abs, rel, false
	}
	return abs, rel, true
}

// handleDialogStart は対話セッションを開始（または既存を再開）する。
func handleDialogStart(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if deps.Dialog == nil || deps.NewID == nil {
			apierror.Write(w, apierror.NewKey(http.StatusNotImplemented, i18n.KeyErrorJobRunnerNotImplemented))
			return
		}
		var req dialogStartRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorInvalidJSONBody))
			return
		}
		category, ok := configeditor.FindCategory(req.CategoryID)
		if !ok {
			apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorConfigGenInvalidPayload))
			return
		}
		fileName := strings.TrimSpace(req.FileName)
		if fileName == "" || len([]rune(fileName)) > inputMaxRunes || len([]rune(req.EditorContent)) > editorContentMaxRunes {
			apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorConfigGenInvalidPayload))
			return
		}
		fileName, err := safename.Validate(fileName)
		if err != nil {
			apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorInvalidName))
			return
		}
		dirName := fileName
		if !category.IsCharacter {
			dirName = fileName
		}

		abs, _, exists := settingFileAbs(deps, category, fileName)
		fileContent := req.EditorContent
		fileHash := ""
		if exists {
			data, err := os.ReadFile(abs)
			if err != nil {
				apierror.Write(w, apierror.Internal(err))
				return
			}
			fileContent = string(data)
			fileHash = configgendialog.ContentHash(fileContent)
		}

		session, found := deps.Dialog.Find(req.CategoryID, dirName, fileName)
		if found && req.Reset {
			if err := deps.Dialog.Delete(session.SessionID); err != nil {
				apierror.Write(w, apierror.Internal(err))
				return
			}
			found = false
		}
		if !found {
			session = configgendialog.Session{
				SessionID:  deps.NewID(),
				CategoryID: req.CategoryID,
				DirName:    dirName,
				FileName:   fileName,
				IsNew:      !exists,
				FileHash:   fileHash,
				Provider:   strings.TrimSpace(req.Provider),
				Model:      strings.TrimSpace(req.Model),
				Locale:     strings.TrimSpace(req.Locale),
				Messages:   []configgendialog.Message{},
			}
			if err := deps.Dialog.Save(session); err != nil {
				apierror.Write(w, apierror.Internal(err))
				return
			}
		} else if exists && session.IsNew {
			// セッション作成後に別経路でファイルが作られていた場合は既存扱いへ寄せる。
			session, err = deps.Dialog.Update(session.SessionID, func(s *configgendialog.Session) error {
				s.IsNew = false
				s.FileHash = fileHash
				return nil
			})
			if err != nil {
				apierror.Write(w, apierror.Internal(err))
				return
			}
		}
		writeJSON(w, dialogSessionResponse{
			SessionID:   session.SessionID,
			CategoryID:  session.CategoryID,
			DirName:     session.DirName,
			FileName:    session.FileName,
			IsNew:       session.IsNew,
			FileHash:    session.FileHash,
			FileContent: fileContent,
			Messages:    session.Messages,
		})
	}
}

// handleDialogSend はユーザー発話を履歴へ追記し、対話ターンのジョブを投入する。
func handleDialogSend(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if deps.Dialog == nil {
			apierror.Write(w, apierror.NewKey(http.StatusNotImplemented, i18n.KeyErrorJobRunnerNotImplemented))
			return
		}
		var req dialogSendRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorInvalidJSONBody))
			return
		}
		message := strings.TrimSpace(req.Message)
		if message == "" || len([]rune(message)) > messageMaxRunes || len([]rune(req.EditorContent)) > editorContentMaxRunes {
			apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorConfigGenInvalidPayload))
			return
		}
		session, err := deps.Dialog.Read(req.SessionID)
		if err != nil {
			apierror.Write(w, apierror.NotFoundKey(i18n.KeyErrorConfigGenDialogSessionMissing))
			return
		}
		category, ok := configeditor.FindCategory(session.CategoryID)
		if !ok {
			apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorConfigGenInvalidPayload))
			return
		}

		// 競合判定: 正規ファイルの現在ハッシュがセッションの既知ハッシュと異なり、
		// かつエディタ内容が現在のファイルとも既知ハッシュとも一致しないなら、
		// 別経路の変更を上書きしてしまうため拒否する。
		abs, rel, exists := settingFileAbs(deps, category, session.FileName)
		currentHash := ""
		if exists {
			data, readErr := os.ReadFile(abs)
			if readErr != nil {
				apierror.Write(w, apierror.Internal(readErr))
				return
			}
			currentHash = configgendialog.ContentHash(string(data))
		}
		editorHash := strings.TrimSpace(req.EditorHash)
		if editorHash == "" {
			editorHash = configgendialog.ContentHash(req.EditorContent)
		}
		if exists && currentHash != session.FileHash && editorHash != currentHash && editorHash != session.FileHash {
			apierror.Write(w, apierror.NewKey(http.StatusConflict, i18n.KeyErrorConfigGenDialogConflict))
			return
		}
		// ユーザー編集の反映: 既存ファイルでエディタ内容が現在のファイルと異なるなら、
		// 送信で暗黙保存する（AI は実ファイルを読むため、次ターンから編集が伝わる）。
		if exists && editorHash != currentHash {
			createAbs, createErr := deps.Resolver.ResolveForCreateMkdirAll(rel, 0o755)
			if createErr != nil {
				apierror.Write(w, apierror.Internal(createErr))
				return
			}
			if writeErr := os.WriteFile(createAbs, []byte(req.EditorContent), 0o644); writeErr != nil {
				apierror.Write(w, apierror.Internal(writeErr))
				return
			}
			currentHash = editorHash
		}

		session, err = deps.Dialog.Update(session.SessionID, func(s *configgendialog.Session) error {
			if exists {
				s.FileHash = currentHash
				s.IsNew = false
			}
			if m := strings.TrimSpace(req.Model); m != "" {
				s.Model = m
			}
			if l := strings.TrimSpace(req.Locale); l != "" {
				s.Locale = l
			}
			s.Messages = append(s.Messages, configgendialog.Message{
				Role:      configgendialog.RoleUser,
				Content:   message,
				Timestamp: time.Now(),
			})
			return nil
		})
		if err != nil {
			apierror.Write(w, apierror.Internal(err))
			return
		}

		payload := configgenjobs.Payload{
			CategoryID:          session.CategoryID,
			Method:              configgenjobs.MethodDialog,
			CharacterName:       session.FileName,
			FileName:            session.FileName,
			DirName:             session.DirName,
			Model:               strings.TrimSpace(req.Model),
			ClaudeEffort:        strings.TrimSpace(req.ClaudeEffort),
			AntigravityThinking: strings.TrimSpace(req.AntigravityThinking),
			TimeoutMinutes:      req.TimeoutMinutes,
			Locale:              strings.TrimSpace(req.Locale),
			EditorContent:       req.EditorContent,
			EditorHash:          editorHash,
			DialogSessionID:     session.SessionID,
			UserMessage:         message,
			SettingTemplate:     strings.TrimSpace(req.SettingTemplate),
		}
		enqueue(w, deps, payload, dedupeKey(session.CategoryID, session.DirName))
	}
}

func handleDialogGet(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if deps.Dialog == nil {
			apierror.Write(w, apierror.NewKey(http.StatusNotImplemented, i18n.KeyErrorJobRunnerNotImplemented))
			return
		}
		session, err := deps.Dialog.Read(r.PathValue(pathParamSessionID))
		if err != nil {
			apierror.Write(w, apierror.NotFoundKey(i18n.KeyErrorConfigGenDialogSessionMissing))
			return
		}
		category, ok := configeditor.FindCategory(session.CategoryID)
		if !ok {
			apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorConfigGenInvalidPayload))
			return
		}
		fileContent := ""
		if abs, _, exists := settingFileAbs(deps, category, session.FileName); exists {
			if data, readErr := os.ReadFile(abs); readErr == nil {
				fileContent = string(data)
			}
		}
		writeJSON(w, dialogSessionResponse{
			SessionID:   session.SessionID,
			CategoryID:  session.CategoryID,
			DirName:     session.DirName,
			FileName:    session.FileName,
			IsNew:       session.IsNew,
			FileHash:    session.FileHash,
			FileContent: fileContent,
			Messages:    session.Messages,
		})
	}
}

func handleDialogDelete(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if deps.Dialog == nil {
			apierror.Write(w, apierror.NewKey(http.StatusNotImplemented, i18n.KeyErrorJobRunnerNotImplemented))
			return
		}
		if err := deps.Dialog.Delete(r.PathValue(pathParamSessionID)); err != nil {
			if errors.Is(err, configgendialog.ErrNotFound) {
				writeJSON(w, map[string]bool{"success": true})
				return
			}
			apierror.Write(w, apierror.Internal(err))
			return
		}
		writeJSON(w, map[string]bool{"success": true})
	}
}

// researchParams はパスパラメータの検証とカテゴリ解決を行う。
func researchParams(w http.ResponseWriter, r *http.Request) (configeditor.Category, string, string, bool) {
	category, ok := configeditor.FindCategory(r.PathValue(pathParamCategoryID))
	if !ok || !category.IsCharacter {
		apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorConfigGenInvalidPayload))
		return configeditor.Category{}, "", "", false
	}
	dirName, err := safename.Validate(r.PathValue(pathParamDirName))
	if err != nil {
		apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorInvalidName))
		return configeditor.Category{}, "", "", false
	}
	characterName, err := safename.Validate(r.PathValue(pathParamCharacterName))
	if err != nil {
		apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorInvalidName))
		return configeditor.Category{}, "", "", false
	}
	return category, dirName, characterName, true
}

// resolveResearch は調査メモの実在パスを解決する（無ければ error）。
func resolveResearch(resolver *paths.Resolver, category configeditor.Category, dirName, characterName string) (string, error) {
	rel := configgenjobs.ResearchMemoRelPath(category.Dir, dirName, characterName)
	return resolver.ResolveExisting(rel)
}

func resultFileFromOutput(raw string) any {
	if raw == "" {
		return nil
	}
	var value configgenjobs.ResultFile
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		return nil
	}
	return value
}

func elapsedSeconds(deps Deps, job jobsvc.Job) int64 {
	if job.StartedAt <= 0 {
		return 0
	}
	end := job.UpdatedAt
	if job.Status == jobsvc.StatusProcessing {
		if deps.NowUnixMilli != nil {
			end = deps.NowUnixMilli()
		} else {
			end = nowUnixMilli()
		}
	}
	if end < job.StartedAt {
		return 0
	}
	return (end - job.StartedAt) / 1000
}

func dedupeKey(categoryID, dirName string) string {
	return "config-gen:" + categoryID + ":" + dirName
}

func writeJSON(w http.ResponseWriter, v any) {
	_ = apiresponse.WriteJSON(w, http.StatusOK, v)
}
