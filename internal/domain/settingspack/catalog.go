// Package settingspack は設定パック（設定インポート・エクスポート）の
// 分類テーブルとインポートプラン生成のユースケースを担う。
//
// 分類テーブル（A〜F。設定設定大設定/設定インポートエクスポート_設計.md §4）の
// 正本はここに置く。zip の読み書き・展開・ファイルシステム操作は
// system/settingspack、HTTP 入出力は api/settingspack が担い、
// いずれも本パッケージの分類・プラン判定だけを見る。
//
// 安全方針は allowlist（Kinds の Roots/Files に載るパスだけ書き込み許可）と
// denylist（forbiddenRoots。allowlist の漏れがあっても F で止める）の二重。
package settingspack

import (
	"strings"

	"alslime/internal/config"
	"alslime/internal/domain/configeditor"
)

// Class は分類テーブルの大分類（設計 §4 の A〜F）。
type Class string

const (
	// ClassRoleplay はロールプレイMD系（キャラクター・シチュエーション等）。
	ClassRoleplay Class = "A"
	// ClassSchema は項目設定・プリセット類（スキーマとプリセットの整合が要るもの）。
	ClassSchema Class = "B"
	// ClassConfig は各種設定 JSON（単一ファイル型が中心）。
	ClassConfig Class = "C"
	// ClassImageGen は画像生成系（supporter tier ゲート対象）。
	ClassImageGen Class = "D"
	// ClassEnv は環境依存設定（接続URL・ローカルパス等。入出力とも常に除外）。
	ClassEnv Class = "E"
	// ClassForbidden は絶対除外（認証・履歴・キャッシュ等。検知したら拒否）。
	ClassForbidden Class = "F"
)

// Kind は分類テーブルの1項目（エクスポート選択・インポート振り分けの単位）。
type Kind struct {
	// ID は機械可読な種別ID（API・エクスポート選択で使う）。
	ID string
	// Label は表示名。configeditor カタログと同じく現状は日本語literal
	// （将来 i18n 対象）。
	Label string
	// Class は大分類。
	Class Class
	// Roots は種別に属するディレクトリプレフィックス（WORKSPACE_ROOT 相対・"/" 区切り）。
	Roots []string
	// Files は種別に属する単一ファイル（WORKSPACE_ROOT 相対・"/" 区切り）。
	Files []string
	// ForceOverwrite は衝突時にポリシーを無視して常に上書きする種別。
	// AIプロバイダ指示ファイルのように「取り込み＝内容の反映」が目的の
	// 種別に使う。無確認適用の import_inbox 経路では無効化される（設計 §5）。
	ForceOverwrite bool
}

// forbiddenRoots は F 分類（絶対除外）のディレクトリプレフィックス。
//
// AuthDir は秘匿情報（安全要件§8-2）。history は設定ではなく履歴、
// cache/temp/log/backups/debug は生成物。allowlist 判定より先に必ず照合する。
var forbiddenRoots = []string{
	config.AuthDir,
	"roleplay/history",
	config.AppCacheDir,
	config.RuntimeTempDir,
	"roleplay/log",
	config.AppBackupDir,
	config.ComfyUIDebugDir,
	// import_inbox はパックから書き込ませない（パック内に inbox 宛 zip を仕込む
	// 連鎖ロードの禁止。設計 §5 の inbox セキュリティ条件）。
	config.SettingsPackInboxDir,
}

// envFiles は E 分類（環境依存。入出力とも常に除外）の単一ファイル。
var envFiles = []string{
	config.ComfyUIConfigFile,
	config.ComfyUILoraDirectoriesFile,
	config.ServerSettingsFile,
	config.PWASettingsFile,
	config.LegacyServerSettingsFile,
	config.LegacyPWASettingsFile,
}

// kinds は A〜D 分類の正本（順序維持。カタログ API・エクスポート選択ツリーの表示順）。
//
// A（ロールプレイMD）は configeditor のカテゴリ定義から導出し、二重管理を避ける。
// 文体設定も configeditor カテゴリ（ID "writingStyle"）に含まれるため導出で賄う。
// 「基本指示」の実体は AIプロバイダ指示ファイル
// （config.ProviderInstruction*File。設計 §8）。当初はパック対象外だったが、
// 2026-07-19 のユーザー判断で C 分類 Kind「providerInstructions」として対象化。
// 指示ファイルは「パックの内容を反映させる」ことが取り込みの目的そのものなので、
// 衝突時もポリシーによらず常に上書きする（ForceOverwrite）。
// 例外は無確認適用の import_inbox のみ（新規のみ書き込みの保証を維持。設計 §5）。
func kinds() []Kind {
	out := make([]Kind, 0, 32)
	for _, c := range configeditor.Categories() {
		out = append(out, Kind{
			ID:    c.ID,
			Label: c.Label,
			Class: ClassRoleplay,
			Roots: []string{c.Dir},
		})
	}
	out = append(out,
		// B: 項目設定・プリセット類。
		Kind{
			ID:    "parameterSchemas",
			Label: "項目設定",
			Class: ClassSchema,
			Roots: []string{config.ParameterSchemaCustomDir},
			Files: []string{config.ParameterSchemaDefaultFile},
		},
		Kind{
			ID:    "parameterPresets",
			Label: "パラメータプリセット",
			Class: ClassSchema,
			Roots: []string{config.ParameterNormalModePresetDir},
		},
		Kind{
			ID:    "ssrpPresets",
			Label: "SSRPプリセット",
			Class: ClassSchema,
			Roots: []string{config.PresetSSRPModeDir},
		},
		Kind{
			ID:    "datetimePresets",
			Label: "日付時刻プリセット",
			Class: ClassSchema,
			Files: []string{config.DateTimePresetsFile},
		},
		// C: 各種設定 JSON。
		Kind{ID: "characterFilters", Label: "キャラフィルタ", Class: ClassConfig, Files: []string{config.CharacterFiltersFile}},
		Kind{ID: "relationOptions", Label: "関係性オプション", Class: ClassConfig, Files: []string{config.RelationOptionsFile}},
		Kind{ID: "replacementConfig", Label: "置換設定", Class: ClassConfig, Files: []string{config.ReplacementConfigFile}},
		Kind{ID: "emotionDefinitions", Label: "心情定義", Class: ClassConfig, Files: []string{config.EmotionDefinitionsFile}},
		Kind{ID: "calendar", Label: "祝日カレンダー", Class: ClassConfig, Files: []string{config.CalendarFile}},
		Kind{ID: "userModels", Label: "モデル一覧（ユーザー編集）", Class: ClassConfig, Files: []string{config.UserModelsFile}},
		Kind{ID: "globalDefaults", Label: "グローバル設定", Class: ClassConfig, Files: []string{config.GlobalSettingsFile}},
		Kind{ID: "configTemplates", Label: "設定ファイルテンプレート", Class: ClassConfig, Roots: []string{config.ConfigEditorTemplateRoot}},
		Kind{ID: "uiDictionaries", Label: "UI辞書", Class: ClassConfig, Roots: []string{config.I18NDir, config.LanguageDir}},
		Kind{
			ID:    "providerInstructions",
			Label: "AIプロバイダ指示ファイル",
			Class: ClassConfig,
			Files: []string{
				config.ProviderInstructionAntigravityFile,
				config.ProviderInstructionClaudeFile,
				config.ProviderInstructionGeminiFile,
			},
			ForceOverwrite: true,
		},
		// D: 画像生成系（tier ゲート対象）。
		Kind{
			ID:    "comfyDirectives",
			Label: "タグ判定指示ファイル",
			Class: ClassImageGen,
			Files: []string{config.ComfyUIDirectiveDanbooruFile, config.ComfyUIDirectiveNaturalFile},
		},
		Kind{ID: "comfyProfiles", Label: "生成プロファイル", Class: ClassImageGen, Roots: []string{config.ComfyUIProfileDir}},
		Kind{ID: "comfyPlaceholderPresets", Label: "プレースホルダプリセット", Class: ClassImageGen, Roots: []string{config.ComfyUIPlaceholderPresetDir}},
		Kind{ID: "comfyTemplates", Label: "ワークフローテンプレート", Class: ClassImageGen, Roots: []string{config.ComfyUITemplateDir}},
		Kind{ID: "comfyTagMappings", Label: "タグマッピング", Class: ClassImageGen, Roots: []string{config.ComfyUITagMappingDir}},
	)
	return out
}

// Kinds は A〜D 分類の全種別を順序どおり返す（カタログ API・エクスポート用）。
func Kinds() []Kind {
	return kinds()
}

// FindKind は id に一致する種別を返す。未知は ok=false。
func FindKind(id string) (Kind, bool) {
	for _, k := range kinds() {
		if k.ID == id {
			return k, true
		}
	}
	return Kind{}, false
}

// Classification はパス1件の分類結果。
type Classification struct {
	// Kind は該当種別。未認識・E・F は nil。
	Kind *Kind
	// Class は大分類。未認識は空。
	Class Class
}

// Classify は WORKSPACE_ROOT 相対パス（"/" 区切り）を分類テーブルへ照合する。
//
// 判定順: F（絶対除外）→ E（環境依存）→ A〜D（単一ファイル完全一致 →
// ディレクトリの最長プレフィックス一致）。最長一致により
// backgrounds/occupations が backgrounds より優先される。
func Classify(rel string) Classification {
	for _, root := range forbiddenRoots {
		if underPrefix(rel, root) {
			return Classification{Class: ClassForbidden}
		}
	}
	for _, f := range envFiles {
		if rel == f {
			return Classification{Class: ClassEnv}
		}
	}
	all := kinds()
	for i := range all {
		for _, f := range all[i].Files {
			if rel == f {
				return Classification{Kind: &all[i], Class: all[i].Class}
			}
		}
	}
	best := -1
	bestLen := -1
	for i := range all {
		for _, root := range all[i].Roots {
			if underPrefix(rel, root) && len(root) > bestLen {
				best = i
				bestLen = len(root)
			}
		}
	}
	if best >= 0 {
		return Classification{Kind: &all[best], Class: all[best].Class}
	}
	return Classification{}
}

// IsAuthPath は rel が認証ファイル配置場所（AuthDir）配下かを返す。
// これを含むパックは部分スキップではなくパック全体を拒否する（設計 §4）。
func IsAuthPath(rel string) bool {
	return underPrefix(rel, config.AuthDir)
}

// IsCharacterInternal は rel がキャラ内部保持情報
// （roleplay/characters/<キャラ>/internal/...）かを返す。
// キャッシュ的データのため入出力とも除外する（設計 §6）。
func IsCharacterInternal(rel string) bool {
	return characterSubdir(rel, config.CharacterInternalDataDirName)
}

// IsCharacterImage は rel がキャラ画像
// （roleplay/characters/<キャラ>/images/...）かを返す。
// エクスポートでは既定 OFF の任意選択（設計 §6）。インポートは受け入れる。
func IsCharacterImage(rel string) bool {
	return characterSubdir(rel, config.CharacterImageDirName)
}

// characterSubdir は rel が roleplay/characters/<キャラ>/<sub>/... 形式かを返す。
func characterSubdir(rel, sub string) bool {
	if !underPrefix(rel, config.CharacterListDir) || rel == config.CharacterListDir {
		return false
	}
	rest := strings.TrimPrefix(rel, config.CharacterListDir+"/")
	parts := strings.SplitN(rest, "/", 3)
	return len(parts) >= 2 && parts[1] == sub
}

// LooseAliases は「ゆるい形式（形式B）」のトップレベルディレクトリ名 →
// 展開先ベースディレクトリの対応表を返す（設計 §3-2）。
//
// configeditor カテゴリは ID・表示名（日本語）・物理ディレクトリ名の3通りを受理する。
// 項目設定はカスタムスキーマ保存先へ展開する（デフォルトスキーマの上書きは
// 正準形式でのみ可能とし、ゆるい形式では受けない）。
func LooseAliases() map[string]string {
	aliases := make(map[string]string, 32)
	for _, c := range configeditor.Categories() {
		aliases[c.ID] = c.Dir
		aliases[c.Label] = c.Dir
		aliases[c.TemplateDirName] = c.Dir
	}
	aliases["項目設定"] = config.ParameterSchemaCustomDir
	aliases["parameterSchemas"] = config.ParameterSchemaCustomDir
	aliases["parameter_schemas"] = config.ParameterSchemaCustomDir
	return aliases
}

// underPrefix は rel が prefix 自身またはその配下かをセパレータ境界で判定する。
// 単純な strings.HasPrefix だと "roleplay/global2" を "roleplay/global" 配下と
// 誤認するため、必ず "/" 境界で見る。
func underPrefix(rel, prefix string) bool {
	return rel == prefix || strings.HasPrefix(rel, prefix+"/")
}
