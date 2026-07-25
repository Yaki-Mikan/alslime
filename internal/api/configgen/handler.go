// Package configgen は設定ファイル自動作成（config-generate）API の入口を提供する。
//
// submit / status / cancel と、じっくり作成（2段階）でユーザーが手直しする
// 調査メモの取得・保存を担う。実行本体は core 側（alslime-core/configgen）。
package configgen

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"alslime/internal/api/apierror"
	"alslime/internal/api/apiresponse"
	"alslime/internal/config"
	"alslime/internal/domain/configeditor"
	"alslime/internal/domain/configgenjobs"
	"alslime/internal/domain/models"
	"alslime/internal/i18n"
	jobsvc "alslime/internal/jobs"
	"alslime/internal/storage/paths"
	"alslime/internal/storage/safename"
)

// Deps は config-gen API の依存。
type Deps struct {
	Queue    *jobsvc.Queue
	Resolver *paths.Resolver
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
}

type submitRequest struct {
	CategoryID     string `json:"categoryId"`
	Method         string `json:"method"`
	Step           int    `json:"step,omitempty"`
	CharacterName  string `json:"characterName"`
	WorkTitle      string `json:"workTitle"`
	DirName        string `json:"dirName"`
	FileName       string `json:"fileName,omitempty"`
	Model          string `json:"model,omitempty"`
	ClaudeEffort   string `json:"claudeEffort,omitempty"`
	TimeoutMinutes int    `json:"timeoutMinutes,omitempty"`
	Locale         string `json:"locale,omitempty"`
	Notes          string `json:"notes,omitempty"`
}

// notesMaxRunes は設定作成備考の入力上限。
const notesMaxRunes = 2000

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
	JobID          string                `json:"jobId"`
	Status         string                `json:"status"`
	Progress       []jobsvc.ProgressEntry `json:"progress,omitempty"`
	ElapsedSeconds int64                 `json:"elapsedSeconds"`
	Result         any                   `json:"result,omitempty"`
	Error          string                `json:"error,omitempty"`
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
		if !ok || !category.IsCharacter {
			apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorConfigGenInvalidPayload))
			return
		}
		characterName := strings.TrimSpace(req.CharacterName)
		workTitle := strings.TrimSpace(req.WorkTitle)
		if characterName == "" || workTitle == "" ||
			len([]rune(characterName)) > inputMaxRunes || len([]rune(workTitle)) > inputMaxRunes {
			apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorConfigGenInvalidPayload))
			return
		}
		// キャラクター名はファイル名（調査メモ）にも使うため safename で検証する。
		characterName, err := safename.Validate(characterName)
		if err != nil {
			apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorInvalidName))
			return
		}
		dirName, err := safename.Validate(req.DirName)
		if err != nil {
			apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorInvalidName))
			return
		}
		switch {
		case req.Method == configgenjobs.MethodOneShot:
		case req.Method == configgenjobs.MethodTwoStep && (req.Step == 1 || req.Step == 2):
		default:
			apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorConfigGenInvalidPayload))
			return
		}
		// 2段階の2段階目は調査メモの存在を事前検証する（実行前に確実に弾く）。
		if req.Method == configgenjobs.MethodTwoStep && req.Step == 2 {
			if _, err := resolveResearch(deps.Resolver, category, dirName, characterName); err != nil {
				apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorConfigGenResearchMissing))
				return
			}
		}

		if len([]rune(req.Notes)) > notesMaxRunes {
			apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorConfigGenInvalidPayload))
			return
		}
		payload := configgenjobs.Payload{
			CategoryID:     req.CategoryID,
			Method:         req.Method,
			Step:           req.Step,
			CharacterName:  characterName,
			WorkTitle:      workTitle,
			DirName:        dirName,
			Model:          strings.TrimSpace(req.Model),
			ClaudeEffort:   strings.TrimSpace(req.ClaudeEffort),
			TimeoutMinutes: req.TimeoutMinutes,
			Locale:         strings.TrimSpace(req.Locale),
			Notes:          req.Notes,
		}
		// ジョブの同時実行制御 Kind はモデルから判定する（空モデルは Claude 既定）。
		kind := models.KindOf(payload.Model)
		if payload.Model == "" {
			kind = models.KindClaude
		}
		added := deps.Queue.Add(jobsvc.Spec{
			Type:      jobsvc.TypeConfigGen,
			Kind:      kind,
			Label:     labelKeyConfigGen,
			DedupeKey: dedupeKey(req.CategoryID, dirName),
			Model:     payload.Model,
			Payload:   payload,
		})
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
// （タブを開き直したときの再接続用。レビュー002対応 6.3）。
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
// 調査メモを列挙する（じっくり作成の「調査メモを開く」用。レビュー001対応 3.3）。
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
