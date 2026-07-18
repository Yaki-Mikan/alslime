// Package modelsapi は モデル一覧の正本まわりの API を提供する。
//
//   - GET  /api/models       モデル一覧（内蔵デフォルト＋ユーザー設定のマージ結果）
//   - GET  /api/models/user  ユーザーモデル設定（編集モーダル用）
//   - POST /api/models/user  ユーザーモデル設定の全置換保存
//   - POST /api/models/ping  疎通確認（provider 実行経路へ短文を送信）
//
// GET /api/models は旧 settings パッケージから移設（パス・レスポンス形は互換）。
// 疎通確認の呼び出し口は chatflow.Engine.Chat そのもので、provider 実装への
// 直接依存を持たない（core 切り出し時は Engine 実装の差し込みだけで済む。09番 6章）。
package modelsapi

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"

	"alslime/internal/api/apierror"
	"alslime/internal/api/apiresponse"
	"alslime/internal/config"
	chatflow "alslime/internal/coreapi"
	"alslime/internal/domain/chatjobs"
	"alslime/internal/domain/models"
	"alslime/internal/domain/sessions"
	usermodelssvc "alslime/internal/domain/usermodels"
	usermodelsstore "alslime/internal/storage/usermodels"
)

// pingPrompt は疎通確認で送る短文。応答が返ることだけを確認する。
const pingPrompt = `接続確認です。「OK」とだけ返答してください。 / Connectivity check: reply with just "OK".`

// pingOutputLimit は疎通確認レスポンスへ載せる応答本文の上限（ルーン数）。
const pingOutputLimit = 200

// Deps はハンドラが必要とする依存。
type Deps struct {
	// UserModels はユーザーモデル設定の取得・更新・マージを担う service。
	UserModels *usermodelssvc.Service
	// Checker は疎通確認の呼び出し口（EngineRouter を渡す）。
	Checker chatflow.Engine
	// Timeout は疎通確認1回の上限（チャット本体の CLI タイムアウトと同値を想定）。
	Timeout time.Duration
	// NewPingSessionID は Antigravity 疎通確認用の新規セッション ID を生成する。
	// Antigravity CLI は --conversation の ID 指定が必須のため（他 provider は空で新規会話）。
	NewPingSessionID func() string
}

// Register は models 系ルートを mux へ登録する。
func Register(mux *http.ServeMux, deps Deps) {
	// 疎通確認は CLI プロセスを起動するため、全体で1件に直列化する
	// （jobs.Queue / process.Manager のセマフォを通らない直呼びのため自前で絞る）。
	pingMu := &sync.Mutex{}
	mux.HandleFunc(http.MethodGet+" "+config.APIPrefix+routeModels, handleModels(deps))
	mux.HandleFunc(http.MethodGet+" "+config.APIPrefix+routeModelsUser, handleGetUser(deps))
	mux.HandleFunc(http.MethodPost+" "+config.APIPrefix+routeModelsUser, handlePostUser(deps))
	mux.HandleFunc(http.MethodPost+" "+config.APIPrefix+routeModelsPing, handlePing(deps, pingMu))
}

// modelsResponse は /api/models のレスポンス。
// 旧 settings パッケージ時代（{ models: [...] }）と同形を保つ。
type modelsResponse struct {
	Models []models.Model `json:"models"`
}

// handleModels はモデル一覧の正本（内蔵デフォルト＋ユーザー設定のマージ結果）を返す。
func handleModels(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		merged, err := deps.UserModels.Merged()
		if err != nil {
			apierror.Write(w, apierror.Internal(err))
			return
		}
		writeJSON(w, modelsResponse{Models: merged})
	}
}

// userModelsResponse は GET /api/models/user のレスポンス。
type userModelsResponse struct {
	BuiltIn []models.Model     `json:"builtin"`
	Added   []models.UserModel `json:"added"`
	Hidden  []string           `json:"hidden"`
}

// handleGetUser は編集モーダル用に内蔵一覧＋ユーザー設定を返す。
func handleGetUser(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		data, err := deps.UserModels.Get()
		if err != nil {
			apierror.Write(w, apierror.Internal(err))
			return
		}
		writeJSON(w, userModelsResponse{
			BuiltIn: models.BuiltIn(),
			Added:   data.Added,
			Hidden:  data.Hidden,
		})
	}
}

// userModelsUpdateResponse は POST /api/models/user のレスポンス。
// Models は保存後のマージ結果（フロントの一覧即時反映用）。
type userModelsUpdateResponse struct {
	Success bool               `json:"success"`
	Added   []models.UserModel `json:"added"`
	Hidden  []string           `json:"hidden"`
	Models  []models.Model     `json:"models"`
}

// handlePostUser はユーザーモデル設定を検証して全置換保存する。
func handlePostUser(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var data usermodelsstore.Data
		if err := json.NewDecoder(r.Body).Decode(&data); err != nil {
			apierror.Write(w, apierror.BadRequestKey(errKeyInvalidJSONBody))
			return
		}
		updated, err := deps.UserModels.Update(data)
		if err != nil {
			if usermodelssvc.IsValidationError(err) {
				// 検証エラーの Error() は i18n キーそのもの。
				apierror.Write(w, apierror.BadRequestKey(err.Error()))
				return
			}
			apierror.Write(w, apierror.Internal(err))
			return
		}
		merged, err := deps.UserModels.Merged()
		if err != nil {
			apierror.Write(w, apierror.Internal(err))
			return
		}
		writeJSON(w, userModelsUpdateResponse{
			Success: true,
			Added:   updated.Added,
			Hidden:  updated.Hidden,
			Models:  merged,
		})
	}
}

// pingRequest は POST /api/models/ping のリクエスト。
// model は空も許可する（空は「Default model config」＝ CLI 既定モデルの疎通確認）。
type pingRequest struct {
	Model string `json:"model"`
}

// pingResponse は疎通確認の結果。失敗も HTTP 200 で返し、success で判定する。
// error には provider のエラーメッセージ（i18n キーの場合あり）を載せる。
type pingResponse struct {
	Success   bool   `json:"success"`
	Output    string `json:"output,omitempty"`
	Error     string `json:"error,omitempty"`
	ElapsedMs int64  `json:"elapsedMs"`
}

// handlePing は指定モデル ID で provider 実行経路へ短文を送り、応答有無を返す。
//
// セッション保存・ネイティブ履歴焼き込みの副作用を避けるため、jobs.Queue も
// chatflow.Runner も通さず Engine を直接呼ぶ。SessionID は provider により扱いが違う:
//   - Claude は「新規・継続を問わず nativeSessionId で resume」のため、焼き込みなしの
//     疎通確認では空にして resume なしの新規会話にする（Gemini も IsNewSession で同様）。
//   - Antigravity は --conversation の ID 指定が必須のため、新規 ID を払い出す。
func handlePing(deps Deps, pingMu *sync.Mutex) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req pingRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			apierror.Write(w, apierror.BadRequestKey(errKeyInvalidJSONBody))
			return
		}
		if !pingMu.TryLock() {
			apierror.Write(w, apierror.NewKey(http.StatusTooManyRequests, errKeyPingBusy))
			return
		}
		defer pingMu.Unlock()

		model := strings.TrimSpace(req.Model)
		sessionID := ""
		if models.KindOf(model) == models.KindAntigravity {
			sessionID = deps.NewPingSessionID()
		}
		ctx, cancel := context.WithTimeout(r.Context(), deps.Timeout)
		defer cancel()

		started := time.Now()
		res, err := deps.Checker.Chat(ctx, chatflow.Request{
			Payload:      chatjobs.Payload{Model: model, Message: pingPrompt},
			Session:      sessions.UnifiedSession{SessionID: sessionID},
			UserMessage:  pingPrompt,
			Prompt:       pingPrompt,
			ModelType:    sessions.ModelTypeFromModelID(model),
			IsNewSession: true,
		})
		elapsed := time.Since(started).Milliseconds()

		switch {
		case err != nil:
			writeJSON(w, pingResponse{Success: false, Error: err.Error(), ElapsedMs: elapsed})
		case res.ProviderError:
			writeJSON(w, pingResponse{Success: false, Error: truncateOutput(res.Output), ElapsedMs: elapsed})
		case strings.TrimSpace(res.Output) == "":
			writeJSON(w, pingResponse{Success: false, Error: errKeyPingEmptyResponse, ElapsedMs: elapsed})
		default:
			writeJSON(w, pingResponse{Success: true, Output: truncateOutput(res.Output), ElapsedMs: elapsed})
		}
	}
}

// truncateOutput は応答本文をレスポンス掲載用に切り詰める。
func truncateOutput(output string) string {
	output = strings.TrimSpace(output)
	runes := []rune(output)
	if len(runes) <= pingOutputLimit {
		return output
	}
	return string(runes[:pingOutputLimit]) + "…"
}

// writeJSON は 200 で JSON を書き出す共通処理。
func writeJSON(w http.ResponseWriter, v any) {
	if err := apiresponse.WriteJSON(w, http.StatusOK, v); err != nil {
		apierror.Write(w, apierror.Internal(err))
	}
}
