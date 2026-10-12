/**
 * Chat.tsx - チャット画面メインコンポーネント
 * 
 * アプリケーションのメイン画面。
 * ロジックは useChat / useSession フックに移譲し、
 * UIは MessageList / MessageInput 等のサブコンポーネントに移譲している。
 * このファイルはこれらを統合し、レイアウトとモーダル管理を担当する。
 */

import React, { useState, useEffect } from 'react';
import { MessageSquare, History, Package, Settings, X } from 'lucide-react';
import axios from '../lib/axios';

// Components
import { Sheet } from './ui';
import { CharacterStatusPanel } from './CharacterStatusPanel';
import { SessionTimePanel } from './SessionTimePanel';
import { UpdateModal } from './UpdateModal';
import type { LeaveGuard, SettingsCategory } from './settings/SettingsView';
import { DEFAULT_SETTINGS, normalizeSettings } from '../types/Settings';
import type { Settings as SettingsType } from '../types/Settings';
import { useAppearance } from '../hooks/useAppearance';
import { JobProgressModal } from './JobProgressModal';
import type { MaterialRequest } from './material/MaterialView';
import { TagJudgeWorkflowDrawerPanel } from './comfyui/TagJudgeWorkflowDrawerPanel';
import { ImageGenDrawerControls } from './comfyui/ImageGenDrawerControls';
import { ApiServiceBalancePanel } from './comfyui/apiservice/ApiServiceBalancePanel';
import type { BackendSelection } from './comfyui/BackendTabs';
import { TTSDrawerPanel } from './tts/TTSDrawerPanel';
import { FEATURE_COMFYUI, FEATURE_TTS, isFeatureEnabled, isImageGenAvailable } from '../constants/features';
import { MODULE_COMFY, MODULE_TTS } from '../api/sponsor';
import { useComfyModuleActive } from '../hooks/useComfyModuleActive';
import { useTTSModuleActive } from '../hooks/useTTSModuleActive';
import { getTTSEmojiList } from '../api/tts';
import { MessageList } from './chat/MessageList';

import { MessageInput } from './chat/MessageInput';
import { ChatHeader } from './chat/ChatHeader';
import { ChatEmptyState } from './chat/ChatEmptyState';
import { HistoryView } from './history/HistoryView';
import { NavRail, TabBar, type AppNavItem } from './shell/AppNav';
import { modelTypeForNewSession, resolveRestoredModelSelection } from './chat/sessionModelRestore';
import { extractCharacterDirectoryName, extractSettingName } from './chat/characterImagePath';
import { isCharacterSetDifferent, isSSRPConfigDifferent } from './chat/ssrpDiff';
import { mergeResponseAdvancedSettings } from './chat/responseAdvancedSettings';
import { RolePlaySettings } from './SSRP/RolePlaySettings';
import type { RolePlaySettingsHandlers } from './SSRP/RolePlaySettings';
import { getGlobalSettings } from '../api/global-settings';
import { applySSRPSettingsToSession } from '../api/ssrp';
import {
    CHAT_VIEW_I18N_KEYS,
    CHAT_VIEW_TEXT_FALLBACK_JA,
    COMMON_I18N_KEYS,
    COMMON_TEXT_FALLBACK_JA,
    DEFAULT_UI_LANGUAGE,
    UPDATE_I18N_KEYS,
    UPDATE_TEXT_FALLBACK_JA
} from '../constants/i18n';
import {
    fetchI18NCatalog,
    joinNames,
    resolveMessage,
    type I18NCatalog
} from '../api/i18n';
import { BACKEND_URL } from '../api/base-url';
import { fetchSystemHealth } from '../api/system';
import {
    fetchUpdateApplyStatus,
    fetchUpdateCheck,
    saveUpdateSettings,
    type AppUpdateInfo,
    type ModuleUpdateEntry,
} from '../api/update';

// Hooks
import { useChat } from '../hooks/useChat';
import { useSession } from '../hooks/useSession';
import { useTempCharacterImport } from '../hooks/useTempCharacterImport';
import { usePullToReload } from '../hooks/usePullToReload';
import { lazyWithReload, registerBeforeLazyReload } from '../lib/lazyWithReload';
import {
    clearLazyReloadRecovery,
    readLazyReloadRecovery,
    saveLazyReloadRecovery,
} from '../lib/lazyReloadRecovery';
import { ReloadBoundary } from './ReloadBoundary';

const DEFAULT_SSRP_LANGUAGE = 'ja';

interface ChatProps {
    // ローカル実行版（認証なし）では渡されない。未指定なら設定画面のログアウトボタンも出ない。
    onLogout?: () => void;
}

const cloneSSRPConfig = (config: any) => config ? JSON.parse(JSON.stringify(config)) : null;

const SettingsView = lazyWithReload(() => import('./settings/SettingsView'));
const MaterialView = lazyWithReload(() => import('./material/MaterialView'));

export const Chat: React.FC<ChatProps> = ({ onLogout }) => {
    // 更新で遅延読込ファイルが入れ替わり再読み込みした場合、直前の画面と未反映の
    // 準備・調整内容を引き継ぐ。通常の画面切替ではこの保存先を使用しない。
    const [lazyReloadRecovery] = useState(() => readLazyReloadRecovery());
    const hasAppliedLazyRecoveryRef = React.useRef(!lazyReloadRecovery?.ssrpSettings);
    const hasLoadedRecoveredViewRef = React.useRef(lazyReloadRecovery?.activeView !== 'material');
    // UI State (ローカル)
    // セッション状態ドロワー（ヘッダー左のハンバーガーメニューから開く）
    // 表示中の画面。素材づくり・設定は画面ができるまで今の窓を開く
    const [activeView, setActiveView] = useState<'chat' | 'history' | 'settings' | 'material'>(
        () => lazyReloadRecovery?.activeView ?? 'chat',
    );
    // 設定画面を開いたときに見せる分類（入力欄の「モデル設定を開く」は AI と接続）
    const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>(
        () => lazyReloadRecovery?.settingsCategory ?? 'general',
    );
    // 設定画面から別の画面へ移る前に、保存していない変更を確かめる関所
    const settingsLeaveGuardRef = React.useRef<LeaveGuard | null>(null);
    const registerSettingsLeaveGuard = React.useCallback((guard: LeaveGuard | null) => {
        settingsLeaveGuardRef.current = guard;
    }, []);
    const [isStatusDrawerOpen, setIsStatusDrawerOpen] = useState(false);
    const [isQuickSettingsOpen, setIsQuickSettingsOpen] = useState(false);
    // チャット欄のモデル選択右のアイコンボタンから直接開くAIモデル設定モーダル
    const [isJobProgressOpen, setIsJobProgressOpen] = useState(false);
    const [runningJobCount, setRunningJobCount] = useState(0);

    const [isRolePlaySettingsOpen, setIsRolePlaySettingsOpen] = useState(
        () => lazyReloadRecovery?.prepareOpen ?? false,
    );
    // 素材づくりへの依頼（どのタブ・どのファイルで開くか）。受け取ったら消す
    const [materialRequest, setMaterialRequest] = useState<MaterialRequest | null>(
        () => lazyReloadRecovery?.materialRequest ?? null,
    );
    // 素材づくりは一度開いたら隠すだけにする（設定自動生成の進み具合の読み取りを続けるため）
    const [isMaterialMounted, setIsMaterialMounted] = useState(
        () => lazyReloadRecovery?.activeView === 'material',
    );

    // 設定 State
    const [settings, setSettings] = useState<SettingsType>(DEFAULT_SETTINGS);
    useAppearance(settings);
    const [chatBackgroundUrl, setChatBackgroundUrl] = useState<string | null>(null);

    // SSRP設定リセット用キー
    const [ssrpResetKey, setSsrpResetKey] = useState(0);
    // 現在のセッションのSSRP設定（復元用）
    const [currentSessionConfig, setCurrentSessionConfig] = useState<any>(null);
    // 読み上げ開始時に同梱する会話設定側VoiceDesign。保存キー（キャラ.mdパス）を
    // TURN のキャラクター名（ファイル名から拡張子を除いたもの）へ変換して渡す（要件6.5）。
    const getTTSPresetVoiceDesign = React.useCallback(() => {
        const byPath = currentSessionConfig?.voiceDesignByCharacter as Record<string, { mode: 'append' | 'replace'; text: string }> | undefined;
        if (!byPath) return undefined;
        const byName: Record<string, { mode: 'append' | 'replace'; text: string }> = {};
        for (const [charPath, value] of Object.entries(byPath)) {
            if (!value) continue;
            // 追記モードで本文が空のものは効果が無いため送らない（置換の空は「キャプション無し」の意味を持つ）。
            if (value.mode !== 'replace' && !value.text?.trim()) continue;
            const name = charPath.split('/').pop()?.replace(/\.md$/, '') || charPath;
            byName[name] = value;
        }
        return Object.keys(byName).length > 0 ? byName : undefined;
    }, [currentSessionConfig]);
    // 応答時の自動画像生成で対象外にするキャラクター名の集合。保存キー（キャラ.mdパス）を
    // TURN の character 名（設定名。物理ディレクトリ名は、同じディレクトリの選択中キャラが
    // 全て対象外のときだけ）へ変換して渡す。会話設定で選択中のキャラクターだけを見る。
    const getAutoImageExcludedCharacters = React.useCallback((): ReadonlySet<string> => {
        const excluded = new Set<string>();
        const characters = currentSessionConfig?.characters as string[] | undefined;
        const details = currentSessionConfig?.characterDetails as Record<string, { autoImageGenEnabled?: boolean } | undefined> | undefined;
        if (!characters || !details) return excluded;
        const directoryHasTarget = new Map<string, boolean>();
        for (const charPath of characters) {
            if (!charPath) continue;
            const enabled = details[charPath]?.autoImageGenEnabled !== false;
            const settingName = extractSettingName(charPath) || charPath.split('/').pop()?.replace(/\.md$/i, '') || charPath;
            const directoryName = extractCharacterDirectoryName(charPath);
            if (!enabled) excluded.add(settingName);
            if (directoryName) {
                directoryHasTarget.set(directoryName, (directoryHasTarget.get(directoryName) ?? false) || enabled);
            }
        }
        for (const [directoryName, hasTarget] of directoryHasTarget) {
            if (!hasTarget) excluded.add(directoryName);
        }
        return excluded;
    }, [currentSessionConfig]);
    // セッション履歴から読み込んだSSRP設定（プリセット閲覧・保存からチャット送信を守るための基準）
    const [sessionHistoryConfig, setSessionHistoryConfig] = useState<any>(null);
    const [isConversationPresetChanged, setIsConversationPresetChanged] = useState(false);
    // RolePlaySettingsコンポーネントへのRef
    const rolePlaySettingsRef = React.useRef<RolePlaySettingsHandlers>(null);
    const pendingSendSSRPConfigRef = React.useRef<any>(null);
    // セッション復元中フラグ（復元完了までUIからの送信を禁止する）
    const [isRestoringSession, setIsRestoringSession] = useState(false);
    // SSRP設定がセッション保存値から変更されているか（反映ボタン表示用）
    const [isSSRPDirty, setIsSSRPDirty] = useState(false);
    // 会話中に準備・調整欄で話す相手（キャラ）を替えたか。替えていれば「新しく始める」を主ボタンにする
    const [charactersChangedFromSession, setCharactersChangedFromSession] = useState(false);
    // 準備・調整欄で選択中のキャラ。発言前の新しい会話では、見出しの参加者をここから出す
    const [prepareCharacters, setPrepareCharacters] = useState<string[]>([]);
    // このセッションでは送信時の反映確認モーダルを出さない（中間ファイルのuiStateに永続化）
    const [suppressApplyConfirm, setSuppressApplyConfirm] = useState(false);
    // 送信時の反映確認モーダル
    const [applyConfirmOpen, setApplyConfirmOpen] = useState(false);
    const [applyConfirmDontAsk, setApplyConfirmDontAsk] = useState(false);
    const pendingConfirmSettingsRef = React.useRef<any>(null);
    // 反映ボタンの実行状態（idle/applying/done）
    const [applyToSessionState, setApplyToSessionState] = useState<'idle' | 'applying' | 'done'>('idle');
    const applyDoneTimerRef = React.useRef<number | null>(null);
    // セッション復元が開始されたかどうか（起動時デフォルトプリセット自動適用のレース防止用）
    const hasSessionContextRef = React.useRef(!!lazyReloadRecovery?.ssrpSettings);

    // SSRPモードフラグ（常時true: 全セッションがSSRPモード）
    const isSSRP = true;

    // 言語設定 State
    const [languageSettings, setLanguageSettings] = useState<Record<string, string>>({});
    // backend の tier gate（機能フラグ）。ここで一度だけ取得して子コンポーネントへ配布する
    //（MessageList / 設定画面での都度取得をやめる。04調査 中#4）。
    const [enabledFeatures, setEnabledFeatures] = useState<Record<string, boolean> | null>(null);
    // UI表示用 i18n 辞書 State
    const [uiCatalog, setUiCatalog] = useState<I18NCatalog | null>(null);
    // 本体・モジュール統合の更新告知（起動時チェックで更新検知時に 1 画面で表示）
    const [appUpdateInfo, setAppUpdateInfo] = useState<AppUpdateInfo | null>(null);
    const [moduleUpdateEntries, setModuleUpdateEntries] = useState<ModuleUpdateEntry[]>([]);
    const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
    // 更新告知モーダルの本体セクション／モジュール行を個別に消し、残りが無ければ閉じる
    // （「後で」「スキップ」は本体とモジュールで独立に判断する）。
    const dismissAppUpdate = () => {
        setAppUpdateInfo(null);
        if (moduleUpdateEntries.length === 0) setIsUpdateModalOpen(false);
    };
    const dismissModuleUpdate = (moduleId: string) => {
        const rest = moduleUpdateEntries.filter((m) => m.id !== moduleId);
        setModuleUpdateEntries(rest);
        if (!appUpdateInfo && rest.length === 0) setIsUpdateModalOpen(false);
    };
    // 承認済みモジュール更新の進行バナー（本体更新後の起動時のみ発生。非モーダル）
    const [moduleApplyBanner, setModuleApplyBanner] = useState<'applying' | 'done' | 'partialFailed' | null>(null);
    const t = (key: string) => resolveMessage(
        uiCatalog,
        key,
        CHAT_VIEW_TEXT_FALLBACK_JA[key] || COMMON_TEXT_FALLBACK_JA[key] || key
    );

    // UI辞書は SSRP 置換用 languageSettings と別系統で管理する。
    const loadUICatalog = React.useCallback(async (lang: string) => {
        try {
            const catalog = await fetchI18NCatalog(BACKEND_URL, lang || DEFAULT_UI_LANGUAGE);
            setUiCatalog(catalog);
        } catch (e) {
            console.warn('Failed to load UI i18n catalog');
        }
    }, []);

    // ページ全体のスクロールを止めているため、ブラウザ標準の引っ張り更新が効かない。
    // ヘッダー領域の下引きで代替する（インストール済みアプリでは唯一の更新手段）。
    const headerRef = React.useRef<HTMLElement | null>(null);
    const pullToReload = usePullToReload(headerRef);

    // モバイルのプル・トゥ・リフレッシュ後に 100dvh が過大評価される端末があるため、
    // 実際の表示 viewport の高さをチャット外枠の高さとして同期する。
    // 位置(offsetTop)も見るのは、ソフトウェアキーボード表示時にレイアウト viewport 側を
    // ずらす端末があり、その分だけ外枠が画面外へ逃げてしまうため。
    // ピンチズーム中は offsetTop が指の操作で動くので、追従も原点戻しも止める。
    useEffect(() => {
        const syncViewport = () => {
            const viewport = window.visualViewport;
            const isZoomed = (viewport?.scale ?? 1) > 1.01;
            const viewportHeight = isZoomed
                ? window.innerHeight
                : (viewport?.height ?? window.innerHeight);
            const offsetTop = isZoomed ? 0 : (viewport?.offsetTop ?? 0);

            const root = document.documentElement;
            root.style.setProperty('--chat-viewport-height', `${Math.round(viewportHeight)}px`);
            root.style.setProperty('--chat-viewport-offset-top', `${Math.round(offsetTop)}px`);

            // ページ側にスクロール量が残ると外枠の貼り付き位置がずれるため原点へ戻す。
            if (!isZoomed && (window.scrollX !== 0 || window.scrollY !== 0)) {
                window.scrollTo(0, 0);
            }
        };

        syncViewport();
        const rafId = requestAnimationFrame(syncViewport);
        const timeoutId = window.setTimeout(syncViewport, 250);

        window.visualViewport?.addEventListener('resize', syncViewport);
        window.visualViewport?.addEventListener('scroll', syncViewport);
        window.addEventListener('resize', syncViewport);
        window.addEventListener('orientationchange', syncViewport);
        window.addEventListener('pageshow', syncViewport);

        return () => {
            cancelAnimationFrame(rafId);
            window.clearTimeout(timeoutId);
            window.visualViewport?.removeEventListener('resize', syncViewport);
            window.visualViewport?.removeEventListener('scroll', syncViewport);
            window.removeEventListener('resize', syncViewport);
            window.removeEventListener('orientationchange', syncViewport);
            window.removeEventListener('pageshow', syncViewport);
        };
    }, []);

    // 機能フラグ（/api/system/health）の取得。失敗時は指数バックオフで再試行する
    //（従来は末端コンポーネントが失敗すると ComfyUI 導線が消えたままだった。04調査 中#4）。
    useEffect(() => {
        let disposed = false;
        let timerId: number | null = null;
        const load = async (attempt: number) => {
            try {
                const health = await fetchSystemHealth(BACKEND_URL);
                if (!disposed) {
                    setEnabledFeatures(health.features ?? null);
                }
            } catch {
                if (!disposed && attempt < 5) {
                    timerId = window.setTimeout(() => load(attempt + 1), Math.min(30000, 2000 * 2 ** attempt));
                }
            }
        };
        load(0);
        return () => {
            disposed = true;
            if (timerId !== null) window.clearTimeout(timerId);
        };
    }, []);

    // 支援状態・モジュール配置の変化後に機能フラグを取り直す（画面更新なしで
    // 画像生成設定などの導線を追随させる。取得失敗時は既存値を保持）。
    const refreshFeatures = React.useCallback(async () => {
        try {
            const health = await fetchSystemHealth(BACKEND_URL);
            setEnabledFeatures(health.features ?? null);
        } catch {
            // 既存の表示条件を保つ（次の変化時に再取得される）。
        }
    }, []);

    // ComfyUI連携モジュールの連携状態（画像生成設定・容姿プロンプト作成等の表示条件に使用）。
    // ComfyUI機能が有効な支援レベルの間だけ、初回・定期・画面の再表示時に取り直す
    //（サイドカーの起動完了・異常停止へ追随し、投入 API の受付条件と揃える）。
    const [comfyModuleActive, setComfyModuleActive] = useComfyModuleActive(
        BACKEND_URL,
        isFeatureEnabled(enabledFeatures, FEATURE_COMFYUI),
    );
    // 画像生成バックエンドの選択（左メニューの切替タブから受け取り、残高パネルの表示切替に使う）
    const [imageBackendSelection, setImageBackendSelection] = useState<BackendSelection | null>(null);
    // TTS連携モジュールの連携状態（TTS設定タブ等の表示条件に使用）。
    // TTS機能が有効な支援レベルの間だけ、初回・定期・画面の再表示時に取り直す
    //（サイドカーの起動完了・異常停止へ追随する。in-process 供給時も active が返る）。
    const [ttsModuleActive, setTtsModuleActive] = useTTSModuleActive(
        BACKEND_URL,
        isFeatureEnabled(enabledFeatures, FEATURE_TTS),
    );
    // 文体指示の対応絵文字一覧（表示からの常時除去用）。TTS機能が有効なときだけ取得する
    //（除去リストの取得可否はゲートに従う。不通過ユーザーはそもそも文体指示で生成されない）。
    const [ttsEmojiList, setTtsEmojiList] = useState<string[]>([]);
    useEffect(() => {
        if (!isFeatureEnabled(enabledFeatures, FEATURE_TTS)) {
            return;
        }
        let disposed = false;
        getTTSEmojiList(BACKEND_URL)
            .then(list => { if (!disposed) setTtsEmojiList(list); })
            .catch(() => { /* 未接続・未配置時は空のまま（除去なし） */ });
        return () => { disposed = true; };
    }, [enabledFeatures]);

    // 本体アップデートの起動時チェック（起動時1回のみ。失敗は静かに無視する。01番 4章）。
    // スキップ済みバージョン・自動確認OFFはバックエンドの応答値で判定する。
    useEffect(() => {
        let disposed = false;
        (async () => {
            try {
                const check = await fetchUpdateCheck(BACKEND_URL);
                if (disposed) return;
                if (!check.autoCheck) return;
                // 本体・モジュールとも更新のあるものだけを 1 画面の統合モーダルで告知する。
                // スキップ済み・「後で」当日は出さない（本体と各モジュールで独立に判定）。
                const appHasUpdate = check.app.enabled && check.app.hasUpdate
                    && !check.app.skipped && !check.app.postponedToday;
                const moduleEntries = check.modules.filter(
                    (m) => (m.hasUpdate || m.companionPackUpdate) && !m.skipped && !m.postponedToday,
                );
                if (appHasUpdate || moduleEntries.length > 0) {
                    setAppUpdateInfo(appHasUpdate ? check.app : null);
                    setModuleUpdateEntries(moduleEntries);
                    setIsUpdateModalOpen(true);
                }
            } catch {
                // 起動時チェックの失敗は無通知（手動確認時のみ文言表示する）
            }
        })();
        return () => {
            disposed = true;
        };
    }, []);

    // 承認済みモジュール更新の進行バナー（一括全更新→本体更新→再起動の続き）。
    // 適用中なら「更新中」を表示して完了までポーリングし、完了で完了報告に切り替える。
    // 完了報告は 8 秒で自動的に消え、× でいつでも閉じられる（操作はブロックしない）。
    // 初期化時点で完了済みの場合も、直近 5 分以内なら完了報告を出す（再読み込み対策）。
    useEffect(() => {
        let disposed = false;
        let pollTimer: number | null = null;
        let hideTimer: number | null = null;
        const showDone = (failed: boolean) => {
            if (disposed) return;
            setModuleApplyBanner(failed ? 'partialFailed' : 'done');
            hideTimer = window.setTimeout(() => {
                if (!disposed) setModuleApplyBanner(null);
            }, 8000);
        };
        (async () => {
            try {
                const status = await fetchUpdateApplyStatus(BACKEND_URL);
                if (disposed) return;
                const moduleApply = status.moduleApply;
                if (!moduleApply) return;
                if (moduleApply.applying) {
                    setModuleApplyBanner('applying');
                    pollTimer = window.setInterval(async () => {
                        try {
                            const latest = await fetchUpdateApplyStatus(BACKEND_URL);
                            const current = latest.moduleApply;
                            if (current && !current.applying) {
                                if (pollTimer !== null) {
                                    window.clearInterval(pollTimer);
                                    pollTimer = null;
                                }
                                showDone((current.failedIds ?? []).length > 0);
                            }
                        } catch {
                            // 一時的な取得失敗はポーリング継続
                        }
                    }, 1000);
                } else if (moduleApply.done && moduleApply.completedAt) {
                    const elapsed = Date.now() - new Date(moduleApply.completedAt).getTime();
                    if (elapsed >= 0 && elapsed < 5 * 60 * 1000) {
                        showDone((moduleApply.failedIds ?? []).length > 0);
                    }
                }
            } catch {
                // 進行が取得できないだけで更新自体には影響しない（表示なし）
            }
        })();
        return () => {
            disposed = true;
            if (pollTimer !== null) window.clearInterval(pollTimer);
            if (hideTimer !== null) window.clearTimeout(hideTimer);
        };
    }, []);

    // 実行中ジョブ数のポーリング（ヘッダーバッジ用）
    // 実行中ジョブがある間は2秒、アイドル時は10秒に間引き、タブ非表示中は停止する
    useEffect(() => {
        let timerId: number | null = null;
        let disposed = false;
        const schedule = (hasRunning: boolean) => {
            if (disposed) return;
            timerId = window.setTimeout(poll, hasRunning ? 2000 : 10000);
        };
        const poll = async () => {
            if (disposed) return;
            if (document.hidden) return; // visibilitychangeで再開する
            let hasRunning = false;
            try {
                const res = await axios.get(`${BACKEND_URL}/api/jobs`);
                const jobs: any[] = res.data.jobs ?? [];
                const running = jobs.filter((j: any) => j.status === 'processing').length;
                setRunningJobCount(running);
                hasRunning = running > 0;
            } catch { /* ポーリング失敗は無視 */ }
            schedule(hasRunning);
        };
        const onVisibilityChange = () => {
            if (!document.hidden) {
                if (timerId !== null) window.clearTimeout(timerId);
                poll();
            }
        };
        document.addEventListener('visibilitychange', onVisibilityChange);
        poll();
        return () => {
            disposed = true;
            if (timerId !== null) window.clearTimeout(timerId);
            document.removeEventListener('visibilitychange', onVisibilityChange);
        };
    }, []);

    // 設定ロード
    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const res = await axios.get(`${BACKEND_URL}/api/settings`);
                const loadedSettings = normalizeSettings(res.data);
                setSettings(loadedSettings);
                await loadUICatalog(loadedSettings.uiLanguage || DEFAULT_UI_LANGUAGE);

                // 言語設定の取得（UI表示言語に連動。取得失敗時は既定言語で再試行）
                try {
                    const ssrpLang = loadedSettings.uiLanguage || DEFAULT_SSRP_LANGUAGE;
                    const langRes = await axios.get(`${BACKEND_URL}/api/settings/language/${ssrpLang}`);
                    setLanguageSettings(langRes.data || {});
                } catch (e) {
                    console.warn('Failed to load language settings');
                }

                // グローバル設定の確認
                const globalSettings = await getGlobalSettings(BACKEND_URL);

                // ピン留め設定の反映
                if (globalSettings.isMenuPinned) {
                    if (window.innerWidth >= 1024) {
                        setIsRolePlaySettingsOpen(true);
                    }
                }

                // デフォルトプリセットの自動適用
                if (globalSettings.defaultSSRPPresetName) {
                    // RolePlaySettingsの初期化完了を待ってからプリセットを適用
                    setTimeout(() => {
                        // セッション復元が先に始まっていたら、復元済みUIをデフォルトプリセットで上書きしない
                        if (rolePlaySettingsRef.current && !hasSessionContextRef.current) {
                            rolePlaySettingsRef.current.loadPreset(globalSettings.defaultSSRPPresetName!);
                            console.log('[Chat] Default preset applied:', globalSettings.defaultSSRPPresetName);
                        }
                    }, 500);
                } else {
                    // デフォルトプリセット未設定：RolePlaySettingsを開いて設定を促す
                    setIsRolePlaySettingsOpen(true);
                }
            } catch (error) {
                console.log('Using default settings');
                await loadUICatalog(DEFAULT_SETTINGS.uiLanguage || DEFAULT_UI_LANGUAGE);
            }
        };
        fetchSettings();
    }, [loadUICatalog]);

    const saveSettings = async (newSettings: SettingsType) => {
        try {
            const normalizedSettings = normalizeSettings(newSettings);
            await axios.post(`${BACKEND_URL}/api/settings`, normalizedSettings);
            setSettings(normalizedSettings);
            await loadUICatalog(normalizedSettings.uiLanguage || DEFAULT_UI_LANGUAGE);
        } catch (error) {
            console.error('Failed to save settings:', error);
            throw error;
        }
    };

    // Session Hook
    const {
        sessions,
        currentSessionTitle,
        currentSessionId,
        setCurrentSessionId,
        setCurrentSessionTitle,
        handleNewSession: sessionHandleNewSession,
        handleResumeSession: sessionHandleResumeSession,
        fetchSessions,
        takeRestoreSessionId,
        updateSessionTitle,
        deleteSession,
        deleteSessions
    } = useSession({
        backendUrl: BACKEND_URL,
        catalog: uiCatalog,
        onSessionChange: (_id, _title) => {
            // セッション変更時の処理（必要なら）
        },
        onHistoryLoaded: (history) => {
            console.log('[Chat] onHistoryLoaded called with', history?.length || 0, 'messages');
            setMessages(history);
        }
    });

    // Chat Hook
    const {
        messages,
        setMessages,
        input,
        setInput,
        isLoading,
        editingState,
        setEditingState,
        models,
        refreshModels,
        selectedModel,
        setSelectedModel,
        selectedModelProvider,
        setSelectedModelProvider,
        geminiTempFileMode,
        setGeminiTempFileMode,
        claudeEffort,
        selectClaudeEffort,
        antigravityThinking,
        selectAntigravityThinking,
        antigravityStreamGuardLimit,
        selectAntigravityStreamGuardLimit,
        responseTimeoutMinutes,
        selectResponseTimeoutMinutes,
        actionChoices,
        selectedChoice,
        setSelectedChoice,
        handleSend,
        handleStop,
        handleRegenerate,
        handleRegenerateWithModel,
        regenerateClaudeEffort,
        regenerateAntigravityThinking,
        handleSaveEdit,
        pollJobStatus
    } = useChat({
        backendUrl: BACKEND_URL,
        // セッション設定(directiveModeなど)を優先マージ
        // currentSessionConfigのプロパティ名をSettings型に合わせて変換
        settings: currentSessionConfig ? {
            ...settings,
            ...currentSessionConfig,
            selectedCharacters: currentSessionConfig.characters || [],
            selectedSituations: currentSessionConfig.situations || [],
        } : settings,
        currentSessionId: currentSessionId,
        onSessionCreated: (newSessionId) => {
            console.log('[Chat] New session created, updating ID:', newSessionId);
            setCurrentSessionId(newSessionId);
            const sentConfig = cloneSSRPConfig(pendingSendSSRPConfigRef.current);
            if (sentConfig) {
                setCurrentSessionConfig(sentConfig);
                setSessionHistoryConfig(cloneSSRPConfig(sentConfig));
                setIsConversationPresetChanged(false);
            }
            pendingSendSSRPConfigRef.current = null;
            // 本体が最初の発言から作った題を見出しへ反映する。
            // 読み直しの間に別の会話へ移っていたら、その会話の題を上書きしない。
            void fetchSessions().then(list => {
                const created = list.find(s => s.id === newSessionId);
                if (created?.title && currentSessionIdRef.current === newSessionId) {
                    setCurrentSessionTitle(created.title);
                }
            });
        },
        onResponseCompleted: (sessionId) => {
            void syncSessionSettingsAfterResponse(sessionId);
        },
        disableAutoLoadHistory: true, // useSession側でロードするのでuseChat側では無効化
        ssrpSettings: currentSessionConfig,
        catalog: uiCatalog
    });

    useEffect(() => {
        console.log('[Chat] Current settings:', {
            currentSessionConfig: currentSessionConfig ? 'exists' : 'null'
        });
    }, [settings, currentSessionConfig]);

    // セッション状態ドロワーは会話中のみ表示のため、セッションが無くなったら閉じる
    useEffect(() => {
        if (!currentSessionId) setIsStatusDrawerOpen(false);
    }, [currentSessionId]);

    // 入力変更
    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setInput(e.target.value);
    };

    // ラッパー関数
    const handleNewSessionWrapper = async (ssrpSettings?: any) => {
        console.log('[Chat] handleNewSessionWrapper called with:', ssrpSettings);
        console.trace('[Chat] Stack trace for handleNewSessionWrapper');

        if (ssrpSettings) {
            // セッション開始ボタンから呼ばれた場合：設定を反映（リセットしない）
            setCurrentSessionConfig(ssrpSettings);
            setSessionHistoryConfig(null);
            setIsConversationPresetChanged(false);
        } else {
            // ＋ボタンから呼ばれた場合：設定画面をリセット
            setSsrpResetKey(prev => prev + 1);
            setCurrentSessionConfig(null);
            setSessionHistoryConfig(null);
            setIsConversationPresetChanged(false);
        }
        // 反映確認まわりの状態は新規セッションでリセット
        setSuppressApplyConfirm(false);
        setIsSSRPDirty(false);
        setApplyConfirmOpen(false);

        // modelType は選択中プロバイダ（サーバーの provider フィールド正）から取る。
        // モデルID文字列の startsWith 推測は廃止（openai_compat が gemini に落ちて
        // 履歴復元時に provider/モデルが既定値へ戻る不具合の経路）。
        const modelType = modelTypeForNewSession(selectedModelProvider);
        await sessionHandleNewSession(ssrpSettings, modelType);
        setMessages([]); // メッセージクリア
    };

    const handleResumeSessionWrapper = async (session: any) => {
        hasSessionContextRef.current = true;
        setIsRestoringSession(true);
        try {
            const result = await sessionHandleResumeSession(session);

            // resume API失敗時は何も変更しない
            // （セッションIDが切り替わっていないのに設定だけ書き換わる不整合を防ぐ）
            if (!result) {
                console.warn('[Chat] Session resume failed; keeping current state');
                return;
            }
            setActiveView('chat');

            // SSRP設定はresume APIのレスポンスから取得（一覧APIはconfigを含まない）
            const activeConfig = result.config;

            // 送信時確認モーダルの抑制フラグを中間ファイル(uiState)から復元
            setSuppressApplyConfirm(!!(result.uiState && result.uiState.suppressSSRPApplyConfirm));
            setApplyConfirmOpen(false);

            // 設定があれば反映
            if (activeConfig) {
                console.log('[Chat] Resuming with config:', activeConfig);
                const restoredConfig = cloneSSRPConfig(activeConfig);
                setCurrentSessionConfig(restoredConfig);
                setSessionHistoryConfig(cloneSSRPConfig(activeConfig));
                setIsConversationPresetChanged(false);

                // SSRPメニューの開閉状態に関係なく、UI stateを復元configへ即時同期する
                // （閉じたままだとRolePlaySettings側のinit()が走らず、送信時にUIの古い設定が使われるため）
                rolePlaySettingsRef.current?.applySettings(cloneSSRPConfig(activeConfig));

            }

            if (!activeConfig) {
                setCurrentSessionConfig(null);
                setSessionHistoryConfig(null);
                setIsConversationPresetChanged(false);
            }

            // モデルとproviderは必ず同時に復元する。片方だけを更新すると
            // useChatの整合effectが復元モデルを直前providerの既定値で上書きする。
            const restoredSelection = resolveRestoredModelSelection(result);
            if (restoredSelection.provider) {
                setSelectedModelProvider(restoredSelection.provider);
            }
            if (restoredSelection.model) {
                console.log('[Chat] Restoring last used model:', restoredSelection.model);
                setSelectedModel(restoredSelection.model);
            }

            // 未完了ジョブがあれば直接ポーリングを再開
            if (result?.activeJobId) {
                console.log('[Chat] Active job detected on resume, starting polling:', result.activeJobId);
                pollJobStatus(result.activeJobId);
            }
        } finally {
            setIsRestoringSession(false);
        }
    };

    // 画面の再読込後に、直前まで開いていたセッションを再表示する。
    // モデル一覧が届いてから一度だけ動かす（先に復元すると、後から届いた一覧へ合わせる
    // 整合処理が復元済みのモデルを既定値で上書きするため）。
    // 一覧に無いID（削除済み等）は何もせず、保存先は state 側の effect が既に消している。
    const hasAttemptedRestoreRef = React.useRef(false);
    useEffect(() => {
        if (models.length === 0 || hasAttemptedRestoreRef.current) return;
        hasAttemptedRestoreRef.current = true;
        const storedId = takeRestoreSessionId();
        if (!storedId) return;
        (async () => {
            try {
                const list = await fetchSessions();
                const target = list.find(s => s.id === storedId);
                if (!target) {
                    console.log('[Chat] Stored session not found in list; skip restore:', storedId);
                    return;
                }
                console.log('[Chat] Restoring session after reload:', storedId);
                await handleResumeSessionWrapper(target);
            } catch (e) {
                console.error('[Chat] Session restore after reload failed:', e);
            }
        })();
    }, [models]);

    // 履歴の画面を開く（開くたびに一覧を読み直す）
    const openHistoryView = async () => {
        await fetchSessions();
        setActiveView('history');
    };

    // SSRP設定メニューを開く
    const handleOpenRolePlaySettings = () => {
        setIsRolePlaySettingsOpen(true);
    };

    // SSRP設定メニューを閉じる
    const handleCloseRolePlaySettings = () => {
        setIsRolePlaySettingsOpen(false);
    };

    const handleConversationPresetChanged = () => {
        if (currentSessionId) {
            setIsConversationPresetChanged(true);
        }
    };

    // セッションからの一時キャラクター取り込み。進行状態は画面本体で保持し、小窓を閉じても続く。
    const currentSessionIdRef = React.useRef<string | null>(null);
    currentSessionIdRef.current = currentSessionId || null;
    // サーバー側で会話設定が更新されたとき（分析完了・一時キャラの本文更新／削除・キャラ設定登録）に
    // 保持値と会話設定メニューの UI を差し替える。保存値スナップショットも揃えて dirty にしない。
    const handleSessionSettingsUpdated = React.useCallback((saved: any) => {
        if (!saved) return;
        setCurrentSessionConfig(cloneSSRPConfig(saved));
        setSessionHistoryConfig(cloneSSRPConfig(saved));
        setIsConversationPresetChanged(false);
        setIsSSRPDirty(false);
        rolePlaySettingsRef.current?.applySettings(cloneSSRPConfig(saved));
    }, []);
    // 応答の確定で本体が進めた会話の設定（日付時刻・付き合いの長さ）を読み直す。
    // 読み直さないと状態の欄に古い時刻が残り、そのまま反映すると本体の時刻を古い値で戻してしまう。
    const sessionHistoryConfigRef = React.useRef<any>(null);
    sessionHistoryConfigRef.current = sessionHistoryConfig;
    const syncSessionSettingsAfterResponse = async (sessionId: string) => {
        try {
            const res = await applySSRPSettingsToSession(BACKEND_URL, sessionId, null);
            const saved = res.ssrpSettings;
            if (!saved || currentSessionIdRef.current !== sessionId) return;
            const ui = rolePlaySettingsRef.current?.getCurrentSettings();
            const history = sessionHistoryConfigRef.current;
            if (!ui || !history || !isSSRPConfigDifferent(ui, history)) {
                handleSessionSettingsUpdated(saved);
                return;
            }
            // 準備・調整欄に反映していない変更があるときは、それを残して本体が進めた値だけを差し替える
            setCurrentSessionConfig((prev: any) => mergeResponseAdvancedSettings(prev ?? saved, saved));
            setSessionHistoryConfig(cloneSSRPConfig(saved));
            rolePlaySettingsRef.current?.applySettings(mergeResponseAdvancedSettings(ui, saved));
        } catch (error) {
            console.error('[Chat] Failed to reload SSRP settings after response:', error);
        }
    };
    const tempImport =useTempCharacterImport(BACKEND_URL, async (sessionId) => {
        // 分析完了時の登録はサーバー側で済んでいる。会話設定を読み直して画面へ反映する。
        try {
            const res = await applySSRPSettingsToSession(BACKEND_URL, sessionId, null);
            if (currentSessionIdRef.current === sessionId && res.ssrpSettings) {
                handleSessionSettingsUpdated(res.ssrpSettings);
            }
        } catch (error) {
            console.error('[Chat] Failed to reload SSRP settings after temp character import:', error);
        }
    });
    // 画面を読み込み直した後もサーバーで分析が続いていれば、完了時に会話設定を読み直す。
    useEffect(() => {
        if (currentSessionId) tempImport.watchActive(currentSessionId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentSessionId]);

    // UIの現在SSRP設定を送信時と同じ経路で取得する（lastModel付与込み）
    const collectCurrentSSRPSettings = React.useCallback(() => {
        let settings: any = null;
        try {
            settings = rolePlaySettingsRef.current?.getCurrentSettings() ?? null;
        } catch (e) {
            console.error('[Chat] Failed to get SSRP settings from UI:', e);
        }
        if (!settings) {
            settings = cloneSSRPConfig(currentSessionConfig);
        }
        if (settings) {
            settings.lastModel = selectedModel;
        }
        return settings;
    }, [currentSessionConfig, selectedModel]);

    // 遅延読込は画面切替の描画中に失敗し得るため、登録済みハンドラから常に最新の
    // 遷移先を読めるよう ref へ同期する。
    const lazyReloadContextRef = React.useRef({
        activeView,
        materialRequest,
        settingsCategory,
        prepareOpen: isRolePlaySettingsOpen,
    });
    lazyReloadContextRef.current = {
        activeView,
        materialRequest,
        settingsCategory,
        prepareOpen: isRolePlaySettingsOpen,
    };

    useEffect(() => registerBeforeLazyReload(() => {
        const context = lazyReloadContextRef.current;
        saveLazyReloadRecovery({
            sessionId: currentSessionIdRef.current,
            ssrpSettings: cloneSSRPConfig(rolePlaySettingsRef.current?.getCurrentSettings() ?? currentSessionConfig),
            activeView: context.activeView === 'history' ? 'chat' : context.activeView,
            materialRequest: context.materialRequest,
            settingsCategory: context.settingsCategory,
            prepareOpen: context.prepareOpen,
        });
    }), [currentSessionConfig]);

    const clearCompletedLazyRecovery = React.useCallback(() => {
        if (hasAppliedLazyRecoveryRef.current && hasLoadedRecoveredViewRef.current) {
            clearLazyReloadRecovery();
        }
    }, []);

    // RolePlaySettings 自身の非同期初期化が完了してから未反映内容を重ね、初期化処理による
    // 上書きを防ぐ。開始済みセッションは useSession の再開完了後まで待つ。
    const applyLazyReloadRecovery = React.useCallback(() => {
        if (hasAppliedLazyRecoveryRef.current || !lazyReloadRecovery?.ssrpSettings) return;
        if (lazyReloadRecovery.sessionId && currentSessionIdRef.current !== lazyReloadRecovery.sessionId) return;
        const target = rolePlaySettingsRef.current;
        if (!target) return;
        target.applySettings(cloneSSRPConfig(lazyReloadRecovery.ssrpSettings));
        hasAppliedLazyRecoveryRef.current = true;
        clearCompletedLazyRecovery();
    }, [clearCompletedLazyRecovery, lazyReloadRecovery]);

    // 閉じた準備・調整欄は初期化処理が走らないため、セッション復元後に親側から戻す。
    useEffect(() => {
        if (!lazyReloadRecovery?.prepareOpen) applyLazyReloadRecovery();
    }, [applyLazyReloadRecovery, currentSessionId, lazyReloadRecovery]);

    // dirty監視: セッション保存値スナップショット(sessionHistoryConfig)とUI現在値を定期比較する。
    // RolePlaySettings内部の全変更に個別フックを張るより、この軽量ポーリングのほうが確実。
    // ただしUIから設定を変更できるのはメニューが開いている間だけなので、ポーリングもその間に限定する。
    // メニュー外からの変更（キャラ状態パネル・日時パネル・セッション復元）はすべて
    // setCurrentSessionConfig を経由するため、依存変化によるeffect再実行時の即時checkで拾える。
    useEffect(() => {
        if (!currentSessionId || !sessionHistoryConfig) {
            setIsSSRPDirty(false);
            setCharactersChangedFromSession(false);
            return;
        }
        const check = () => {
            try {
                const ui = rolePlaySettingsRef.current?.getCurrentSettings() ?? currentSessionConfig;
                if (!ui) {
                    setIsSSRPDirty(false);
                    setCharactersChangedFromSession(false);
                    return;
                }
                setIsSSRPDirty(isSSRPConfigDifferent(ui, sessionHistoryConfig));
                setCharactersChangedFromSession(isCharacterSetDifferent(ui.characters, sessionHistoryConfig.characters));
            } catch {
                // 取得失敗時は判定を変えない
            }
        };
        check();
        if (!isRolePlaySettingsOpen) return;
        const id = window.setInterval(check, 1500);
        return () => window.clearInterval(id);
    }, [currentSessionId, sessionHistoryConfig, currentSessionConfig, isRolePlaySettingsOpen]);

    // 反映ボタン: UIの現在設定をセッション正本へ保存する
    const handleApplyToSession = async () => {
        if (!currentSessionId || applyToSessionState === 'applying') return;
        const settings = collectCurrentSSRPSettings();
        if (!settings) return;
        setApplyToSessionState('applying');
        try {
            const res = await applySSRPSettingsToSession(BACKEND_URL, currentSessionId, settings);
            const saved = cloneSSRPConfig(res.ssrpSettings || settings);
            setCurrentSessionConfig(saved);
            setSessionHistoryConfig(cloneSSRPConfig(saved));
            setIsConversationPresetChanged(false);
            setIsSSRPDirty(false);
            setApplyToSessionState('done');
            if (applyDoneTimerRef.current) window.clearTimeout(applyDoneTimerRef.current);
            applyDoneTimerRef.current = window.setTimeout(() => setApplyToSessionState('idle'), 2000);
        } catch (e) {
            console.error('[Chat] Failed to apply SSRP settings to session:', e);
            setApplyToSessionState('idle');
            window.alert(t(CHAT_VIEW_I18N_KEYS.applyToSessionFailed));
        }
    };

    // 反映完了表示タイマーの後始末
    useEffect(() => {
        return () => {
            if (applyDoneTimerRef.current) window.clearTimeout(applyDoneTimerRef.current);
        };
    }, []);

    const handleRestoreSessionSettings = () => {
        const restoredConfig = cloneSSRPConfig(sessionHistoryConfig || currentSessionConfig);
        if (!restoredConfig) return;

        setCurrentSessionConfig(restoredConfig);
        setIsConversationPresetChanged(false);
        rolePlaySettingsRef.current?.applySettings(restoredConfig);
        console.log('[Chat] Restored SSRP settings from session history');
    };

    // 送信本体: payload構築と送信（確認モーダルの選択後にも呼ばれる）
    const doSend = (ssrpSettingsOverride: any, updateCurrentConfig: boolean) => {
        pendingSendSSRPConfigRef.current = cloneSSRPConfig(ssrpSettingsOverride);
        if (currentSessionId && ssrpSettingsOverride && updateCurrentConfig) {
            // UI表示用の単一ソースのみ更新する。
            // sessionHistoryConfig（セッション保存値スナップショット）は
            // 反映API成功時にだけ更新する（送信してもバックエンドの既存セッションは
            // payloadのssrpSettingsを保存しないため、ここで更新するとdirty検知が壊れる）。
            setCurrentSessionConfig(cloneSSRPConfig(ssrpSettingsOverride));
        }
        handleSend(ssrpSettingsOverride);
    };

    // 送信ラッパー: RolePlaySettingsから最新設定を取得して送信
    const handleSendWrapper = () => {
        // セッション復元中はUI stateが未同期の可能性があるため送信を禁止
        if (isRestoringSession) {
            console.log('[Chat] Send blocked: session restore in progress');
            return;
        }
        // 一時キャラクターの分析中は、完了時の登録と送信時の会話設定が食い違わないよう送信を止める
        if (tempImport.running) {
            console.log('[Chat] Send blocked: temp character import in progress');
            return;
        }
        let ssrpSettingsOverride = undefined;
        const shouldUseSessionHistoryConfig = !!currentSessionId && isConversationPresetChanged && !!sessionHistoryConfig;

        if (shouldUseSessionHistoryConfig) {
            ssrpSettingsOverride = cloneSSRPConfig(sessionHistoryConfig);
            if (ssrpSettingsOverride) {
                ssrpSettingsOverride.lastModel = selectedModel;
            }
            console.log('[Chat] Using session history SSRP settings because conversation preset was changed:', ssrpSettingsOverride);
        } else {
            ssrpSettingsOverride = collectCurrentSSRPSettings();
            console.log('[Chat] Using fresh SSRP settings from UI:', ssrpSettingsOverride);
        }

        // 既存セッションで設定が未反映のまま送信しようとした場合は確認モーダルを出す
        // （このセッションで抑制指定済みなら出さない。反映は手動の反映ボタンに委ねる）。
        if (
            currentSessionId &&
            !shouldUseSessionHistoryConfig &&
            !suppressApplyConfirm &&
            sessionHistoryConfig &&
            ssrpSettingsOverride &&
            isSSRPConfigDifferent(ssrpSettingsOverride, sessionHistoryConfig)
        ) {
            pendingConfirmSettingsRef.current = ssrpSettingsOverride;
            setApplyConfirmDontAsk(false);
            setApplyConfirmOpen(true);
            return;
        }

        doSend(ssrpSettingsOverride, !shouldUseSessionHistoryConfig);
    };

    // 確認モーダル: 反映して送信
    const handleApplyConfirmApplyAndSend = async () => {
        const settingsToApply = pendingConfirmSettingsRef.current;
        setApplyConfirmOpen(false);
        if (!currentSessionId || !settingsToApply) return;
        try {
            const res = await applySSRPSettingsToSession(
                BACKEND_URL,
                currentSessionId,
                settingsToApply,
                applyConfirmDontAsk ? true : undefined
            );
            const saved = cloneSSRPConfig(res.ssrpSettings || settingsToApply);
            setSessionHistoryConfig(cloneSSRPConfig(saved));
            setIsConversationPresetChanged(false);
            setIsSSRPDirty(false);
            if (applyConfirmDontAsk) setSuppressApplyConfirm(true);
        } catch (e) {
            // 反映に失敗したのに送信すると「反映されたつもり」の会話が進むため中断する
            console.error('[Chat] Failed to apply SSRP settings before send:', e);
            window.alert(t(CHAT_VIEW_I18N_KEYS.applyToSessionFailed));
            return;
        }
        doSend(settingsToApply, true);
    };

    // 確認モーダル: 反映せずに送信（セッション保存値のまま送る）
    const handleApplyConfirmSendWithoutApply = async () => {
        setApplyConfirmOpen(false);
        if (applyConfirmDontAsk && currentSessionId) {
            try {
                await applySSRPSettingsToSession(BACKEND_URL, currentSessionId, undefined, true);
                setSuppressApplyConfirm(true);
            } catch (e) {
                console.error('[Chat] Failed to save suppress flag:', e);
            }
        }
        const base = cloneSSRPConfig(sessionHistoryConfig) || pendingConfirmSettingsRef.current;
        if (base) {
            base.lastModel = selectedModel;
        }
        doSend(base, false);
    };

    // 空の状態に出す「選んでいるキャラの数」。準備・調整欄の選択を、空の状態を出している間だけ見に行く
    const [selectedCharacterCount, setSelectedCharacterCount] = useState(0);
    const isConversationStarted = !!currentSessionId || !!currentSessionConfig;
    const isEmptyStateVisible = activeView === 'chat' && messages.length === 0 && !isConversationStarted;
    useEffect(() => {
        if (!isEmptyStateVisible) return;
        const check = () => {
            try {
                const chars = rolePlaySettingsRef.current?.getCurrentSettings()?.characters;
                setSelectedCharacterCount(Array.isArray(chars) ? chars.length : 0);
            } catch {
                // 読めなければ前の値のまま
            }
        };
        check();
        const id = window.setInterval(check, 1500);
        return () => window.clearInterval(id);
    }, [isEmptyStateVisible]);

    // 会話が始まった後は反映済みの参加者を出す。発言前の新しい会話はまだ会話設定が確定していないため、
    // 準備・調整欄の選択（外した・足したキャラ）をそのまま出す
    const headerCharacters: unknown[] = currentSessionId
        ? (currentSessionConfig?.characters || [])
        : (currentSessionConfig ? prepareCharacters : []);
    const participantNames: string[] = headerCharacters
        .filter((p: unknown): p is string => typeof p === 'string' && p !== '')
        .map((p: string) => extractSettingName(p) || p.split('/').pop()?.replace(/\.md$/i, '') || p);
    const startedTitle = currentSessionId
        ? currentSessionTitle
        // 言語設定でカスタムした SSRP_SESSION_TITLE を最優先し、
        // 無ければ UI 辞書（→JAフォールバック）で解決する（PWA版と同じ優先順。04調査 中#1）。
        : (languageSettings['SSRP_SESSION_TITLE'] || t(CHAT_VIEW_I18N_KEYS.newSessionTitle));

    // 設定画面にいるときは、関所を通してから移る
    const leaveCurrentView = (proceed: () => void) => {
        const guard = activeView === 'settings' ? settingsLeaveGuardRef.current : null;
        if (guard) guard(proceed); else proceed();
    };
    // 素材づくりを開く（依頼が無ければ前に見ていたタブのまま）
    const openMaterialView = (request?: MaterialRequest) => {
        setIsMaterialMounted(true);
        if (request) setMaterialRequest(request);
        setActiveView('material');
    };
    const openSettingsView = (category: SettingsCategory) => {
        setSettingsCategory(category);
        setActiveView('settings');
    };
    const navItems: AppNavItem[] = [
        {
            id: 'chat',
            label: t(CHAT_VIEW_I18N_KEYS.navChat),
            icon: <MessageSquare size={20} />,
            active: activeView === 'chat',
            onSelect: () => leaveCurrentView(() => setActiveView('chat')),
        },
        {
            id: 'history',
            label: t(CHAT_VIEW_I18N_KEYS.navHistory),
            icon: <History size={20} />,
            active: activeView === 'history',
            onSelect: () => leaveCurrentView(() => { void openHistoryView(); }),
        },
        {
            id: 'material',
            label: t(CHAT_VIEW_I18N_KEYS.navMaterial),
            icon: <Package size={20} />,
            active: activeView === 'material',
            onSelect: () => leaveCurrentView(() => openMaterialView({ tab: 'files' })),
        },
        {
            id: 'settings',
            label: t(CHAT_VIEW_I18N_KEYS.navSettings),
            icon: <Settings size={20} />,
            active: activeView === 'settings',
            onSelect: () => openSettingsView('general'),
        },
    ];

    // クイック設定に並べる、すべての会話に効く支援者向けの欄があるか
    const hasSupportPanels = (isFeatureEnabled(enabledFeatures, FEATURE_COMFYUI) && comfyModuleActive)
        || (isFeatureEnabled(enabledFeatures, FEATURE_TTS) && ttsModuleActive && (settings.uiLanguage || DEFAULT_UI_LANGUAGE) === 'ja');
    const useChatAreaBackground =
        settings.enableBackgroundImage &&
        (settings.backgroundImageFit ?? 'cover') === 'cover' &&
        (settings.backgroundImageScope ?? 'history') === 'chat';
    const chatInputAreaOpacity = settings.backgroundChatInputAreaMatchImageOpacity
        ? 0
        : (settings.backgroundChatInputAreaOpacity ?? 0.45);

    return (
        <div className="chat-viewport-shell flex app-bg text-fg">
            <NavRail items={navItems} className="hidden md:flex" />
            <div className="flex-1 min-w-0 flex flex-col relative">
            {/* 状態欄（見出しの「状態」から開く。キャラの状態と時刻を埋め込み表示）。クイック設定と同じく右から出す */}
            <Sheet
                open={isStatusDrawerOpen}
                onClose={() => setIsStatusDrawerOpen(false)}
                side="right"
                title={t(CHAT_VIEW_I18N_KEYS.statusMenu)}
                closeLabel={t(COMMON_I18N_KEYS.close)}
                widthClassName="w-full sm:w-[400px]"
            >
                <div className="p-3 space-y-3">
                {/* キャラクター状態パネル */}
                <CharacterStatusPanel
                    sessionId={currentSessionId}
                    backendUrl={BACKEND_URL}
                    isSSRP={isSSRP}
                    characterDetails={currentSessionConfig?.characterDetails || null}
                    selectedCharacters={currentSessionConfig?.characters || []}
                    parameterSchemaId={currentSessionConfig?.parameterSchemaId}
                    onUpdateCharacterDetails={(newDetails) => {
                        // B6: 会話設定メニュー(RolePlaySettings)側へも即時同期し、
                        // 送信・反映時のgetCurrentSettings()に状態パネルの変更を含める。
                        // updater 関数の中から別コンポーネントの状態を更新すると描画中の更新になり
                        // React が反映を保証しないため、先に合成してから両方へ別々に渡す。
                        const merged = { ...currentSessionConfig, characterDetails: newDetails };
                        setCurrentSessionConfig(merged);
                        rolePlaySettingsRef.current?.applySettings(merged);
                    }}
                    uiCatalog={uiCatalog}
                    isSessionDirty={!!currentSessionId && isSSRPDirty}
                    onApplyToSession={handleApplyToSession}
                    applyToSessionState={applyToSessionState}
                    embedded
                />

                {/* セッション時刻パネル（SSRPモード時のみ表示） */}
                {isSSRP && currentSessionConfig?.dateTimeSettings && (
                    <SessionTimePanel
                        dateTimeSettings={currentSessionConfig.dateTimeSettings}
                        onChange={(newDateTimeSettings) => {
                            // B6: UI2系統のstate統一。currentSessionConfig（単一ソース）を更新しつつ、
                            // 会話設定メニュー側(RolePlaySettings)へも即時同期し、両UIの食い違いを防ぐ。
                            // updater 関数の中から別コンポーネントの状態を更新すると描画中の更新になり
                            // React が反映を保証しないため、先に合成してから両方へ別々に渡す。
                            const merged = { ...currentSessionConfig, dateTimeSettings: newDateTimeSettings };
                            setCurrentSessionConfig(merged);
                            rolePlaySettingsRef.current?.applySettings(merged);
                        }}
                        uiCatalog={uiCatalog}
                        isSessionDirty={!!currentSessionId && isSSRPDirty}
                        onApplyToSession={handleApplyToSession}
                        applyToSessionState={applyToSessionState}
                        embedded
                    />
                )}

                </div>
            </Sheet>

            {/* クイック設定（見出しの「クイック設定」から開く。刷新前の左メニューにあった、すべての会話に効く設定） */}
            <Sheet
                open={isQuickSettingsOpen}
                onClose={() => setIsQuickSettingsOpen(false)}
                side="right"
                title={t(CHAT_VIEW_I18N_KEYS.headerQuickSettings)}
                closeLabel={t(COMMON_I18N_KEYS.close)}
                widthClassName="w-full sm:w-[400px]"
            >
                <div className="p-3 space-y-3">
                        <>
                        {/* タグ判定・ワークフロー設定パネル（支援者機能が有効 かつ モジュール
                            連携済みのときのみ表示。他の画像生成系 UI と同条件） */}
                        {isFeatureEnabled(enabledFeatures, FEATURE_COMFYUI) && comfyModuleActive && (
                            <TagJudgeWorkflowDrawerPanel
                                backendUrl={BACKEND_URL}
                                uiCatalog={uiCatalog}
                                active={isQuickSettingsOpen}
                                onBackendChange={setImageBackendSelection}
                            />
                        )}

                        {/* API サービスの残高パネル（バックエンドが API サービスのときだけ中身が表示される） */}
                        {isFeatureEnabled(enabledFeatures, FEATURE_COMFYUI) && comfyModuleActive && (
                            <ApiServiceBalancePanel
                                backendUrl={BACKEND_URL}
                                uiCatalog={uiCatalog}
                                active={isQuickSettingsOpen}
                                selection={imageBackendSelection}
                            />
                        )}

                        {/* 画像生成ジョブの単位（分析と生成をまとめる／分ける）とタグ有効/無効設定。
                            他のパネルと同じ開閉パネル（デフォルト閉）。表示条件はタグ判定・ワークフロー設定パネルと同じ。
                            パネルが開いていてドロワーが開くたびに設定を読み直す（他画面での変更を拾う） */}
                        {isFeatureEnabled(enabledFeatures, FEATURE_COMFYUI) && comfyModuleActive && (
                            <ImageGenDrawerControls
                                backendUrl={BACKEND_URL}
                                uiCatalog={uiCatalog}
                                active={isQuickSettingsOpen}
                                onOpenTags={() => {
                                    // 素材づくりへ移る前にクイック設定を閉じる（重なった欄の後ろに素材づくりが隠れないように）
                                    setIsQuickSettingsOpen(false);
                                    openMaterialView({ tab: 'tags' });
                                }}
                            />
                        )}

                        {/* TTS設定パネル（支援者機能が有効 かつ TTS連携済み かつ 日本語表示。
                            要件4章の「チャット欄左のメニュー」のトグル類。設計04の4章） */}
                        {isFeatureEnabled(enabledFeatures, FEATURE_TTS) && ttsModuleActive
                            && (settings.uiLanguage || DEFAULT_UI_LANGUAGE) === 'ja' && (
                            <TTSDrawerPanel
                                backendUrl={BACKEND_URL}
                                uiCatalog={uiCatalog}
                                active={isQuickSettingsOpen}
                            />
                        )}
                        </>
                </div>
            </Sheet>

            {/* ジョブ進行状況モーダル */}
            <JobProgressModal
                isOpen={isJobProgressOpen}
                onClose={() => setIsJobProgressOpen(false)}
                uiCatalog={uiCatalog}
            />



            {/* 本体・モジュール統合の更新告知モーダル（起動時チェックで更新検知時のみ） */}
            <UpdateModal
                isOpen={isUpdateModalOpen}
                app={appUpdateInfo}
                modules={moduleUpdateEntries}
                uiCatalog={uiCatalog}
                backendUrl={BACKEND_URL}
                onModulesChanged={modules => {
                    setComfyModuleActive(modules.some(m => m.id === MODULE_COMFY && m.active));
                    setTtsModuleActive(modules.some(m => m.id === MODULE_TTS && m.active));
                    void refreshFeatures();
                }}
                onClose={() => setIsUpdateModalOpen(false)}
                onLater={() => {
                    // 本体の「後で」は本体告知の当日中の再表示を抑止し、本体セクションだけを
                    // 消す（保存失敗しても消す。翌日以降は再表示されるだけで実害なし）。
                    // モジュール行は残す（行ごとの「後で」「スキップ」で独立に判断する）。
                    if (appUpdateInfo) {
                        saveUpdateSettings(BACKEND_URL, { postponeToday: true }).catch(() => {});
                    }
                    dismissAppUpdate();
                }}
                onSkip={() => {
                    if (appUpdateInfo) {
                        // 保存失敗しても消す（次回起動時に再表示されるだけで実害なし）
                        saveUpdateSettings(BACKEND_URL, { skippedVersion: appUpdateInfo.latest }).catch(() => {});
                    }
                    dismissAppUpdate();
                }}
                onModuleDismiss={dismissModuleUpdate}
            />

            {/* 承認済みモジュール更新の進行バナー（非モーダル。操作をブロックしない） */}
            {moduleApplyBanner && (
                <div
                    className={`fixed top-2 left-1/2 -translate-x-1/2 z-[70] flex items-center gap-3 px-4 py-2 rounded-lg border shadow-lg text-sm ${
                        moduleApplyBanner === 'applying'
                            ? 'bg-panel/95 border-warn/40 text-warn'
                            : moduleApplyBanner === 'done'
                                ? 'bg-panel/95 border-line-strong text-ok'
                                : 'bg-panel/95 border-danger/40 text-danger'
                    }`}
                >
                    <span>
                        {moduleApplyBanner === 'applying' && resolveMessage(uiCatalog, UPDATE_I18N_KEYS.moduleApplying, UPDATE_TEXT_FALLBACK_JA[UPDATE_I18N_KEYS.moduleApplying])}
                        {moduleApplyBanner === 'done' && resolveMessage(uiCatalog, UPDATE_I18N_KEYS.moduleApplyDone, UPDATE_TEXT_FALLBACK_JA[UPDATE_I18N_KEYS.moduleApplyDone])}
                        {moduleApplyBanner === 'partialFailed' && resolveMessage(uiCatalog, UPDATE_I18N_KEYS.moduleApplyPartialFailed, UPDATE_TEXT_FALLBACK_JA[UPDATE_I18N_KEYS.moduleApplyPartialFailed])}
                    </span>
                    <button
                        type="button"
                        onClick={() => setModuleApplyBanner(null)}
                        className="text-fg-muted hover:text-fg transition-colors"
                        aria-label="close"
                    >
                        <X size={16} />
                    </button>
                </div>
            )}


            {/* SSRP設定 未反映のまま送信時の確認モーダル */}
            {applyConfirmOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
                    <div className="bg-surface-solid rounded-xl shadow-2xl w-full max-w-md border border-line-strong overflow-hidden">
                        <div className="px-4 py-3 border-b border-line-strong bg-surface">
                            <h3 className="font-semibold text-fg">
                                {t(CHAT_VIEW_I18N_KEYS.applyConfirmTitle)}
                            </h3>
                        </div>
                        <div className="p-4 space-y-4">
                            <p className="text-sm text-fg-muted">
                                {t(CHAT_VIEW_I18N_KEYS.applyConfirmMessage)}
                            </p>
                            <label className="flex items-center gap-2 text-sm text-fg-muted cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    checked={applyConfirmDontAsk}
                                    onChange={(e) => setApplyConfirmDontAsk(e.target.checked)}
                                    className="rounded border-line-strong bg-surface"
                                />
                                {t(CHAT_VIEW_I18N_KEYS.applyConfirmDontAsk)}
                            </label>
                            <div className="flex flex-col gap-2">
                                <button
                                    onClick={handleApplyConfirmApplyAndSend}
                                    className="w-full px-4 py-2.5 bg-accent hover:brightness-110 rounded-lg text-sm font-semibold text-on-accent transition-colors"
                                >
                                    {t(CHAT_VIEW_I18N_KEYS.applyConfirmApplyAndSend)}
                                </button>
                                <button
                                    onClick={handleApplyConfirmSendWithoutApply}
                                    className="w-full px-4 py-2.5 bg-surface-2 hover:bg-surface-2 rounded-lg text-sm font-medium text-fg transition-colors"
                                >
                                    {t(CHAT_VIEW_I18N_KEYS.applyConfirmSendWithoutApply)}
                                </button>
                                <button
                                    onClick={() => setApplyConfirmOpen(false)}
                                    className="w-full px-4 py-2 hover:bg-surface rounded-lg text-sm text-fg-muted transition-colors"
                                >
                                    {t(COMMON_I18N_KEYS.cancel)}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ヘッダー下引き中の案内帯。引き量に応じて伸び、閾値到達で文言が変わる */}
            {pullToReload.pullDistance > 0 && (
                <div
                    className={`absolute top-0 left-0 right-0 z-30 flex items-end justify-center overflow-hidden pointer-events-none text-xs font-semibold transition-colors ${
                        pullToReload.isReady ? 'bg-accent text-on-accent' : 'bg-surface text-fg-muted'
                    }`}
                    style={{ height: `${Math.min(pullToReload.pullDistance, 96)}px` }}
                    aria-live="polite"
                >
                    <span className="pb-1">
                        {pullToReload.isReloading || pullToReload.isReady
                            ? t(CHAT_VIEW_I18N_KEYS.releaseToReload)
                            : t(CHAT_VIEW_I18N_KEYS.pullToReload)}
                    </span>
                </div>
            )}
            {activeView === 'history' && (
                <HistoryView
                    sessions={sessions}
                    currentSessionId={currentSessionId}
                    uiCatalog={uiCatalog}
                    onResume={(session) => { void handleResumeSessionWrapper(session); }}
                    onNew={() => { void handleNewSessionWrapper(); setActiveView('chat'); }}
                    deleteSession={deleteSession}
                    deleteSessions={deleteSessions}
                    onCurrentDeleted={() => handleNewSessionWrapper()}
                />
            )}

            {activeView === 'settings' && (
                <ReloadBoundary message={t(CHAT_VIEW_I18N_KEYS.viewLoadFailed)} reloadLabel={t(CHAT_VIEW_I18N_KEYS.reloadPage)}>
                <React.Suspense fallback={<div className="flex-1" />}>
                    <SettingsView
                        settings={settings}
                        onSave={saveSettings}
                        uiCatalog={uiCatalog}
                        onLogout={onLogout}
                        onModelsChanged={refreshModels}
                        onModulesChanged={modules => {
                            setComfyModuleActive(modules.some(m => m.id === MODULE_COMFY && m.active));
                            setTtsModuleActive(modules.some(m => m.id === MODULE_TTS && m.active));
                            void refreshFeatures();
                        }}
                        onOpenApiProviderInstruction={target => openMaterialView({ tab: 'files', apiProviderInstruction: target })}
                        imageGenAvailable={isImageGenAvailable(enabledFeatures, comfyModuleActive)}
                        ttsAvailable={isFeatureEnabled(enabledFeatures, FEATURE_TTS) && ttsModuleActive}
                        onOpenMaterial={tab => openMaterialView({ tab })}
                        initialCategory={settingsCategory}
                        registerLeaveGuard={registerSettingsLeaveGuard}
                    />
                </React.Suspense>
                </ReloadBoundary>
            )}

            {isMaterialMounted && (
                <div className={activeView === 'material' ? 'flex-1 min-h-0 flex flex-col' : 'hidden'}>
                    <ReloadBoundary message={t(CHAT_VIEW_I18N_KEYS.viewLoadFailed)} reloadLabel={t(CHAT_VIEW_I18N_KEYS.reloadPage)}>
                    <React.Suspense fallback={<div className="flex-1" />}>
                        <MaterialView
                            backendUrl={BACKEND_URL}
                            uiCatalog={uiCatalog}
                            imageGenEnabled={isImageGenAvailable(enabledFeatures, comfyModuleActive)}
                            ttsEnabled={isFeatureEnabled(enabledFeatures, FEATURE_TTS) && ttsModuleActive}
                            comfyDirectiveVisible={isFeatureEnabled(enabledFeatures, FEATURE_COMFYUI) && comfyModuleActive}
                            active={activeView === 'material'}
                            request={materialRequest}
                            onRequestConsumed={() => {
                                setMaterialRequest(null);
                                if (lazyReloadRecovery?.activeView === 'material') {
                                    hasLoadedRecoveredViewRef.current = true;
                                    clearCompletedLazyRecovery();
                                }
                            }}
                            sessionCharacterPaths={currentSessionConfig?.characters || []}
                        />
                    </React.Suspense>
                    </ReloadBoundary>
                </div>
            )}

            {/* 会話の画面。履歴を見ている間も会話設定の欄の状態を残すため、消さずに隠す */}
            <div className={activeView === 'chat' ? 'flex-1 min-h-0 flex flex-col' : 'hidden'}>
            <div className="flex flex-1 min-h-0 overflow-hidden relative">
                <main className="flex-1 min-h-0 overflow-hidden flex flex-col relative w-full h-full min-w-0">
                    {useChatAreaBackground && chatBackgroundUrl && (
                        <div className="absolute inset-0 pointer-events-none z-0">
                            <img
                                src={chatBackgroundUrl}
                                alt=""
                                className="w-full h-full object-cover"
                                style={{ opacity: settings.backgroundImageOpacity ?? 1.0 }}
                            />
                        </div>
                    )}
                    <ChatHeader
                        headerRef={headerRef}
                        title={currentSessionId ? currentSessionTitle : t(CHAT_VIEW_I18N_KEYS.headerNewConversation)}
                        subtitle={joinNames(uiCatalog, participantNames) || (isConversationStarted ? '' : t(CHAT_VIEW_I18N_KEYS.headerReadyHint))}
                        canEditTitle={!!currentSessionId}
                        showStatus={!!currentSessionId}
                        runningJobCount={runningJobCount}
                        isPrepareOpen={isRolePlaySettingsOpen}
                        onOpenStatus={() => setIsStatusDrawerOpen(true)}
                        showQuickSettings={hasSupportPanels}
                        isQuickSettingsOpen={isQuickSettingsOpen}
                        onToggleQuickSettings={() => setIsQuickSettingsOpen(v => !v)}
                        onTogglePrepare={isRolePlaySettingsOpen ? handleCloseRolePlaySettings : handleOpenRolePlaySettings}
                        onOpenJobs={() => setIsJobProgressOpen(true)}
                        onSaveTitle={(title) => (currentSessionId ? updateSessionTitle(currentSessionId, title) : Promise.resolve(false))}
                        t={t}
                        keys={{
                            status: CHAT_VIEW_I18N_KEYS.headerStatus,
                            prepare: CHAT_VIEW_I18N_KEYS.headerPrepare,
                            quickSettings: CHAT_VIEW_I18N_KEYS.headerQuickSettings,
                            jobsRunning: CHAT_VIEW_I18N_KEYS.headerJobsRunning,
                            titleEdit: CHAT_VIEW_I18N_KEYS.titleEdit,
                            save: COMMON_I18N_KEYS.save,
                            cancel: COMMON_I18N_KEYS.cancel,
                        }}
                    />

                    {messages.length === 0 ? (
                        <ChatEmptyState
                            started={isConversationStarted}
                            startedTitle={startedTitle}
                            selectedCharacterCount={selectedCharacterCount}
                            onOpenPrepare={handleOpenRolePlaySettings}
                            t={t}
                            keys={{
                                title: CHAT_VIEW_I18N_KEYS.emptyTitle,
                                lead: CHAT_VIEW_I18N_KEYS.emptyLead,
                                step1: CHAT_VIEW_I18N_KEYS.emptyStep1,
                                step1Count: CHAT_VIEW_I18N_KEYS.emptyStep1Count,
                                step1None: CHAT_VIEW_I18N_KEYS.emptyStep1None,
                                step2: CHAT_VIEW_I18N_KEYS.emptyStep2,
                                step2Note: CHAT_VIEW_I18N_KEYS.emptyStep2Note,
                                step3: CHAT_VIEW_I18N_KEYS.emptyStep3,
                                step3Note: CHAT_VIEW_I18N_KEYS.emptyStep3Note,
                                startedInstruction: CHAT_VIEW_I18N_KEYS.emptyInstruction,
                            }}
                        />
                    ) : (
                        <MessageList
                            messages={messages}
                            settings={settings}
                            editingState={editingState}
                            onEditStart={(msgId, turnIndex, content) => setEditingState({ messageId: msgId, turnIndex: turnIndex, content })}
                            onEditCancel={() => setEditingState(null)}
                            onEditSave={handleSaveEdit}
                            onEditChange={(content) => editingState && setEditingState({ ...editingState, content })}
                            onRegenerate={handleRegenerate}
                            onRegenerateWithModel={handleRegenerateWithModel}
                            regenerateClaudeEffort={regenerateClaudeEffort}
                            regenerateAntigravityThinking={regenerateAntigravityThinking}
                            models={models}
                            selectedModel={selectedModel}
                            selectedModelProvider={selectedModelProvider}
                            isLoading={isLoading}
                            backendUrl={BACKEND_URL}
                            sessionId={currentSessionId || undefined}
                            characterPaths={currentSessionConfig?.characters || []}
                            onActiveBackgroundChange={setChatBackgroundUrl}
                            uiCatalog={uiCatalog}
                            enabledFeatures={enabledFeatures}
                            imageGenEnabled={isImageGenAvailable(enabledFeatures, comfyModuleActive)}
                            ttsEnabled={isFeatureEnabled(enabledFeatures, FEATURE_TTS) && ttsModuleActive}
                            ttsEmojiList={ttsEmojiList}
                            getTTSPresetVoiceDesign={getTTSPresetVoiceDesign}
                            getAutoImageExcludedCharacters={getAutoImageExcludedCharacters}
                            actionChoices={actionChoices}
                            selectedChoice={selectedChoice}
                            onSelectChoice={setSelectedChoice}
                        />
                    )}

                    <div className="relative z-[1] shrink-0">
                        <MessageInput
                            modelPickerTopBoundaryRef={headerRef}
                            input={input}
                            isLoading={isLoading}
                            disabled={isRestoringSession || tempImport.running}
                            onSend={handleSendWrapper}
                            onStop={handleStop}
                            onInputChange={handleInputChange}
                            models={models}
                            selectedModel={selectedModel}
                            onSelectModel={setSelectedModel}
                            selectedModelProvider={selectedModelProvider}
                            onSelectModelProvider={setSelectedModelProvider}
                            onOpenModelSettings={() => openSettingsView('ai')}
                            claudeEffort={claudeEffort}
                            onSelectClaudeEffort={selectClaudeEffort}
                            antigravityThinking={antigravityThinking}
                            onSelectAntigravityThinking={selectAntigravityThinking}
                            antigravityStreamGuardLimit={antigravityStreamGuardLimit}
                            onSelectAntigravityStreamGuardLimit={selectAntigravityStreamGuardLimit}
                            responseTimeoutMinutes={responseTimeoutMinutes}
                            onSelectResponseTimeoutMinutes={selectResponseTimeoutMinutes}
                            geminiTempFileMode={geminiTempFileMode}
                            onToggleGeminiTempFileMode={setGeminiTempFileMode}
                            showBackgroundThrough={useChatAreaBackground && !!chatBackgroundUrl}
                            backgroundAreaOpacity={chatInputAreaOpacity}
                            uiCatalog={uiCatalog}
                            allowEmptySend={!!selectedChoice}
                            chatSendKey={settings.chatSendKey}
                        />
                    </div>
                </main>

                {/* SSRP設定サイドバー */}
                <RolePlaySettings
                    ref={rolePlaySettingsRef}
                    key={ssrpResetKey}
                    isOpen={isRolePlaySettingsOpen}
                    onClose={handleCloseRolePlaySettings}
                    onStartSession={handleNewSessionWrapper}
                    initialSettings={currentSessionConfig}
                    onInitialized={applyLazyReloadRecovery}
                    backendUrl={BACKEND_URL}
                    canRestoreSessionSettings={!!currentSessionId && !!sessionHistoryConfig}
                    onConversationPresetChanged={handleConversationPresetChanged}
                    onRestoreSessionSettings={handleRestoreSessionSettings}
                    fallbackDirectiveMode={'C'}
                    defaultUserNameSetting={settings.defaultUserName}
                    onOpenCharacterEditor={target => {
                        // 設定ファイルエディタ（設定ファイルタブ）でそのキャラクター本体を開く
                        openMaterialView({ tab: 'files', openFile: { categoryId: 'character', dirName: target.dirName, fileName: target.fileName } });
                    }}
                    imageGenSettingsVisible={isFeatureEnabled(enabledFeatures, FEATURE_COMFYUI) && comfyModuleActive}
                    onOpenIntegratedImageSettings={isFeatureEnabled(enabledFeatures, FEATURE_COMFYUI) && comfyModuleActive
                        ? characterName => {
                            // 素材づくりのキャラで、そのキャラを選んで開く
                            openMaterialView({ tab: 'images', character: characterName });
                        }
                        : undefined}
                    ttsSettingsVisible={isFeatureEnabled(enabledFeatures, FEATURE_TTS) && ttsModuleActive}
                    onOpenIntegratedTTSSettings={isFeatureEnabled(enabledFeatures, FEATURE_TTS) && ttsModuleActive
                        ? characterName => {
                            // 声の紐づけも素材づくりのキャラにあるので、そのキャラを選び、声の紐づけを開く
                            openMaterialView({ tab: 'images', character: characterName, section: 'voice' });
                        }
                        : undefined}
                    uiCatalog={uiCatalog}
                    canApplyToSession={!!currentSessionId && isSSRPDirty}
                    charactersChangedFromSession={!!currentSessionId && charactersChangedFromSession}
                    onApplyToSession={handleApplyToSession}
                    applyToSessionState={applyToSessionState}
                    sessionId={currentSessionId}
                    messages={messages}
                    tempImport={tempImport}
                    onSessionSettingsUpdated={handleSessionSettingsUpdated}
                    onCharactersChange={setPrepareCharacters}
                />
            </div>
            </div>

            <TabBar items={navItems} className="flex md:hidden" />
            </div>
        </div>
    );
};
