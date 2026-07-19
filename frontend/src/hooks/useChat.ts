/**
 * useChat.ts - チャット機能コアロジック
 * 
 * チャットのメインロジックを提供するカスタムフック。
 * - メッセージの送受信
 * - リジェネレート
 * - メッセージ編集
 * - ファイル参照展開
 * - 状態管理（メッセージ、入力、モデル選択など）
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import axios from '../lib/axios';
import { getGlobalSettings } from '../api/global-settings';
import type { Settings as SettingsType } from '../types/Settings';
import { CHAT_VIEW_I18N_KEYS, CHAT_VIEW_LOCALIZED_TEXT, CHAT_VIEW_TEXT_FALLBACK_JA } from '../constants/i18n';
import { resolveMessage, type I18NCatalog } from '../api/i18n';

// 型定義
export interface Message {
    id?: string;
    role: 'user' | 'agent';
    content: string;
    model?: string;
    sessionTime?: { year: number; month: number; day: number; hour: number; minute: number; second?: number };
    /** TURN単位の絶対時刻（content内の[TURN]出現順。各TURNバブルの時刻表示に使用） */
    turnTimes?: { year: number; month: number; day: number; hour: number; minute: number; second?: number }[];
}

export interface Model {
    id: string;
    name: string;
    description: string;
    /** 経路種別（サーバのマージ結果が確定値を持つ。旧レスポンス互換のため任意） */
    provider?: ModelProvider;
}

export type ModelProvider = 'antigravity' | 'claude' | 'gemini';

export const getModelProvider = (modelId: string): ModelProvider => {
    if (modelId.startsWith('antigravity')) return 'antigravity';
    if (modelId.startsWith('claude-')) return 'claude';
    return 'gemini';
};

/** モデルの実効プロバイダ。サーバ確定値（ユーザーの明示指定を反映済み）を優先し、無ければ ID 推定。 */
export const modelProviderOf = (model: { id: string; provider?: ModelProvider }): ModelProvider => {
    return model.provider || getModelProvider(model.id);
};

// モデルリストの正本はサーバの AVAILABLE_MODELS (/api/models)。
// クライアントはベタ書きを持たず、取得できるまでは空のまま扱う。

/**
 * TURNタグ内のコンテンツを置換するヘルパー関数
 */
export const replaceTurnContent = (fullContent: string, turnIndex: number, newTurnContent: string): string => {
    // emotion/scene属性（オプショナル）＋未知の属性に対応した正規表現
    const TURN_REGEX = /\[TURN\s+character="([^"]+)"(?:\s+emotion="([^"]+)")?(?:\s+scene="([^"]+)")?(?:\s+\w+="[^"]*")*\]([\s\S]*?)\[\/TURN\]/g;

    // TURNタグが存在するか確認
    if (TURN_REGEX.test(fullContent)) {
        TURN_REGEX.lastIndex = 0; // Reset
        let currentValidIndex = 0; // 空でないTURNのカウント用

        return fullContent.replace(TURN_REGEX, (match, charName, emotion, scene, content) => {
            // パーサー(multiCharacterParser.ts)と同様に、空白のみのコンテンツはスキップしてカウントしない
            if (content.trim().length === 0) {
                return match;
            }

            if (currentValidIndex === turnIndex) {
                currentValidIndex++;
                // emotion/sceneがある場合は保持する
                const emotionAttr = emotion ? ` emotion="${emotion}"` : '';
                const sceneAttr = scene ? ` scene="${scene}"` : '';
                return `[TURN character="${charName}"${emotionAttr}${sceneAttr}]
${newTurnContent}
[/TURN]`;
            }
            currentValidIndex++;
            return match;
        });
    }

    // TURNタグがない場合（ユーザー発言など）は、全体を置換
    return newTurnContent;
};

import type { SSRPSettings } from '../api/ssrp';

// JA固定のフォールバック（catalog未取得時と、過去メッセージのローカルエラー判定用）。
const LOCAL_ERROR_PREFIX_JA = CHAT_VIEW_TEXT_FALLBACK_JA[CHAT_VIEW_I18N_KEYS.errorPrefix];
const localizedChatViewText = (lang: string | undefined, text: Record<'ja' | 'en', string>) => (
    lang?.startsWith('en') ? text.en : text.ja
);

interface UseChatProps {
    backendUrl: string;
    settings: SettingsType;
    currentSessionId: string | null;
    onSessionCreated?: (sessionId: string) => void;
    // 履歴の自動ロードを無効化するフラグ（useSession側で管理する場合など）
    disableAutoLoadHistory?: boolean;
    // SSRP設定 (初回メッセージ注入用)
    ssrpSettings?: SSRPSettings | null;
    // UI辞書。ジョブエラー等の messageKey を表示言語へ解決するのに使う。
    catalog?: I18NCatalog | null;
}

interface ChatSubmitPayload {
    message: string;
    model: string;
    sessionId: string | null;
    temperature: number;
    directiveMode: string;
    ssrpSettings: SSRPSettings | null | undefined;
    antigravityTempFileMode: boolean;
    geminiTempFileMode: boolean;
}

interface LastSubmitAttempt {
    payload: ChatSubmitPayload;
    displayMessage: string;
}

export const useChat = ({ backendUrl, settings, currentSessionId, onSessionCreated, disableAutoLoadHistory = false, ssrpSettings, catalog }: UseChatProps) => {
    // ローカル文言は uiLanguage の辞書で解決する（従来はJA固定だった。04調査 低#6）。
    const uiText = (key: string) => resolveMessage(catalog ?? null, key, CHAT_VIEW_TEXT_FALLBACK_JA[key] || key);
    // ローカルエラー判定は現在言語のプレフィックスとJAフォールバックの両方を見る
    //（言語切替後も過去のエラーメッセージを判定できるように）。
    const isLocalErrorMessage = (message: Message): boolean => (
        message.role === 'agent' &&
        (message.content.startsWith(uiText(CHAT_VIEW_I18N_KEYS.errorPrefix)) ||
            message.content.startsWith(LOCAL_ERROR_PREFIX_JA))
    );
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    // 編集モードState
    const [editingState, setEditingState] = useState<{
        messageId: string;
        turnIndex: number;
        content: string;
    } | null>(null);

    // モデル選択
    const [models, setModels] = useState<Model[]>([]);
    const [selectedModel, setSelectedModel] = useState<string>('antigravity');
    const [selectedModelProvider, setSelectedModelProvider] = useState<ModelProvider>('antigravity');
    // プロバイダ別デフォルトモデル（グローバル設定 defaultModels）。
    // プロバイダ切替時の初期モデル選択に使う。
    const [defaultModels, setDefaultModels] = useState<Record<string, string>>({});
    const [antigravityTempFileMode, setAntigravityTempFileMode] = useState(false);
    const [geminiTempFileMode, setGeminiTempFileMode] = useState(false);

    // ファイル添付
    const [attachedFiles, setAttachedFiles] = useState<string[]>([]);

    // 行動選択肢（支援者向け）。最新の応答に付いた選択肢と、ユーザーの選択状態。
    // 永続化はしない（リロードで消える。設計 6.1 の v1 仕様）。
    const [actionChoices, setActionChoices] = useState<string[] | null>(null);
    const [selectedChoice, setSelectedChoice] = useState<string | null>(null);

    const currentSessionIdRef = useRef<string | null>(currentSessionId);
    const lastSubmitAttemptRef = useRef<LastSubmitAttempt | null>(null);
    // アンマウント後のポーリング継続・setState を止めるフラグ（04調査 中#3）。
    const disposedRef = useRef(false);

    useEffect(() => {
        disposedRef.current = false;
        return () => { disposedRef.current = true; };
    }, []);

    useEffect(() => {
        currentSessionIdRef.current = currentSessionId;
    }, [currentSessionId]);

    // モデル一覧を取得。モデル編集モーダルの保存後にも再取得する（refreshModels）。
    const refreshModels = useCallback(async () => {
        try {
            const res = await axios.get(`${backendUrl}/api/models`);
            if (res.data.models) {
                setModels(res.data.models);
            }
        } catch (error) {
            console.error('[useChat] /api/models fetch failed; model list stays empty:', error);
        }
    }, [backendUrl]);

    useEffect(() => {
        refreshModels();
    }, [refreshModels]);

    // 起動時にグローバル設定を読み、デフォルトプロバイダとプロバイダ別
    // デフォルトモデルを初期選択へ反映する（セッション復元の lastModel は
    // 会話を開いた時点で上書きされるため競合しない）。
    useEffect(() => {
        let cancelled = false;
        (async () => {
            const settings = await getGlobalSettings(backendUrl);
            if (cancelled || disposedRef.current) return;
            const dm = (settings.defaultModels || {}) as Record<string, string>;
            setDefaultModels(dm);
            const dp = settings.defaultProvider as ModelProvider | undefined;
            if (dp === 'gemini' || dp === 'claude' || dp === 'antigravity') {
                setSelectedModelProvider(dp);
                if (dm[dp]) {
                    setSelectedModel(dm[dp]);
                }
            } else if (dm['antigravity']) {
                // デフォルトプロバイダ未設定でも、初期プロバイダ(antigravity)の
                // デフォルトモデルは反映する。
                setSelectedModel(dm['antigravity']);
            }
        })();
        return () => { cancelled = true; };
    }, [backendUrl]);

    useEffect(() => {
        if (models.length === 0) return;
        const current = models.find(m => m.id === selectedModel);
        const currentProvider = current ? modelProviderOf(current) : getModelProvider(selectedModel);
        if (currentProvider === selectedModelProvider) return;

        // プロバイダ別デフォルトモデルが設定されていればそれを優先し、
        // 無ければ従来どおり一覧の先頭モデルへフォールバックする。
        const preferredId = defaultModels[selectedModelProvider];
        const nextModel =
            (preferredId && models.find(m => m.id === preferredId && modelProviderOf(m) === selectedModelProvider)) ||
            models.find(m => modelProviderOf(m) === selectedModelProvider);
        if (nextModel) {
            setSelectedModel(nextModel.id);
        }
    }, [models, selectedModel, selectedModelProvider, defaultModels]);

    useEffect(() => {
        if (selectedModelProvider !== 'antigravity' && antigravityTempFileMode) {
            setAntigravityTempFileMode(false);
        }
    }, [selectedModelProvider, antigravityTempFileMode]);

    useEffect(() => {
        if (selectedModelProvider !== 'gemini' && geminiTempFileMode) {
            setGeminiTempFileMode(false);
        }
    }, [selectedModelProvider, geminiTempFileMode]);

    // セッション履歴のロード関数（再利用可能）
    const loadHistory = async (sessionId: string) => {
        try {
            const res = await axios.get(`${backendUrl}/api/chat/history/${sessionId}`);
            // アンマウント後の setState を防ぐ（遅延実行経由で呼ばれるため）。
            if (disposedRef.current) return;
            // fetch中・遅延実行（ジョブ完了1.5秒後の再読込等）の間に別セッションへ
            // 切り替わっていたら、閲覧中セッションの表示を他セッションの履歴で
            // 上書きしない（セッション混線ガード）。
            if (currentSessionIdRef.current !== sessionId) {
                console.log('[Frontend] loadHistory skipped: viewing session changed', { loaded: sessionId, visible: currentSessionIdRef.current });
                return;
            }
            if (res.data.messages) {
                setMessages(res.data.messages);
            }
        } catch (error) {
            console.error("Failed to load session history:", error);
        }
    };

    // セッション履歴の自動ロード
    useEffect(() => {
        setEditingState(null);
        // 選択肢は最新応答専用（別セッションへ持ち越さない）。
        setActionChoices(null);
        setSelectedChoice(null);
        // 自動ロードが無効、またはIDがない場合はスキップ
        if (disableAutoLoadHistory || !currentSessionId) return;
        loadHistory(currentSessionId);
    }, [currentSessionId, backendUrl, disableAutoLoadHistory]);

    // ジョブステータスをポーリングする関数
    // mode: 'append' = 新規メッセージとして追加（chat送信）
    //       'replace-last-agent' = 最後のagentメッセージを置換（regenerate）
    const pollJobStatus = async (
        jobId: string,
        mode: 'append' | 'replace-last-agent' = 'append',
        targetSessionId: string | null = currentSessionId
    ) => {
        setIsLoading(true); // ポーリング中はローディング状態にする
        const maxAttempts = 300; // 10分間（2秒 × 300回）
        let attempts = 0;

        const isTargetVisible = (finalSessionId?: string | null) => {
            const visibleSessionId = currentSessionIdRef.current;
            if (finalSessionId) {
                return visibleSessionId === finalSessionId || (!targetSessionId && !visibleSessionId);
            }
            return visibleSessionId === targetSessionId;
        };

        const poll = async () => {
            // アンマウント後はポーリング・setState を止める（04調査 中#3）。
            if (disposedRef.current) return;
            if (attempts >= maxAttempts) {
                console.error('[Frontend] Job polling timeout');
                if (isTargetVisible()) {
                    setMessages(prev => [...prev, { role: 'agent', content: uiText(CHAT_VIEW_I18N_KEYS.errorTimeout) }]);
                }
                setIsLoading(false);
                return;
            }

            try {
                const res = await axios.get(`${backendUrl}/api/chat/status/${jobId}`);
                const { status, result, error, sessionId: finalSessionId } = res.data;

                if (status === 'completed') {
                    const usedModelId = res.data.model || selectedModel;
                    const selectedModelInfo = models.find(m => m.id === usedModelId);
                    const usedModel = selectedModelInfo?.description || usedModelId || 'Default';
                    const { sessionTime } = res.data;
                    const finalSessionReplacesTarget = !!finalSessionId && !!targetSessionId && finalSessionId !== targetSessionId;
                    const shouldUpdateVisibleHistory = isTargetVisible(finalSessionId) || finalSessionReplacesTarget;

                    if (shouldUpdateVisibleHistory && mode === 'replace-last-agent') {
                        // 最後のagentメッセージを置換（regenerate用）。resultが空の場合は置換しない
                        if (result) {
                            setMessages(prev => {
                                const newMessages = [...prev];
                                for (let i = newMessages.length - 1; i >= 0; i--) {
                                    if (newMessages[i].role === 'agent') {
                                        newMessages[i] = { role: 'agent', content: result, model: usedModel, sessionTime };
                                        break;
                                    }
                                }
                                return newMessages;
                            });
                        }
                    } else if (shouldUpdateVisibleHistory) {
                        // 新規追加（通常チャット用）
                        setMessages(prev => [...prev, { role: 'agent', content: result, model: usedModel, sessionTime }]);
                    }

                    // セッション情報更新
                    if (shouldUpdateVisibleHistory && finalSessionId && (!targetSessionId || finalSessionReplacesTarget) && onSessionCreated) {
                        onSessionCreated(finalSessionId);
                        console.log('[Frontend] New session created:', finalSessionId);
                    }

                    // 履歴を再読み込み
                    if (shouldUpdateVisibleHistory && finalSessionId) {
                        setTimeout(() => loadHistory(finalSessionId), 1500);
                    }

                    // 行動選択肢（支援者向け）。付いていれば最新応答の選択肢として差し替える。
                    if (shouldUpdateVisibleHistory) {
                        const choices = res.data.actionChoices;
                        setActionChoices(Array.isArray(choices) && choices.length > 0 ? choices : null);
                        setSelectedChoice(null);
                    }

                    setIsLoading(false);
                    return; // ポーリング終了
                } else if (status === 'error') {
                    console.error('[Frontend] Job failed:', error);
                    if (isTargetVisible()) {
                        // error は messageKey（i18nキー）または生文字列。
                        // catalog にキーがあれば表示言語へ解決し、無ければ元の文字列をそのまま出す。
                        const localizedError = resolveMessage(catalog ?? null, error, error);
                        setMessages(prev => [...prev, { role: 'agent', content: `${uiText(CHAT_VIEW_I18N_KEYS.errorPrefix)} ${localizedError}` }]);
                    }
                    setIsLoading(false);
                    return; // ポーリング終了
                } else if (status === 'canceled') {
                    console.log('[Frontend] Job canceled:', jobId);
                    setIsLoading(false);
                    return;
                }

                // まだ処理中 → 2秒後に再ポーリング
                attempts++;
                setTimeout(poll, 2000);
            } catch (err: any) {
                if (err.response?.status === 404) {
                    console.warn('[Frontend] Job no longer exists:', jobId);
                    setIsLoading(false);
                    return;
                }
                console.error('[Frontend] Polling error:', err);
                attempts++;
                setTimeout(poll, 2000);
            }
        };

        poll();
    };

    const handleSend = async (overrideSsrpSettings?: any) => {
        // 行動選択肢を選択済みなら、入力空でも送信できる（選択肢だけの送信）。
        const choiceText = selectedChoice?.trim() ?? '';
        if (!input.trim() && attachedFiles.length === 0 && !choiceText) return;
        if (isLoading) return;

        // 選択肢＋チャット入力の合成（設計 6.2）: 両方あれば「選択肢 改行 入力」で両方送る。
        const typedText = input;
        const rawUserMsg = choiceText
            ? (typedText.trim() ? `${choiceText}\n${typedText}` : choiceText)
            : typedText;
        setInput('');
        // 選択肢は送信した時点で畳む（次の応答の選択肢に置き換わる）。
        setActionChoices(null);
        setSelectedChoice(null);

        // SSRP設定の注入処理
        const activeSsrpSettings = overrideSsrpSettings || ssrpSettings;

        const promptToProcess = rawUserMsg;

        // UI表示用
        const attachmentLabel = localizedChatViewText(settings.uiLanguage, CHAT_VIEW_LOCALIZED_TEXT.attachmentLabel);
        const displayMsg = attachedFiles.length > 0
            ? `${rawUserMsg}\n\n📎 ${attachmentLabel}: ${attachedFiles.map(f => f.split('/').pop()).join(', ')}`
            : rawUserMsg;

        setMessages(prev => [...prev, { role: 'user', content: displayMsg }]);
        setIsLoading(true);

        try {
            // 添付ファイルを展開
            const attachedContexts: string[] = [];
            for (const filePath of attachedFiles) {
                try {
                    const res = await axios.get(`${backendUrl}/api/content`, {
                        params: { path: filePath }
                    });
                    attachedContexts.push(`[FILE_CONTEXT path="${filePath}"]\n${res.data.content}\n[/FILE_CONTEXT]`);
                } catch (error) {
                    console.error(`Failed to load attached file: ${filePath}`);
                }
            }

            setAttachedFiles([]);

            // 結合
            const finalMessage = attachedContexts.length > 0
                ? `${attachedContexts.join('\n\n')}\n\n${promptToProcess}`
                : promptToProcess;

            // ジョブ送信（ジョブキュー方式）
            const submitPayload: ChatSubmitPayload = {
                message: finalMessage,
                model: selectedModel,
                sessionId: currentSessionId,
                temperature: settings.temperature,
                directiveMode: activeSsrpSettings?.directiveMode || 'C',
                ssrpSettings: activeSsrpSettings,
                antigravityTempFileMode,
                geminiTempFileMode
            };
            lastSubmitAttemptRef.current = { payload: submitPayload, displayMessage: displayMsg };

            const res = await axios.post(`${backendUrl}/api/chat/submit`, submitPayload);

            const { jobId } = res.data;
            console.log('[Frontend] Job submitted:', jobId);

            // ポーリング開始
            pollJobStatus(jobId, 'append', currentSessionId);

        } catch (error: any) {
            // 409: 同セッション処理中 → 既存ジョブにアタッチしてポーリング
            if (error.response?.status === 409 && error.response.data?.existingJobId) {
                console.log('[Frontend] Already processing, attaching to existing job:', error.response.data.existingJobId);
                pollJobStatus(error.response.data.existingJobId, 'append', currentSessionId);
                return;
            }
            console.error(error);
            const errMsg = error.response?.data?.error || error.message || uiText(CHAT_VIEW_I18N_KEYS.errorGeneric);
            setMessages(prev => [...prev, { role: 'agent', content: `${uiText(CHAT_VIEW_I18N_KEYS.errorPrefix)} ${errMsg}` }]);
            setIsLoading(false);
        }
    };

    const handleStop = async () => {
        try {
            await axios.post(`${backendUrl}/api/abort`);
            console.log('Backend process aborted');
        } catch (error) {
            console.error('Failed to abort backend process', error);
        }
    };

    const handleRegenerate = async () => {
        if (isLoading) return;

        if (!currentSessionId) {
            const retryAttempt = lastSubmitAttemptRef.current;
            if (!retryAttempt) return;

            const canRetryVisibleError = messages.some((msg, index) => (
                index === messages.length - 1 &&
                isLocalErrorMessage(msg) &&
                messages[index - 1]?.role === 'user' &&
                messages[index - 1]?.content === retryAttempt.displayMessage
            ));
            if (!canRetryVisibleError) return;

            setMessages(prev => (
                prev.length > 0 && isLocalErrorMessage(prev[prev.length - 1])
                    ? prev.slice(0, -1)
                    : prev
            ));
            setIsLoading(true);

            try {
                const res = await axios.post(`${backendUrl}/api/chat/submit`, retryAttempt.payload);
                const { jobId } = res.data;
                console.log('[Frontend] Retry job submitted:', jobId);
                pollJobStatus(jobId, 'append', retryAttempt.payload.sessionId);
            } catch (error: any) {
                if (error.response?.status === 409 && error.response.data?.existingJobId) {
                    console.log('[Frontend] Already processing, attaching to existing job:', error.response.data.existingJobId);
                    pollJobStatus(error.response.data.existingJobId, 'append', retryAttempt.payload.sessionId);
                    return;
                }
                console.error('[Frontend] Retry failed:', error);
                const errMsg = error.response?.data?.error || error.message || uiText(CHAT_VIEW_I18N_KEYS.errorGeneric);
                setMessages(prev => [...prev, { role: 'agent', content: `${uiText(CHAT_VIEW_I18N_KEYS.errorPrefix)} ${errMsg}` }]);
                setIsLoading(false);
            }
            return;
        }

        try {
            const res = await axios.post(`${backendUrl}/api/regenerate`, {
                sessionId: currentSessionId,
                temperature: settings.temperature,
                ssrpSettings: ssrpSettings || undefined,
                antigravityTempFileMode,
                geminiTempFileMode
            });

            const { jobId } = res.data;
            console.log('[Frontend] Regenerate job submitted:', jobId);

            // ポーリング開始（最後のagentメッセージを置換）
            pollJobStatus(jobId, 'replace-last-agent', currentSessionId);
        } catch (error: any) {
            // 409: 同セッション処理中 → 既存ジョブにアタッチしてポーリング
            if (error.response?.status === 409 && error.response.data?.existingJobId) {
                console.log('[Frontend] Already processing, attaching to existing job:', error.response.data.existingJobId);
                pollJobStatus(error.response.data.existingJobId, 'replace-last-agent', currentSessionId);
                return;
            }
            console.error('[Frontend] Regenerate failed:', error);
            const errMsg = error.response?.data?.error || error.message || uiText(CHAT_VIEW_I18N_KEYS.errorGeneric);
            setMessages(prev => [...prev, { role: 'agent', content: `${uiText(CHAT_VIEW_I18N_KEYS.errorPrefix)} ${errMsg}` }]);
        }
    };

    const handleSaveEdit = async () => {
        if (!editingState || !currentSessionId) return;

        try {
            const targetMessage = messages.find(m => m.id === editingState.messageId);
            if (!targetMessage) return;

            const newContent = replaceTurnContent(targetMessage.content, editingState.turnIndex, editingState.content);

            await axios.post(`${backendUrl}/api/chat/history/update`, {
                sessionId: currentSessionId,
                messageId: editingState.messageId,
                content: newContent
            });

            setMessages(prev => prev.map(m =>
                m.id === editingState.messageId
                    ? { ...m, content: newContent }
                    : m
            ));

            setEditingState(null);

        } catch (error: any) {
            console.error('Failed to update message:', error);
            const errMsg = error.response?.data?.error || error.message || uiText(CHAT_VIEW_I18N_KEYS.errorUnknown);
            alert(`${uiText(CHAT_VIEW_I18N_KEYS.saveFailedPrefix)}: ${errMsg}`);
        }
    };

    return {
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
        antigravityTempFileMode,
        setAntigravityTempFileMode,
        geminiTempFileMode,
        setGeminiTempFileMode,
        attachedFiles,
        setAttachedFiles,
        actionChoices,
        selectedChoice,
        setSelectedChoice,
        handleSend,
        handleStop,
        handleRegenerate,
        handleSaveEdit,
        pollJobStatus, // ポーリング関数をエクスポート
        loadHistory // 履歴読み込み関数もエクスポート（ジョブ完了後に使用）
    };
};
