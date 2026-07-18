// Package configcheck は保存系 JSON の破損や保存先の基本状態を検査する。
//
// 目的（交換日記 38）: 保存系 JSON の破損を見える化し、利用者が「どのファイルが悪いか」
// を画面で確認できるようにする。自動修復はしない（検出のみ）。
//
// スコープ（初回・段階A）:
//   - 対象 JSON が存在する場合にパース可能かを見る。
//   - 未存在は原則 ok（任意ファイルが多く、未存在を異常扱いすると赤だらけになるため）。
//   - スキーマ意味検査（ValidateSchema 等）は今回入れない。
//   - WORKSPACE_ROOT 全体探索はしない（/api/files/search とは目的が違う）。
//
// 安全方針: path は WORKSPACE_ROOT 相対（resolver.ToSlash）のみ返す。絶対パス・
// 認証情報・内部リクエスト・会話本文等は一切出さない（運用支援機能の厳守事項）。
//
// 検査は通常の domain/storage の挙動を変えず、外側から paths.Resolver + jsonstore で読む。
package configcheck

import (
	"errors"
	"io/fs"
	"os"
	"strings"
	"sync"

	"alslime/internal/storage/jsonstore"
	"alslime/internal/storage/locations"
	"alslime/internal/storage/paths"
	"alslime/internal/system/diagnostics"
)

// messageKey（交換日記 38 で確定した最小セット）。
const (
	msgOK                 = "configCheck.ok"
	msgMissingOptional    = "configCheck.missingOptional"
	msgInvalidJSON        = "configCheck.invalidJson"
	msgReadError          = "configCheck.readError"
	msgWorkspaceNotWrite  = "configCheck.workspaceNotWritable"
	msgLegacyBrokenTplDir = "configCheck.legacyBrokenTemplateDir"
	msgWorkspaceWritable  = "configCheck.workspaceWritable"
)

// Kind は検査項目の種別。
type Kind int

const (
	// KindSingleJSON は単一 JSON ファイルのパス可否検査。
	KindSingleJSON Kind = iota
	// KindJSONDir はディレクトリ内の対象 .json を列挙して各々検査。
	KindJSONDir
)

// Item は検査項目。論理パスは locations から解決する。
type Item struct {
	// LocationID は locations の論理 ID。レスポンスの locationId に使う。
	LocationID locations.Location
	// LocationName は locationId 表示用の文字列（レスポンス互換）。
	LocationName string
	// Kind は検査種別。
	Kind Kind
}

// FileResult は 1 ファイル/項目の検査結果。
type FileResult struct {
	LocationID string                  `json:"locationId"`
	Path       string                  `json:"path"`
	Status     diagnostics.CheckStatus `json:"status"`
	MessageKey string                  `json:"messageKey,omitempty"`
}

// Result は config-check 全体の結果。
type Result struct {
	Status diagnostics.CheckStatus `json:"status"`
	Files  []FileResult            `json:"files"`
}

// jsonExt はディレクトリ列挙で検査対象とする拡張子。
const jsonExt = ".json"

// Checker は config-check のスキャンと直近結果の保持を担う。
type Checker struct {
	resolver *paths.Resolver
	items    []Item

	mu   sync.Mutex
	last *Result // 直近スキャン結果（プロセス内メモリのみ。永続化しない）。
}

// New は標準の検査項目で Checker を生成する。
func New(resolver *paths.Resolver) *Checker {
	return &Checker{resolver: resolver, items: defaultItems()}
}

// defaultItems は初回 config-check の検査対象（交換日記 38「初回で見たい検査対象」＋ 40 の追加）。
//
// 単一 JSON: グローバル設定 / relationships / replacement-config / datetime-presets /
//
//	PWA設定 / character_filters / calendar / parameter schema default / Config Editor の _defaults.json。
//
// ディレクトリ列挙: parameter schema custom / parameter presets。
// （各キャラ tags.json は走査コストが利用者データ量に比例するため初回は含めない。
//
//	Character Images / ComfyUI 周りに入るタイミングでまとめて足す。WORKSPACE 全探索も避ける。）
//
// UI i18n 辞書は任意の外部 JSON 群なので、ディレクトリ列挙で軽く見る。
//
// 特殊（WORKSPACE 書込可否・破損テンプレ検出）は Scan 内で別途実行する。
func defaultItems() []Item {
	return []Item{
		{LocationID: locations.GlobalSettingsFile, LocationName: "GlobalSettingsFile", Kind: KindSingleJSON},
		{LocationID: locations.RelationOptionsFile, LocationName: "RelationOptionsFile", Kind: KindSingleJSON},
		{LocationID: locations.ReplacementConfigFile, LocationName: "ReplacementConfigFile", Kind: KindSingleJSON},
		{LocationID: locations.DateTimePresetsFile, LocationName: "DateTimePresetsFile", Kind: KindSingleJSON},
		{LocationID: locations.PWASettingsFile, LocationName: "PWASettingsFile", Kind: KindSingleJSON},
		{LocationID: locations.CharacterFiltersFile, LocationName: "CharacterFiltersFile", Kind: KindSingleJSON},
		{LocationID: locations.CalendarFile, LocationName: "CalendarFile", Kind: KindSingleJSON},
		{LocationID: locations.ParameterSchemaDefaultFile, LocationName: "ParameterSchemaDefaultFile", Kind: KindSingleJSON},
		{LocationID: locations.ConfigEditorDefaultsFile, LocationName: "ConfigEditorDefaultsFile", Kind: KindSingleJSON},
		{LocationID: locations.ParameterSchemaCustomDir, LocationName: "ParameterSchemaCustomDir", Kind: KindJSONDir},
		{LocationID: locations.ParameterNormalModePresetDir, LocationName: "ParameterNormalModePresetDir", Kind: KindJSONDir},
		{LocationID: locations.I18NDir, LocationName: "I18NDir", Kind: KindJSONDir},
	}
}

// Latest は直近結果を返す。未スキャンなら一度スキャンして返す（GET 用）。
func (c *Checker) Latest() (Result, error) {
	c.mu.Lock()
	if c.last != nil {
		r := *c.last
		c.mu.Unlock()
		return r, nil
	}
	c.mu.Unlock()
	return c.Scan()
}

// Scan は全項目を検査し、結果を保持して返す（POST 用・必ず再スキャン）。
func (c *Checker) Scan() (Result, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	locs := locations.NewResolver()
	files := make([]FileResult, 0, len(c.items)+2)

	for _, it := range c.items {
		logical, ok := locs.Path(it.LocationID)
		if !ok {
			continue
		}
		switch it.Kind {
		case KindSingleJSON:
			files = append(files, c.checkSingleJSON(it.LocationName, logical))
		case KindJSONDir:
			files = append(files, c.checkJSONDir(it.LocationName, logical)...)
		}
	}

	// 特殊検査。
	files = append(files, c.checkWorkspaceWritable())
	if r, found := c.checkLegacyTemplateDir(); found {
		files = append(files, r)
	}

	result := Result{Status: aggregate(files), Files: files}
	c.last = &result
	return result, nil
}

// checkSingleJSON は単一 JSON のパス可否を検査する。
// 未存在は ok（missingOptional）。パース失敗は error。境界外・読取不能は error。
func (c *Checker) checkSingleJSON(locationName, logical string) FileResult {
	rel := relPathOrLogical(logical)
	res := FileResult{LocationID: locationName, Path: rel}

	lexical, err := c.resolver.ResolveLexical(logical)
	if err != nil {
		res.Status, res.MessageKey = diagnostics.CheckError, msgReadError
		return res
	}
	if _, statErr := os.Lstat(lexical); errors.Is(statErr, fs.ErrNotExist) {
		res.Status, res.MessageKey = diagnostics.CheckOK, msgMissingOptional
		return res
	}
	abs, err := c.resolver.ResolveExisting(logical)
	if err != nil {
		// 境界外・root 外 symlink 等。
		res.Status, res.MessageKey = diagnostics.CheckError, msgReadError
		return res
	}
	var v any
	if rerr := jsonstore.ReadJSON(abs, &v); rerr != nil {
		if errors.Is(rerr, fs.ErrNotExist) {
			res.Status, res.MessageKey = diagnostics.CheckOK, msgMissingOptional
			return res
		}
		res.Status, res.MessageKey = diagnostics.CheckError, msgInvalidJSON
		return res
	}
	res.Status, res.MessageKey = diagnostics.CheckOK, msgOK
	return res
}

// checkJSONDir はディレクトリ内の *.json を列挙し各々検査する。
// ディレクトリ未存在は「対象なし」として ok（missingOptional）1 件を返す。
func (c *Checker) checkJSONDir(locationName, dirLogical string) []FileResult {
	dirRel := relPathOrLogical(dirLogical)

	lexical, err := c.resolver.ResolveLexical(dirLogical)
	if err != nil {
		return []FileResult{{LocationID: locationName, Path: dirRel, Status: diagnostics.CheckError, MessageKey: msgReadError}}
	}
	if _, statErr := os.Lstat(lexical); errors.Is(statErr, fs.ErrNotExist) {
		return []FileResult{{LocationID: locationName, Path: dirRel, Status: diagnostics.CheckOK, MessageKey: msgMissingOptional}}
	}
	abs, err := c.resolver.ResolveExisting(dirLogical)
	if err != nil {
		return []FileResult{{LocationID: locationName, Path: dirRel, Status: diagnostics.CheckError, MessageKey: msgReadError}}
	}
	dirents, rerr := os.ReadDir(abs)
	if rerr != nil {
		return []FileResult{{LocationID: locationName, Path: dirRel, Status: diagnostics.CheckError, MessageKey: msgReadError}}
	}

	out := make([]FileResult, 0, len(dirents))
	for _, d := range dirents {
		if d.IsDir() || !strings.HasSuffix(d.Name(), jsonExt) {
			continue
		}
		childLogical := dirLogical + "/" + d.Name()
		out = append(out, c.checkSingleJSON(locationName, childLogical))
	}
	if len(out) == 0 {
		// ディレクトリはあるが対象 JSON なし。正常扱い。
		out = append(out, FileResult{LocationID: locationName, Path: dirRel, Status: diagnostics.CheckOK, MessageKey: msgMissingOptional})
	}
	return out
}

// checkWorkspaceWritable は WORKSPACE_ROOT に書き込めるかを確認する（一時ファイル作成→即削除）。
func (c *Checker) checkWorkspaceWritable() FileResult {
	res := FileResult{LocationID: "WorkspaceRoot", Path: "."}
	probe, err := os.CreateTemp(c.resolver.Root(), ".configcheck-*.tmp")
	if err != nil {
		res.Status, res.MessageKey = diagnostics.CheckError, msgWorkspaceNotWrite
		return res
	}
	name := probe.Name()
	_ = probe.Close()
	_ = os.Remove(name)
	res.Status, res.MessageKey = diagnostics.CheckOK, msgWorkspaceWritable
	return res
}

// legacyBrokenTemplateRel は旧 Node 版の文字化け TEMPLATE_ROOT（「テンプレート」の
// 「レ」が U+FFFD 置換文字 ×3 に化けた綴り）の相対パス。検出のみ行う（移行は Phase 15）。
// 親パスはワークスペース英語化後の名前（移行スクリプトが親ごとリネームするため）。
// 文字列リテラルとして直接表現できないため、rune 連結で構成する。
func legacyBrokenTemplateRel() string {
	const repl = "�"
	return "roleplay/global/テンプ" + repl + repl + repl + "ート"
}

// checkLegacyTemplateDir は旧破損テンプレートディレクトリの存在を検査する。
// 存在すれば warning（legacyBrokenTemplateDir）。無ければ項目を出さない（found=false）。
func (c *Checker) checkLegacyTemplateDir() (FileResult, bool) {
	logical := legacyBrokenTemplateRel()
	lexical, err := c.resolver.ResolveLexical(logical)
	if err != nil {
		return FileResult{}, false
	}
	if _, statErr := os.Lstat(lexical); statErr != nil {
		return FileResult{}, false // 未存在（正常）。項目を出さない。
	}
	return FileResult{
		LocationID: "LegacyBrokenTemplateDir",
		Path:       logical,
		Status:     diagnostics.CheckWarning,
		MessageKey: msgLegacyBrokenTplDir,
	}, true
}

// relPathOrLogical は logical を WORKSPACE 相対 "/" 区切りで返す。
// 解決できない場合は論理パスをそのまま返す（絶対パスは決して返さない）。
func relPathOrLogical(logical string) string {
	return logical
}

// aggregate は FileResult 群の status を最も重い状態へ集約する。
func aggregate(files []FileResult) diagnostics.CheckStatus {
	results := make([]diagnostics.CheckResult, 0, len(files))
	for _, f := range files {
		results = append(results, diagnostics.CheckResult{ID: f.LocationID, Status: f.Status})
	}
	return diagnostics.Aggregate(results)
}
