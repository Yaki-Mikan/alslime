package settingspack

// 公式サンプルパックのダウンロード取り込み（同梱用サンプルファイル達作成 01番 検討事項1）。
//
// POST /api/settings-pack/download-samples
//   body: {"lang": "ja", "policy": "skip"}（policy 省略時 skip）
//
// 本体埋め込みの固定 URL（config.SamplePackURLs。GitHub Releases）から zip を取得し、
// 既存のパックインポートパイプライン（Manager.Import）へ流す。zip 検証・A〜F 分類・
// E/F 自動除外・D 分類の tier 判定は通常インポートと完全に同じ経路を通る。
// URL は開発者管理の固定値のみで、リクエストから任意 URL は受け付けない。

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"alslime/internal/api/apierror"
	"alslime/internal/config"
	syspack "alslime/internal/system/settingspack"
)

// downloadSamplesRequest は POST /api/settings-pack/download-samples のリクエスト。
type downloadSamplesRequest struct {
	Lang   string `json:"lang"`
	Policy string `json:"policy"`
}

// handleDownloadSamples は公式サンプルパックを取得して取り込む。
func handleDownloadSamples(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req downloadSamplesRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			apierror.Write(w, apierror.BadRequestKey("settingsPack.error.invalidRequest"))
			return
		}
		url, ok := config.SamplePackURLs[req.Lang]
		if !ok {
			apierror.Write(w, apierror.BadRequestKey("settingsPack.samples.errorUnsupportedLang"))
			return
		}
		policy := syspack.ImportPolicy(req.Policy)
		if policy == "" {
			policy = syspack.PolicySkip
		}
		if !syspack.ValidPolicy(policy) {
			apierror.Write(w, apierror.BadRequestKey("settingsPack.error.invalidPolicy"))
			return
		}

		zipPath, cleanup, apiErr := fetchSamplePack(url)
		if apiErr != nil {
			apierror.Write(w, apiErr)
			return
		}
		defer cleanup()

		result, err := deps.Manager.Import(zipPath, syspack.ImportOptions{
			Policy:          policy,
			ImageGenAllowed: imageGenAllowed(deps.Gate),
		})
		if err != nil {
			apierror.Write(w, packError(err))
			return
		}
		writeJSON(w, result)
	}
}

// fetchSamplePack は url の zip を一時ファイルへダウンロードする。
// 呼び出し側は cleanup を必ず defer すること。
// サイズ上限は通常アップロードと同じ SettingsPackMaxUploadBytes を適用する。
func fetchSamplePack(url string) (zipPath string, cleanup func(), apiErr *apierror.Error) {
	client := &http.Client{Timeout: config.SamplePackDownloadTimeoutSeconds * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return "", nil, apierror.WrapKey(http.StatusBadGateway, "settingsPack.samples.errorDownloadFailed", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return "", nil, apierror.WrapKey(http.StatusBadGateway, "settingsPack.samples.errorDownloadFailed",
			fmt.Errorf("sample pack download: unexpected status %d for %s", resp.StatusCode, url))
	}

	tmp, err := os.CreateTemp("", "alslime-sample-pack-*.zip")
	if err != nil {
		return "", nil, apierror.Internal(err)
	}
	name := tmp.Name()
	remove := func() { _ = os.Remove(name) }
	// 上限+1 バイトまで読み、上限超過を検出する。
	written, err := io.Copy(tmp, io.LimitReader(resp.Body, config.SettingsPackMaxUploadBytes+1))
	if err != nil {
		_ = tmp.Close()
		remove()
		return "", nil, apierror.WrapKey(http.StatusBadGateway, "settingsPack.samples.errorDownloadFailed", err)
	}
	if err := tmp.Close(); err != nil {
		remove()
		return "", nil, apierror.Internal(err)
	}
	if written > config.SettingsPackMaxUploadBytes {
		remove()
		return "", nil, apierror.BadRequestKey("settingsPack.error.uploadTooLarge")
	}
	return name, remove, nil
}
