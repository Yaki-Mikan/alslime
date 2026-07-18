// Package i18n は UI 多言語辞書 API を提供する。
package i18n

import (
	"errors"
	"net/http"

	"alslime/internal/api/apierror"
	"alslime/internal/api/apiresponse"
	"alslime/internal/config"
	i18nsvc "alslime/internal/i18n"
)

// Register は i18n 系ルートを mux へ登録する。
func Register(mux *http.ServeMux, svc *i18nsvc.Service) {
	mux.HandleFunc(http.MethodGet+" "+config.APIPrefix+routeLanguages, handleLanguages(svc))
	mux.HandleFunc(http.MethodGet+" "+config.APIPrefix+routeCatalog, handleCatalog(svc))
}

func handleLanguages(svc *i18nsvc.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		languages, err := svc.Languages()
		if err != nil {
			apierror.Write(w, apierror.Internal(err))
			return
		}
		writeJSON(w, languagesResponse{
			DefaultLang:  config.I18NDefaultLang,
			FallbackLang: config.I18NFallbackLang,
			Languages:    languages,
		})
	}
}

func handleCatalog(svc *i18nsvc.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		catalog, err := svc.Load(r.PathValue(pathParamLang))
		if err != nil {
			if errors.Is(err, i18nsvc.ErrInvalidLang) {
				apierror.Write(w, apierror.BadRequestKey(errKeyInvalidLang))
				return
			}
			apierror.Write(w, apierror.Internal(err))
			return
		}
		writeJSON(w, catalog)
	}
}

func writeJSON(w http.ResponseWriter, v any) {
	if err := apiresponse.WriteJSON(w, http.StatusOK, v); err != nil {
		apierror.Write(w, apierror.Internal(err))
	}
}
