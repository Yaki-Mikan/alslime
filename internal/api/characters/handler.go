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
	"encoding/json"
	"errors"
	"io/fs"
	"net/http"

	"alslime/internal/api/apierror"
	"alslime/internal/api/apiresponse"
	"alslime/internal/config"
	charsvc "alslime/internal/domain/characters"
	storage "alslime/internal/storage/charfilters"
)

// Register はキャラ系ルートを mux へ登録する。
func Register(mux *http.ServeMux, svc *charsvc.Service) {
	mux.HandleFunc(http.MethodGet+" "+config.APIPrefix+routeCharacterTags, handleTags(svc))
	mux.HandleFunc(http.MethodGet+" "+config.APIPrefix+routeCharacterFilters, handleFilters(svc))
	mux.HandleFunc(http.MethodPost+" "+config.APIPrefix+routeCharacterFiltersRebuild, handleRebuild(svc))
}

// RegisterImages はキャラクター画像系ルートを mux へ登録する。
func RegisterImages(mux *http.ServeMux, svc *charsvc.ImageService) {
	mux.HandleFunc(http.MethodGet+" "+config.APIPrefix+routeCharacterEmotions, handleEmotions(svc))
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
	default:
		apierror.Write(w, apierror.Internal(err))
	}
}

func writeJSON(w http.ResponseWriter, v any) {
	if err := apiresponse.WriteJSON(w, http.StatusOK, v); err != nil {
		apierror.Write(w, apierror.Internal(err))
	}
}
