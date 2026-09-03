// Package characters はキャラリスト走査・キャラフィルタの HTTP ハンドラを提供する。
//
// API 契約は現行 Node 版維持（交換日記 28）。
//   - GET  /api/character-tags             -> { characters: [{name,dirName,path,work,tags}] }
//   - GET  /api/character-filters          -> { works, tags }
//   - POST /api/character-filters/rebuild  -> { works, tags, stats:{totalCharacters,withTags,withoutTags} }
//
// 走査・集約は domain/characters → storage/charfilters に委ねる。
// 画像系 /api/characters/* と /images/characters は ImageService に委ねる。
package characters

import (
	"context"
	"encoding/json"
	"errors"
	"io/fs"
	"net/http"
	"strings"

	"alslime/internal/api/apierror"
	"alslime/internal/api/apiresponse"
	"alslime/internal/config"
	"alslime/internal/coreapi"
	charsvc "alslime/internal/domain/characters"
	sponsorsvc "alslime/internal/domain/sponsor"
	"alslime/internal/features"
	"alslime/internal/i18n"
	storage "alslime/internal/storage/charfilters"
)

// Register はキャラ系ルートを mux へ登録する。
func Register(mux *http.ServeMux, svc *charsvc.Service) {
	mux.HandleFunc(http.MethodGet+" "+config.APIPrefix+routeCharacterTags, handleTags(svc))
	mux.HandleFunc(http.MethodGet+" "+config.APIPrefix+routeCharacterFilters, handleFilters(svc))
	mux.HandleFunc(http.MethodPost+" "+config.APIPrefix+routeCharacterFiltersRebuild, handleRebuild(svc))
	mux.HandleFunc(http.MethodPut+" "+config.APIPrefix+routeCharacterTagsByDir, handleSaveTags(svc))
}

// RegisterEmotionPrompts は表情画像生成用の表情プロンプト（emotion_prompts.json）ルートを mux へ登録する。
// 「/characters/emotion-prompts」は「/characters/{name}/...」より具体的なため、Go 1.22 の mux で優先される。
func RegisterEmotionPrompts(mux *http.ServeMux, svc *charsvc.EmotionPromptsService) {
	mux.HandleFunc(http.MethodGet+" "+config.APIPrefix+routeEmotionPrompts, handleGetEmotionPrompts(svc))
	mux.HandleFunc(http.MethodPut+" "+config.APIPrefix+routeEmotionPrompts, handleSaveEmotionPrompts(svc))
}

func handleGetEmotionPrompts(svc *charsvc.EmotionPromptsService) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		data, err := svc.Get()
		if err != nil {
			apierror.Write(w, apierror.Internal(err))
			return
		}
		writeJSON(w, apiDataResponse{Success: true, Data: data})
	}
}

func handleSaveEmotionPrompts(svc *charsvc.EmotionPromptsService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req charsvc.EmotionPrompts
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorInvalidJSONBody))
			return
		}
		data, err := svc.Save(req)
		if err != nil {
			apierror.Write(w, apierror.Internal(err))
			return
		}
		writeJSON(w, apiDataResponse{Success: true, Data: data})
	}
}

// PackFetcher は認証サーバーから支援者向け配布パックを取得・検証して install へ渡す境界
// （domain/sponsor.Service.FetchPack）。
type PackFetcher interface {
	FetchPack(ctx context.Context, packID string, install func(zipPath string) error) (string, error)
}

// RegisterEmotionPromptsSample は表情プロンプトのサンプルパック取り込みルートを mux へ登録する。
// 画像生成機能が有効な支援レベルでなければ 403。取得はサーバーのトークン検証・署名検証を経る。
func RegisterEmotionPromptsSample(mux *http.ServeMux, svc *charsvc.EmotionPromptsService, fetcher PackFetcher, gate coreapi.FeatureGate) {
	mux.HandleFunc(http.MethodPost+" "+config.APIPrefix+routeEmotionPromptsSample, handleDownloadEmotionPromptsSample(svc, fetcher, gate))
}

func handleDownloadEmotionPromptsSample(svc *charsvc.EmotionPromptsService, fetcher PackFetcher, gate coreapi.FeatureGate) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if gate == nil || !gate.Enabled(string(features.FeatureComfyUI)) {
			apierror.Write(w, apierror.ForbiddenKey(i18n.KeyErrorImageGenRequired))
			return
		}
		// 言語ごとに別パック。lang は UI 言語（ja / en など）で、パック ID の一部になるため書式を絞る。
		var req emotionPromptsSampleRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorInvalidJSONBody))
			return
		}
		lang := strings.ToLower(strings.TrimSpace(req.Lang))
		if lang == "" {
			lang = config.I18NDefaultLang
		}
		if !samplePackLangPattern.MatchString(lang) {
			apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorInvalidLang))
			return
		}
		var result charsvc.EmotionPromptsMergeResult
		version, err := fetcher.FetchPack(r.Context(), emotionPromptsPackIDPrefix+lang, func(zipPath string) error {
			merged, mergeErr := svc.MergeFromZip(zipPath)
			if mergeErr != nil {
				return mergeErr
			}
			result = merged
			return nil
		})
		if err != nil {
			switch {
			case errors.Is(err, sponsorsvc.ErrModuleNoToken):
				apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorSponsorNoToken))
			case errors.Is(err, sponsorsvc.ErrModuleRejected):
				apierror.Write(w, apierror.ForbiddenKey(i18n.KeyErrorSponsorModuleRejected))
			case errors.Is(err, sponsorsvc.ErrTokenInvalid):
				apierror.Write(w, apierror.NewKey(http.StatusUnauthorized, i18n.KeyErrorSponsorTokenInvalid))
			case errors.Is(err, sponsorsvc.ErrTierRejected):
				apierror.Write(w, apierror.ForbiddenKey(i18n.KeyErrorSponsorTierRejected))
			case errors.Is(err, sponsorsvc.ErrModuleUnavailable), errors.Is(err, charsvc.ErrEmotionPromptsPackMissing):
				apierror.Write(w, apierror.NotFoundKey(i18n.KeyErrorSponsorModuleUnavailable))
			default:
				apierror.Write(w, apierror.WrapKey(http.StatusBadGateway, i18n.KeyErrorSponsorModuleInstallFailed, err))
			}
			return
		}
		writeJSON(w, apiDataResponse{Success: true, Data: emotionPromptsSampleResponse{
			Version: version, Added: result.Added, Skipped: result.Skipped, Prompts: result.Prompts,
		}})
	}
}

// RegisterLinkedSettings はキャラクターの設定紐づけ（linked_settings.json）ルートを mux へ登録する。
func RegisterLinkedSettings(mux *http.ServeMux, svc *charsvc.LinkedSettingsService) {
	mux.HandleFunc(http.MethodGet+" "+config.APIPrefix+routeCharacterLinkedSettings, handleGetLinkedSettings(svc))
	mux.HandleFunc(http.MethodPut+" "+config.APIPrefix+routeCharacterLinkedSettings, handleSaveLinkedSettings(svc))
}

// handleSaveTags は tags.json を書き込み、続けてマスタを再構築する。
func handleSaveTags(svc *charsvc.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req saveTagsRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorInvalidJSONBody))
			return
		}
		if req.Tags == nil {
			req.Tags = []string{}
		}
		filters, stats, err := svc.SaveTags(r.PathValue(pathParamDirName), req.Work, req.Tags)
		if err != nil {
			switch {
			case errors.Is(err, storage.ErrInvalidDirName):
				apierror.Write(w, apierror.BadRequestKey(errKeyInvalidName))
			case errors.Is(err, fs.ErrNotExist):
				apierror.Write(w, apierror.NotFoundKey(errKeyCharacterNotFound))
			default:
				apierror.Write(w, apierror.Internal(err))
			}
			return
		}
		// 書き込んだ値を読み直さず、正規化後の値をそのまま返す（work は空なら nil）。
		var work *string
		if req.Work != nil && *req.Work != "" {
			work = req.Work
		}
		writeJSON(w, saveTagsResponse{Work: work, Tags: req.Tags, Filters: filters, Stats: stats})
	}
}

func handleGetLinkedSettings(svc *charsvc.LinkedSettingsService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		data, err := svc.Get(r.PathValue(pathParamCharacterName))
		if err != nil {
			writeLinkedSettingsError(w, err)
			return
		}
		writeJSON(w, apiDataResponse{Success: true, Data: data})
	}
}

func handleSaveLinkedSettings(svc *charsvc.LinkedSettingsService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req charsvc.LinkedSettings
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			apierror.Write(w, apierror.BadRequestKey(i18n.KeyErrorInvalidJSONBody))
			return
		}
		data, err := svc.Save(r.PathValue(pathParamCharacterName), req)
		if err != nil {
			writeLinkedSettingsError(w, err)
			return
		}
		writeJSON(w, apiDataResponse{Success: true, Data: data})
	}
}

func writeLinkedSettingsError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, charsvc.ErrInvalidName):
		apierror.Write(w, apierror.BadRequestKey(errKeyInvalidName))
	case errors.Is(err, charsvc.ErrCharacterNotFound):
		apierror.Write(w, apierror.NotFoundKey(errKeyCharacterNotFound))
	default:
		apierror.Write(w, apierror.Internal(err))
	}
}

// RegisterImages はキャラクター画像系ルートを mux へ登録する。
func RegisterImages(mux *http.ServeMux, svc *charsvc.ImageService) {
	mux.HandleFunc(http.MethodGet+" "+config.APIPrefix+routeCharacterEmotions, handleEmotions(svc))
	mux.HandleFunc(http.MethodGet+" "+config.APIPrefix+routeEmotionCatalog, handleEmotionCatalog(svc))
	mux.HandleFunc(http.MethodPost+" "+config.APIPrefix+routeEmotionCatalog, handleSaveEmotionCatalog(svc))
	mux.HandleFunc(http.MethodPost+" "+config.APIPrefix+routeEmotionImagePrune, handlePruneEmotionImages(svc))
	mux.HandleFunc(http.MethodGet+" "+config.APIPrefix+routeCharacterImages, handleCharacterImages(svc))
	mux.HandleFunc(http.MethodPost+" "+config.APIPrefix+routeCharacterImageUpload, handleUploadImage(svc))
	mux.HandleFunc(http.MethodPost+" "+config.APIPrefix+routeCharacterImageCrop, handleCropImage(svc))
	mux.HandleFunc(http.MethodDelete+" "+config.APIPrefix+routeCharacterImageDelete, handleDeleteImage(svc))
	mux.HandleFunc(http.MethodGet+" "+config.CharacterImagesRoute+routeStaticCharacterImage, handleStaticImage(svc))
}

func handleTags(svc *charsvc.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		chars, err := svc.Tags()
		if err != nil {
			apierror.Write(w, apierror.Internal(err))
			return
		}
		if chars == nil {
			chars = []storage.Character{}
		}
		writeJSON(w, charactersResponse{Characters: chars})
	}
}

func handleFilters(svc *charsvc.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		filters, err := svc.Filters()
		if err != nil {
			apierror.Write(w, apierror.Internal(err))
			return
		}
		// 現行は { works, tags } をそのまま返す。
		writeJSON(w, filters)
	}
}

// rebuildResponse は rebuild レスポンス（{ works, tags, stats }）。
type rebuildResponse struct {
	Works []string             `json:"works"`
	Tags  []string             `json:"tags"`
	Stats storage.RebuildStats `json:"stats"`
}

func handleRebuild(svc *charsvc.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		filters, stats, err := svc.RebuildFilters()
		if err != nil {
			apierror.Write(w, apierror.Internal(err))
			return
		}
		writeJSON(w, rebuildResponse{Works: filters.Works, Tags: filters.Tags, Stats: stats})
	}
}

func handleEmotions(svc *charsvc.ImageService) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		data, err := svc.Emotions()
		if err != nil {
			apierror.Write(w, apierror.Internal(err))
			return
		}
		writeJSON(w, apiDataResponse{Success: true, Data: data})
	}
}

func handleEmotionCatalog(svc *charsvc.ImageService) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		data, err := svc.EmotionCatalog()
		if err != nil {
			apierror.Write(w, apierror.Internal(err))
			return
		}
		writeJSON(w, apiDataResponse{Success: true, Data: data})
	}
}

func handleSaveEmotionCatalog(svc *charsvc.ImageService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req charsvc.EmotionCatalogData
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			apierror.Write(w, apierror.BadRequestKey(errKeyInvalidImageUploadForm))
			return
		}
		result, err := svc.SaveEmotionCatalog(req)
		if err != nil {
			writeImageServiceError(w, err)
			return
		}
		writeJSON(w, apiDataResponse{Success: true, Data: result})
	}
}

func handlePruneEmotionImages(svc *charsvc.ImageService) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		result, err := svc.PruneOrphanImages()
		if err != nil {
			writeImageServiceError(w, err)
			return
		}
		writeJSON(w, apiDataResponse{Success: true, Data: result})
	}
}

func handleCharacterImages(svc *charsvc.ImageService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		data, err := svc.Images(r.PathValue(pathParamCharacterName))
		if err != nil {
			// ErrInvalidName（400相当）等の利用者起因エラーを一律 500 にしない。
			writeImageServiceError(w, err)
			return
		}
		writeJSON(w, apiDataResponse{Success: true, Data: data})
	}
}

func handleUploadImage(svc *charsvc.ImageService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, charsvc.MaxCharacterImageUploadBytes()+multipartReaderOverheadBytes)
		if err := r.ParseMultipartForm(charsvc.MaxCharacterImageUploadBytes()); err != nil {
			apierror.Write(w, apierror.BadRequestKey(errKeyInvalidImageUploadForm))
			return
		}
		emotion := r.FormValue(formFieldEmotion)
		file, header, err := r.FormFile(formFieldImage)
		if err != nil {
			apierror.Write(w, apierror.BadRequestKey(errKeyImageFileRequired))
			return
		}
		defer file.Close()
		contentType := header.Header.Get(config.HTTPHeaderContentType)
		result, err := svc.Upload(r.PathValue(pathParamCharacterName), emotion, contentType, file)
		if err != nil {
			writeImageServiceError(w, err)
			return
		}
		writeJSON(w, apiDataResponse{Success: true, Data: result})
	}
}

type cropImageRequest struct {
	Emotion  string           `json:"emotion"`
	CropData charsvc.CropData `json:"cropData"`
}

func handleCropImage(svc *charsvc.ImageService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req cropImageRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			apierror.Write(w, apierror.BadRequestKey(errKeyInvalidImageUploadForm))
			return
		}
		result, err := svc.Crop(r.PathValue(pathParamCharacterName), req.Emotion, req.CropData)
		if err != nil {
			writeImageServiceError(w, err)
			return
		}
		writeJSON(w, apiDataResponse{Success: true, Data: result})
	}
}

func handleDeleteImage(svc *charsvc.ImageService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		result, err := svc.Delete(r.PathValue(pathParamCharacterName), r.PathValue(pathParamEmotion))
		if err != nil {
			// handleCharacterImages と同じく利用者起因エラーを振り分ける。
			writeImageServiceError(w, err)
			return
		}
		writeJSON(w, apiDataResponse{Success: true, Data: result})
	}
}

func handleStaticImage(svc *charsvc.ImageService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		image, err := svc.StaticImage(r.PathValue(pathParamCharacterName), r.PathValue(pathParamImagePath))
		if err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				http.NotFound(w, r)
				return
			}
			writeImageServiceError(w, err)
			return
		}
		if image.ContentType != "" {
			w.Header().Set(config.HTTPHeaderContentType, image.ContentType)
		}
		http.ServeFile(w, r, image.Path)
	}
}

// writeImageServiceError はキャラ画像 service の利用者起因エラーを i18n キーへ変換する。
// 想定外エラーは内部エラーとして隠し、domain の err.Error() をそのまま外へ出さない。
func writeImageServiceError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, charsvc.ErrImageEmotionRequired):
		apierror.Write(w, apierror.BadRequestKey(errKeyImageEmotionRequired))
	case errors.Is(err, charsvc.ErrImageFileRequired):
		apierror.Write(w, apierror.BadRequestKey(errKeyImageFileRequired))
	case errors.Is(err, charsvc.ErrImageTooLarge):
		apierror.Write(w, apierror.BadRequestKey(errKeyImageTooLarge))
	case errors.Is(err, charsvc.ErrUnsupportedImageType):
		apierror.Write(w, apierror.BadRequestKey(errKeyUnsupportedImageType))
	case errors.Is(err, charsvc.ErrInvalidImagePath):
		apierror.Write(w, apierror.BadRequestKey(errKeyInvalidImagePath))
	case errors.Is(err, charsvc.ErrInvalidName):
		apierror.Write(w, apierror.BadRequestKey(errKeyInvalidName))
	case errors.Is(err, charsvc.ErrCropDataRequired):
		apierror.Write(w, apierror.BadRequestKey(errKeyImageCropDataRequired))
	case errors.Is(err, charsvc.ErrSourceImageNotFound):
		apierror.Write(w, apierror.NotFoundKey(errKeySourceImageNotFound))
	case errors.Is(err, charsvc.ErrUnsupportedCropImageType):
		apierror.Write(w, apierror.NewKey(http.StatusUnsupportedMediaType, errKeyUnsupportedCropImageType))
	case errors.Is(err, charsvc.ErrInvalidCropData):
		apierror.Write(w, apierror.BadRequestKey(errKeyInvalidCropData))
	case errors.Is(err, charsvc.ErrEmotionNameInvalid):
		apierror.Write(w, apierror.BadRequestKey(errKeyEmotionNameInvalid))
	case errors.Is(err, charsvc.ErrEmotionNameDuplicate):
		apierror.Write(w, apierror.BadRequestKey(errKeyEmotionNameDuplicate))
	case errors.Is(err, charsvc.ErrEmotionDefaultRequired):
		apierror.Write(w, apierror.BadRequestKey(errKeyEmotionDefaultRequired))
	case errors.Is(err, charsvc.ErrEmotionCatalogMissing):
		apierror.Write(w, apierror.BadRequestKey(errKeyEmotionCatalogMissing))
	default:
		apierror.Write(w, apierror.Internal(err))
	}
}

func writeJSON(w http.ResponseWriter, v any) {
	if err := apiresponse.WriteJSON(w, http.StatusOK, v); err != nil {
		apierror.Write(w, apierror.Internal(err))
	}
}
