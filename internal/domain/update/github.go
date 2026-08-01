package update

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// githubRelease は GitHub Releases API（releases/latest）の必要フィールドのみ。
type githubRelease struct {
	TagName string        `json:"tag_name"`
	Body    string        `json:"body"`
	HTMLURL string        `json:"html_url"`
	Assets  []githubAsset `json:"assets"`
}

// githubAsset はリリースアセット（zip / SHA256SUMS.txt）の必要フィールドのみ。
type githubAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
	Size               int64  `json:"size"`
}

// fetchLatestRelease は最新リリースを照会する（認証不要・ETag なし。
// 起動時1回＋手動のみでレート制限に届かないため条件付きリクエストは持たない）。
func (s *Service) fetchLatestRelease(ctx context.Context) (githubRelease, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.releaseURL, nil)
	if err != nil {
		return githubRelease{}, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := s.client.Do(req)
	if err != nil {
		return githubRelease{}, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return githubRelease{}, fmt.Errorf("update: release check status %d", resp.StatusCode)
	}
	var release githubRelease
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&release); err != nil {
		return githubRelease{}, err
	}
	if release.TagName == "" {
		return githubRelease{}, fmt.Errorf("update: release response has no tag")
	}
	return release, nil
}
