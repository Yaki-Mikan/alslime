// Package presets はディレクトリ列挙型プリセットの HTTP ハンドラを提供する。
//
// 統一 API 契約（交換日記 08 の合意。全系統共通）:
//   - 一覧 GET    /api/<kind>        -> { presets: string[] }
//   - 取得 GET    /api/<kind>/{name} -> { name, data }
//   - 保存 POST   /api/<kind>        body { name, data } -> { success, name }
//   - 削除 DELETE /api/<kind>/{name} -> { success }
//
// 系統（SSRP_Mode / 時刻設定 / SSRP_All / SSRP_Parameter）の差は service 側
// （保存先・メタ付与）で吸収済みのため、handler は系統非依存。各系統は
// RouteSet で「URL の kind 名」と「対応する service」を束ねて登録する。
//
// handler は薄く保つ（規約案）: request parse / validation / service 呼び出し /
// response 生成 / HTTP status 決定のみを行い、永続化や正本操作は service へ委譲する。
package presets

import (
	"encoding/json"
	"errors"
	"net/http"

	"alslime/internal/api/apierror"
	"alslime/internal/api/apiresponse"
	"alslime/internal/config"
	"alslime/internal/storage/presetname"
	"alslime/internal/storage/presetstore"
)

// Service はプリセット系統が満たすべきユースケースの最小インタフェース。
//
// handler を具体型へ依存させないことで、ディレクトリ列挙型（domain/presets）と
// 単一ファイル型（datetime-presets。後続実装）の両方を同じ handler に乗せられる
// （燈レビュー指摘4）。
//
// Data の型は any。datetime-presets のように値が文字列・値オブジェクトになる系統と、
// SSRP 系のようにオブジェクトになる系統を同一契約で扱うため（交換日記 08 / 指摘4）。
type Service interface {
	// List はプリセット名一覧（表示名）を返す。
	List() ([]string, error)
	// Get は name のプリセット内容を返す。未存在は presetstore.ErrNotFound。
	// 第1戻り値は正規化済みの正本名（レスポンス name はこれを使う）。
	Get(name string) (normalizedName string, data any, err error)
	// Save は name のプリセットを保存し、保存された正本名（正規化後）を返す。
	Save(name string, data any) (string, error)
	// Delete は name のプリセットを削除する。未存在は presetstore.ErrNotFound。
	Delete(name string) error
}

// RouteSet は 1 系統分の登録情報。kind は URL 断片（例: "presets"）。
type RouteSet struct {
	// Kind は API パスの種別断片。config.APIPrefix + "/" + Kind がベースパス。
	Kind string
	// Service はその系統のユースケースを担う。
	Service Service
}

// Register は複数系統のプリセットルートをまとめて mux へ登録する。
func Register(mux *http.ServeMux, sets ...RouteSet) {
	for _, set := range sets {
		registerOne(mux, set)
	}
}

// registerOne は 1 系統分の CRUD ルートを登録する。
func registerOne(mux *http.ServeMux, set RouteSet) {
	base := config.APIPrefix + "/" + set.Kind
	mux.HandleFunc(http.MethodGet+" "+base, handleList(set.Service))
	mux.HandleFunc(http.MethodGet+" "+base+"/{"+pathParamName+"}", handleGet(set.Service))
	mux.HandleFunc(http.MethodPost+" "+base, handleSave(set.Service))
	mux.HandleFunc(http.MethodDelete+" "+base+"/{"+pathParamName+"}", handleDelete(set.Service))
}

// listResponse は一覧レスポンス { presets: [...] }。
type listResponse struct {
	Presets []string `json:"presets"`
}

// handleList は一覧を返す。
func handleList(svc Service) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		names, err := svc.List()
		if err != nil {
			apierror.Write(w, apierror.Internal(err))
			return
		}
		writeJSON(w, listResponse{Presets: names})
	}
}

// getResponse は取得レスポンス { name, data }。
// Data は any（系統により map / 文字列 / 値オブジェクト）。
type getResponse struct {
	Name string `json:"name"`
	Data any    `json:"data"`
}

// handleGet は name のプリセットを返す。未存在は 404、不正名は 400。
//
// レスポンスの name は service が返す正規化済み正本名を使う。
// path の name に余分な空白等が含まれても、契約上は正本名を返す（燈レビュー対応確認）。
func handleGet(svc Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name := r.PathValue(pathParamName)
		normalized, data, err := svc.Get(name)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, getResponse{Name: normalized, Data: data})
	}
}

// saveRequest は保存リクエストボディ { name, data }。
// Data は any（系統により map / 文字列 / 値オブジェクト）。
type saveRequest struct {
	Name string `json:"name"`
	Data any    `json:"data"`
}

// saveResponse は保存レスポンス { success, name }。
type saveResponse struct {
	Success bool   `json:"success"`
	Name    string `json:"name"`
}

// handleSave はプリセットを保存する。
//
// body の name 欠落・data 欠落は 400。名前検証エラーは 400、
// 大文字小文字違いの衝突は 409。
func handleSave(svc Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req saveRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			apierror.Write(w, apierror.BadRequestKey(errKeyInvalidJSONBody))
			return
		}
		if req.Name == "" {
			apierror.Write(w, apierror.BadRequestKey(errKeyNameRequired))
			return
		}
		if req.Data == nil {
			apierror.Write(w, apierror.BadRequestKey(errKeyDataRequired))
			return
		}
		// レスポンスの name は保存された正本名（正規化後）を返す。
		// 例: "  夜の設定  " で保存すると "夜の設定" が返る（燈レビュー指摘2）。
		saved, err := svc.Save(req.Name, req.Data)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, saveResponse{Success: true, Name: saved})
	}
}

// handleDelete は name のプリセットを削除する。未存在は 404、不正名は 400。
func handleDelete(svc Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name := r.PathValue(pathParamName)
		if err := svc.Delete(name); err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, successResponse{Success: true})
	}
}

// successResponse は削除など { success } のみのレスポンス。
type successResponse struct {
	Success bool `json:"success"`
}

// writeStoreError は store/service 由来のエラーを適切な HTTP ステータスへ変換する。
//
//   - presetstore.ErrNotFound          -> 404
//   - presetstore.ErrNameConflict      -> 409
//   - presetname の検証エラー各種        -> 400
//   - それ以外                          -> 500（内部詳細はログのみ）
func writeStoreError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, presetstore.ErrNotFound):
		apierror.Write(w, apierror.NotFoundKey(errKeyPresetNotFound))
	case errors.Is(err, presetstore.ErrNameConflict):
		apierror.Write(w, apierror.NewKey(http.StatusConflict, errKeyPresetNameConflict))
	case isNameValidationError(err):
		apierror.Write(w, apierror.BadRequestKey(errKeyPresetNameInvalid))
	default:
		apierror.Write(w, apierror.Internal(err))
	}
}

// isNameValidationError は presetname の検証エラー（利用者起因の 400 相当）かを返す。
func isNameValidationError(err error) bool {
	return errors.Is(err, presetname.ErrEmpty) ||
		errors.Is(err, presetname.ErrTooLong) ||
		errors.Is(err, presetname.ErrInvalidChar) ||
		errors.Is(err, presetname.ErrReserved) ||
		errors.Is(err, presetname.ErrTrailing)
}

// writeJSON は 200 で JSON を書き出す共通処理。
func writeJSON(w http.ResponseWriter, v any) {
	if err := apiresponse.WriteJSON(w, http.StatusOK, v); err != nil {
		apierror.Write(w, apierror.Internal(err))
	}
}
