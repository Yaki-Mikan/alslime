package sponsor

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
)

const testManifestKid = "manifest-test"

// downloadFixture は配信用ドメインと entitlement サーバーの許可発行を 1 台で模す。
type downloadFixture struct {
	t        *testing.T
	priv     ed25519.PrivateKey
	pub      ed25519.PublicKey
	server   *httptest.Server
	mu       sync.Mutex
	manifest dlManifest
	objects  map[string][]byte
	// manifestStatus が 0 以外なら、一覧ファイルの要求へその状態コードを返す。
	manifestStatus int
	// tamperManifest は署名後の中身を差し替える（署名不一致の再現）。
	tamperManifest bool
	grantRequests  []map[string]string
	downloads      []string
}

func newDownloadFixture(t *testing.T) *downloadFixture {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatalf("keygen: %v", err)
	}
	f := &downloadFixture{
		t: t, priv: priv, pub: pub, objects: map[string][]byte{},
		manifest: dlManifest{Modules: map[string][]dlModuleEntry{}, Packs: map[string][]dlVersionedFile{}},
	}
	f.server = httptest.NewServer(http.HandlerFunc(f.handle))
	t.Cleanup(f.server.Close)
	return f
}

func (f *downloadFixture) handle(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	switch {
	case r.URL.Path == "/"+dlManifestPath:
		if f.manifestStatus != 0 {
			w.WriteHeader(f.manifestStatus)
			return
		}
		_, _ = w.Write(f.sealedManifest())
	case r.URL.Path == "/downloads/grant" && r.Method == http.MethodPost:
		if r.Header.Get("Authorization") != "Bearer good-token" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		var req map[string]string
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		f.grantRequests = append(f.grantRequests, req)
		_ = json.NewEncoder(w).Encode(map[string]string{"grant": "grant-for-" + req["name"]})
	default:
		key := strings.TrimPrefix(r.URL.Path, "/")
		body, ok := f.objects[key]
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer grant-for-") {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		f.downloads = append(f.downloads, key)
		_, _ = w.Write(body)
	}
}

func (f *downloadFixture) sealedManifest() []byte {
	payload, err := json.Marshal(f.manifest)
	if err != nil {
		f.t.Fatalf("manifest marshal: %v", err)
	}
	sig := ed25519.Sign(f.priv, payload)
	if f.tamperManifest {
		payload = append(payload, ' ')
	}
	raw, err := json.Marshal(dlEnvelope{
		V: dlEnvelopeVersion, Kid: testManifestKid,
		Payload: base64.RawURLEncoding.EncodeToString(payload),
		Sig:     base64.RawURLEncoding.EncodeToString(sig),
	})
	if err != nil {
		f.t.Fatalf("envelope marshal: %v", err)
	}
	return raw
}

func (f *downloadFixture) verify(kid string, payload []byte, sigB64 string) error {
	sig, err := base64.RawURLEncoding.DecodeString(sigB64)
	if err != nil || kid != testManifestKid || !ed25519.Verify(f.pub, payload, sig) {
		return errors.New("signature verification failed")
	}
	return nil
}

// put は配布物を置き、そのハッシュ値とサイズを返す。
func (f *downloadFixture) put(key string, body []byte) (string, int64) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.objects[key] = body
	sum := sha256.Sum256(body)
	return hex.EncodeToString(sum[:]), int64(len(body))
}

// addModule は実行環境向けの実行ファイル（と任意の付属パック）を持つバージョンを一覧へ足す。
func (f *downloadFixture) addModule(id, version string, binary, pack []byte) {
	name := "alslime-" + id + "-" + runtime.GOOS + "-" + runtime.GOARCH
	sum, size := f.put("sidecar/"+id+"/"+version+"/"+name, binary)
	entry := dlModuleEntry{
		Version: version,
		Files:   []dlModuleFile{{OS: runtime.GOOS, Arch: runtime.GOARCH, Name: name, SHA256: sum, Size: size}},
	}
	if pack != nil {
		packSum, packSize := f.put("sidecar/"+id+"/"+version+"/companion.zip", pack)
		entry.CompanionPack = &dlVersionedFile{Version: "2026.07.1", Name: "companion.zip", SHA256: packSum, Size: packSize}
	}
	f.mu.Lock()
	f.manifest.Modules[id] = append(f.manifest.Modules[id], entry)
	f.mu.Unlock()
}

// service は fixture を取得元にした Service を返す（トークンは保存済み）。
func (f *downloadFixture) service(targets map[string]ModuleTarget) *Service {
	svc, store := newTestService(f.t, f.server.URL)
	svc.dlBaseURL = f.server.URL
	if err := store.Save("good-token"); err != nil {
		f.t.Fatal(err)
	}
	ids := make([]string, 0, len(targets))
	for id := range targets {
		ids = append(ids, id)
	}
	svc.ConfigureModules(ids, targets, f.verify)
	return svc
}

func TestInstallModule_一覧から選んで許可つきで取得し付属パックを適用(t *testing.T) {
	f := newDownloadFixture(t)
	f.addModule("comfy", "1.2.2", []byte("old binary"), nil)
	f.addModule("comfy", "1.2.3", []byte("module binary"), []byte("companion pack"))

	dir := t.TempDir()
	installPath := filepath.Join(dir, "alslime-comfy.exe")
	receiptPath := filepath.Join(dir, "alslime-comfy.receipt.json")
	var installedPack []byte
	installedTemplates := []string{"AlSlime Generic Workflow"}
	svc := f.service(map[string]ModuleTarget{
		"comfy": {
			InstallPath: installPath,
			ReceiptPath: receiptPath,
			InstallCompanionPack: func(zipPath string) ([]string, error) {
				var readErr error
				installedPack, readErr = os.ReadFile(zipPath)
				return installedTemplates, readErr
			},
		},
	})

	result, err := svc.InstallModule(context.Background(), "comfy")
	if err != nil {
		t.Fatalf("InstallModule: %v", err)
	}
	if result.Version != "1.2.3" || !result.FirstInstall || !result.CompanionPackConfigured || !result.CompanionPackInstalled {
		t.Fatalf("result: %+v", result)
	}
	if len(result.CompanionPackWorkflowTemplates) != 1 ||
		result.CompanionPackWorkflowTemplates[0] != installedTemplates[0] {
		t.Fatalf("workflow templates: %#v", result.CompanionPackWorkflowTemplates)
	}
	gotBinary, err := os.ReadFile(installPath)
	if err != nil || string(gotBinary) != "module binary" {
		t.Fatalf("binary: %q err=%v", gotBinary, err)
	}
	if string(installedPack) != "companion pack" {
		t.Fatalf("pack: %q", installedPack)
	}
	// 許可は 1 回だけ取得し、実行ファイルと付属パックで共用する。
	if len(f.grantRequests) != 1 || f.grantRequests[0]["kind"] != "module" ||
		f.grantRequests[0]["name"] != "comfy" || f.grantRequests[0]["version"] != "1.2.3" {
		t.Fatalf("grant requests: %#v", f.grantRequests)
	}
	if len(f.downloads) != 2 || !strings.HasPrefix(f.downloads[0], "sidecar/comfy/1.2.3/") {
		t.Fatalf("downloads: %#v", f.downloads)
	}
	receipt, ok := svc.readReceipt(receiptPath)
	if !ok || receipt.Version != "1.2.3" || receipt.CompanionPack == nil || receipt.CompanionPack.Version != "2026.07.1" {
		t.Fatalf("receipt: %+v ok=%v", receipt, ok)
	}

	failedInstallPath := filepath.Join(t.TempDir(), "alslime-comfy.exe")
	svc.ConfigureModules([]string{"comfy"}, map[string]ModuleTarget{
		"comfy": {
			InstallPath: failedInstallPath,
			InstallCompanionPack: func(string) ([]string, error) {
				return []string{"返却してはならない名前"}, errors.New("pack install failed")
			},
		},
	}, f.verify)
	failedResult, err := svc.InstallModule(context.Background(), "comfy")
	if err != nil {
		t.Fatalf("付随パック失敗時の InstallModule: %v", err)
	}
	if !failedResult.CompanionPackConfigured || failedResult.CompanionPackInstalled {
		t.Fatalf("付随パック失敗時の result: %+v", failedResult)
	}
	if failedResult.CompanionPackWorkflowTemplates == nil ||
		len(failedResult.CompanionPackWorkflowTemplates) != 0 {
		t.Fatalf("付随パック失敗時の workflow templates: %#v",
			failedResult.CompanionPackWorkflowTemplates)
	}
}

func TestInstallModule_一覧ファイルが取れない時と署名不正の時は許可を求めない(t *testing.T) {
	f := newDownloadFixture(t)
	f.addModule("comfy", "1.0.0", []byte("module binary"), nil)
	installPath := filepath.Join(t.TempDir(), "alslime-comfy.exe")
	svc := f.service(map[string]ModuleTarget{"comfy": {InstallPath: installPath}})

	f.manifestStatus = http.StatusServiceUnavailable
	if _, err := svc.InstallModule(context.Background(), "comfy"); !errors.Is(err, ErrManifestUnavailable) {
		t.Fatalf("取得できない時: %v", err)
	}
	f.manifestStatus = 0
	f.tamperManifest = true
	if _, err := svc.InstallModule(context.Background(), "comfy"); !errors.Is(err, ErrManifestInvalid) {
		t.Fatalf("署名不正の時: %v", err)
	}
	if len(f.grantRequests) != 0 || len(f.downloads) != 0 {
		t.Fatalf("許可・取得は行わないはず: %#v %#v", f.grantRequests, f.downloads)
	}
	if _, err := os.Stat(installPath); !os.IsNotExist(err) {
		t.Fatalf("配置されないはず: %v", err)
	}
}

func TestInstallModule_ハッシュ不一致とサイズ超過は配置しない(t *testing.T) {
	for _, tc := range []struct {
		name   string
		served []byte
	}{
		{"中身の差し替え", []byte("evil!! binary")},
		{"サイズ超過", []byte("module binary with extra bytes")},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newDownloadFixture(t)
			f.addModule("comfy", "1.0.0", []byte("module binary"), nil)
			for key := range f.objects {
				f.objects[key] = tc.served
			}
			installPath := filepath.Join(t.TempDir(), "alslime-comfy.exe")
			if err := os.WriteFile(installPath, []byte("current binary"), 0o755); err != nil {
				t.Fatal(err)
			}
			svc := f.service(map[string]ModuleTarget{"comfy": {InstallPath: installPath}})
			if _, err := svc.InstallModule(context.Background(), "comfy"); err == nil {
				t.Fatal("照合に失敗するはず")
			}
			got, err := os.ReadFile(installPath)
			if err != nil || string(got) != "current binary" {
				t.Fatalf("導入済みの実体は残るはず: %q err=%v", got, err)
			}
			if _, err := os.Stat(installPath + ".download"); !os.IsNotExist(err) {
				t.Fatalf("一時ファイルは残さないはず: %v", err)
			}
		})
	}
}

func TestInstallModule_一覧に無いモジュールと未ログイン(t *testing.T) {
	f := newDownloadFixture(t)
	svc := f.service(map[string]ModuleTarget{"comfy": {InstallPath: filepath.Join(t.TempDir(), "x.exe")}})
	if _, err := svc.InstallModule(context.Background(), "comfy"); !errors.Is(err, ErrModuleUnavailable) {
		t.Fatalf("一覧に無い: %v", err)
	}
	if _, err := svc.InstallModule(context.Background(), "unknown"); !errors.Is(err, ErrModuleUnknown) {
		t.Fatalf("レジストリに無い: %v", err)
	}
	if err := svc.store.Clear(); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.InstallModule(context.Background(), "comfy"); !errors.Is(err, ErrModuleNoToken) {
		t.Fatalf("未ログイン: %v", err)
	}
}

func TestCleanModule_一覧ファイルが取れない時は削除を始めない(t *testing.T) {
	f := newDownloadFixture(t)
	f.addModule("comfy", "1.0.0", []byte("module binary"), nil)
	installPath := filepath.Join(t.TempDir(), "alslime-comfy.exe")
	if err := os.WriteFile(installPath, []byte("current binary"), 0o755); err != nil {
		t.Fatal(err)
	}
	svc := f.service(map[string]ModuleTarget{"comfy": {InstallPath: installPath}})

	f.manifestStatus = http.StatusBadGateway
	if _, err := svc.CleanModule(context.Background(), "comfy", true); !errors.Is(err, ErrManifestUnavailable) {
		t.Fatalf("CleanModule: %v", err)
	}
	if got, err := os.ReadFile(installPath); err != nil || string(got) != "current binary" {
		t.Fatalf("削除は始まらないはず: %q err=%v", got, err)
	}

	f.manifestStatus = 0
	result, err := svc.CleanModule(context.Background(), "comfy", true)
	if err != nil || result.Version != "1.0.0" {
		t.Fatalf("取得できる時は入れ直す: %+v err=%v", result, err)
	}
	if got, err := os.ReadFile(installPath); err != nil || string(got) != "module binary" {
		t.Fatalf("入れ直し後の実体: %q err=%v", got, err)
	}
}

func TestModulesUpdateInfo_レシートと一覧を比べる(t *testing.T) {
	f := newDownloadFixture(t)
	f.addModule("comfy", "1.2.3", []byte("module binary"), []byte("companion pack"))
	dir := t.TempDir()
	installPath := filepath.Join(dir, "alslime-comfy.exe")
	receiptPath := filepath.Join(dir, "alslime-comfy.receipt.json")
	if err := os.WriteFile(installPath, []byte("installed binary"), 0o755); err != nil {
		t.Fatal(err)
	}
	svc := f.service(map[string]ModuleTarget{
		"comfy": {InstallPath: installPath, ReceiptPath: receiptPath},
		"tts":   {InstallPath: filepath.Join(dir, "alslime-tts.exe")}, // 未配置は対象外
	})
	check := func() ModuleUpdateEntry {
		t.Helper()
		entries, err := svc.ModulesUpdateInfo(context.Background(), "0.5.0")
		if err != nil {
			t.Fatalf("ModulesUpdateInfo: %v", err)
		}
		if len(entries) != 1 || entries[0].ID != "comfy" {
			t.Fatalf("entries: %+v", entries)
		}
		return entries[0]
	}

	// レシート無し: 実体のハッシュ値が一覧と違えば更新あり。
	if got := check(); !got.HasUpdate || !got.CompanionPackUpdate || got.LatestVersion != "1.2.3" {
		t.Fatalf("レシート無し: %+v", got)
	}
	svc.writeReceipt(receiptPath, moduleReceipt{Module: "comfy", Version: "1.2.0"})
	if got := check(); !got.HasUpdate || got.InstalledVersion != "1.2.0" || got.LatestCompanionPackVersion != "2026.07.1" {
		t.Fatalf("古い版を導入済み: %+v", got)
	}
	svc.writeReceipt(receiptPath, moduleReceipt{
		Module: "comfy", Version: "1.2.3", CompanionPack: &moduleReceiptPack{Version: "2026.07.1"},
	})
	if got := check(); got.HasUpdate || got.CompanionPackUpdate {
		t.Fatalf("最新を導入済み: %+v", got)
	}
	// 導入済みのほうが新しい場合（一覧から版が下げられた等）は更新ありにしない。
	svc.writeReceipt(receiptPath, moduleReceipt{Module: "comfy", Version: "1.3.0"})
	if got := check(); got.HasUpdate {
		t.Fatalf("導入済みが新しい: %+v", got)
	}

	f.manifestStatus = http.StatusServiceUnavailable
	if _, err := svc.ModulesUpdateInfo(context.Background(), "0.5.0"); !errors.Is(err, ErrManifestUnavailable) {
		t.Fatalf("一覧が取れない時: %v", err)
	}
}

func TestFetchPack_一覧から最新を選んで取得(t *testing.T) {
	f := newDownloadFixture(t)
	oldSum, oldSize := f.put("packs/emotion-prompts-ja/2026.07.1/emotion-prompts-ja.zip", []byte("old pack"))
	newSum, newSize := f.put("packs/emotion-prompts-ja/2026.09.1/emotion-prompts-ja.zip", []byte("new pack"))
	f.manifest.Packs["emotion-prompts-ja"] = []dlVersionedFile{
		{Version: "2026.09.1", Name: "emotion-prompts-ja.zip", SHA256: newSum, Size: newSize},
		{Version: "2026.07.1", Name: "emotion-prompts-ja.zip", SHA256: oldSum, Size: oldSize},
	}
	svc := f.service(map[string]ModuleTarget{})

	var got []byte
	version, err := svc.FetchPack(context.Background(), "emotion-prompts-ja", func(zipPath string) error {
		var readErr error
		got, readErr = os.ReadFile(zipPath)
		return readErr
	})
	if err != nil || version != "2026.09.1" || string(got) != "new pack" {
		t.Fatalf("FetchPack: version=%q got=%q err=%v", version, got, err)
	}
	if len(f.grantRequests) != 1 || f.grantRequests[0]["kind"] != "pack" || f.grantRequests[0]["version"] != "2026.09.1" {
		t.Fatalf("grant requests: %#v", f.grantRequests)
	}
	if _, err := svc.FetchPack(context.Background(), "emotion-prompts-en", func(string) error { return nil }); !errors.Is(err, ErrModuleUnavailable) {
		t.Fatalf("一覧に無いパック: %v", err)
	}
	if _, err := svc.FetchPack(context.Background(), "../evil", func(string) error { return nil }); !errors.Is(err, ErrPackUnknown) {
		t.Fatalf("不正なパック ID: %v", err)
	}
}

func TestSelectModule_対応範囲と実行環境で選ぶ(t *testing.T) {
	file := func(os, arch string) dlModuleFile {
		return dlModuleFile{OS: os, Arch: arch, Name: "alslime-comfy", SHA256: strings.Repeat("a", 64), Size: 1}
	}
	entry := func(version, min, max string, files ...dlModuleFile) dlModuleEntry {
		return dlModuleEntry{Version: version, MinAppVersion: min, MaxAppVersion: max, Files: files}
	}
	win := file("windows", "amd64")
	entries := []dlModuleEntry{
		entry("1.0.0", "0.1.0", "0.4.9", win),
		entry("1.1.0", "0.5.0", "0.9.9", win),
		entry("1.1.5", "0.5.0", "0.9.9", win),
		entry("1.2.0", "1.0.0", "", win),
		entry("9.0.0", "", "", file("linux", "amd64")),
		entry("not-a-version", "", "", win),
	}
	cases := []struct {
		name          string
		app           string
		enforce       bool
		want          string
		needsNewerApp bool
		incompatible  bool
	}{
		{"範囲内の最新", "0.6.0", true, "1.1.5", false, false},
		{"下限ちょうど", "1.0.0", true, "1.2.0", false, false},
		{"上限ちょうど", "0.4.9", true, "1.0.0", false, false},
		{"本体が古すぎる", "0.0.5", true, "", true, false},
		{"dev ビルドは範囲を見ない", "0.0.0-dev", false, "1.2.0", false, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := selectModule(entries, "windows", "amd64", tc.app, tc.enforce)
			version := ""
			if got.Entry != nil {
				version = got.Entry.Version
			}
			if version != tc.want || got.NeedsNewerApp != tc.needsNewerApp || got.Incompatible != tc.incompatible {
				t.Fatalf("got version=%q needsNewer=%v incompatible=%v", version, got.NeedsNewerApp, got.Incompatible)
			}
		})
	}

	tooNew := selectModule([]dlModuleEntry{entry("1.0.0", "0.1.0", "0.4.9", win)}, "windows", "amd64", "2.0.0", true)
	if tooNew.Entry != nil || tooNew.NeedsNewerApp || !tooNew.Incompatible {
		t.Fatalf("本体が新しすぎる: %+v", tooNew)
	}
	noBinary := selectModule(entries, "linux", "arm64", "0.6.0", true)
	if noBinary.Entry != nil || !noBinary.Incompatible {
		t.Fatalf("実行環境向けの配布が無い: %+v", noBinary)
	}
	// 比較できない下限・上限や、下限が上限を超える範囲は「制限なし」と扱わず、選ばない。
	for _, broken := range []dlModuleEntry{
		entry("1.0.0", "not-semver", "", win),
		entry("1.0.0", "", "also-not-semver", win),
		entry("1.0.0", "0.9.0", "0.5.0", win),
	} {
		for _, enforce := range []bool{true, false} {
			if got := selectModule([]dlModuleEntry{broken}, "windows", "amd64", "0.6.0", enforce); got.Entry != nil {
				t.Fatalf("不正な対応範囲は選ばない: %+v enforce=%v", broken, enforce)
			}
		}
		if !moduleOutOfRange([]dlModuleEntry{broken}, "1.0.0", "0.6.0", true) {
			t.Fatalf("不正な対応範囲の導入済みは、使えない側へ倒す: %+v", broken)
		}
	}

	badName := file("windows", "amd64")
	badName.Name = "../evil.exe"
	if got := selectModule([]dlModuleEntry{entry("1.0.0", "", "", badName)}, "windows", "amd64", "0.6.0", true); got.Entry != nil {
		t.Fatalf("不正なファイル名は選ばない: %+v", got)
	}
}

func TestModuleOutOfRange_導入済みの版が対応範囲から外れたか(t *testing.T) {
	entries := []dlModuleEntry{{Version: "1.0.0", MinAppVersion: "0.1.0", MaxAppVersion: "0.4.9"}}
	if !moduleOutOfRange(entries, "1.0.0", "0.5.0", true) {
		t.Fatal("上限を超えた本体では範囲外のはず")
	}
	if moduleOutOfRange(entries, "1.0.0", "0.4.0", true) {
		t.Fatal("範囲内のはず")
	}
	if moduleOutOfRange(entries, "0.9.0", "0.5.0", true) {
		t.Fatal("一覧に無い版は判定しない")
	}
	if moduleOutOfRange(entries, "1.0.0", "0.5.0", false) {
		t.Fatal("dev ビルドは範囲を見ない")
	}
}

func TestModuleUpdateEntry_対応範囲に入る最新だけと比べる(t *testing.T) {
	file := dlModuleFile{OS: runtime.GOOS, Arch: runtime.GOARCH, Name: "alslime-comfy", SHA256: strings.Repeat("a", 64), Size: 1}
	entry := func(version, min, max, packVersion string) dlModuleEntry {
		out := dlModuleEntry{Version: version, MinAppVersion: min, MaxAppVersion: max, Files: []dlModuleFile{file}}
		if packVersion != "" {
			out.CompanionPack = &dlVersionedFile{Version: packVersion, Name: "companion.zip", SHA256: strings.Repeat("b", 64), Size: 1}
		}
		return out
	}
	twoLines := []dlModuleEntry{
		entry("1.0.0", "0.3.0", "0.3.9", "1.0"),
		entry("1.1.0", "0.3.0", "0.3.9", "1.0"),
		entry("1.2.0", "0.4.0", "", "1.1"),
	}
	cases := []struct {
		name      string
		entries   []dlModuleEntry
		app       string
		installed moduleReceipt
		want      ModuleUpdateEntry
	}{
		{
			name: "対応範囲に入る新しい版があれば更新あり（範囲外の 1.2.0 は案内しない）", entries: twoLines, app: "0.3.4",
			installed: moduleReceipt{Version: "1.0.0", CompanionPack: &moduleReceiptPack{Version: "1.0"}},
			want:      ModuleUpdateEntry{InstalledVersion: "1.0.0", LatestVersion: "1.1.0", LatestCompanionPackVersion: "1.0", HasUpdate: true},
		},
		{
			// 本体が更新されていない間は、対応範囲を超えたバージョンを更新として出してはならない。
			name: "対応範囲の最新を導入済みなら、範囲外に新しい版があっても更新なし", entries: twoLines, app: "0.3.4",
			installed: moduleReceipt{Version: "1.1.0", CompanionPack: &moduleReceiptPack{Version: "1.0"}},
			want:      ModuleUpdateEntry{InstalledVersion: "1.1.0", LatestVersion: "1.1.0", LatestCompanionPackVersion: "1.0"},
		},
		{
			name: "本体を上げた直後は導入済みが範囲外になり、新しい版を案内", entries: twoLines, app: "0.4.0",
			installed: moduleReceipt{Version: "1.1.0", CompanionPack: &moduleReceiptPack{Version: "1.0"}},
			want: ModuleUpdateEntry{
				InstalledVersion: "1.1.0", LatestVersion: "1.2.0", LatestCompanionPackVersion: "1.1",
				HasUpdate: true, CompanionPackUpdate: true,
			},
		},
		{
			name: "最新を導入済みなら更新なし", entries: twoLines, app: "0.4.0",
			installed: moduleReceipt{Version: "1.2.0", CompanionPack: &moduleReceiptPack{Version: "1.1"}},
			want:      ModuleUpdateEntry{InstalledVersion: "1.2.0", LatestVersion: "1.2.0", LatestCompanionPackVersion: "1.1"},
		},
		{
			name: "付属パックだけが古い", entries: twoLines, app: "0.4.0",
			installed: moduleReceipt{Version: "1.2.0", CompanionPack: &moduleReceiptPack{Version: "1.0"}},
			want: ModuleUpdateEntry{
				InstalledVersion: "1.2.0", LatestVersion: "1.2.0", LatestCompanionPackVersion: "1.1", CompanionPackUpdate: true,
			},
		},
		{
			name: "本体が古くて使える版が無い時は、状態だけを返しバージョンは出さない", entries: twoLines, app: "0.2.0",
			installed: moduleReceipt{Version: "0.9.0"},
			want:      ModuleUpdateEntry{InstalledVersion: "0.9.0", NeedsAppUpdate: true},
		},
		{
			name:    "範囲外になった導入済みより古い版しか使えなくても案内する",
			entries: []dlModuleEntry{entry("1.1.0", "0.3.0", "0.3.9", ""), entry("1.0.9", "0.4.0", "0.4.9", "")}, app: "0.4.0",
			installed: moduleReceipt{Version: "1.1.0"},
			want:      ModuleUpdateEntry{InstalledVersion: "1.1.0", LatestVersion: "1.0.9", HasUpdate: true},
		},
		{
			name:    "本体が新しすぎて使える版が無い",
			entries: []dlModuleEntry{entry("1.1.0", "0.3.0", "0.3.9", "")}, app: "9.0.0",
			installed: moduleReceipt{Version: "1.1.0"},
			want:      ModuleUpdateEntry{InstalledVersion: "1.1.0", Incompatible: true},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			svc, _ := newTestService(t, "")
			dir := t.TempDir()
			target := ModuleTarget{
				InstallPath: filepath.Join(dir, "alslime-comfy.exe"),
				ReceiptPath: filepath.Join(dir, "alslime-comfy.receipt.json"),
			}
			tc.installed.Module = "comfy"
			svc.writeReceipt(target.ReceiptPath, tc.installed)
			tc.want.ID = "comfy"
			if got := svc.moduleUpdateEntry("comfy", target, tc.entries, tc.app, true); got != tc.want {
				t.Fatalf("\n got: %+v\nwant: %+v", got, tc.want)
			}
		})
	}
}

func TestModuleResponseError_認証失効と権限不足を分離する(t *testing.T) {
	if err := moduleResponseError(http.StatusUnauthorized); !errors.Is(err, ErrTokenInvalid) {
		t.Fatalf("401=%v want=%v", err, ErrTokenInvalid)
	}
	if err := moduleResponseError(http.StatusForbidden); !errors.Is(err, ErrTierRejected) {
		t.Fatalf("403=%v want=%v", err, ErrTierRejected)
	}
}
