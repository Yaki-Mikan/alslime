package settingspack

import (
	"errors"
	"path"
	"strings"

	"alslime/internal/config"
)

// パック検査で使うエラー（system/api 層が HTTP ステータス・messageKey へ変換する）。
var (
	// ErrManifestInvalid は alslime-pack.json が JSON として壊れている。
	ErrManifestInvalid = errors.New("settingsPack.error.manifestInvalid")
	// ErrPackFormatTooNew は packFormat が現行仕様より新しい。
	ErrPackFormatTooNew = errors.New("settingsPack.error.packFormatTooNew")
	// ErrTooManyEntries はエントリ数が上限を超えた。
	ErrTooManyEntries = errors.New("settingsPack.error.tooManyEntries")
	// ErrTooLarge は展開後合計サイズが上限を超えた。
	ErrTooLarge = errors.New("settingsPack.error.tooLarge")
)

// Action はプラン上のエントリ処理区分。
type Action string

const (
	// ActionNew は新規作成（展開先に既存ファイルなし）。
	ActionNew Action = "new"
	// ActionConflict は既存ファイルと衝突（適用時のポリシーで解決）。
	ActionConflict Action = "conflict"
	// ActionSkip は書き込まない（E・F・tier外・未認識等。理由は ReasonKey）。
	ActionSkip Action = "skip"
)

// スキップ理由・ブロック理由の messageKey。
const (
	ReasonForbidden         = "settingsPack.skip.forbidden"
	ReasonEnvironment       = "settingsPack.skip.environment"
	ReasonTier              = "settingsPack.skip.tier"
	ReasonUnrecognized      = "settingsPack.skip.unrecognized"
	ReasonInvalidPath       = "settingsPack.skip.invalidPath"
	ReasonCharacterInternal = "settingsPack.skip.characterInternal"

	BlockedAuth = "settingsPack.blocked.auth"

	WarnOrphanPreset            = "settingsPack.warn.orphanPreset"
	WarnProfileWithoutDirective = "settingsPack.warn.profileWithoutDirective"
	WarnDirectiveWithoutProfile = "settingsPack.warn.directiveWithoutProfile"
	WarnCharacterWithoutSetting = "settingsPack.warn.characterWithoutSettings"
)

// Entry は zip から読み出した書き込み候補1件（system 層で正規化済み）。
type Entry struct {
	// Path は展開先（WORKSPACE_ROOT 相対・"/" 区切り）。
	// ゆるい形式（形式B）の場合はエイリアス解決済みのパスが入る。
	Path string
	// SizeBytes は展開後サイズ（zip ヘッダ申告値。表示用）。
	SizeBytes int64
	// Invalid は zip エントリ名として不正（脱出・絶対パス等）だったもの。
	// system 層が検知し、プランでは無条件スキップとして報告する。
	Invalid bool
}

// PlanEntry はプラン上の1エントリ。
type PlanEntry struct {
	Path      string `json:"path"`
	Kind      string `json:"kind,omitempty"`
	Class     string `json:"class,omitempty"`
	Action    Action `json:"action"`
	ReasonKey string `json:"reasonKey,omitempty"`
	SizeBytes int64  `json:"sizeBytes"`
	// Forced は衝突時にポリシーを無視して常に上書きするエントリ
	// （Kind.ForceOverwrite 由来。UI はポリシー選択を出さず「常に上書き」表示）。
	Forced bool `json:"forced,omitempty"`
}

// Warning は整合性チェックの警告（ブロックはしない。設計 §4）。
type Warning struct {
	Key  string `json:"key"`
	Path string `json:"path,omitempty"`
}

// Plan はインポートプラン（dry-run 結果。この段階では何も書かれていない）。
type Plan struct {
	Manifest *Manifest   `json:"manifest,omitempty"`
	Entries  []PlanEntry `json:"entries"`
	Warnings []Warning   `json:"warnings"`
	// Blocked は auth 配下を含む等でパック全体を拒否すべき状態。
	Blocked    bool   `json:"blocked"`
	BlockedKey string `json:"blockedKey,omitempty"`
	// Summary はアクション別件数（UI 表示用）。
	Summary map[Action]int `json:"summary"`
}

// PlanOptions はプラン生成の環境情報。
type PlanOptions struct {
	// Exists は展開先の既存判定（system 層が resolver 経由で供給する）。
	Exists func(rel string) bool
	// ImageGenAllowed は D 分類（画像生成系）の取り込み可否（tier ゲート）。
	ImageGenAllowed bool
}

// BuildPlan は正規化済みエントリからインポートプランを生成する。
//
// ファイルシステムへは Exists 経由の存在確認以外に一切触れない。
func BuildPlan(entries []Entry, manifest *Manifest, opts PlanOptions) Plan {
	plan := Plan{
		Manifest: manifest,
		Entries:  make([]PlanEntry, 0, len(entries)),
		Warnings: []Warning{},
		Summary:  map[Action]int{},
	}
	exists := opts.Exists
	if exists == nil {
		exists = func(string) bool { return false }
	}

	for _, e := range entries {
		pe := PlanEntry{Path: e.Path, SizeBytes: e.SizeBytes}
		switch {
		case e.Invalid:
			pe.Action = ActionSkip
			pe.ReasonKey = ReasonInvalidPath
		default:
			c := Classify(e.Path)
			if c.Kind != nil {
				pe.Kind = c.Kind.ID
			}
			pe.Class = string(c.Class)
			switch {
			case c.Class == ClassForbidden:
				pe.Action = ActionSkip
				pe.ReasonKey = ReasonForbidden
				if IsAuthPath(e.Path) {
					// 認証情報を含むパックは全体を拒否する（設計 §4）。
					plan.Blocked = true
					plan.BlockedKey = BlockedAuth
				}
			case c.Class == ClassEnv:
				pe.Action = ActionSkip
				pe.ReasonKey = ReasonEnvironment
			case c.Class == "":
				pe.Action = ActionSkip
				pe.ReasonKey = ReasonUnrecognized
			case c.Class == ClassImageGen && !opts.ImageGenAllowed:
				pe.Action = ActionSkip
				pe.ReasonKey = ReasonTier
			case IsCharacterInternal(e.Path):
				pe.Action = ActionSkip
				pe.ReasonKey = ReasonCharacterInternal
			case exists(e.Path):
				pe.Action = ActionConflict
				pe.Forced = c.Kind != nil && c.Kind.ForceOverwrite
			default:
				pe.Action = ActionNew
			}
		}
		plan.Summary[pe.Action]++
		plan.Entries = append(plan.Entries, pe)
	}

	plan.Warnings = integrityWarnings(plan.Entries, exists)
	return plan
}

// integrityWarnings は依存関係の整合性チェック（設計 §4。警告のみ）。
//
//   - 孤児プリセット: parameter-presets-<schemaId>.json に対応するスキーマが
//     パック内にも既存環境にも無い。schemaId の正本はファイル内容だが、
//     プラン段階では内容を読まないためファイル名の慣例で判定する（警告どまりの根拠）。
//   - プロファイル/directive: 分業構造のため片方だけでは機能しない。
//   - キャラクター: settings/ を持たない骨だけキャラ。
func integrityWarnings(entries []PlanEntry, exists func(string) bool) []Warning {
	warnings := []Warning{}

	inPack := make(map[string]bool, len(entries))
	for _, e := range entries {
		if e.Action == ActionNew || e.Action == ActionConflict {
			inPack[e.Path] = true
		}
	}

	// 孤児パラメータプリセット。
	for _, e := range entries {
		if e.Kind != "parameterPresets" || (e.Action != ActionNew && e.Action != ActionConflict) {
			continue
		}
		base := path.Base(e.Path)
		sid, ok := presetSchemaID(base)
		if !ok || sid == "default" {
			continue
		}
		schemaRel := config.ParameterSchemaCustomDir + "/parameter-schema-" + sid + ".json"
		if !inPack[schemaRel] && !exists(schemaRel) {
			warnings = append(warnings, Warning{Key: WarnOrphanPreset, Path: e.Path})
		}
	}

	// 生成プロファイルと directive のセット推奨。
	hasProfile, hasDirective := false, false
	for _, e := range entries {
		if e.Action != ActionNew && e.Action != ActionConflict {
			continue
		}
		switch e.Kind {
		case "comfyProfiles":
			hasProfile = true
		case "comfyDirectives":
			hasDirective = true
		}
	}
	directiveExists := exists(config.ComfyUIDirectiveDanbooruFile) || exists(config.ComfyUIDirectiveNaturalFile)
	profileExists := exists(config.ComfyUIProfileDir)
	if hasProfile && !hasDirective && !directiveExists {
		warnings = append(warnings, Warning{Key: WarnProfileWithoutDirective})
	}
	if hasDirective && !hasProfile && !profileExists {
		warnings = append(warnings, Warning{Key: WarnDirectiveWithoutProfile})
	}

	// settings/ を持たないキャラクター。
	charHasAny := map[string]bool{}
	charHasSettings := map[string]bool{}
	for _, e := range entries {
		if e.Action != ActionNew && e.Action != ActionConflict {
			continue
		}
		rest, ok := strings.CutPrefix(e.Path, config.CharacterListDir+"/")
		if !ok {
			continue
		}
		parts := strings.SplitN(rest, "/", 3)
		if len(parts) < 2 {
			continue
		}
		name := parts[0]
		charHasAny[name] = true
		if parts[1] == config.CharacterSettingsDirName {
			charHasSettings[name] = true
		}
	}
	for name := range charHasAny {
		if charHasSettings[name] {
			continue
		}
		if exists(config.CharacterListDir + "/" + name + "/" + config.CharacterSettingsDirName) {
			continue
		}
		warnings = append(warnings, Warning{Key: WarnCharacterWithoutSetting, Path: config.CharacterListDir + "/" + name})
	}
	return warnings
}

// presetSchemaID は parameter-presets-<schemaId>.json から schemaId を取り出す。
func presetSchemaID(base string) (string, bool) {
	rest, ok := strings.CutPrefix(base, "parameter-presets-")
	if !ok {
		return "", false
	}
	sid, ok := strings.CutSuffix(rest, ".json")
	if !ok || sid == "" {
		return "", false
	}
	return sid, true
}
