package sponsor

// 配信用ドメインの配布ファイル一覧（一覧ファイル）の取得・署名検証・バージョン選択。
//
// 一覧ファイルは誰でも読める署名付き JSON で、モジュールとパックの各バージョンについて
// 対応する本体のバージョン範囲・ファイル名・SHA-256・サイズを持つ。形:
//
//	{"v":1,"kid":"<鍵の識別名>","payload":"<base64url(中身の JSON)>","sig":"<base64url(署名)>"}
//
// 署名の対象は payload を解いたバイト列そのもの（JSON の項目順に依存しない）。
// 検証実体は core（featuresimpl）に閉じ、本パッケージは注入された関数だけを呼ぶ。

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"

	"alslime/internal/logging"
	"alslime/internal/semver"
)

// ErrManifestUnavailable は一覧ファイルを取得できない（通信不調・配信側の障害）。
// 別の配布元へは切り替えず、時間をおいた再試行を案内する。
var ErrManifestUnavailable = errors.New("sponsor: download manifest unavailable")

// ErrManifestInvalid は一覧ファイルの形または署名が不正（改ざんの疑い）。
var ErrManifestInvalid = errors.New("sponsor: download manifest invalid")

const (
	dlManifestPath     = "sidecar/manifest.json"
	dlManifestMaxBytes = 4 << 20
	dlEnvelopeVersion  = 1
)

// 一覧ファイルの版・ファイル名は取得 URL の一部になるため、形を絞る
// （配信側・認証サーバーが受け付ける形と一致させること）。名前は呼び出し側が検証済みの ID を使う。
var (
	dlVersionPattern  = regexp.MustCompile(`^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$`)
	dlFileNamePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`)
	dlSHA256Pattern   = regexp.MustCompile(`^[0-9a-fA-F]{64}$`)
)

type dlEnvelope struct {
	V       int    `json:"v"`
	Kid     string `json:"kid"`
	Payload string `json:"payload"`
	Sig     string `json:"sig"`
}

// dlManifest は一覧ファイルの中身。
type dlManifest struct {
	GeneratedAt string                       `json:"generatedAt"`
	Modules     map[string][]dlModuleEntry   `json:"modules"`
	Packs       map[string][]dlVersionedFile `json:"packs"`
}

// dlModuleEntry はモジュールの 1 バージョン分。
type dlModuleEntry struct {
	Version       string           `json:"version"`
	MinAppVersion string           `json:"minAppVersion"`
	MaxAppVersion string           `json:"maxAppVersion"`
	Files         []dlModuleFile   `json:"files"`
	CompanionPack *dlVersionedFile `json:"companionPack,omitempty"`
}

// dlModuleFile は OS・CPU 種別ごとの実行ファイル。
type dlModuleFile struct {
	OS     string `json:"os"`
	Arch   string `json:"arch"`
	Name   string `json:"name"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}

// dlVersionedFile は版つきの単一ファイル（付属パック・支援者向けパック）。
type dlVersionedFile struct {
	Version string `json:"version"`
	Name    string `json:"name"`
	SHA256  string `json:"sha256"`
	Size    int64  `json:"size"`
}

// fetchDownloadManifest は一覧ファイルを取得して署名を検証する。
// 取得できない場合は ErrManifestUnavailable、形・署名の不正は ErrManifestInvalid。
func (s *Service) fetchDownloadManifest(ctx context.Context) (dlManifest, error) {
	if s.verifyManifestSig == nil {
		return dlManifest{}, errors.New("sponsor: download manifest verification is not configured")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.dlBaseURL+"/"+dlManifestPath, nil)
	if err != nil {
		return dlManifest{}, err
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return dlManifest{}, fmt.Errorf("%w: %v", ErrManifestUnavailable, err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return dlManifest{}, fmt.Errorf("%w: status %d", ErrManifestUnavailable, resp.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, dlManifestMaxBytes+1))
	if err != nil {
		return dlManifest{}, fmt.Errorf("%w: %v", ErrManifestUnavailable, err)
	}
	if len(raw) > dlManifestMaxBytes {
		return dlManifest{}, fmt.Errorf("%w: too large", ErrManifestInvalid)
	}
	manifest, err := s.openDownloadManifest(raw)
	if err != nil {
		return dlManifest{}, err
	}
	s.noteManifestGeneratedAt(manifest.GeneratedAt)
	return manifest, nil
}

// openDownloadManifest は一覧ファイルの署名を検証して中身を返す。
func (s *Service) openDownloadManifest(raw []byte) (dlManifest, error) {
	var envelope dlEnvelope
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return dlManifest{}, fmt.Errorf("%w: envelope: %v", ErrManifestInvalid, err)
	}
	if envelope.V != dlEnvelopeVersion || envelope.Kid == "" || envelope.Payload == "" || envelope.Sig == "" {
		return dlManifest{}, fmt.Errorf("%w: incomplete envelope", ErrManifestInvalid)
	}
	payload, err := base64.RawURLEncoding.DecodeString(envelope.Payload)
	if err != nil {
		return dlManifest{}, fmt.Errorf("%w: payload encoding", ErrManifestInvalid)
	}
	if err := s.verifyManifestSig(envelope.Kid, payload, envelope.Sig); err != nil {
		return dlManifest{}, fmt.Errorf("%w: %v", ErrManifestInvalid, err)
	}
	var manifest dlManifest
	if err := json.Unmarshal(payload, &manifest); err != nil {
		return dlManifest{}, fmt.Errorf("%w: payload: %v", ErrManifestInvalid, err)
	}
	return manifest, nil
}

// noteManifestGeneratedAt は前回より古い一覧ファイルを受け取ったことをログへ残す。
// 配信側のキャッシュは拠点ごとに切り替わるため、古い一覧が返ること自体は起こり得る。
// 署名は通っているので拒否はせず、巻き戻しの調査材料として記録に留める。
func (s *Service) noteManifestGeneratedAt(generatedAt string) {
	s.dlMu.Lock()
	defer s.dlMu.Unlock()
	if generatedAt != "" && s.lastManifestAt != "" && generatedAt < s.lastManifestAt {
		logging.Warn("sponsor: download manifest is older than the previous one (%s < %s)", generatedAt, s.lastManifestAt)
		return
	}
	s.lastManifestAt = generatedAt
}

// moduleSelection は一覧からのモジュールのバージョン選択結果。
type moduleSelection struct {
	// Entry / File は選ばれたバージョンと、実行環境向けの実行ファイル（該当なしは nil）。
	Entry *dlModuleEntry
	File  *dlModuleFile
	// NeedsNewerApp は「もっと新しい本体向けのバージョンならある」（Entry が nil のときだけ true）。
	// 対応範囲の外にあるバージョンそのものは返さない（導入・更新の対象にしてはならないため）。
	NeedsNewerApp bool
	// Incompatible は対応するバージョンが無い（本体が新しすぎる・OS/CPU 種別の配布が無い）。
	Incompatible bool
}

// selectModule は実行環境（goos/goarch）向けの実行ファイルがあり、appVersion が対応範囲に
// 入るもののうち、最も新しいバージョンを選ぶ。enforceRange が false なら範囲は見ない
// （dev ビルドのバージョンは常に範囲外になり、ローカル検証を阻害するため）。
// 名前や版の形が不正な項目、比較できない版は選ばない。対応範囲の下限・上限が比較できない
// 項目も選ばない（比較できない値を「制限なし」と同じに扱うと、非対応の本体へ配ってしまう）。
func selectModule(entries []dlModuleEntry, goos, goarch, appVersion string, enforceRange bool) moduleSelection {
	var out moduleSelection
	for i := range entries {
		entry := &entries[i]
		file := moduleFileFor(entry, goos, goarch)
		if file == nil || !validDownloadVersion(entry.Version) || !comparableVersion(entry.Version) || !validAppRange(entry) {
			continue
		}
		if enforceRange {
			if entry.MinAppVersion != "" && semver.IsNewer(entry.MinAppVersion, appVersion) {
				out.NeedsNewerApp = true
				continue
			}
			if entry.MaxAppVersion != "" && semver.IsNewer(appVersion, entry.MaxAppVersion) {
				continue
			}
		}
		if out.Entry == nil || semver.IsNewer(entry.Version, out.Entry.Version) {
			out.Entry, out.File = entry, file
		}
	}
	if out.Entry != nil {
		out.NeedsNewerApp = false
		return out
	}
	out.Incompatible = !out.NeedsNewerApp
	return out
}

// moduleOutOfRange は導入済みバージョンが一覧にあり、かつ本体が対応範囲から外れているかを返す
// （本体の更新で導入済みモジュールが非対応になった状態の検出用）。
func moduleOutOfRange(entries []dlModuleEntry, installedVersion, appVersion string, enforceRange bool) bool {
	if !enforceRange {
		return false
	}
	for i := range entries {
		entry := &entries[i]
		if entry.Version != installedVersion {
			continue
		}
		if !validAppRange(entry) {
			return true // 対応範囲を判定できない項目は、使えない側へ倒す
		}
		if entry.MinAppVersion != "" && semver.IsNewer(entry.MinAppVersion, appVersion) {
			return true
		}
		return entry.MaxAppVersion != "" && semver.IsNewer(appVersion, entry.MaxAppVersion)
	}
	return false
}

// validAppRange は対応範囲の下限・上限が、空（制限なし）または比較できる形で、
// 下限が上限を超えていないことを確かめる。
func validAppRange(entry *dlModuleEntry) bool {
	if entry.MinAppVersion != "" && !comparableVersion(entry.MinAppVersion) {
		return false
	}
	if entry.MaxAppVersion != "" && !comparableVersion(entry.MaxAppVersion) {
		return false
	}
	return entry.MinAppVersion == "" || entry.MaxAppVersion == "" ||
		!semver.IsNewer(entry.MinAppVersion, entry.MaxAppVersion)
}

// selectPack は最も新しいバージョンのパックを選ぶ（パックは対応範囲を持たない）。
func selectPack(entries []dlVersionedFile) *dlVersionedFile {
	var best *dlVersionedFile
	for i := range entries {
		entry := &entries[i]
		if !validVersionedFile(entry) || !comparableVersion(entry.Version) {
			continue
		}
		if best == nil || semver.IsNewer(entry.Version, best.Version) {
			best = entry
		}
	}
	return best
}

func moduleFileFor(entry *dlModuleEntry, goos, goarch string) *dlModuleFile {
	for i := range entry.Files {
		file := &entry.Files[i]
		if file.OS == goos && file.Arch == goarch {
			if !dlFileNamePattern.MatchString(file.Name) || !dlSHA256Pattern.MatchString(file.SHA256) || file.Size <= 0 {
				return nil
			}
			return file
		}
	}
	return nil
}

func validVersionedFile(file *dlVersionedFile) bool {
	return file != nil && validDownloadVersion(file.Version) && dlFileNamePattern.MatchString(file.Name) &&
		dlSHA256Pattern.MatchString(file.SHA256) && file.Size > 0
}

func validDownloadVersion(version string) bool {
	return dlVersionPattern.MatchString(version) && !strings.Contains(version, "..")
}

func comparableVersion(version string) bool {
	_, ok := semver.Compare(version, version)
	return ok
}
