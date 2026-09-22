package tempcharacters

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strings"

	"alslime/internal/api/apierror"
	"alslime/internal/api/apiresponse"
	"alslime/internal/config"
	"alslime/internal/domain/characters"
	"alslime/internal/domain/charname"
	"alslime/internal/domain/configeditor"
	"alslime/internal/domain/presets"
	"alslime/internal/domain/sessions"
	tempchar "alslime/internal/domain/tempcharacters"
	"alslime/internal/i18n"
	"alslime/internal/storage/charfilters"
)

// Deps は temp-characters API の依存。
type Deps struct {
	Sessions *sessions.Service
	// Characters は登録済みキャラクター一覧（同名の存在確認・照合用 ID の取得）。
	Characters *charfilters.Store
	// Editor は設定ファイルの書き込み経路（キャラクターディレクトリと設定ファイルの作成）。
	Editor *configeditor.Service
	// Linked は紐づけ設定（由来の記録を書く）。
	Linked *characters.LinkedSettingsService
	// Presets は会話設定プリセット（SSRP_All）。登録時に紐づくプリセットも書き換える。
	Presets *presets.Service
}

// Register は temp-characters API を mux へ登録する。
func Register(mux *http.ServeMux, deps Deps) {
	mux.HandleFunc(http.MethodPost+" "+config.APIPrefix+routeUpdate, handleUpdate(deps))
	mux.HandleFunc(http.MethodPost+" "+config.APIPrefix+routeRemove, handleRemove(deps))
	mux.HandleFunc(http.MethodPost+" "+config.APIPrefix+routeRegister, handleRegister(deps))
}

type targetRequest struct {
	SessionID   string `json:"sessionId"`
	VirtualPath string `json:"virtualPath"`
	Content     string `json:"content,omitempty"`
}

type settingsResponse struct {
	Success        bool           `json:"success"`
	SSRPSettings   map[string]any `json:"ssrpSettings"`
	RegisteredPath string         `json:"registeredPath,omitempty"`
}

func decodeTarget(w http.ResponseWriter, r *http.Request) (targetRequest, bool) {
	var req targetRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorInvalidJSONBody))
		return req, false
	}
	req.SessionID = strings.TrimSpace(req.SessionID)
	req.VirtualPath = strings.TrimSpace(strings.ReplaceAll(req.VirtualPath, `\`, "/"))
	if req.SessionID == "" {
		apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorSessionIDRequired))
		return req, false
	}
	if !tempchar.IsTempCharacterPath(req.VirtualPath) {
		apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorTempCharNotFound))
		return req, false
	}
	return req, true
}

func writeSessionError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, os.ErrNotExist):
		apierror.Write(w, apierror.NewKey(http.StatusNotFound, i18n.KeyErrorTempCharSessionNotFound))
	case errors.Is(err, errTempNotFound):
		apierror.Write(w, apierror.NewKey(http.StatusNotFound, i18n.KeyErrorTempCharNotFound))
	default:
		apierror.Write(w, apierror.NewKey(http.StatusInternalServerError, i18n.KeyErrorInternal))
	}
}

var errTempNotFound = errors.New(i18n.KeyErrorTempCharNotFound)

// handleUpdate は簡易エディタの保存（一時キャラクターの設定本文の更新）。
func handleUpdate(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		req, ok := decodeTarget(w, r)
		if !ok {
			return
		}
		if len(req.Content) > contentMaxBytes {
			apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorTempCharContentTooLarge))
			return
		}
		updated, err := deps.Sessions.Update(req.SessionID, func(session *sessions.UnifiedSession) error {
			tc, ok := tempchar.Get(session.SSRPSettings, req.VirtualPath)
			if !ok {
				return errTempNotFound
			}
			tc.Content = req.Content
			tempchar.Set(session.SSRPSettings, req.VirtualPath, tc)
			return nil
		})
		if err != nil {
			writeSessionError(w, err)
			return
		}
		_ = apiresponse.WriteJSON(w, http.StatusOK, settingsResponse{Success: true, SSRPSettings: updated.SSRPSettings})
	}
}

// handleRemove はスロットのごみ箱（一時キャラクターを会話設定から外し、本文も消す）。
func handleRemove(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		req, ok := decodeTarget(w, r)
		if !ok {
			return
		}
		updated, err := deps.Sessions.Update(req.SessionID, func(session *sessions.UnifiedSession) error {
			if session.SSRPSettings == nil {
				return nil
			}
			tempchar.Delete(session.SSRPSettings, req.VirtualPath)
			session.SSRPSettings["characters"] = removeCharacter(session.SSRPSettings["characters"], req.VirtualPath)
			for _, key := range []string{"characterDetails", "voiceDesignByCharacter"} {
				if m, ok := session.SSRPSettings[key].(map[string]any); ok {
					delete(m, req.VirtualPath)
				}
			}
			return nil
		})
		if err != nil {
			writeSessionError(w, err)
			return
		}
		_ = apiresponse.WriteJSON(w, http.StatusOK, settingsResponse{Success: true, SSRPSettings: updated.SSRPSettings})
	}
}

// handleRegister はキャラ設定登録（一時キャラクターを正規のキャラクターにする）。
func handleRegister(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		req, ok := decodeTarget(w, r)
		if !ok {
			return
		}
		session, err := deps.Sessions.Read(req.SessionID)
		if err != nil {
			writeSessionError(w, err)
			return
		}
		tc, ok := tempchar.Get(session.SSRPSettings, req.VirtualPath)
		if !ok {
			apierror.Write(w, apierror.NewKey(http.StatusNotFound, i18n.KeyErrorTempCharNotFound))
			return
		}
		if tc.RegisteredPath != "" {
			// 既に登録済み（二度押し・照合済み）。書き換えは済んでいるので現状を返す。
			_ = apiresponse.WriteJSON(w, http.StatusOK, settingsResponse{Success: true, SSRPSettings: session.SSRPSettings, RegisteredPath: tc.RegisteredPath})
			return
		}
		dirName, err := tempchar.SanitizeForDirName(tc.Name)
		if err != nil {
			apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorTempCharInvalidName))
			return
		}
		// 同名の登録済みキャラクターが後から出来ていた場合は上書きしない。
		if exists, err := registeredNameExists(deps.Characters, tc.Name, dirName); err != nil {
			apierror.Write(w, apierror.NewKey(http.StatusInternalServerError, i18n.KeyErrorInternal))
			return
		} else if exists {
			apierror.Write(w, apierror.NewKey(http.StatusConflict, i18n.KeyErrorTempCharAlreadyExists))
			return
		}
		// 1. 設定ファイル（親ディレクトリは書き込み経路が作る）。
		if err := deps.Editor.WriteFile("character", dirName, dirName, tc.Content); err != nil {
			apierror.Write(w, apierror.NewKey(http.StatusInternalServerError, i18n.KeyErrorInternal))
			return
		}
		// 2. 由来の記録（紐づけ設定の origin）。
		linked, err := deps.Linked.Get(dirName)
		if err != nil {
			apierror.Write(w, apierror.NewKey(http.StatusInternalServerError, i18n.KeyErrorInternal))
			return
		}
		linked.Origin = &characters.LinkedOrigin{
			TempCharacterID: tc.ID,
			OriginalName:    tc.Name,
			SourceSessionID: tc.SourceSessionID,
			RegisteredAt:    tempchar.NowISO(),
		}
		if _, err := deps.Linked.Save(dirName, linked); err != nil {
			apierror.Write(w, apierror.NewKey(http.StatusInternalServerError, i18n.KeyErrorInternal))
			return
		}
		registeredPath := config.CharacterListDir + "/" + dirName + "/" + config.CharacterSettingsDirName + "/" + dirName + ".md"
		// 3. セッションの会話設定を登録した設定に変える。
		presetName := ""
		updated, err := deps.Sessions.Update(req.SessionID, func(s *sessions.UnifiedSession) error {
			if s.SSRPSettings == nil {
				return errTempNotFound
			}
			tempchar.RewriteForRegistered(s.SSRPSettings, req.VirtualPath, registeredPath)
			presetName, _ = s.SSRPSettings["presetName"].(string)
			return nil
		})
		if err != nil {
			writeSessionError(w, err)
			return
		}
		// 4. 紐づく会話設定プリセットも同じく変える（未存在・不正名は飛ばす）。
		if name := strings.TrimSpace(presetName); name != "" && deps.Presets != nil {
			if normalized, data, err := deps.Presets.Get(name); err == nil {
				if m, ok := data.(map[string]any); ok && tempchar.RewriteForRegistered(m, req.VirtualPath, registeredPath) {
					_, _ = deps.Presets.Save(normalized, m)
				}
			}
		}
		_ = apiresponse.WriteJSON(w, http.StatusOK, settingsResponse{Success: true, SSRPSettings: updated.SSRPSettings, RegisteredPath: registeredPath})
	}
}

// registeredNameExists は登録済みキャラクターの名前・ディレクトリ名・元の名前のいずれかが、
// 照合用正規化で name または dirName と一致するかを返す。
func registeredNameExists(store *charfilters.Store, name, dirName string) (bool, error) {
	if store == nil {
		return false, nil
	}
	list, err := store.ListCharacters()
	if err != nil {
		return false, err
	}
	wants := map[string]bool{
		charname.NormalizeMatchName(name):    true,
		charname.NormalizeMatchName(dirName): true,
	}
	delete(wants, "")
	for _, c := range list {
		for _, candidate := range []string{c.Name, c.DirName, c.OriginalName} {
			if candidate == "" {
				continue
			}
			if wants[charname.NormalizeMatchName(candidate)] {
				return true, nil
			}
		}
	}
	return false, nil
}

// removeCharacter は会話設定の characters 配列から値を取り除く。
func removeCharacter(raw any, value string) []any {
	out := make([]any, 0)
	switch v := raw.(type) {
	case []string:
		for _, item := range v {
			if item != value {
				out = append(out, item)
			}
		}
	case []any:
		for _, item := range v {
			if s, ok := item.(string); ok && s == value {
				continue
			}
			out = append(out, item)
		}
	}
	return out
}

// RegisteredTempCharacters は登録済みキャラクターの「一時キャラ ID → 設定ファイルのパス」を返す
// 関数を作る（セッション復元・プリセット読み込み時の照合に使う）。
func RegisteredTempCharacters(store *charfilters.Store) func() map[string]string {
	return func() map[string]string {
		out := map[string]string{}
		if store == nil {
			return out
		}
		list, err := store.ListCharacters()
		if err != nil {
			return out
		}
		for _, c := range list {
			if c.TempCharacterID == "" {
				continue
			}
			if _, exists := out[c.TempCharacterID]; !exists {
				out[c.TempCharacterID] = c.Path
			}
		}
		return out
	}
}
