// Package settingspack は設定パック（設定インポート・エクスポート）の API を提供する。
//
// ルート（設計 §10）:
//   - GET  /api/settings-pack/catalog … 分類ツリー（tier 反映済み）
//   - POST /api/settings-pack/inspect … zip 検査（dry-run。書き込みなし）
//   - POST /api/settings-pack/import  … zip 適用（衝突ポリシー付き）
//   - POST /api/settings-pack/export  … 選択種別を zip でダウンロード
//
// 画像生成系（D 分類）の可否はフロントの出し分けに頼らず、ここでも
// FeatureGate で判定する（設計 §9）。
package settingspack

import (
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"sync"

	"alslime/internal/api/apierror"
	"alslime/internal/api/apiresponse"
	"alslime/internal/config"
	"alslime/internal/coreapi"
	domain "alslime/internal/domain/settingspack"
	"alslime/internal/features"
	syspack "alslime/internal/system/settingspack"
)

// formFieldPack はアップロード multipart のファイルフィールド名。
const formFieldPack = "pack"

// Deps は settings-pack ハンドラの依存。
type Deps struct {
	// Manager はパック zip の検査・適用・生成を担う。
	Manager *syspack.Manager
	// Gate は機能ゲート（D 分類の tier 判定）。nil は全ゲート無効として扱う。
	Gate coreapi.FeatureGate
	// Inbox は起動時取り込み（import_inbox）の結果保持。nil は未実行として扱う。
	Inbox *InboxState
}

// Register は settings-pack 系ルートを mux へ登録する。
func Register(mux *http.ServeMux, deps Deps) {
	mux.HandleFunc("GET "+config.APIPrefix+"/settings-pack/catalog", handleCatalog(deps))
	mux.HandleFunc("POST "+config.APIPrefix+"/settings-pack/inspect", handleInspect(deps))
	mux.HandleFunc("POST "+config.APIPrefix+"/settings-pack/import", handleImport(deps))
	mux.HandleFunc("POST "+config.APIPrefix+"/settings-pack/export", handleExport(deps))
	mux.HandleFunc("GET "+config.APIPrefix+"/settings-pack/inbox", handleInbox(deps))
	mux.HandleFunc("POST "+config.APIPrefix+"/settings-pack/download-samples", handleDownloadSamples(deps))
}

// InboxState は起動時取り込み結果の保持（background goroutine が Set、handler が Get）。
type InboxState struct {
	mu     sync.Mutex
	report *syspack.InboxReport
}

// NewInboxState は空の InboxState を返す。
func NewInboxState() *InboxState {
	return &InboxState{}
}

// Set は取り込み結果を保存する。
func (s *InboxState) Set(report syspack.InboxReport) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.report = &report
}

// Get は取り込み結果を返す（未実行は nil）。
func (s *InboxState) Get() *syspack.InboxReport {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.report
}

// RunInbox は起動時取り込みを実行して結果を state へ保存する
// （routes.go の background から goroutine で呼ぶ）。
func RunInbox(state *InboxState, manager *syspack.Manager, gate coreapi.FeatureGate) {
	state.Set(manager.ProcessInbox(imageGenAllowed(gate)))
}

// inboxResponse は GET /api/settings-pack/inbox のレスポンス。
type inboxResponse struct {
	// Status は "pending"（起動時処理が未完了）または "done"。
	Status string `json:"status"`
	// Report は処理結果（done のときのみ）。
	Report *syspack.InboxReport `json:"report,omitempty"`
}

// handleInbox は起動時取り込みの結果を返す。
func handleInbox(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		if deps.Inbox == nil {
			writeJSON(w, inboxResponse{Status: "pending"})
			return
		}
		report := deps.Inbox.Get()
		if report == nil {
			writeJSON(w, inboxResponse{Status: "pending"})
			return
		}
		writeJSON(w, inboxResponse{Status: "done", Report: report})
	}
}

// imageGenAllowed は D 分類（画像生成系）の可否を gate から判定する。
func imageGenAllowed(gate coreapi.FeatureGate) bool {
	return gate != nil && gate.Enabled(string(features.FeatureComfyUI))
}

// catalogKind はカタログ API の1種別。
type catalogKind struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Class string `json:"class"`
}

// catalogResponse は GET /api/settings-pack/catalog のレスポンス。
type catalogResponse struct {
	Kinds []catalogKind `json:"kinds"`
}

// handleCatalog は選択可能な種別ツリーを返す。
// E・F 分類は Kinds に含まれず、D 分類は tier が無ければ返さない。
func handleCatalog(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		allowD := imageGenAllowed(deps.Gate)
		kinds := []catalogKind{}
		for _, k := range domain.Kinds() {
			if k.Class == domain.ClassImageGen && !allowD {
				continue
			}
			kinds = append(kinds, catalogKind{ID: k.ID, Label: k.Label, Class: string(k.Class)})
		}
		writeJSON(w, catalogResponse{Kinds: kinds})
	}
}

// handleInspect はアップロードされた zip のインポートプラン（dry-run）を返す。
func handleInspect(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		zipPath, cleanup, apiErr := receivePack(r)
		if apiErr != nil {
			apierror.Write(w, apiErr)
			return
		}
		defer cleanup()

		plan, err := deps.Manager.Inspect(zipPath, imageGenAllowed(deps.Gate))
		if err != nil {
			apierror.Write(w, packError(err))
			return
		}
		writeJSON(w, plan)
	}
}

// importRequestOverrides は import の overrides フィールド（JSON 文字列）の型。
type importRequestOverrides map[string]syspack.ImportPolicy

// handleImport はアップロードされた zip を適用する。
//
// multipart フィールド:
//   - pack:      zip ファイル（必須）
//   - policy:    "skip" | "overwrite" | "rename"（省略時 skip）
//   - overrides: {"<path>": "<policy>"} の JSON 文字列（任意）
func handleImport(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		zipPath, cleanup, apiErr := receivePack(r)
		if apiErr != nil {
			apierror.Write(w, apiErr)
			return
		}
		defer cleanup()

		policy := syspack.ImportPolicy(r.FormValue("policy"))
		if policy == "" {
			policy = syspack.PolicySkip
		}
		if !syspack.ValidPolicy(policy) {
			apierror.Write(w, apierror.BadRequestKey("settingsPack.error.invalidPolicy"))
			return
		}
		var overrides importRequestOverrides
		if raw := r.FormValue("overrides"); raw != "" {
			if err := json.Unmarshal([]byte(raw), &overrides); err != nil {
				apierror.Write(w, apierror.BadRequestKey("settingsPack.error.invalidOverrides"))
				return
			}
		}

		result, err := deps.Manager.Import(zipPath, syspack.ImportOptions{
			Policy:          policy,
			Overrides:       overrides,
			ImageGenAllowed: imageGenAllowed(deps.Gate),
		})
		if err != nil {
			apierror.Write(w, packError(err))
			return
		}
		writeJSON(w, result)
	}
}

// exportRequest は POST /api/settings-pack/export のリクエスト。
type exportRequest struct {
	Kinds                  []string `json:"kinds"`
	IncludeCharacterImages bool     `json:"includeCharacterImages"`
	Name                   string   `json:"name"`
	Description            string   `json:"description"`
}

// handleExport は選択種別を zip としてダウンロードさせる。
func handleExport(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req exportRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			apierror.Write(w, apierror.BadRequestKey("settingsPack.error.invalidRequest"))
			return
		}
		if len(req.Kinds) == 0 {
			apierror.Write(w, apierror.BadRequestKey("settingsPack.error.noKinds"))
			return
		}
		// 種別の存在・tier 判定は zip 送出（ヘッダ確定）前に済ませる。
		// 送出開始後はステータス・ヘッダを変更できないため。
		allowD := imageGenAllowed(deps.Gate)
		for _, id := range req.Kinds {
			k, ok := domain.FindKind(id)
			if !ok {
				apierror.Write(w, apierror.BadRequestKey("settingsPack.error.invalidRequest"))
				return
			}
			if k.Class == domain.ClassImageGen && !allowD {
				apierror.Write(w, apierror.ForbiddenKey(domain.ReasonTier))
				return
			}
		}

		w.Header().Set(config.HTTPHeaderContentType, "application/zip")
		w.Header().Set("Content-Disposition", `attachment; filename="settings-pack.zip"`)
		if _, err := deps.Manager.Export(w, syspack.ExportSelection{
			KindIDs:                req.Kinds,
			IncludeCharacterImages: req.IncludeCharacterImages,
			Name:                   req.Name,
			Description:            req.Description,
		}, allowD); err != nil {
			// zip 送出開始後はステータスを書き換えられない可能性があるため、
			// ここでの Write はログ・未送出時の救済用途。
			apierror.Write(w, packError(err))
			return
		}
	}
}

// receivePack は multipart の pack フィールドを一時ファイルへ保存する。
// 呼び出し側は cleanup を必ず defer すること。
func receivePack(r *http.Request) (zipPath string, cleanup func(), apiErr *apierror.Error) {
	r.Body = http.MaxBytesReader(nil, r.Body, config.SettingsPackMaxUploadBytes)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		return "", nil, apierror.BadRequestKey("settingsPack.error.uploadTooLarge")
	}
	file, _, err := r.FormFile(formFieldPack)
	if err != nil {
		return "", nil, apierror.BadRequestKey("settingsPack.error.packRequired")
	}
	return saveUpload(file)
}

// saveUpload はアップロード内容を OS 一時ファイルへ書き出す。
func saveUpload(file multipart.File) (string, func(), *apierror.Error) {
	defer func() { _ = file.Close() }()
	tmp, err := os.CreateTemp("", "alslime-pack-*.zip")
	if err != nil {
		return "", nil, apierror.Internal(err)
	}
	name := tmp.Name()
	cleanup := func() { _ = os.Remove(name) }
	if _, err := io.Copy(tmp, file); err != nil {
		_ = tmp.Close()
		cleanup()
		return "", nil, apierror.Internal(err)
	}
	if err := tmp.Close(); err != nil {
		cleanup()
		return "", nil, apierror.Internal(err)
	}
	return name, cleanup, nil
}

// packError は domain/system 層のエラーを HTTP エラーへ変換する。
func packError(err error) *apierror.Error {
	switch {
	case errors.Is(err, domain.ErrManifestInvalid),
		errors.Is(err, domain.ErrPackFormatTooNew),
		errors.Is(err, domain.ErrTooManyEntries),
		errors.Is(err, domain.ErrTooLarge):
		return apierror.BadRequestKey(err.Error())
	case err.Error() == domain.BlockedAuth:
		return apierror.ForbiddenKey(domain.BlockedAuth)
	case err.Error() == domain.ReasonTier:
		return apierror.ForbiddenKey(domain.ReasonTier)
	default:
		return apierror.Internal(err)
	}
}

// writeJSON は 200 で JSON を書き出す。
func writeJSON(w http.ResponseWriter, v any) {
	if err := apiresponse.WriteJSON(w, http.StatusOK, v); err != nil {
		apierror.Write(w, apierror.Internal(err))
	}
}
