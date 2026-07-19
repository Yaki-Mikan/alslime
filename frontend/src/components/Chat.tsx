/**
 * Chat.tsx - チャット画面メインコンポーネント
 * 
 * アプリケーションのメイン画面。
 * ロジックは useChat / useSession フックに移譲し、
 * UIは MessageList / MessageInput 等のサブコンポーネントに移譲している。
 * このファイルはこれらを統合し、レイアウトとモーダル管理を担当する。
 */

import React, { useState, useEffect } from 'react';
import { Code2, Menu, FolderTree, Plus, History, Settings, X, Edit, Activity, NotebookPen, Trash2, ListChecks } from 'lucide-react';
import axios from '../lib/axios';

// Components
import { StatusDrawer } from './StatusDrawer';
import { CharacterStatusPanel } from './CharacterStatusPanel';
import { SessionTimePanel } from './SessionTimePanel';
import { SettingsModal } from './SettingsModal';
import { AIModelSettingsModal } from './settings/AIModelSettingsModal';
import { DEFAULT_SETTINGS } from '../types/Settings';
import type { Settings as SettingsType } from '../types/Settings';
import { JobProgressModal } from './JobProgressModal';
import { ConfigEditorHub } from './settings/ConfigEditorHub';
import { FEATURE_COMFYUI, isFeatureEnabled } from '../constants/features';
import { MessageList } from './chat/MessageList';

import { MessageInput } from './chat/MessageInput';
import { HamburgerMenu } from './SSRP/HamburgerMenu';
import { RolePlaySettings } from './SSRP/RolePlaySettings';
import type { RolePlaySettingsHandlers } from './SSRP/RolePlaySettings';
import { getGlobalSettings } from '../api/global-settings';
import { applySSRPSettingsToSession } from '../api/ssrp';
import {
    CHAT_VIEW_I18N_KEYS,
    CHAT_VIEW_TEXT_FALLBACK_JA,
    COMMON_I18N_KEYS,
    COMMON_TEXT_FALLBACK_JA,
    DEFAULT_UI_LANGUAGE
} from '../constants/i18n';
import {
    fetchI18NCatalog,
    resolveMessage,
    type I18NCatalog
} from '../api/i18n';
import { BACKEND_URL } from '../api/base-url';
import { fetchSystemHealth } from '../api/system';

// Hooks
import { useChat } from '../hooks/useChat';
import { useSession } from '../hooks/useSession';
import type { Session } from '../hooks/useSession';

const DEFAULT_SSRP_LANGUAGE = 'ja';

interface ChatProps {
    // ローカル実行版（認証なし）では渡されない。未指定なら設定画面のログアウトボタンも出ない。
    onLogout?: () => void;
}

const cloneSSRPConfig = (config: any) => config ? JSON.parse(JSON.stringify(config)) : null;

// キー順に依存しない比較用のstringify（オブジェクトのキーを再帰的にソート）
const stableStringify = (value: any): string => {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`;
    }
    const keys = Object.keys(value).sort();
    return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
};

// dirty比較用の正規化。
// lastModel等の実行記録キーと、characterDetails内のUI開閉状態は設定差分として扱わない。
const normalizeSSRPForComparison = (config: any): any => {
    if (!config) return null;
    const normalized = cloneSSRPConfig(config);
    delete normalized.lastModel;
    if (normalized.characterDetails && typeof normalized.characterDetails === 'object') {
        for (const key of Object.keys(normalized.characterDetails)) {
            const detail = normalized.characterDetails[key];
            if (detail && typeof detail === 'object') {
                delete detail.isOpen;
                delete detail.isCorrelationOpen;
            }
        }
    }
    return normalized;
};

const isSSRPConfigDifferent = (a: any, b: any): boolean =>
    stableStringify(normalizeSSRPForComparison(a)) !== stableStringify(normalizeSSRPForComparison(b));

export const Chat: React.FC<ChatProps> = ({ onLogout }) => {
    // UI State (ローカル)
    // セッション状態ドロワー（ヘッダー左のハンバーガーメニューから開く）
    const [isStatusDrawerOpen, setIsStatusDrawerOpen] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    // チャット欄のモデル選択右のアイコンボタンから直接開くAIモデル設定モーダル
    const [isModelSettingsOpen, setIsModelSettingsOpen] = useState(false);
    const [isJobProgressOpen, setIsJobProgressOpen] = useState(false);
    const [runningJobCount, setRunningJobCount] = useState(0);

    const [isRolePlaySettingsOpen, setIsRolePlaySettingsOpen] = useState(false);
    const [isConfigEditorOpen, setIsConfigEditorOpen] = useState(false);

    // 設定 State
    const [settings, setSettings] = useState<SettingsType>(DEFAULT_SETTINGS);
    const [chatBackgroundUrl, setChatBackgroundUrl] = useState<string | null>(null);

    // SSRP設定リセット用キー
    const [ssrpResetKey, setSsrpResetKey] = useState(0);
    // 現在のセッションのSSRP設定（復元用）
    const [currentSessionConfig, setCurrentSessionConfig] = useState<any>(null);
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
    const hasSessionContextRef = React.useRef(false);

    // SSRPモードフラグ（常時true: 全セッションがSSRPモード）
    const isSSRP = true;

    // 言語設定 State
    const [languageSettings, setLanguageSettings] = useState<Record<string, string>>({});
    // backend の tier gate（機能フラグ）。ここで一度だけ取得して子コンポーネントへ配布する
    //（MessageList / SettingsModal での都度取得をやめる。04調査 中#4）。
    const [enabledFeatures, setEnabledFeatures] = useState<Record<string, boolean> | null>(null);
    // UI表示用 i18n 辞書 State
    const [uiCatalog, setUiCatalog] = useState<I18NCatalog | null>(null);
    const t = (key: string) => resolveMessage(
        uiCatalog,
        key,
        CHAT_VIEW_TEXT_FALLBACK_JA[key] || COMMON_TEXT_FALLBACK_JA[key] || key
    );
    const formatText = (template: string, values: Record<string, string | number>) =>
        Object.entries(values).reduce((text, [key, value]) => text.split(`{{${key}}}`).join(String(value)), template);

    // UI辞書は SSRP 置換用 languageSettings と別系統で管理する。
    const loadUICatalog = React.useCallback(async (lang: string) => {
        try {
            const catalog = await fetchI18NCatalog(BACKEND_URL, lang || DEFAULT_UI_LANGUAGE);
            setUiCatalog(catalog);
        } catch (e) {
            console.warn('Failed to load UI i18n catalog');
        }
    }, []);

    // モバイルのプル・トゥ・リフレッシュ後に 100dvh が過大評価される端末があるため、
    // 実際の表示 viewport 高をチャット外枠の高さとして同期する。
    useEffect(() => {
        const setViewportHeight = () => {
            const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
            document.documentElement.style.setProperty('--chat-viewport-height', `${Math.round(viewportHeight)}px`);
        };

        setViewportHeight();
        const rafId = requestAnimationFrame(setViewportHeight);
        const timeoutId = window.setTimeout(setViewportHeight, 250);

        window.visualViewport?.addEventListener('resize', setViewportHeight);
        window.addEventListener('resize', setViewportHeight);
        window.addEventListener('orientationchange', setViewportHeight);
        window.addEventListener('pageshow', setViewportHeight);

        return () => {
            cancelAnimationFrame(rafId);
            window.clearTimeout(timeoutId);
            window.visualViewport?.removeEventListener('resize', setViewportHeight);
            window.removeEventListener('resize', setViewportHeight);
            window.removeEventListener('orientationchange', setViewportHeight);
            window.removeEventListener('pageshow', setViewportHeight);
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
                const loadedSettings = { ...DEFAULT_SETTINGS, ...res.data };
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
            const normalizedSettings = { ...DEFAULT_SETTINGS, ...newSettings };
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
        isSessionModalOpen,
        setIsSessionModalOpen,
        currentSessionTitle,
        currentSessionId,
        setCurrentSessionId,
        handleNewSession: sessionHandleNewSession,
        handleResumeSession: sessionHandleResumeSession,
        openSessionModal,
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
        actionChoices,
        selectedChoice,
        setSelectedChoice,
        handleSend,
        handleStop,
        handleRegenerate,
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
            // タイトル更新（必要に応じて）
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

    // タイトル編集用 State
    const [isTitleEditing, setIsTitleEditing] = useState(false);
    const [titleEditValue, setTitleEditValue] = useState('');

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

        const modelType = selectedModel?.startsWith('claude-')
            ? 'claude'
            : selectedModel?.startsWith('antigravity')
                ? 'antigravity'
                : 'gemini';
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

                // 最後に使用したモデルを復元
                if (activeConfig.lastModel) {
                    console.log('[Chat] Restoring last used model:', activeConfig.lastModel);
                    setSelectedModel(activeConfig.lastModel);
                }
            }

            if (!activeConfig) {
                setCurrentSessionConfig(null);
                setSessionHistoryConfig(null);
                setIsConversationPresetChanged(false);
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

    // セッション削除の確認対象（履歴モーダルのゴミ箱ボタンで設定し、確認モーダルを開く）
    const [deleteConfirmSession, setDeleteConfirmSession] = useState<{ id: string; title: string } | null>(null);

    const handleDeleteSessionConfirm = async () => {
        if (!deleteConfirmSession) return;
        const target = deleteConfirmSession;
        setDeleteConfirmSession(null);
        const ok = await deleteSession(target.id);
        if (!ok) {
            window.alert(t(CHAT_VIEW_I18N_KEYS.deleteSessionFailed));
            return;
        }
        // 開いているセッション自身を削除した場合は、消えた履歴を表示し続けないよう新規セッション状態へ戻す
        if (currentSessionId === target.id) {
            await handleNewSessionWrapper();
        }
    };

    // 履歴行ホバー時のセッション情報ツールチップ（大画面のみ表示。モーダルが
    // overflow-y-auto でクリップするため fixed 配置し、行の右横へ出す）
    const [hoveredSessionInfo, setHoveredSessionInfo] = useState<{ session: Session; top: number; left: number } | null>(null);

    // まとめて削除モード（履歴モーダル右上のボタンで切替。モーダルを閉じると解除される）
    const [isSessionSelectMode, setIsSessionSelectMode] = useState(false);
    const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set());
    const [isBulkDeleteConfirmOpen, setIsBulkDeleteConfirmOpen] = useState(false);

    const resetSessionSelectMode = () => {
        setIsSessionSelectMode(false);
        setSelectedSessionIds(new Set());
        setIsBulkDeleteConfirmOpen(false);
    };

    const openSessionModalWrapper = async () => {
        resetSessionSelectMode();
        await openSessionModal();
    };

    const closeSessionModal = () => {
        setIsSessionModalOpen(false);
        resetSessionSelectMode();
    };

    const toggleSessionSelectMode = () => {
        if (isSessionSelectMode) {
            resetSessionSelectMode();
        } else {
            setIsSessionSelectMode(true);
        }
    };

    const toggleSessionSelection = (sessionId: string) => {
        setSelectedSessionIds(prev => {
            const next = new Set(prev);
            if (next.has(sessionId)) {
                next.delete(sessionId);
            } else {
                next.add(sessionId);
            }
            return next;
        });
    };

    const handleBulkDeleteConfirm = async () => {
        const targetIds = Array.from(selectedSessionIds);
        setIsBulkDeleteConfirmOpen(false);
        if (targetIds.length === 0) return;
        const { deletedIds, failedCount } = await deleteSessions(targetIds);
        // 消えた分は選択からも外す（失敗した分は選択を残して再試行できるようにする）
        setSelectedSessionIds(prev => {
            const next = new Set(prev);
            deletedIds.forEach(id => next.delete(id));
            return next;
        });
        if (failedCount > 0) {
            window.alert(t(CHAT_VIEW_I18N_KEYS.deleteSessionFailed));
        }
        // 開いているセッションが削除対象に含まれていた場合は新規セッション状態へ戻す
        if (currentSessionId && deletedIds.includes(currentSessionId)) {
            await handleNewSessionWrapper();
        }
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

    // dirty監視: セッション保存値スナップショット(sessionHistoryConfig)とUI現在値を定期比較する。
    // RolePlaySettings内部の全変更に個別フックを張るより、この軽量ポーリングのほうが確実。
    // ただしUIから設定を変更できるのはメニューが開いている間だけなので、ポーリングもその間に限定する。
    // メニュー外からの変更（キャラ状態パネル・日時パネル・セッション復元）はすべて
    // setCurrentSessionConfig を経由するため、依存変化によるeffect再実行時の即時checkで拾える。
    useEffect(() => {
        if (!currentSessionId || !sessionHistoryConfig) {
            setIsSSRPDirty(false);
            return;
        }
        const check = () => {
            try {
                const ui = rolePlaySettingsRef.current?.getCurrentSettings() ?? currentSessionConfig;
                if (!ui) {
                    setIsSSRPDirty(false);
                    return;
                }
                setIsSSRPDirty(isSSRPConfigDifferent(ui, sessionHistoryConfig));
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

    const useChatAreaBackground =
        settings.enableBackgroundImage &&
        (settings.backgroundImageFit ?? 'cover') === 'cover' &&
        (settings.backgroundImageScope ?? 'history') === 'chat';
    const chatInputAreaOpacity = settings.backgroundChatInputAreaMatchImageOpacity
        ? 0
        : (settings.backgroundChatInputAreaOpacity ?? 0.45);

    return (
        <div className="chat-viewport-shell flex flex-col bg-gray-950 text-gray-100 relative">
            {/* セッション状態ドロワー（ハンバーガーメニューから開く。💛状態と⌚時刻を埋め込み表示） */}
            <StatusDrawer
                isOpen={isStatusDrawerOpen}
                onClose={() => setIsStatusDrawerOpen(false)}
                uiCatalog={uiCatalog}
            >
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
                        setCurrentSessionConfig((prev: any) => {
                            const merged = { ...prev, characterDetails: newDetails };
                            rolePlaySettingsRef.current?.applySettings(merged);
                            return merged;
                        });
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
                            setCurrentSessionConfig((prev: any) => {
                                const merged = { ...prev, dateTimeSettings: newDateTimeSettings };
                                rolePlaySettingsRef.current?.applySettings(merged);
                                return merged;
                            });
                        }}
                        uiCatalog={uiCatalog}
                        isSessionDirty={!!currentSessionId && isSSRPDirty}
                        onApplyToSession={handleApplyToSession}
                        applyToSessionState={applyToSessionState}
                        embedded
                    />
                )}
            </StatusDrawer>

            {/* ジョブ進行状況モーダル */}
            <JobProgressModal
                isOpen={isJobProgressOpen}
                onClose={() => setIsJobProgressOpen(false)}
                uiCatalog={uiCatalog}
            />

            {/* 設定ファイルエディタ（支援者は画像生成統合設定とタブ切り替え可。設計 §9） */}
            <ConfigEditorHub
                isOpen={isConfigEditorOpen}
                onClose={() => setIsConfigEditorOpen(false)}
                backendUrl={BACKEND_URL}
                uiCatalog={uiCatalog}
                imageGenEnabled={isFeatureEnabled(enabledFeatures, FEATURE_COMFYUI)}
            />

            {/* 設定モーダル */}
            <SettingsModal
                isOpen={isSettingsOpen}
                onClose={() => setIsSettingsOpen(false)}
                settings={settings}
                onSave={saveSettings}
                onLogout={onLogout}
                uiCatalog={uiCatalog}
                enabledFeatures={enabledFeatures}
                onModelsChanged={refreshModels}
            />

            {/* AIモデル設定モーダル（チャット欄のモデル選択右のアイコンボタンから直接開く） */}
            <AIModelSettingsModal
                isOpen={isModelSettingsOpen}
                onClose={() => setIsModelSettingsOpen(false)}
                uiCatalog={uiCatalog}
                onModelsChanged={refreshModels}
            />

            {/* SSRP設定 未反映のまま送信時の確認モーダル */}
            {applyConfirmOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
                    <div className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-md border border-gray-700 overflow-hidden">
                        <div className="px-4 py-3 border-b border-gray-700 bg-gray-800">
                            <h3 className="font-semibold text-gray-100">
                                {t(CHAT_VIEW_I18N_KEYS.applyConfirmTitle)}
                            </h3>
                        </div>
                        <div className="p-4 space-y-4">
                            <p className="text-sm text-gray-300">
                                {t(CHAT_VIEW_I18N_KEYS.applyConfirmMessage)}
                            </p>
                            <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    checked={applyConfirmDontAsk}
                                    onChange={(e) => setApplyConfirmDontAsk(e.target.checked)}
                                    className="rounded border-gray-600 bg-gray-800"
                                />
                                {t(CHAT_VIEW_I18N_KEYS.applyConfirmDontAsk)}
                            </label>
                            <div className="flex flex-col gap-2">
                                <button
                                    onClick={handleApplyConfirmApplyAndSend}
                                    className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-semibold text-white transition-colors"
                                >
                                    {t(CHAT_VIEW_I18N_KEYS.applyConfirmApplyAndSend)}
                                </button>
                                <button
                                    onClick={handleApplyConfirmSendWithoutApply}
                                    className="w-full px-4 py-2.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-medium text-gray-200 transition-colors"
                                >
                                    {t(CHAT_VIEW_I18N_KEYS.applyConfirmSendWithoutApply)}
                                </button>
                                <button
                                    onClick={() => setApplyConfirmOpen(false)}
                                    className="w-full px-4 py-2 hover:bg-gray-800 rounded-lg text-sm text-gray-400 transition-colors"
                                >
                                    {t(COMMON_I18N_KEYS.cancel)}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* セッション履歴モーダル */}
            {isSessionModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
                    <div className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-md border border-gray-700 overflow-hidden">
                        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-gray-800">
                            <h3 className="flex items-center gap-2 font-semibold text-gray-100">
                                <History size={18} className="text-blue-400" />
                                {t(CHAT_VIEW_I18N_KEYS.sessionHistory)}
                            </h3>
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={toggleSessionSelectMode}
                                    className={`p-1.5 hover:bg-gray-700 rounded transition-colors ${isSessionSelectMode ? 'text-blue-400 bg-gray-700/50' : 'text-gray-400 hover:text-gray-200'}`}
                                    title={t(CHAT_VIEW_I18N_KEYS.deleteSessionSelectMode)}
                                >
                                    <ListChecks size={18} />
                                </button>
                                <button
                                    onClick={closeSessionModal}
                                    className="p-1.5 hover:bg-gray-700 rounded text-gray-400 hover:text-gray-200 transition-colors"
                                >
                                    <X size={18} />
                                </button>
                            </div>
                        </div>
                        <div className="max-h-96 overflow-y-auto">
                            {sessions.length === 0 ? (
                                <div className="p-4 text-center text-gray-500">
                                    {t(CHAT_VIEW_I18N_KEYS.noSessionHistory)}
                                </div>
                            ) : (
                                sessions.map((session) => (
                                    <div
                                        key={session.id}
                                        className="flex items-center border-b border-gray-700/50"
                                        onMouseEnter={(e) => {
                                            const rect = e.currentTarget.getBoundingClientRect();
                                            setHoveredSessionInfo({ session, top: rect.top, left: rect.right + 8 });
                                        }}
                                        onMouseLeave={() => setHoveredSessionInfo(null)}
                                    >
                                        {isSessionSelectMode ? (
                                            // 選択モード中は行クリックでチェックをトグルする（再開はしない）
                                            <button
                                                onClick={() => toggleSessionSelection(session.id)}
                                                className="flex-1 min-w-0 flex items-center gap-3 text-left px-4 py-3 hover:bg-gray-800 transition-colors"
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={selectedSessionIds.has(session.id)}
                                                    readOnly
                                                    className="pointer-events-none shrink-0 rounded border-gray-600 bg-gray-800"
                                                />
                                                <div className="flex-1 min-w-0">
                                                    <div className="font-medium text-gray-200 truncate">
                                                        {session.title}
                                                    </div>
                                                    <div className="text-xs text-gray-500">
                                                        {session.timeAgo}
                                                    </div>
                                                </div>
                                            </button>
                                        ) : (
                                            <>
                                                <button
                                                    onClick={() => handleResumeSessionWrapper(session)}
                                                    className="flex-1 min-w-0 text-left px-4 py-3 hover:bg-gray-800 transition-colors"
                                                >
                                                    <div className="font-medium text-gray-200 truncate">
                                                        {session.title}
                                                    </div>
                                                    <div className="text-xs text-gray-500">
                                                        {session.timeAgo}
                                                    </div>
                                                </button>
                                                <button
                                                    onClick={() => {
                                                        setHoveredSessionInfo(null);
                                                        setDeleteConfirmSession({ id: session.id, title: session.title });
                                                    }}
                                                    className="p-2 mr-2 hover:bg-gray-700 rounded text-gray-500 hover:text-red-400 transition-colors shrink-0"
                                                    title={t(CHAT_VIEW_I18N_KEYS.deleteSession)}
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                        {/* 選択モード中のみ表示するまとめて削除フッター */}
                        {isSessionSelectMode && (
                            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-700 bg-gray-800">
                                <span className="text-sm text-gray-400">
                                    {formatText(t(COMMON_I18N_KEYS.selectedCount), { count: selectedSessionIds.size })}
                                </span>
                                <button
                                    onClick={() => setIsBulkDeleteConfirmOpen(true)}
                                    disabled={selectedSessionIds.size === 0}
                                    className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:pointer-events-none rounded-lg text-sm font-semibold text-white transition-colors"
                                >
                                    {t(COMMON_I18N_KEYS.delete)}
                                </button>
                            </div>
                        )}
                    </div>
                    {/* 履歴行ホバー時のセッション情報ツールチップ（lg以上の大画面のみ。
                        モーダルのスクロール領域にクリップされないよう fixed で行の右横へ出す） */}
                    {hoveredSessionInfo && (() => {
                        const info = hoveredSessionInfo.session;
                        const rows = [
                            { label: t(CHAT_VIEW_I18N_KEYS.sessionInfoPreset), value: info.presetName || '' },
                            { label: t(CHAT_VIEW_I18N_KEYS.sessionInfoCharacters), value: (info.characters || []).join(', ') },
                            { label: t(CHAT_VIEW_I18N_KEYS.sessionInfoSituations), value: (info.situations || []).join(', ') },
                        ].filter((row) => row.value);
                        if (rows.length === 0) return null;
                        return (
                            <div
                                className="hidden lg:block fixed z-[60] w-64 pointer-events-none bg-gray-800 border border-gray-600 rounded-lg shadow-xl px-3 py-2 space-y-1"
                                style={{
                                    top: Math.min(hoveredSessionInfo.top, window.innerHeight - 160),
                                    left: hoveredSessionInfo.left
                                }}
                            >
                                {rows.map((row) => (
                                    <div key={row.label} className="text-xs">
                                        <span className="text-gray-500">{row.label}: </span>
                                        <span className="text-gray-200 break-all">{row.value}</span>
                                    </div>
                                ))}
                            </div>
                        );
                    })()}
                </div>
            )}

            {/* セッション削除の確認モーダル（履歴モーダルの上に重ねる） */}
            {deleteConfirmSession && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
                    <div className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-md border border-gray-700 overflow-hidden">
                        <div className="px-4 py-3 border-b border-gray-700 bg-gray-800">
                            <h3 className="font-semibold text-gray-100">
                                {t(CHAT_VIEW_I18N_KEYS.deleteSession)}
                            </h3>
                        </div>
                        <div className="p-4 space-y-4">
                            <div className="font-medium text-gray-200 truncate">
                                {deleteConfirmSession.title}
                            </div>
                            <p className="text-sm text-gray-300">
                                {t(CHAT_VIEW_I18N_KEYS.deleteSessionConfirmMessage)}
                            </p>
                            <div className="flex flex-col gap-2">
                                <button
                                    onClick={handleDeleteSessionConfirm}
                                    className="w-full px-4 py-2.5 bg-red-600 hover:bg-red-500 rounded-lg text-sm font-semibold text-white transition-colors"
                                >
                                    {t(COMMON_I18N_KEYS.delete)}
                                </button>
                                <button
                                    onClick={() => setDeleteConfirmSession(null)}
                                    className="w-full px-4 py-2 hover:bg-gray-800 rounded-lg text-sm text-gray-400 transition-colors"
                                >
                                    {t(COMMON_I18N_KEYS.cancel)}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* まとめて削除の確認モーダル（履歴モーダルの上に重ねる） */}
            {isBulkDeleteConfirmOpen && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
                    <div className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-md border border-gray-700 overflow-hidden">
                        <div className="px-4 py-3 border-b border-gray-700 bg-gray-800">
                            <h3 className="font-semibold text-gray-100">
                                {t(CHAT_VIEW_I18N_KEYS.deleteSession)}
                            </h3>
                        </div>
                        <div className="p-4 space-y-4">
                            <p className="text-sm text-gray-300">
                                {formatText(t(CHAT_VIEW_I18N_KEYS.deleteSessionBulkConfirmMessage), { count: selectedSessionIds.size })}
                            </p>
                            <div className="flex flex-col gap-2">
                                <button
                                    onClick={handleBulkDeleteConfirm}
                                    className="w-full px-4 py-2.5 bg-red-600 hover:bg-red-500 rounded-lg text-sm font-semibold text-white transition-colors"
                                >
                                    {t(COMMON_I18N_KEYS.delete)}
                                </button>
                                <button
                                    onClick={() => setIsBulkDeleteConfirmOpen(false)}
                                    className="w-full px-4 py-2 hover:bg-gray-800 rounded-lg text-sm text-gray-400 transition-colors"
                                >
                                    {t(COMMON_I18N_KEYS.cancel)}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <header className="px-4 pt-3 pb-2 sm:py-0 border-b border-gray-700 bg-gray-950/80 backdrop-blur-sm sticky top-0 z-10 sm:h-16 sm:flex sm:justify-between sm:items-center">
                {/* 1段目：タイトル行（常時表示） */}
                <div className="flex justify-between items-center sm:contents">
                    <div className="flex items-center gap-3">
                        {/* セッション状態ドロワーを開く。会話中のみ表示し、💛状態と同じピンク色にする */}
                        {currentSessionId && (
                            <button
                                onClick={() => setIsStatusDrawerOpen(true)}
                                className="p-2 -ml-2 hover:bg-gray-800 rounded-lg text-pink-400 hover:text-pink-300 transition-colors"
                                title={t(CHAT_VIEW_I18N_KEYS.statusMenu)}
                            >
                                <Menu size={24} />
                            </button>
                        )}
                        <div className="flex items-center gap-2">
                            <img src="/icons/app.png" alt="AlSlime" className="w-6 h-6" />
                            <h1 className="font-bold text-lg hidden sm:block">AlSlime</h1>
                            <h1 className="font-bold text-lg sm:hidden">AlSlime</h1>
                        </div>
                    </div>

                    {/* ボタン群：sm以上は1段目の右側、sm未満は1段目の右端に新規セッションのみ */}
                    <div className="flex items-center gap-1 sm:gap-2">
                        <button
                            onClick={() => handleNewSessionWrapper()}
                            className="p-2 hover:bg-gray-800 rounded-full text-gray-400 hover:text-green-400 transition-colors"
                            title={t(CHAT_VIEW_I18N_KEYS.newSession)}
                        >
                            <Plus size={20} />
                        </button>
                        <button
                            onClick={openSessionModalWrapper}
                            className="hidden sm:flex p-2 hover:bg-gray-800 rounded-full text-gray-400 hover:text-blue-400 transition-colors"
                            title={t(CHAT_VIEW_I18N_KEYS.sessionHistory)}
                        >
                            <History size={20} />
                        </button>
                        <button
                            onClick={() => setIsJobProgressOpen(true)}
                            className="hidden sm:flex relative p-2 hover:bg-gray-800 rounded-full text-gray-400 hover:text-gray-200 transition-colors"
                            title={t(CHAT_VIEW_I18N_KEYS.jobProgress)}
                        >
                            <Activity size={20} />
                            {runningJobCount > 0 && (
                                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 text-[10px] font-bold bg-blue-500 text-white rounded-full flex items-center justify-center leading-none">
                                    {runningJobCount}
                                </span>
                            )}
                        </button>
                        <button
                            onClick={() => setIsConfigEditorOpen(true)}
                            className="hidden sm:flex p-2 hover:bg-gray-800 rounded-full text-gray-400 hover:text-purple-400 transition-colors"
                            title={t(CHAT_VIEW_I18N_KEYS.configEditor)}
                        >
                            <NotebookPen size={20} />
                        </button>
                        <button
                            onClick={() => setIsSettingsOpen(true)}
                            className="hidden sm:flex p-2 hover:bg-gray-800 rounded-full text-gray-400 hover:text-yellow-400 transition-colors"
                            title={t(CHAT_VIEW_I18N_KEYS.settings)}
                        >
                            <Settings size={20} />
                        </button>
                        <HamburgerMenu
                            isOpen={isRolePlaySettingsOpen}
                            onClick={handleOpenRolePlaySettings}
                            uiCatalog={uiCatalog}
                        />
                    </div>
                </div>

                {/* 2段目：sm未満のみ表示 */}
                <div className="flex sm:hidden items-center justify-end gap-1 mt-1 pb-1">
                    <button
                        onClick={openSessionModalWrapper}
                        className="p-2 hover:bg-gray-800 rounded-full text-gray-400 hover:text-blue-400 transition-colors"
                        title={t(CHAT_VIEW_I18N_KEYS.sessionHistory)}
                    >
                        <History size={20} />
                    </button>
                    <button
                        onClick={() => setIsJobProgressOpen(true)}
                        className="relative p-2 hover:bg-gray-800 rounded-full text-gray-400 hover:text-gray-200 transition-colors"
                        title={t(CHAT_VIEW_I18N_KEYS.jobProgress)}
                    >
                        <Activity size={20} />
                        {runningJobCount > 0 && (
                            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 text-[10px] font-bold bg-blue-500 text-white rounded-full flex items-center justify-center leading-none">
                                {runningJobCount}
                            </span>
                        )}
                    </button>
                    <button
                        onClick={() => setIsConfigEditorOpen(true)}
                        className="p-2 hover:bg-gray-800 rounded-full text-gray-400 hover:text-purple-400 transition-colors"
                        title={t(CHAT_VIEW_I18N_KEYS.configEditor)}
                    >
                        <NotebookPen size={20} />
                    </button>
                    <button
                        onClick={() => setIsSettingsOpen(true)}
                        className="p-2 hover:bg-gray-800 rounded-full text-gray-400 hover:text-yellow-400 transition-colors"
                        title={t(CHAT_VIEW_I18N_KEYS.settings)}
                    >
                        <Settings size={20} />
                    </button>
                </div>
            </header>

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
                    {/* タイトル表示エリア（セッション開始後のみ） */}
                    {currentSessionId && (
                        <div className="relative z-[1] border-b border-gray-700 bg-gray-950/80 backdrop-blur-sm">
                            {isTitleEditing ? (
                                <div className="p-3">
                                    <textarea
                                        value={titleEditValue}
                                        onChange={(e) => setTitleEditValue(e.target.value)}
                                        className="w-full bg-gray-800 border border-gray-700 text-gray-200 rounded p-2 text-sm resize-none outline-none focus:border-blue-500 transition-colors"
                                        rows={2}
                                        autoFocus
                                        onKeyDown={(e) => {
                                            if (e.key === 'Escape') {
                                                setIsTitleEditing(false);
                                            }
                                        }}
                                    />
                                    <div className="flex gap-2 mt-2">
                                        <button
                                            onClick={async () => {
                                                if (currentSessionId && titleEditValue.trim()) {
                                                    const success = await updateSessionTitle(currentSessionId, titleEditValue.trim());
                                                    if (success) {
                                                        setIsTitleEditing(false);
                                                    }
                                                }
                                            }}
                                            className="px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded text-sm text-white transition-colors"
                                        >
                                            {t(COMMON_I18N_KEYS.save)}
                                        </button>
                                        <button
                                            onClick={() => setIsTitleEditing(false)}
                                            className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm"
                                        >
                                            {t(COMMON_I18N_KEYS.cancel)}
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="px-4 py-2 flex items-center justify-between group">
                                    <h2 className="text-sm font-medium text-gray-300">{currentSessionTitle}</h2>
                                    <button
                                        onClick={() => {
                                            setTitleEditValue(currentSessionTitle);
                                            setIsTitleEditing(true);
                                        }}
                                        className="opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity p-1 hover:bg-gray-800 rounded text-gray-400 hover:text-white"
                                        title={t(CHAT_VIEW_I18N_KEYS.titleEdit)}
                                    >
                                        <Edit size={16} />
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    {messages.length === 0 ? (
                        <div className="relative z-[1] flex-1 flex items-center justify-center p-4">
                            <div className="text-center text-gray-500 max-w-md">
                                <div className="flex justify-center gap-4 mb-6">
                                    <Code2 size={40} className="text-gray-700" />
                                    <FolderTree size={40} className="text-gray-700" />
                                </div>
                                <p className="font-medium mb-2">
                                    {!currentSessionId
                                        // 言語設定でカスタムした SSRP_SESSION_TITLE を最優先し、
                                        // 無ければ UI 辞書（→JAフォールバック）で解決する（PWA版と同じ優先順。04調査 中#1）。
                                        ? (languageSettings['SSRP_SESSION_TITLE'] || t(CHAT_VIEW_I18N_KEYS.newSessionTitle))
                                        : currentSessionTitle}
                                </p>
                                <p className="text-sm">{t(CHAT_VIEW_I18N_KEYS.emptyInstruction)}</p>
                            </div>
                        </div>
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
                            isLoading={isLoading}
                            backendUrl={BACKEND_URL}
                            sessionId={currentSessionId || undefined}
                            onActiveBackgroundChange={setChatBackgroundUrl}
                            uiCatalog={uiCatalog}
                            enabledFeatures={enabledFeatures}
                            actionChoices={actionChoices}
                            selectedChoice={selectedChoice}
                            onSelectChoice={setSelectedChoice}
                        />
                    )}

                    <div className="relative z-[1] shrink-0">
                        <MessageInput
                            input={input}
                            isLoading={isLoading}
                            disabled={isRestoringSession}
                            onSend={handleSendWrapper}
                            onStop={handleStop}
                            onInputChange={handleInputChange}
                            models={models}
                            selectedModel={selectedModel}
                            onSelectModel={setSelectedModel}
                            selectedModelProvider={selectedModelProvider}
                            onSelectModelProvider={setSelectedModelProvider}
                            onOpenModelSettings={() => setIsModelSettingsOpen(true)}
                            geminiTempFileMode={geminiTempFileMode}
                            onToggleGeminiTempFileMode={setGeminiTempFileMode}
                            showBackgroundThrough={useChatAreaBackground && !!chatBackgroundUrl}
                            backgroundAreaOpacity={chatInputAreaOpacity}
                            uiCatalog={uiCatalog}
                            allowEmptySend={!!selectedChoice}
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
                    backendUrl={BACKEND_URL}
                    canRestoreSessionSettings={!!currentSessionId && !!sessionHistoryConfig}
                    onConversationPresetChanged={handleConversationPresetChanged}
                    onRestoreSessionSettings={handleRestoreSessionSettings}
                    fallbackDirectiveMode={'C'}
                    defaultUserNameSetting={settings.defaultUserName}
                    uiCatalog={uiCatalog}
                    canApplyToSession={!!currentSessionId && isSSRPDirty}
                    onApplyToSession={handleApplyToSession}
                    applyToSessionState={applyToSessionState}
                />
            </div>
        </div>
    );
};
