package app

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/http"
	"path/filepath"
	"strings"
	"sync"
	"time"

	apiprovidersapi "alslime/internal/api/apiproviders"
	"alslime/internal/api/apiresponse"
	charactersapi "alslime/internal/api/characters"
	chatapi "alslime/internal/api/chat"
	"alslime/internal/api/comfyuigate"
	configeditorapi "alslime/internal/api/configeditor"
	configgenapi "alslime/internal/api/configgen"
	filesapi "alslime/internal/api/files"
	i18napi "alslime/internal/api/i18n"
	jobsapi "alslime/internal/api/jobs"
	manualapi "alslime/internal/api/manual"
	modelsapi "alslime/internal/api/models"
	parametersapi "alslime/internal/api/parameters"
	presetsapi "alslime/internal/api/presets"
	sessionapi "alslime/internal/api/session"
	"alslime/internal/api/settings"
	settingspackapi "alslime/internal/api/settingspack"
	sponsorapi "alslime/internal/api/sponsor"
	systemapi "alslime/internal/api/system"
	updateapi "alslime/internal/api/update"
	"alslime/internal/config"
	"alslime/internal/coreapi"
	apiproviderssvc "alslime/internal/domain/apiproviders"
	calendarsvc "alslime/internal/domain/calendar"
	characterssvc "alslime/internal/domain/characters"
	configeditorsvc "alslime/internal/domain/configeditor"
	datetimepresetssvc "alslime/internal/domain/datetimepresets"
	filessvc "alslime/internal/domain/files"
	globalsettingssvc "alslime/internal/domain/globalsettings"
	"alslime/internal/domain/models"
	parameterssvc "alslime/internal/domain/parameters"
	presetssvc "alslime/internal/domain/presets"
	pwasettingssvc "alslime/internal/domain/pwasettings"
	serversettingssvc "alslime/internal/domain/serversettings"
	sessionssvc "alslime/internal/domain/sessions"
	sponsorsvc "alslime/internal/domain/sponsor"
	ssrpsettingssvc "alslime/internal/domain/ssrpsettings"
	updatesvc "alslime/internal/domain/update"
	usermodelssvc "alslime/internal/domain/usermodels"
	i18nsvc "alslime/internal/i18n"
	jobsqueue "alslime/internal/jobs"
	"alslime/internal/module"
	"alslime/internal/process"
	apiprovidersstore "alslime/internal/storage/apiproviders"
	calendarstore "alslime/internal/storage/calendar"
	charfiltersstore "alslime/internal/storage/charfilters"
	configeditorstore "alslime/internal/storage/configeditor"
	datetimepresetsstore "alslime/internal/storage/datetimepresets"
	entitlementstore "alslime/internal/storage/entitlement"
	globalsettingsstore "alslime/internal/storage/globalsettings"
	"alslime/internal/storage/locations"
	parametersstore "alslime/internal/storage/parameters"
	"alslime/internal/storage/paths"
	"alslime/internal/storage/presetstore"
	pwasettingsstore "alslime/internal/storage/pwasettings"
	serversettingsstore "alslime/internal/storage/serversettings"
	ssrpsettingsstore "alslime/internal/storage/ssrpsettings"
	updatesettingsstore "alslime/internal/storage/updatesettings"
	usermodelsstore "alslime/internal/storage/usermodels"
	"alslime/internal/storage/workspacefs"
	"alslime/internal/system/backup"
	"alslime/internal/system/cache"
	"alslime/internal/system/clistatus"
	"alslime/internal/system/configcheck"
	"alslime/internal/system/housekeeping"
	settingspacksys "alslime/internal/system/settingspack"
)

// registerAPIRoutes は API ルートを mux へ登録する。
//
// 骨格段階ではヘルスチェックのみ実装する。各 API カテゴリ
// （chat / session / files / settings / ssrp / parameters / presets /
// configeditor / characters / comfyui / jobs / system）は、対応する
// internal/api 配下のパッケージを実装し次第ここへマウントする。
//
// cfg は起動時確定設定、resolver は WORKSPACE_ROOT 配下の安全なパス解決を
// 各ハンドラへ渡すために保持する。
// 戻り値はサーバーライフサイクルに紐づくバックグラウンドタスクの起動関数
// （Run が別 goroutine で呼び、ctx キャンセルで停止する）。
func registerAPIRoutes(mux *http.ServeMux, cfg *config.Config, resolver *paths.Resolver, requestRestart func(exePath string)) (background func(ctx context.Context)) {
	// 疎通確認用の簡易 health（deprecated）。
	// 正式な診断用 health は GET /api/system/health に統一する（交換日記 25）。
	// この簡易版は配布前まで疎通確認の互換として残すが、フロント・診断画面は
	// /api/system/health だけを見ること。
	mux.HandleFunc("GET "+config.APIPrefix+"/health", func(w http.ResponseWriter, _ *http.Request) {
		_ = apiresponse.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	// 論理ロケーション解決器。物理パス定数を各層へ直接渡さず、論理ID経由で解決する
	// （多言語対応・カスタムパス差し込みの入口）。
	locs := locations.NewResolver()

	// settings 系の軽量 API（workspace, models, settings/global, settings(PWA), SSRP単一ファイル系）。
	globalStore := globalsettingsstore.New(resolver)
	globalSvc := globalsettingssvc.New(globalStore)
	ssrpStore := ssrpsettingsstore.New(resolver)
	ssrpSvc := ssrpsettingssvc.New(ssrpStore)
	pwaStore := pwasettingsstore.New(resolver, locs.MustPath(locations.PWASettingsFile))
	calendarSvc := calendarsvc.New(
		calendarstore.New(resolver, locs.MustPath(locations.CalendarFile)),
		globalStore,
		pwaStore,
	)
	pwaSvc := pwasettingssvc.New(pwaStore).WithCalendarUpdater(calendarSvc)
	serverSettingsSvc := serversettingssvc.New(serversettingsstore.New(resolver, locs.MustPath(locations.ServerSettingsFile)))
	// openai_compat 接続先。カスケード先（usermodels / globalsettings）は
	// 生成順の都合でクロージャ経由の遅延参照にする（実行時には代入済み）。
	var userModelsSvc *usermodelssvc.Service
	apiProvidersSvc := apiproviderssvc.New(
		apiprovidersstore.NewMetaStore(resolver),
		apiprovidersstore.NewSecretStore(resolver),
		resolver,
		newConnectionIDPart,
		apiproviderssvc.CascadeDeps{
			ListUserModelIDsByConnection: func(connectionID string) ([]string, error) {
				return userModelIDsByConnection(userModelsSvc, connectionID)
			},
			RemoveUserModelsByConnection: func(connectionID string) ([]string, error) {
				return removeUserModelsByConnection(userModelsSvc, connectionID)
			},
			DefaultOpenAICompatModel: func() (string, error) {
				return defaultOpenAICompatModel(globalSvc)
			},
			ClearDefaultOpenAICompatModel: func() error {
				return clearDefaultOpenAICompatModel(globalSvc)
			},
			ListUserModelConnectionIDs: func() ([]string, error) {
				return userModelConnectionIDs(userModelsSvc)
			},
		},
	)
	// ユーザー編集のモデル一覧設定（09番）。モデル一覧 API 本体（modelsapi.Register）は
	// 疎通確認が EngineRouter を要するため、チャット実行系の組み立て後にマウントする。
	userModelsSvc = usermodelssvc.New(usermodelsstore.New(resolver), apiProvidersSvc.ConnectionExists)
	// 起動時整合性チェック（孤児 secret／孤児接続別指示の回収）。
	apiProvidersSvc.StartupCheck()
	apiprovidersapi.Register(mux, apiProvidersSvc)
	settings.Register(mux, settings.Deps{
		WorkspaceRoot:  resolver.Root(),
		GlobalSettings: globalSvc,
		SSRPSettings:   ssrpSvc,
		PWASettings:    pwaSvc,
		ServerSettings: serverSettingsSvc,
	})
	i18nService := i18nsvc.New(resolver, locs.MustPath(locations.I18NDir))
	i18napi.Register(mux, i18nService)
	// 同梱操作マニュアルの配信（アプリ内マニュアル表示の読み込み元）。
	manualapi.Register(mux)

	// ディレクトリ列挙型プリセット（統一契約）。
	// 系統ごとに「保存先ロケーション」と「メタ付与方針」だけが異なる。
	// SSRP_Mode / 時刻設定グループはメタなし、SSRP_All / SSRP_Parameter はメタ付与。
	// 保存先は locs（論理ID）経由で解決する。
	newPresetSvc := func(loc locations.Location, meta presetssvc.MetaPolicy) *presetssvc.Service {
		return presetssvc.New(presetstore.New(resolver, locs.MustPath(loc)), meta)
	}
	presetsapi.Register(mux,
		presetsapi.RouteSet{
			Kind:    "presets",
			Service: newPresetSvc(locations.PresetSSRPMode, presetssvc.MetaNone),
		},
		presetsapi.RouteSet{
			Kind:    "datetime-group-presets",
			Service: newPresetSvc(locations.PresetDateTimeGroup, presetssvc.MetaNone),
		},
		presetsapi.RouteSet{
			Kind:    "ssrp-all-presets",
			Service: newPresetSvc(locations.PresetSSRPAll, presetssvc.MetaTimestamps),
		},
		presetsapi.RouteSet{
			Kind:    "ssrp-param-presets",
			Service: newPresetSvc(locations.PresetSSRPParam, presetssvc.MetaTimestamps),
		},
	)

	// 単一ファイル型プリセット（日付時刻）。保存先は datetime_presets.json 内の
	// presets キー。内部構造は異なるが、同じ統一契約 handler に載せる（レビュー10）。
	dtPresetsSvc := datetimepresetssvc.New(
		datetimepresetsstore.New(resolver, locs.MustPath(locations.DateTimePresetsFile)),
	)
	presetsapi.Register(mux,
		presetsapi.RouteSet{Kind: "datetime-presets", Service: dtPresetsSvc},
	)

	// Parameters（項目設定）系。schema 系と preset 系で構造が違うため、
	// 統一プリセット契約ではなく専用 handler に載せる（交換日記 17）。
	paramSchemaStore := parametersstore.NewSchemaStore(
		resolver,
		locs.MustPath(locations.ParameterSchemaDefaultDir),
		locs.MustPath(locations.ParameterSchemaCustomDir),
	)
	paramPresetStore := parametersstore.NewPresetStore(
		resolver,
		locs.MustPath(locations.ParameterNormalModePresetDir),
	)
	paramSvc := parameterssvc.New(paramSchemaStore, paramPresetStore)
	parametersapi.Register(mux, paramSvc)

	// 配布版運用支援（system）。health に加え、config-check / diagnostics（交換日記 38）。
	// 設定ファイル破損の見える化・WORKSPACE 書込可否・旧破損テンプレ検出を担う。
	systemDeps := systemapi.Deps{
		WorkspaceRoot:         resolver.Root(),
		Host:                  cfg.Host,
		Port:                  cfg.Port,
		ChatCLITimeoutSeconds: cfg.ChatCLITimeoutSeconds,
		ConfigCheck:           configcheck.New(resolver),
		CLIStatus:             clistatus.New(workspaceAuthPaths(resolver), apiProvidersSvc.HasEnabledConnection),
		Cache:                 cache.New(resolver),
		Backup:                backup.New(resolver),
	}

	// ジョブキュー / AIプロセス同時実行制御（交換日記 42）。
	// Chat / Regenerate / ImageGenerate はそれぞれ専用 Runner へ接続する。
	procManager := process.NewManager()
	if limits, ok := loadAIProcessLimits(globalSvc); ok {
		procManager.UpdateLimits(limits)
	}
	sessionSvc := sessionssvc.New(resolver)
	// プロンプト層の言語解決（uiLanguage 連動）。送信のたびに現在の設定で解決される。
	promptLocale := func() coreapi.PromptLocale {
		return resolvePromptLocale(i18nService, pwaSvc)
	}
	// 支援者 entitlement トークンの保存（14番 7章の TokenStore）と
	// 時刻巻き戻し検出の記録（17番の緩和策）。署名検証・tier 判定・巻き戻り判定は
	// core 側 gate（featuresimpl）が担う。
	entitlementSvc := entitlementstore.New(resolver.Root())
	entitlementClock := entitlementstore.NewClock(resolver.Root())
	// 行動選択肢サイドカー（支援者向け）: モジュール実行バイナリが配置されていれば
	// チャット送受信フック（ChatHook）としてサイドカーへ委譲する。ゲート判定は
	// フック実装（ChoiceHook）が実行時に先評価する（core 組み立て後に SetGate）。
	choiceMgr := module.NewManager(module.Config{
		ExePath:   module.ExePath(resolver.Root(), module.ModuleActionChoice),
		Workspace: resolver.Root(),
		Token:     entitlementSvc.Current,
	})
	var choiceHook *module.ChoiceHook
	var chatHook coreapi.ChatHook
	if choiceMgr.Available() {
		choiceHook = module.NewChoiceHook(choiceMgr, featureToggleReader(globalSvc, "actionChoice"))
		chatHook = choiceHook
	}
	// core 実装一式の組み立て（12番 3.2）。結線は corebuild_full / corebuild_stub の
	// ビルドタグ切替（12番 6章）。core 側パッケージへの直 import はここには置かない。
	core := newCore(coreapi.CoreDeps{
		Cwd:          resolver.Root(),
		Resolver:     resolver,
		Sessions:     sessionSvc,
		Schemas:      paramSvc,
		Replacements: ssrpSvc,
		Files:        workspacefs.New(resolver),
		Calendar:     calendarSvc,
		PromptLocale: promptLocale,
		DefaultModel: func(modelType sessionssvc.ModelType) string {
			return defaultModelFromSettings(globalSvc, string(modelType))
		},
		ResolveGeminiExe:      resolveGeminiExecutable(serverSettingsSvc),
		ResolveClaudeExe:      resolveClaudeExecutable(serverSettingsSvc),
		ResolveAntigravityExe: resolveAntigravityExecutable(serverSettingsSvc),
		ExtraAliases:          geminiExtraAliases(userModelsSvc),
		NewID:                 newJobID,
		CLITimeout:            time.Duration(cfg.ChatCLITimeoutSeconds) * time.Second,
		EntitlementToken:      entitlementSvc.Current,
		EntitlementClock:      entitlementClock,
		ChatHook:              chatHook,
		// openai_compat の解決 2 口。Target は chatflow が
		// Request 構築直前に、Connection（キー含む）は Engine が実行直前に呼ぶ。
		ResolveAPIRequestTarget: func(modelID string) (coreapi.APIRequestTarget, error) {
			return resolveAPIRequestTarget(userModelsSvc, apiProvidersSvc, modelID)
		},
		ResolveAPIConnection: apiProvidersSvc.ResolveConnectionInfo,
	})
	// フックのゲートは core の gate 実装を注入する（ゲート先評価。設計 3.4）。
	if choiceHook != nil {
		choiceHook.SetGate(core.Features())
	}
	chatRunner := core.ChatRunner()
	// system の Features は core の gate 実装（12番 3.3）。core 組み立て後に登録する。
	systemDeps.Features = core.Features()
	systemapi.Register(mux, systemDeps)
	// 設定パック管理は支援者モジュール付属パックと通常インポートで共有する。
	packManager := settingspacksys.New(resolver)
	packInbox := settingspackapi.NewInboxState()
	// 支援者機能（Phase D-3）: ログイン導線・状態取得・refresh。
	// トークンの署名検証は gate（core）に閉じ、sponsor はフローと保存判断だけを持つ。
	sponsorSvc := sponsorsvc.New(entitlementSvc, core.Features(), entitlementClock)
	// 開発者お知らせ（作業予定14番）: ログイン完了時・refresh 時にサーバーから
	// UI 言語に応じた文言を取得し、次に取り直すまで保持して Status で返す。
	sponsorSvc.ConfigureNotice(entitlementstore.NewNoticeStore(resolver.Root()), func() string {
		if settings, err := pwaSvc.Get(); err == nil {
			if lang, _ := settings["uiLanguage"].(string); lang != "" {
				return lang
			}
		}
		return ""
	})
	sponsorapi.Register(mux, sponsorSvc)
	// ComfyUI 実行モードの決定（12番 Phase B）: モジュール exe が配置されていれば
	// サイドカーモード（プロキシ + RPC）、無ければ従来の in-process モード。
	moduleMgr := module.NewManager(module.Config{
		ExePath:   module.ExePath(resolver.Root(), module.ModuleComfy),
		Workspace: resolver.Root(),
		Token:     entitlementSvc.Current,
	})
	sidecarMode := moduleMgr.Available()
	// 配布ビルド（in-process 供給なし）でモジュール未配置のまま起動した場合の
	// 初回導入用結線。プロキシルートの後付け登録はルート組み立て部で代入し、
	// 生存管理 ctx は background 起動時（listen 開始前）に確定する。
	var registerComfyProxyLate func()
	var moduleRunCtx context.Context
	// モジュール取得（14番 6章の本体側受け口。複数モジュール対応）: レジストリの
	// 全モジュールの配置先・起動状態と、署名検証（core に閉じた埋め込み鍵）を
	// sponsor サービスへ注入する。
	moduleTargets := make(map[string]sponsorsvc.ModuleTarget)
	for _, def := range module.Definitions() {
		target := sponsorsvc.ModuleTarget{
			InstallPath: module.ExePath(resolver.Root(), def.ID),
			ReceiptPath: module.ReceiptPath(resolver.Root(), def.ID),
		}
		// 起動状態は接続先が解決済みかの実測を都度返す（初回導入の自動起動や
		// 更新の起こし直しを一覧へ即時反映する）。
		switch def.ID {
		case module.ModuleComfy:
			target.Active = func() bool { return moduleMgr.BaseURL() != nil }
		case module.ModuleActionChoice:
			hooked := choiceHook != nil
			target.Active = func() bool { return hooked && choiceMgr.BaseURL() != nil }
		}
		// 配置後のプロセス起動。起動中の更新は起こし直し、未配置起動からの
		// 初回導入はプロキシ登録＋初回起動で、どちらも本体再起動なしで有効化する
		//（in-process 供給ビルドの ComfyUI はサイドカーを使わないため対象外）。
		if def.ID == module.ModuleComfy {
			if sidecarMode {
				target.Restart = moduleMgr.Restart
			} else if !core.Comfy().InProcess() {
				target.Restart = func() error {
					if registerComfyProxyLate == nil || moduleRunCtx == nil {
						return errors.New("comfyui sidecar start deps not ready")
					}
					registerComfyProxyLate()
					return moduleMgr.StartInstalled(moduleRunCtx)
				}
			}
		}
		if def.ID == module.ModuleActionChoice && choiceHook != nil {
			target.Restart = choiceMgr.Restart
		}
		if def.CompanionPack {
			// クリーン再導入がレシートのテンプレート名から削除先を組み立てる（01番 7章）。
			target.WorkflowTemplateDir = filepath.Join(resolver.Root(), filepath.FromSlash(config.ComfyUITemplateDir))
			target.InstallCompanionPack = func(zipPath string) ([]string, error) {
				result, err := packManager.Import(zipPath, settingspacksys.ImportOptions{
					Policy:           settingspacksys.PolicySkip,
					ImageGenAllowed:  true,
					NoForceOverwrite: true,
				})
				if err != nil {
					return nil, err
				}
				return settingspacksys.ComfyUIWorkflowTemplateNames(result), nil
			}
		}
		moduleTargets[def.ID] = target
	}
	sponsorSvc.ConfigureModules(module.IDs(), moduleTargets, core.VerifyModuleSig)
	// アップデート確認 API（ファイル自動更新、確認 01番）: 本体は GitHub Releases、
	// モジュールは entitlement サーバーの一括インデックスで更新有無を返す。
	updateSvc := updatesvc.New(updatesettingsstore.New(resolver, locs.MustPath(locations.UpdateSettingsFile)))
	updateapi.Register(mux, updateapi.Deps{Update: updateSvc, Sponsor: sponsorSvc})
	var imageRunner jobsqueue.Runner
	if sidecarMode || !core.Comfy().InProcess() {
		// サイドカー委譲（未起動なら実行時に接続先未解決エラー）。配布ビルドは
		// 初回導入の自動起動後、本体再起動なしでジョブが通る。
		imageRunner = module.ImageRunner{Manager: moduleMgr}
	} else {
		imageRunner = core.Comfy().ImageRunner()
	}
	// 設定ファイル自動作成（config-generate）: 進捗シンクは Queue 生成後に確定する
	// クロージャで渡す（実行時には jobQueue が必ず組み立て済み）。
	var jobQueue *jobsqueue.Queue
	configGenRunner := core.ConfigGenRunner(func(jobID string, entry jobsqueue.ProgressEntry) {
		jobQueue.AppendProgress(jobID, entry)
	})
	jobRunner := jobsqueue.CompositeRunner{
		jobsqueue.TypeChat:       chatRunner,
		jobsqueue.TypeRegenerate: chatRunner,
		jobsqueue.TypeImageGen:   imageRunner,
		jobsqueue.TypeConfigGen:  configGenRunner,
	}
	jobQueue = jobsqueue.NewQueue(procManager, jobRunner, newJobID)
	// 本体の直接アップデート（01番 5章）: 適用開始と同時にジョブ投入を停止し
	//（実行中ジョブがあれば開始を拒否）、入れ替え完了後の再起動は Server
	//（requestRestart）へ依頼する（交換日記 005-2）。
	updateSvc.ConfigureApply(updatesvc.ApplyDeps{
		Resolver:         resolver,
		BeginMaintenance: jobQueue.BeginMaintenance,
		EndMaintenance:   jobQueue.EndMaintenance,
		RequestRestart:   requestRestart,
	})
	jobsapi.Register(mux, jobsapi.Deps{
		Queue:   jobQueue,
		Process: procManager,
		Limits:  globalSvc,
	})
	chatapi.Register(mux, chatapi.Deps{
		Queue: jobQueue,
	})
	configgenapi.Register(mux, configgenapi.Deps{
		Queue:    jobQueue,
		Resolver: resolver,
	})
	// モデル一覧の正本まわり（一覧・ユーザー編集・疎通確認。09番）。
	// 疎通確認の呼び出し口は chatflow.Engine（EngineRouter）そのもの。
	modelsapi.Register(mux, modelsapi.Deps{
		UserModels:       userModelsSvc,
		Checker:          core.EngineRouter(),
		Timeout:          time.Duration(cfg.ChatCLITimeoutSeconds) * time.Second,
		NewPingSessionID: newJobID,
		// openai_compat の疎通確認は保存を伴わない最小チャット要求で
		// 選択モデルの生成可否を確認する。Target 解決はチャット本体と同じ実体。
		ResolveAPITarget: func(modelID string) (coreapi.APIRequestTarget, error) {
			return resolveAPIRequestTarget(userModelsSvc, apiProvidersSvc, modelID)
		},
		APIConnectionLabel: func(connectionID string) (string, bool, error) {
			connection, ok, err := apiProvidersSvc.Get(connectionID)
			return connection.Label, ok, err
		},
	})
	sessionapi.Register(mux, sessionapi.Deps{
		Sessions:      sessionSvc,
		Queue:         jobQueue,
		NativeSweeper: core.NativeSweeper(),
		Sidecars:      core.SidecarRemover(),
	})

	// Files / Content（汎用 WORKSPACE ファイル操作）。境界確認は paths.Resolver 正本。
	filesapi.Register(mux, filessvc.New(workspacefs.New(resolver)))

	// Character 基本データ（キャラリスト走査・フィルタ集約）。Files とは責務を分ける。
	charactersapi.Register(mux, characterssvc.New(
		charfiltersstore.New(resolver, config.CharacterListDir, config.CharacterFiltersFile),
	))
	charactersapi.RegisterImages(mux, characterssvc.NewImageService(resolver))

	// Config Editor（設定編集 UI 用のカテゴリ別ファイル/テンプレート CRUD）。
	// カテゴリ定義の正本は domain、保存先解決・境界確認は storage（paths.Resolver）。
	// gate はタグ判定指示ファイル（D 分類。設計 §9）の tier 判定に使う。
	configeditorapi.Register(mux, configeditorsvc.New(configeditorstore.New(resolver)), core.Features())

	// 設定パック（設定インポート・エクスポート。設定設定大設定/設定インポートエクスポート_設計.md）。
	// 分類の正本は domain/settingspack、zip 入出力は system/settingspack。
	// 画像生成系（D 分類）の可否は core の gate で判定する。
	settingspackapi.Register(mux, settingspackapi.Deps{
		Manager: packManager,
		Gate:    core.Features(),
		Inbox:   packInbox,
	})

	// ComfyUI（Phase 13 / 12番 Phase C）。
	// サイドカーモード: generate-from-chat（ジョブ投入）以外をモジュールへプロキシ（comfyuigate）。
	// in-process モード: core 供給のルート一式を登録（従来動作）。
	// どちらでもない（配布ビルドで未配置のまま起動）: 初回導入の成功時に一度だけ
	// プロキシを登録し、本体再起動なしで有効化する。
	registerComfyProxy := func() {
		comfyuigate.RegisterProxy(mux, comfyuigate.Deps{
			Gate:         core.Features(),
			Queue:        jobQueue,
			TagJudgeKind: core.Comfy().TagJudgeKind,
			Module:       moduleMgr,
		})
	}
	switch {
	case sidecarMode:
		registerComfyProxy()
	case core.Comfy().InProcess():
		core.Comfy().RegisterRoutes(mux, jobQueue, core.Features())
	default:
		// ServeMux は配信中の登録も並行安全だが、二重登録は panic するため Once で括る。
		var once sync.Once
		registerComfyProxyLate = func() { once.Do(registerComfyProxy) }
	}

	// 残る大きな未完了は、ComfyUI実生成疎通、実CLI疎通確認、
	// フロント統合・配布前確認。画像cropは PNG/JPEG の実処理まで接続済み。

	// サーバーライフサイクルに紐づくバックグラウンドタスク。
	// 終端ジョブの定期掃除（AI応答全文を含む Job の無限蓄積防止。02調査 高#1）と、
	// 使い捨て一時ファイル + ネイティブ履歴のハウスキーピング（起動時掃除 + 定期掃除。
	// ネイティブ掃除の実装は core 側のため、組み立てが可能な本関数で合成する）。
	housekeeper := housekeeping.New(resolver, core.NativeSweeper())
	return func(ctx context.Context) {
		// サイドカー初回起動（StartInstalled）の生存管理 ctx。listen 開始前に
		// 確定するため、API 経由の初回導入時には必ず設定済み。
		moduleRunCtx = ctx
		go jobQueue.RunCleanup(ctx)
		go housekeeper.Run(ctx)
		// import_inbox の起動時取り込み（設計 §5）。起動時に1回だけ実行し、
		// 常駐監視はしない。結果は InboxState 経由で /api/settings-pack/inbox が返す。
		go settingspackapi.RunInbox(packInbox, packManager, core.Features())
		// entitlement トークンの定期 refresh（exp 前の前倒し再取得・grace 復帰）。
		go sponsorSvc.RunAutoRefresh(ctx)
		// サイドカー更新の待避残骸（modules/*.old）の起動時掃除（01番 6.3）。
		go module.CleanupStaleFiles(resolver.Root())
		// 一括全更新でユーザーが承認済みのモジュール更新の適用（本体更新後の
		// 起動時に一度だけ。承認記録が無ければ何もしない。適用後は InstallModule
		// 内のサイドカー再起動で有効化され、進行状態は /api/update/status が返す）。
		updateSvc.RunApprovedModuleUpdates(ctx, func(ctx context.Context, id string) error {
			_, err := sponsorSvc.InstallModule(ctx, id)
			return err
		})
		// 本体更新の入れ替え残骸（alslime.exe.old / .new）の起動時掃除（01番 5.1）。
		go updateSvc.CleanupStagedBinaries()
		if sidecarMode {
			go moduleMgr.Run(ctx)
		}
		if choiceHook != nil {
			go choiceMgr.Run(ctx)
		}
	}
}

// featureToggleReader は globalsettings の featureToggles から機能のON/OFFを
// 都度読みするクロージャを返す（設計: モジュール基盤複数対応 6章）。
// 既定は有効: キー無し・設定読込失敗・型不一致は true（明示 false のときだけ無効）。
func featureToggleReader(svc *globalsettingssvc.Service, key string) func() bool {
	return func() bool {
		settings, err := svc.Get()
		if err != nil {
			return true
		}
		raw, ok := settings["featureToggles"].(map[string]any)
		if !ok {
			return true
		}
		enabled, ok := raw[key].(bool)
		if !ok {
			return true
		}
		return enabled
	}
}

// loadAIProcessLimits は globalsettings の aiProcessLimits を process.Limits へ読む。
//
// 無い・不正な場合は ok=false（呼び出し側は既定値のまま）。
// JSON 数値は float64 で入るため変換する。
func loadAIProcessLimits(svc *globalsettingssvc.Service) (process.Limits, bool) {
	settings, err := svc.Get()
	if err != nil {
		return process.Limits{}, false
	}
	raw, ok := settings["aiProcessLimits"].(map[string]any)
	if !ok {
		return process.Limits{}, false
	}
	num := func(key string, fallback int) int {
		if v, ok := raw[key].(float64); ok {
			return int(v)
		}
		return fallback
	}
	def := process.DefaultLimits()
	return process.Limits{
		Global:       num("global", def.Global),
		Gemini:       num("gemini", def.Gemini),
		Claude:       num("claude", def.Claude),
		Antigravity:  num("antigravity", def.Antigravity),
		OpenAICompat: num("openai_compat", def.OpenAICompat),
	}, true
}

// resolvePromptLocale は UI 言語設定（uiLanguage）に対応するプロンプト層の
// 言語解決コンテキスト（prompt.* キーを含む i18n カタログ）を返す。
// 設定・辞書の取得に失敗した場合は空（呼び出し側が日本語既定へフォールバック）。
//
// 必ず LoadPrompt（fallback 補完なし）を使うこと。Load（UI 辞書）を使うと
// 内蔵 ja に無い prompt.* キーが内蔵 en から補完され、コード内日本語既定への
// フォールバックが発動しなくなる（セリフ引用符が "" になった不具合の原因）。
func resolvePromptLocale(i18nService *i18nsvc.Service, pwaSvc *pwasettingssvc.Service) coreapi.PromptLocale {
	lang := ""
	if settings, err := pwaSvc.Get(); err == nil {
		lang, _ = settings["uiLanguage"].(string)
	}
	catalog, err := i18nService.LoadPrompt(lang)
	if err != nil {
		return coreapi.PromptLocale{Lang: lang}
	}
	return coreapi.PromptLocale{Lang: catalog.Lang, Messages: catalog.Messages}
}

// defaultModelFromSettings は globalsettings の defaultModels からプロバイダ毎の
// デフォルトモデルIDを読む。無い・不正な場合は空（CLI 既定に任せる）。
func defaultModelFromSettings(svc *globalsettingssvc.Service, modelType string) string {
	settings, err := svc.Get()
	if err != nil {
		return ""
	}
	raw, ok := settings["defaultModels"].(map[string]any)
	if !ok {
		return ""
	}
	model, _ := raw[modelType].(string)
	return strings.TrimSpace(model)
}

// geminiExtraAliases はユーザー定義 Thinking エイリアス（user-models.json 由来）を
// 境界の中立表現（coreapi.ThinkingAlias）へ変換して返す関数を作る（09番 5章）。
//
// providers/gemini（core 行き）が usermodels（公開）を直接 import しないよう、
// 変換はこの組み立て層で行う。読み込み失敗時は空を返し、送信自体は止めない。
func geminiExtraAliases(svc *usermodelssvc.Service) func() map[string]coreapi.ThinkingAlias {
	return func() map[string]coreapi.ThinkingAlias {
		aliases, err := svc.GeminiAliases()
		if err != nil {
			return nil
		}
		out := make(map[string]coreapi.ThinkingAlias, len(aliases))
		for id, alias := range aliases {
			out[id] = coreapi.ThinkingAlias{BaseModel: alias.BaseModel, Level: alias.Level}
		}
		return out
	}
}

// newJobID はジョブ ID を生成する（job_<16進16文字>）。
// 外部依存を増やさないため crypto/rand を使う。
func newJobID() string {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		// 乱数取得失敗は極めて稀。時刻ベースで最低限の一意性を確保する。
		return "job_" + hex.EncodeToString([]byte(time.Now().Format("150405.000000")))
	}
	return "job_" + hex.EncodeToString(b[:])
}

// newConnectionIDPart は openai_compat 接続先 ID の識別子片を生成する
// （newJobID と同系の暗号学的生成器。hex のため文字集合は [0-9a-f]。
// "conn-" 前置は domain/apiproviders 側が行う）。
func newConnectionIDPart() string {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return hex.EncodeToString([]byte(time.Now().Format("150405.000000")))
	}
	return hex.EncodeToString(b[:])
}

// userModelIDsByConnection は接続先を参照するユーザーモデル ID を列挙する
// （削除カスケードの dryRun 用）。
func userModelIDsByConnection(svc *usermodelssvc.Service, connectionID string) ([]string, error) {
	data, err := svc.Get()
	if err != nil {
		return nil, err
	}
	ids := []string{}
	for _, m := range data.Added {
		if m.ConnectionID == connectionID {
			ids = append(ids, m.ID)
		}
	}
	return ids, nil
}

// removeUserModelsByConnection は該当接続先のユーザーモデル行を削除する
// （usermodels.Update 経由で SetUserKinds 同期を維持。冪等）。
func removeUserModelsByConnection(svc *usermodelssvc.Service, connectionID string) ([]string, error) {
	data, err := svc.Get()
	if err != nil {
		return nil, err
	}
	removed := []string{}
	kept := data.Added[:0:0]
	for _, m := range data.Added {
		if m.ConnectionID == connectionID {
			removed = append(removed, m.ID)
			continue
		}
		kept = append(kept, m)
	}
	if len(removed) == 0 {
		return removed, nil
	}
	data.Added = kept
	if _, err := svc.Update(data); err != nil {
		return nil, err
	}
	return removed, nil
}

// userModelConnectionIDs はユーザーモデルが参照する全接続先 ID を返す
// （起動時整合性チェックの宙吊り検出用）。
func userModelConnectionIDs(svc *usermodelssvc.Service) ([]string, error) {
	data, err := svc.Get()
	if err != nil {
		return nil, err
	}
	ids := []string{}
	for _, m := range data.Added {
		if m.ConnectionID != "" {
			ids = append(ids, m.ConnectionID)
		}
	}
	return ids, nil
}

// resolveAPIRequestTarget は openai_compat モデル ID から送信先を解決する
// （CoreDeps.ResolveAPIRequestTarget の実体）。
//
// UserModel の公開側正本（usermodels）と接続先メタデータを参照し、
// 不存在・接続先無効は *coreapi.ProviderFailure で返す（普通の error だと
// chatflow で一律 provider_execution_error に潰れるため）。
func resolveAPIRequestTarget(userModelsSvc *usermodelssvc.Service, apiProvidersSvc *apiproviderssvc.Service, modelID string) (coreapi.APIRequestTarget, error) {
	unavailable := func() error {
		return &coreapi.ProviderFailure{
			Type:       coreapi.APIErrorConnectionUnavailable,
			MessageKey: i18nsvc.KeyChatErrorAPIConnectionUnavailable,
		}
	}
	connectionID, remoteModelID, ok := models.ParseOpenAICompatID(strings.TrimSpace(modelID))
	if !ok {
		return coreapi.APIRequestTarget{}, unavailable()
	}
	data, err := userModelsSvc.Get()
	if err != nil {
		return coreapi.APIRequestTarget{}, unavailable()
	}
	found := false
	for _, m := range data.Added {
		if m.ID == strings.TrimSpace(modelID) {
			found = true
			break
		}
	}
	if !found {
		return coreapi.APIRequestTarget{}, unavailable()
	}
	conn, ok, err := apiProvidersSvc.Get(connectionID)
	if err != nil || !ok || !conn.Enabled {
		return coreapi.APIRequestTarget{}, unavailable()
	}
	// Preset は保存正本の値をカタログで再検証してから返す。破損・手編集等で
	// 不正値が正本へ入っていた場合、固定プリセット指示を黙って省略せず、
	// 構成不備として送信前に明示エラーで止める。
	if _, ok := apiproviderssvc.PresetByID(conn.Preset); !ok {
		return coreapi.APIRequestTarget{}, &coreapi.ProviderFailure{
			Type:       coreapi.APIErrorInternalError,
			MessageKey: i18nsvc.KeyChatErrorAPIInternalError,
		}
	}
	return coreapi.APIRequestTarget{
		ConnectionID:  connectionID,
		RemoteModelID: remoteModelID,
		Preset:        conn.Preset,
	}, nil
}

// defaultOpenAICompatModel は defaultModels["openai_compat"] の現在値を返す。
func defaultOpenAICompatModel(svc *globalsettingssvc.Service) (string, error) {
	settings, err := svc.Get()
	if err != nil {
		return "", err
	}
	dm, ok := settings["defaultModels"].(map[string]any)
	if !ok {
		return "", nil
	}
	v, _ := dm["openai_compat"].(string)
	return v, nil
}

// clearDefaultOpenAICompatModel は defaultModels["openai_compat"] を空にする。
// Merge は浅いマージのため、defaultModels マップ全体を読み替えて書き戻す
// （他 provider の既定値を消さない）。
func clearDefaultOpenAICompatModel(svc *globalsettingssvc.Service) error {
	settings, err := svc.Get()
	if err != nil {
		return err
	}
	dm, ok := settings["defaultModels"].(map[string]any)
	if !ok {
		dm = map[string]any{}
	}
	dm["openai_compat"] = ""
	_, err = svc.Update(map[string]any{"defaultModels": dm})
	return err
}
