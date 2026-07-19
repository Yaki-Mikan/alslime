// Package config は alslime 全体で共有する設定値・定数・WORKSPACE_ROOT 解決を管理する。
//
// 規約: 定数のべた書きを禁止し、ポート・パス・CLI名・環境変数名などは
// このパッケージに集中させる。各所からは config の公開シンボルを参照すること。
package config

// 環境変数名。プロセス内で参照する環境変数のキーはここに集約する。
const (
	// EnvWorkspaceRoot は WORKSPACE_ROOT の探索を上書きする環境変数。
	EnvWorkspaceRoot = "WORKSPACE_ROOT"
	// EnvPort はリッスンポートを上書きする環境変数。
	EnvPort = "PORT"
	// EnvHost はバインドアドレスを上書きする環境変数。
	EnvHost = "HOST"
	// EnvAntigravityPath は Antigravity CLI 実行ファイルパスを上書きする環境変数。
	EnvAntigravityPath = "AGY_PATH"
	// EnvChatCLITimeoutSeconds はチャット用外部CLIの最大待機秒数を上書きする環境変数。
	EnvChatCLITimeoutSeconds = "ALSLIME_CHAT_CLI_TIMEOUT_SECONDS"
	// EnvAntigravityMaxStreamCalls は Antigravity CLI 実行の内部呼び出し回数上限
	// （暴走停止のしきい値）を上書きする環境変数。
	EnvAntigravityMaxStreamCalls = "ANTIGRAVITY_MAX_STREAM_CALLS"
	// EnvFirebaseProjectID は Firebase 認証を有効化するプロジェクトID。
	// 設定時のみ /api/* で IDトークン検証を行う（未設定＝ローカル利用は従来どおり認証なし）。
	EnvFirebaseProjectID = "FIREBASE_PROJECT_ID"
	// EnvAllowedUIDs は許可する Firebase UID のカンマ区切りリスト。
	// 空なら UID 制限なし（トークン検証のみ）。旧 Node 版 ALLOWED_UIDS と同名・同義。
	EnvAllowedUIDs = "ALLOWED_UIDS"
	// EnvNoBrowser は起動時のブラウザ自動起動を抑止する環境変数（値があれば抑止）。
	EnvNoBrowser = "ALSLIME_NO_BROWSER"
	// EnvDisplay は X11 のディスプレイ環境変数。Linux での GUI セッション判定に使う。
	EnvDisplay = "DISPLAY"
	// EnvWaylandDisplay は Wayland のディスプレイ環境変数。Linux での GUI セッション判定に使う。
	EnvWaylandDisplay = "WAYLAND_DISPLAY"
)

// Firebase 認証（Lightsail 等、インターネット公開運用時のみ有効）。
const (
	// FirebaseSecureTokenCertsURL は IDトークン署名検証用の Google 公開証明書（x509）の取得先。
	FirebaseSecureTokenCertsURL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com"
	// FirebaseIssuerPrefix は IDトークンの iss クレーム接頭辞。この直後にプロジェクトIDが続く。
	FirebaseIssuerPrefix = "https://securetoken.google.com/"
)

// ネットワーク既定値。
const (
	// DefaultPort は配布版・開発版共通の既定リッスンポート。
	// 現行 Node 版と揃える（設定で変更可能）。
	DefaultPort = 3000
	// DefaultHost は既定のバインドアドレス。LAN 公開の初期値は別途設定で決める。
	DefaultHost = "127.0.0.1"
	// DefaultLANHost は LAN 公開時に使う全インターフェイス向けのバインドアドレス。
	DefaultLANHost = "0.0.0.0"
	// DefaultChatCLITimeoutSeconds はチャット用外部CLIの既定最大待機秒数。
	// Antigravity CLI の既存 --print-timeout 10m と揃える。
	DefaultChatCLITimeoutSeconds = 600
)

// API ルートのプレフィックス。route 定義はここを基準にする。
const (
	APIPrefix = "/api"
	// HTTPHeaderContentType は Content-Type ヘッダ名。
	HTTPHeaderContentType = "Content-Type"
	// MediaTypeJSONUTF8 は JSON レスポンスの Content-Type。
	MediaTypeJSONUTF8 = "application/json; charset=utf-8"
)

// WORKSPACE_ROOT 配下の主要ディレクトリ・ファイルの相対パス。
// パス区切りは保存時に OS 依存へ変換するため、ここでは "/" 区切りの論理パスで持つ。
const (
	// RolePlayDir はロールプレイ関連データのルート。
	RolePlayDir = "roleplay"
	// GlobalSettingsFile はグローバル設定（AIプロセス制限・Antigravityモード等）の正本。
	// /api/settings/global（マージ）と /api/settings/default（全置換）が同じ正本を見る。
	GlobalSettingsFile = "roleplay/global/defaults/defaults.json"
	// CharacterListDir はキャラクター設定・画像のルート。
	CharacterListDir = "roleplay/characters"
	// CharacterSettingsDirName はキャラディレクトリ配下の設定ディレクトリ名。
	CharacterSettingsDirName = "settings"
	// CharacterImageGenConfigFileName はキャラ別画像生成設定ファイル名。
	CharacterImageGenConfigFileName = "image_gen_config.json"
	// CharacterImageDirName はキャラディレクトリ配下の画像ディレクトリ名。
	CharacterImageDirName = "images"
	// CharacterOriginalImageDirName はキャラ画像の元画像ディレクトリ名。
	CharacterOriginalImageDirName = "originals"
	// CharacterIconImageDirName はキャラ画像のアイコンディレクトリ名。
	CharacterIconImageDirName = "icons"
	// CharacterInternalDataDirName はキャラごとの内部保持情報ディレクトリ名。
	CharacterInternalDataDirName = "internal"
	// CharacterImageHashesFileName はキャラ画像キャッシュ破棄用ハッシュ保存ファイル名。
	CharacterImageHashesFileName = "image_hashes.json"
	// CharacterImageCropDataFileName はキャラ画像切り抜き設定保存ファイル名。
	CharacterImageCropDataFileName = "crop_data.json"
	// CharacterFiltersFile はキャラフィルタ（works/tags）マスタの正本。
	CharacterFiltersFile = "roleplay/global/settings/character_filters.json"
	// RelationOptionsFile は関係性オプション（/api/settings/relationships）の正本。
	RelationOptionsFile = "roleplay/global/settings/relation_options.json"
	// ReplacementConfigFile は置換設定（/api/settings/replacement-config）の正本。
	ReplacementConfigFile = "roleplay/global/settings/replacement_config.json"
	// EmotionDefinitionsFile は SSRP 応答時に参照する心情定義ファイル。
	EmotionDefinitionsFile = "roleplay/global/settings/emotion_definitions.json"
	// CalendarFile は日付時刻プロンプトで祝日名を判定するカレンダー定義ファイル。
	CalendarFile = "roleplay/global/settings/calendar.json"
	// CalendarLogFile は祝日カレンダー自動更新のログ。
	CalendarLogFile = "roleplay/log/calendar.log"
	// CalendarAPIURL は日本の祝日情報を取得する既定 API。
	CalendarAPIURL = "https://holidays-jp.github.io/api/v1/date.json"
	// CalendarUpdateIntervalDays はカレンダー自動更新の既定間隔（日）。
	CalendarUpdateIntervalDays = 30
	// WritingStylesDir は文体設定（MD）のディレクトリ。
	// フロント正本は frontend/src/constants/workspacePaths.ts の WRITING_STYLES（同値）。
	// SSRP 画面が Files API 経由で列挙するユーザーデータで、設定パックの A 分類対象。
	WritingStylesDir = "roleplay/global/writing_styles"
	// LanguageDir は言語設定（/api/settings/language/:lang）のディレクトリ。
	// 実ファイルは LanguageDir/<lang>.json。
	LanguageDir = "roleplay/Language"
	// I18NDir は配布版 UI 辞書の保存ディレクトリ。
	// 実ファイルは I18NDir/<lang>.json。未作成なら内蔵辞書を返す。
	I18NDir = "roleplay/global/settings/i18n"
	// I18NDefaultLang は UI 辞書の既定言語。
	I18NDefaultLang = "ja"
	// I18NFallbackLang は UI 辞書のフォールバック言語。
	I18NFallbackLang = "en"
	// PWASettingsFile は PWA（アプリ表示）設定の正本（/api/settings）。
	PWASettingsFile = "roleplay/global/settings/pwa-settings.json"
	// LegacyPWASettingsFile は移行専用の旧 PWA 設定保存先。
	LegacyPWASettingsFile = "roleplay/global/settings/app/pwa-settings.json"
	// ServerSettingsFile は起動前に読むサーバー設定の正本。
	// ヘッドレス環境では画面から変更できないため、WORKSPACE_ROOT 配下の設定ファイルで
	// port / bindAddress / lanPublic を指定できるようにする。
	ServerSettingsFile = "roleplay/global/settings/server-settings.json"
	// LegacyServerSettingsFile は移行専用の旧サーバー設定保存先。
	LegacyServerSettingsFile = "roleplay/global/settings/app/server-settings.json"
	// UserModelsFile はユーザー編集のモデル一覧設定（/api/models/user）。
	// モデル一覧の正本は「内蔵デフォルト＋本ファイルのマージ」（配布公開準備その2 09番）。
	UserModelsFile = "roleplay/global/settings/user-models.json"
	// UnifiedSessionsDir は配布版の統一セッション履歴保存先。
	// 設定ファイル置き場ではなく、WORKSPACE_ROOT 配下の履歴領域として分離する。
	UnifiedSessionsDir = "roleplay/history/unified_sessions"
	// LegacyUnifiedSessionsDir は移行専用の旧保存先。
	// 新規書き込みには使わず、旧デバッグ環境で作成済みの履歴を新保存先へコピーするためだけに参照する。
	LegacyUnifiedSessionsDir = "roleplay/global/settings/app/unified_sessions"
	// RuntimeTempDir は配布版が作る使い捨て一時ファイルのルート。
	// 設定や履歴と混ぜず、削除可能な作業領域として扱う。
	RuntimeTempDir = "roleplay/temp"
	// AntigravityTempOutputDir は Antigravity 一時ファイルモードの出力先。
	AntigravityTempOutputDir = RuntimeTempDir + "/antigravity_output"
	// GeminiTempOutputDir は Gemini 一時ファイルモードの出力先。
	GeminiTempOutputDir = RuntimeTempDir + "/gemini_output"
	// AntigravityContextTempDir は Antigravity 連携が CLI に読ませる一時コンテキスト
	// ファイルの出力先。
	AntigravityContextTempDir = RuntimeTempDir + "/antigravity_method_c"
	// AntigravityLogDir は Antigravity CLI 実行ログの保存先。
	AntigravityLogDir = RuntimeTempDir + "/antigravity_logs"
	// ClaudeSystemPromptTempDir は Claude へ引数長回避でシステムプロンプトを
	// ファイル渡しする際の一時ファイル置き場。送信後に削除する使い捨て領域。
	ClaudeSystemPromptTempDir = RuntimeTempDir + "/claude_system_prompt"
	// AntigravitySidecarDir は Antigravity ネイティブ履歴と統一セッションを結ぶ補助メタデータ保存先。
	AntigravitySidecarDir = "roleplay/history/antigravity_sidecars"
	// AppCacheDir は配布版が管理するキャッシュ保存先。
	// 外部 CLI の認証情報・履歴・OS ホーム配下のキャッシュは対象外にし、削除 API もここだけを触る。
	AppCacheDir = "roleplay/cache"
	// AppBackupDir は配布版が作成するバックアップ保存先。
	// restore は別フェーズ。初期実装ではここに zip を作成し、認証情報や cache は含めない。
	AppBackupDir = "roleplay/backups"
	// AuthDir は WORKSPACE_ROOT 配下の認証ファイル配置場所（配置運用）。
	// 利用者がローカルの認証ファイルをここへ置くと、OS デフォルトより優先して探索する。
	// 秘匿情報のため cache 削除・backup・全文走査の対象から必ず除外する（安全要件§8-2）。
	AuthDir = "roleplay/auth"
	// ComfyUIDir は ComfyUI 連携設定のルート。
	ComfyUIDir = "roleplay/global/ComfyUI"
	// ComfyUIConfigFile は ComfyUI 接続・生成設定の正本。
	ComfyUIConfigFile = ComfyUIDir + "/comfyui_config.json"
	// ComfyUITemplateDir は ComfyUI workflow テンプレートのルート。
	ComfyUITemplateDir = ComfyUIDir + "/templates"
	// ComfyUIProfileDir は生成プロファイル定義（プレースホルダ注入文言セット）のルート。
	// JSON を置くだけで有効になるユーザーデータで、本体は注入文言・照合語彙を内蔵しない。
	ComfyUIProfileDir = ComfyUIDir + "/profiles"
	// ComfyUIPlaceholderPresetDir はプレースホルダプリセット（変換元→変換先の組）の
	// 保存ディレクトリ。「1 プリセット = 1 JSON ファイル」形式で presetstore が扱う。
	// 生成プロファイル（profiles。タグ判定AI連動の機構的注入）とは別系統で、
	// こちらはテスト生成のプレースホルダ直指定を UI から保存・選択するためのもの。
	ComfyUIPlaceholderPresetDir = ComfyUIDir + "/placeholder_presets"
	// ComfyUILoraDirectoriesFile は LoRA ディレクトリ設定の正本。
	ComfyUILoraDirectoriesFile = ComfyUIDir + "/lora_directories.json"
	// ComfyUITagMappingDir は TURNタグとプロンプト/LoRAの対応設定ディレクトリ。
	ComfyUITagMappingDir = ComfyUIDir + "/tag_mappings"
	// ComfyUITagCategoriesFile はタグカテゴリ定義の正本。
	ComfyUITagCategoriesFile = ComfyUITagMappingDir + "/categories.json"
	// ComfyUIDirectiveDanbooruFile は画像生成タグ判定の Danbooru 指示ファイル。
	ComfyUIDirectiveDanbooruFile = ComfyUIDir + "/image_gen_directive.md"
	// ComfyUIDirectiveNaturalFile は画像生成タグ判定の自然文指示ファイル。
	ComfyUIDirectiveNaturalFile = ComfyUIDir + "/image_gen_directive_natural.md"
	// ComfyUIDebugDir は ComfyUI 連携のデバッグ出力ルート。
	ComfyUIDebugDir = ComfyUIDir + "/debug"
	// ComfyUITagJudgeResponsesDir はタグ判定AIの応答ログ格納先。
	ComfyUITagJudgeResponsesDir = ComfyUIDebugDir + "/tag_judge_responses"
	// ComfyUITagExtractionFailuresDir はタグ抽出失敗ログの格納先。
	ComfyUITagExtractionFailuresDir = ComfyUIDebugDir + "/tag_extraction_failures"
)

// ディレクトリ列挙型プリセットのベースディレクトリ。
// いずれも「1 プリセット = 1 JSON ファイル」を並べる形式で、presetstore が扱う。
const (
	// PresetSSRPModeDir は SSRP_Mode プリセット（/api/presets）のディレクトリ。
	PresetSSRPModeDir = "roleplay/global/presets/SSRP_Mode"
	// PresetDateTimeGroupDir は時刻設定グループプリセット（/api/datetime-group-presets）のディレクトリ。
	PresetDateTimeGroupDir = "roleplay/global/presets/SSRP_Mode/datetime"
	// PresetSSRPAllDir は SSRP 全体プリセット（/api/ssrp-all-presets）のディレクトリ。
	PresetSSRPAllDir = "roleplay/global/presets/SSRP_Mode/SSRP_All"
	// PresetSSRPParamDir は SSRP パラメータプリセット（/api/ssrp-param-presets）のディレクトリ。
	PresetSSRPParamDir = "roleplay/global/presets/SSRP_Mode/SSRP_Parameter"
)

// 単一ファイル型プリセットの保存先。
const (
	// DateTimePresetsFile は日付時刻プリセット（/api/datetime-presets）の正本。
	// ディレクトリ列挙型ではなく、このファイル内に presets キーで保持する。
	DateTimePresetsFile = "roleplay/settings/datetime_presets.json"
)

// Parameters（項目設定）系の保存先。
// schema 系はファイル名 ≠ schemaId で、ファイル内容の schemaId を正本に検索する。
const (
	// ParameterSchemaDefaultDir はデフォルト項目設定の保存ディレクトリ。
	// 実ファイルは parameter-schema-default.json（固定名）。
	ParameterSchemaDefaultDir = "roleplay/global/settings"
	// ParameterSchemaDefaultFileName はデフォルト項目設定の固定ファイル名。
	ParameterSchemaDefaultFileName = "parameter-schema-default.json"
	// ParameterSchemaDefaultFile はデフォルト項目設定の正本（Dir + 固定ファイル名）。
	// config-check の検査対象として単一ファイルで参照する。
	ParameterSchemaDefaultFile = ParameterSchemaDefaultDir + "/" + ParameterSchemaDefaultFileName
	// ParameterSchemaCustomDir はカスタム項目設定の保存ディレクトリ。
	// 実ファイルは parameter-schema-<schemaId>.json。
	ParameterSchemaCustomDir = "roleplay/global/parameter_schemas"
	// ParameterNormalModePresetDir は通常モード用パラメータプリセットのディレクトリ。
	// 実ファイルは parameter-presets-<schemaId>.json（中に presets 配列）。
	ParameterNormalModePresetDir = "roleplay/global/presets/Normal_Mode"
)

// Config Editor 系の保存先（config-check が参照する正本）。
const (
	// ConfigEditorTemplateRoot は Config Editor テンプレートのルート。
	// 旧 Node 版の破損綴り「テンプ���ート」には合わせない（configcheck が検出のみ行う）。
	ConfigEditorTemplateRoot = "roleplay/global/templates"
	// ConfigEditorDefaultsFile はデフォルトテンプレート設定ファイル（{categoryId: templateName}）。
	ConfigEditorDefaultsFile = ConfigEditorTemplateRoot + "/_defaults.json"
)

// 静的配信のマウントポイント。
const (
	// CharacterImagesRoute はキャラクター画像の静的配信パス。
	CharacterImagesRoute = "/images/characters"
)

// 外部 CLI 認証ファイルの所在（2026-06-30 本番 Linux 実機確認値・21番§2/§10）。
//
// アプリは中身を読まず「存在するか」だけを見る。値の中身・絶対パスは
// ログ・レスポンス・バックアップ・診断へ出さない（安全要件§8-1）。
// AuthHome* は OS ホーム配下のスラッシュ相対パス（os.UserHomeDir と結合する）。
// AuthWorkspace* は WORKSPACE_ROOT/AuthDir 配下の配置運用パス（OS デフォルトより優先）。
const (
	// AuthHomeGeminiFile は Gemini CLI の OS デフォルト認証ファイル（両 OS 共通）。
	AuthHomeGeminiFile = ".gemini/oauth_creds.json"
	// AuthHomeClaudeFile は Claude Code の OS デフォルト認証ファイル（両 OS 共通）。
	AuthHomeClaudeFile = ".claude/.credentials.json"
	// AuthHomeAntigravityFile は Antigravity CLI の Linux 認証ファイル。
	// Windows は OS 資格ストアのため、この定数は使わない（GOOS 分岐）。
	AuthHomeAntigravityFile = ".gemini/antigravity-cli/antigravity-oauth-token"

	// AuthWorkspaceGeminiFile は配置運用時の Gemini 認証ファイル（AuthDir 相対）。
	AuthWorkspaceGeminiFile = AuthDir + "/gemini/oauth_creds.json"
	// AuthWorkspaceClaudeFile は配置運用時の Claude 認証ファイル（AuthDir 相対）。
	AuthWorkspaceClaudeFile = AuthDir + "/claude/.credentials.json"
	// AuthWorkspaceAntigravityFile は配置運用時の Antigravity 認証ファイル（AuthDir 相対）。
	AuthWorkspaceAntigravityFile = AuthDir + "/antigravity/antigravity-oauth-token"

	// EntitlementTokenFile は支援者 entitlement トークンの保存先（AuthDir 相対。14番 7章）。
	// AuthDir 配下のためバックアップ・キャッシュ削除・全文走査の対象外（安全要件§8-2）。
	EntitlementTokenFile = AuthDir + "/entitlement-token"
	// EntitlementClockFile は時刻巻き戻し検出用の最終検証時刻の保存先（AuthDir 相対。17番）。
	EntitlementClockFile = AuthDir + "/entitlement-clock"
)

// entitlement サーバー（支援状態確認・トークン発行。14番）。
const (
	// EntitlementServerURL は entitlement サーバーのベース URL（本体埋め込み）。
	// URL 自体は秘密ではなく、トークンの正当性は Ed25519 署名検証（公開鍵埋め込み）で
	// 担保するため、差し替えられても偽造トークンは作れない。
	// ※Lightsail 配備時に本番 URL へ確定する（暫定値）。
	// dev ビルドに限り環境変数 ALSLIME_ENTITLEMENT_SERVER で上書き可（ローカル検証用）。
	EntitlementServerURL = "https://entitlement.alslime.app"
)

// ファイルシステムのパーミッション。
const (
	// DirPerm は WORKSPACE_ROOT 配下に作成するディレクトリのパーミッション。
	DirPerm = 0o755
	// FilePerm は WORKSPACE_ROOT 配下に作成するファイルのパーミッション。
	FilePerm = 0o644
)

// AIプロバイダ指示ファイル（設定設定大設定/設定インポートエクスポート_設計.md §8）。
//
// 各 CLI が作業ディレクトリ（= WORKSPACE_ROOT。coreapi.CoreDeps.Cwd）から自動で読む
// 指示ファイル（イメージ.md 原文の「基本指示」の実体。単一ディレクトリを持たず
// ワークスペース内に散在する）。設定ファイルエディタから「書き換えのみ」可能にする
// （新規作成・削除・リネーム不可）。設定パックでは C 分類 Kind
// 「providerInstructions」としてインポート/エクスポート対象
// （2026-07-19 に対象外方針を改定。domain/settingspack カタログ参照）。
const (
	// ProviderInstructionAntigravityFile は Antigravity CLI の指示ファイル。
	// ルート直下の AGENTS.md ではなく .agents/rules/AGENTS.md が実効。
	ProviderInstructionAntigravityFile = ".agents/rules/AGENTS.md"
	// ProviderInstructionClaudeFile は Claude Code の指示ファイル（cwd 直下）。
	ProviderInstructionClaudeFile = "CLAUDE.md"
	// ProviderInstructionGeminiFile は Gemini CLI のプロジェクト指示ファイル（cwd 直下）。
	// .gemini/GEMINI.md はユーザーレベル設定＋認証情報（oauth_creds.json）が同居する
	// ディレクトリのため、アプリからは触らない。
	ProviderInstructionGeminiFile = "GEMINI.md"
)

// 設定パック（設定インポート・エクスポート）。
//
// 設定設定大設定/設定インポートエクスポート_設計.md に基づく。
// パック zip の仕様バージョン・マニフェスト名・安全上限はここへ集約する。
const (
	// SettingsPackManifestFileName はパック zip ルートのマニフェストファイル名。
	SettingsPackManifestFileName = "alslime-pack.json"
	// SettingsPackFormat は現行のパック仕様バージョン。
	// これより大きい packFormat を持つパックは互換性を保証できないため拒否する。
	SettingsPackFormat = 1
	// SettingsPackStructure は現行のワークスペース構造世代
	// （ワークスペース英語化後の構造）。マニフェストへ記録する。
	SettingsPackStructure = "workspace-v2"
	// SettingsPackMaxEntries はパック zip のエントリ数上限（zip 爆弾対策）。
	SettingsPackMaxEntries = 10000
	// SettingsPackMaxTotalBytes はパック展開後の合計サイズ上限（zip 爆弾対策）。
	SettingsPackMaxTotalBytes int64 = 500 << 20
	// SettingsPackMaxUploadBytes はパック zip アップロードの受信サイズ上限。
	SettingsPackMaxUploadBytes int64 = 200 << 20

	// SettingsPackInboxDir は「置くだけ」取り込み（import_inbox）の配置ディレクトリ。
	// パック allowlist のどのルートにも含まれない位置に置き、さらに F 分類
	// （絶対除外）へ登録してパック経由の書き込み（連鎖ロード）を禁止する（設計 §5）。
	SettingsPackInboxDir = "roleplay/import_inbox"
	// SettingsPackInboxProcessedDir は処理済み zip の移動先（再処理防止）。
	SettingsPackInboxProcessedDir = SettingsPackInboxDir + "/processed"
	// SettingsPackInboxLogFile は起動時取り込みの結果ログ。
	SettingsPackInboxLogFile = "roleplay/log/import_inbox.log"
	// SettingsPackInboxMaxPerBoot は1起動あたりの処理数上限。
	// 超過分は inbox に残し、次回起動で処理する。
	SettingsPackInboxMaxPerBoot = 10
	// SettingsPackInboxProcessedMaxAgeSeconds は processed/ 配下の処理済み zip の
	// 保持秒数。起動時取り込みの最後に、これより古い（mtime ベース）ものを削除する
	// （ハウスキーピングは roleplay/temp しか見ないため、掃除はここで行う）。既定 30 日。
	SettingsPackInboxProcessedMaxAgeSeconds = 30 * 24 * 60 * 60

	// SamplePackDownloadTimeoutSeconds は公式サンプルパック取得の HTTP タイムアウト（秒）。
	SamplePackDownloadTimeoutSeconds = 120
)

// SamplePackURLs は公式サンプルパック（同梱用サンプルファイル達作成 01番）の配布 URL。
// 言語コード → GitHub Releases アセット URL。ここに無い言語はサンプル未提供として
// API が 400 を返す（フロントは ja へ寄せて送る）。
// ※公開リポジトリ・Release が未作成のため URL は暫定値。Release 配置時に確定する。
var SamplePackURLs = map[string]string{
	"ja": "https://github.com/Yaki-Mikan/alslime/releases/download/sample-pack/sample-pack-ja.zip",
	"en": "https://github.com/Yaki-Mikan/alslime/releases/download/sample-pack/sample-pack-en.zip",
}

// ハウスキーピング（使い捨て一時ファイルの掃除）のしきい値。
//
// 19_ハウスキーピング設計.md に基づく。RuntimeTempDir 配下の純粋な使い捨て
// 作業ファイルは、最終更新が一定時間より古いものを起動時・定期で削除する。
// しきい値は将来 server-settings から上書きできる余地を残すが、初期実装は定数。
//
// このパッケージは time へ依存させないため秒数で持ち、利用側で time.Duration へ変換する。
const (
	// HousekeepingTempMaxAgeSeconds は RuntimeTempDir 配下の使い捨てファイルの保持秒数。
	// これより古い（mtime ベース）ものを削除対象とする。既定 24 時間。
	HousekeepingTempMaxAgeSeconds = 24 * 60 * 60
	// HousekeepingIntervalSeconds は定期掃除の実行間隔（秒）。既定 1 時間。
	HousekeepingIntervalSeconds = 60 * 60
)
