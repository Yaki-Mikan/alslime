/**
 * MessageInput.tsx - メッセージ入力コンポーネント
 *
 * チャットの入力エリアを提供するコンポーネント。
 * - 多段テキストエリア（自動リサイズ）
 * - 送信ボタン
 * - ストップボタン（生成中）
 * - 使う AI とモデルの札（押すと選択欄を並べた小さな窓が開く）
 */

import React, { useRef, useEffect, useState } from 'react';
import { Send, Square, Settings, Cpu, ChevronUp } from 'lucide-react';
import { KeyboardSafeSelect } from '../common/KeyboardSafeSelect';
import { keepFocusOnPointerDown } from '../../lib/pointer';
import { visibleViewportBounds } from '../../lib/viewport';
import type { Model, ModelProvider } from '../../hooks/useChat';
import { modelProviderOf } from '../../hooks/useChat';
import { formatPair, resolveMessage, type I18NCatalog } from '../../api/i18n';
import {
    ANTIGRAVITY_THINKING_I18N_KEY_BY_VALUE,
    CHAT_INPUT_I18N_KEYS,
    CHAT_INPUT_TEXT_FALLBACK_JA,
    CLAUDE_EFFORT_I18N_KEY_BY_VALUE,
} from '../../constants/i18n';
import { CLAUDE_EFFORT_VALUES, type ClaudeEffort } from '../../constants/claude';
import { CHAT_SEND_KEYS, DEFAULT_CHAT_SEND_KEY, type ChatSendKey } from '../../types/Settings';
import {
    MIN_ANTIGRAVITY_STREAM_GUARD_LIMIT,
    antigravityThinkingLevelsOf,
    normalizeAntigravityStreamGuardLimit,
    type AntigravityThinking,
} from '../../constants/antigravity';
import { MIN_CHAT_RESPONSE_TIMEOUT_MINUTES, normalizeChatResponseTimeoutMinutes } from '../../constants/chatTimeout';
import { apiModelsForConnection, apiRemoteModelLabel, buildAPIConnectionChoices } from './modelSelection';
import { useModalLayer } from '../ui';

const COARSE_POINTER_MEDIA_QUERY = '(pointer: coarse)';
/** 使う AI の小窓と、開閉ボタンの間隔 */
const MODEL_PICKER_ANCHOR_GAP = 8;
/** 使う AI の小窓と、可視領域上端の間に残す余白 */
const MODEL_PICKER_VIEWPORT_MARGIN = 8;

// 使う AI の小窓の高さの上限を、札の上の見えている範囲（キーボードで隠れた分を除く）から求める。
// 小窓は札の上に 8px 空けて出し、見えている範囲の上端からも 8px 空ける
export const measurePickerMaxHeight = (
    anchor: HTMLElement | null,
    topBoundary: HTMLElement | null = null,
): number | undefined => {
    const rect = anchor?.getBoundingClientRect();
    if (!rect) return undefined;
    const visibleTop = visibleViewportBounds().top;
    const usableTop = Math.max(visibleTop, topBoundary?.getBoundingClientRect().bottom ?? visibleTop);
    const availableHeight = rect.top
        - usableTop
        - MODEL_PICKER_ANCHOR_GAP
        - MODEL_PICKER_VIEWPORT_MARGIN;
    return Math.max(0, availableHeight);
};

interface MessageInputProps {
    input: string;
    isLoading: boolean;
    /** 送信を一時的に禁止する（セッション復元中など）。isLoadingと違い停止ボタンには切り替えない */
    disabled?: boolean;
    onSend: () => void;
    onStop: () => void;
    onInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;

    // モデル選択用
    models: Model[];
    selectedModel: string;
    onSelectModel: (modelId: string) => void;
    selectedModelProvider: ModelProvider;
    onSelectModelProvider: (provider: ModelProvider) => void;
    /** 小さな窓の「モデル設定を開く」でAIモデル設定モーダルを開く */
    onOpenModelSettings: () => void;
    claudeEffort: ClaudeEffort;
    onSelectClaudeEffort: (effort: ClaudeEffort) => void;
    antigravityThinking: AntigravityThinking;
    onSelectAntigravityThinking: (thinking: AntigravityThinking) => void;
    antigravityStreamGuardLimit: number;
    onSelectAntigravityStreamGuardLimit: (limit: number) => void;
    /** 会話の応答を待つ時間（分） */
    responseTimeoutMinutes: number;
    onSelectResponseTimeoutMinutes: (minutes: number) => void;
    geminiTempFileMode: boolean;
    onToggleGeminiTempFileMode: (enabled: boolean) => void;
    showBackgroundThrough?: boolean;
    backgroundAreaOpacity?: number;
    uiCatalog: I18NCatalog | null;
    /** 入力が空でも送信を許可する（行動選択肢を選択済みのとき。支援者向け） */
    allowEmptySend?: boolean;
    /** チャット入力欄で送信に使うキー */
    chatSendKey?: ChatSendKey;
    /** モデル選択UIを重ねてはならない上側の要素（チャット見出し） */
    modelPickerTopBoundaryRef?: React.RefObject<HTMLElement | null>;

}

/** 小さな窓の中の1行（見出しと選択欄） */
const PickerRow: React.FC<{ label: string; help?: string; children: React.ReactNode }> = ({ label, help, children }) => (
    <div className="flex flex-col gap-1.5">
        <span className="text-xs text-fg-muted">{label}</span>
        {children}
        {help && <span className="text-xs leading-snug text-fg-muted">{help}</span>}
    </div>
);

export const MessageInput: React.FC<MessageInputProps> = ({
    input,
    isLoading,
    disabled = false,
    onSend,
    onStop,
    onInputChange,
    models,
    selectedModel,
    onSelectModel,
    selectedModelProvider,
    onSelectModelProvider,
    onOpenModelSettings,
    claudeEffort,
    onSelectClaudeEffort,
    antigravityThinking,
    onSelectAntigravityThinking,
    antigravityStreamGuardLimit,
    onSelectAntigravityStreamGuardLimit,
    responseTimeoutMinutes,
    onSelectResponseTimeoutMinutes,
    geminiTempFileMode,
    onToggleGeminiTempFileMode,
    showBackgroundThrough = false,
    backgroundAreaOpacity = 0.95,
    uiCatalog,
    allowEmptySend = false,
    chatSendKey = DEFAULT_CHAT_SEND_KEY,
    modelPickerTopBoundaryRef,
}) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const pickerRef = useRef<HTMLDivElement>(null);
    const [pickerOpen, setPickerOpen] = useState(false);
    // 使う AI の小窓の高さの上限。札の上の、実際に見えている範囲（キーボードで隠れた分を除く）に収め、入り切らない分は中でスクロールする
    const [pickerMaxHeight, setPickerMaxHeight] = useState<number | undefined>(undefined);
    // Esc で一番上の窓から閉じる仕組みに載せる
    useModalLayer(pickerOpen, () => setPickerOpen(false));
    const [streamGuardLimitInput, setStreamGuardLimitInput] = useState(
        String(antigravityStreamGuardLimit)
    );
    const [responseTimeoutInput, setResponseTimeoutInput] = useState(
        String(responseTimeoutMinutes)
    );
    const visibleModels = models.filter(m => modelProviderOf(m) === selectedModelProvider);
    const apiConnectionChoices = selectedModelProvider === 'openai_compat'
        ? buildAPIConnectionChoices(visibleModels)
        : [];
    const selectedApiConnectionId = selectedModelProvider === 'openai_compat'
        ? (visibleModels.find(model => model.id === selectedModel)?.connectionId || apiConnectionChoices[0]?.id || '')
        : '';
    const modelChoices = selectedModelProvider === 'openai_compat'
        ? apiModelsForConnection(visibleModels, selectedApiConnectionId)
        : visibleModels;
    // Antigravity の Thinking 選択肢は選択中モデルの thinkingLevels（サーバ正本）から出す。
    const antigravityThinkingLevels = selectedModelProvider === 'antigravity'
        ? antigravityThinkingLevelsOf(visibleModels.find(m => m.id === selectedModel))
        : [];
    const t = (key: string) => resolveMessage(uiCatalog, key, CHAT_INPUT_TEXT_FALLBACK_JA[key] || key);

    const providerOptions = [
        { value: 'antigravity', label: 'Antigravity' },
        { value: 'claude', label: 'Claude' },
        { value: 'gemini', label: 'Gemini' },
        { value: 'openai_compat', label: t(CHAT_INPUT_I18N_KEYS.providerOpenAICompat) },
    ];
    const modelOptions = modelChoices.map(m => ({
        value: m.id,
        label: selectedModelProvider === 'openai_compat' ? apiRemoteModelLabel(m) : m.description,
    }));
    const providerLabel = providerOptions.find(o => o.value === selectedModelProvider)?.label ?? selectedModelProvider;
    // 一覧に無いモデル（保存済みの選択が古いときなど）は、選択欄と同じく値をそのまま出す
    const modelLabel = modelOptions.find(o => o.value === selectedModel)?.label ?? selectedModel;

    // テキストエリアの高さ自動調整。
    // 高さを打鍵ごとに書き換えるとブラウザのキャレット追従スクロールを毎回誘発するため、
    // 実際に高さが変わるときだけ確定値を書き戻す。
    useEffect(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;

        const previousHeight = textarea.style.height;
        textarea.style.height = 'auto';
        const nextHeight = Math.min(textarea.scrollHeight, 200) + 'px';
        textarea.style.height = nextHeight === previousHeight ? previousHeight : nextHeight;
    }, [input]);

    useEffect(() => {
        setStreamGuardLimitInput(String(antigravityStreamGuardLimit));
    }, [antigravityStreamGuardLimit]);

    useEffect(() => {
        setResponseTimeoutInput(String(responseTimeoutMinutes));
    }, [responseTimeoutMinutes]);

    // 小さな窓の外を押したら閉じる（中の選択欄の一覧は窓の中に描かれるので閉じない）
    useEffect(() => {
        if (!pickerOpen) return;
        const handlePointerDown = (e: PointerEvent) => {
            if (pickerRef.current?.contains(e.target as Node)) return;
            setPickerOpen(false);
        };
        document.addEventListener('pointerdown', handlePointerDown);
        return () => document.removeEventListener('pointerdown', handlePointerDown);
    }, [pickerOpen]);

    // キーボードの開閉や画面回転で見えている範囲が変わったら、小窓の高さの上限を測り直す
    useEffect(() => {
        if (!pickerOpen) return;
        const handleViewportChange = () => setPickerMaxHeight(measurePickerMaxHeight(
            pickerRef.current,
            modelPickerTopBoundaryRef?.current ?? null,
        ));
        const vv = window.visualViewport;
        window.addEventListener('resize', handleViewportChange);
        vv?.addEventListener('resize', handleViewportChange);
        vv?.addEventListener('scroll', handleViewportChange);
        return () => {
            window.removeEventListener('resize', handleViewportChange);
            vv?.removeEventListener('resize', handleViewportChange);
            vv?.removeEventListener('scroll', handleViewportChange);
        };
    }, [pickerOpen, modelPickerTopBoundaryRef]);

    const commitStreamGuardLimit = () => {
        const normalized = normalizeAntigravityStreamGuardLimit(streamGuardLimitInput);
        setStreamGuardLimitInput(String(normalized));
        onSelectAntigravityStreamGuardLimit(normalized);
    };

    const commitResponseTimeout = () => {
        const normalized = normalizeChatResponseTimeoutMinutes(responseTimeoutInput);
        setResponseTimeoutInput(String(normalized));
        onSelectResponseTimeoutMinutes(normalized);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.nativeEvent.isComposing) return;

        if (e.key === 'Enter') {
            // スマートフォン等のソフトウェアキーボードでは、Enterを常に改行として扱う。
            if (window.matchMedia(COARSE_POINTER_MEDIA_QUERY).matches) return;

            const hasOtherModifier = e.altKey || e.metaKey;
            const shouldSend = !hasOtherModifier && (
                (chatSendKey === CHAT_SEND_KEYS.enter && !e.shiftKey && !e.ctrlKey)
                || (chatSendKey === CHAT_SEND_KEYS.shiftEnter && e.shiftKey && !e.ctrlKey)
                || (chatSendKey === CHAT_SEND_KEYS.ctrlEnter && e.ctrlKey && !e.shiftKey)
            );

            if (shouldSend) {
                e.preventDefault();
                if (!disabled) {
                    onSend();
                }
            }
            // 選択した送信操作以外の Enter は改行（デフォルト挙動）
        }
    };

    return (
        <div
            className={`mt-auto border-t border-line px-3 py-3 sm:p-4 relative${showBackgroundThrough && backgroundAreaOpacity > 0 ? ' backdrop-blur-sm' : ''}`}
            style={{ backgroundColor: `rgb(var(--c-bg-rgb) / ${showBackgroundThrough ? backgroundAreaOpacity : 0.95})` }}
        >
            <div className="max-w-4xl mx-auto">
                <div className="relative flex flex-col bg-surface rounded-xl border border-line-strong focus-within:border-accent transition-colors">
                    <textarea
                        ref={textareaRef}
                        value={input}
                        onChange={onInputChange}
                        onKeyDown={handleKeyDown}
                        enterKeyHint="enter"
                        placeholder={t(CHAT_INPUT_I18N_KEYS.placeholder)}
                        className="w-full bg-transparent text-fg placeholder:text-fg-muted outline-none resize-none px-3.5 pt-3 pb-1 min-h-[44px] max-h-[200px] font-sans"
                        rows={1}
                    />

                    <div className="flex items-center gap-2 px-2 pb-2">
                        {/* 使う AI とモデルの札。押すと選択欄を並べた小さな窓を開く */}
                        <div ref={pickerRef} className="relative min-w-0">
                            <button
                                type="button"
                                onPointerDown={keepFocusOnPointerDown}
                                onClick={() => {
                                    if (!pickerOpen) setPickerMaxHeight(measurePickerMaxHeight(
                                        pickerRef.current,
                                        modelPickerTopBoundaryRef?.current ?? null,
                                    ));
                                    setPickerOpen(!pickerOpen);
                                }}
                                aria-haspopup="dialog"
                                aria-expanded={pickerOpen}
                                title={t(CHAT_INPUT_I18N_KEYS.modelPicker)}
                                className={`flex items-center gap-1.5 max-w-full h-7 px-2.5 rounded-full text-xs border transition-colors ${
                                    pickerOpen ? 'bg-accent-soft text-fg border-transparent' : 'text-fg-muted border-line hover:text-fg hover:bg-surface-2'
                                }`}
                            >
                                <Cpu size={13} className="shrink-0" />
                                <span className="truncate">{modelLabel ? formatPair(uiCatalog, providerLabel, modelLabel) : providerLabel}</span>
                                <ChevronUp size={12} className={`shrink-0 transition-transform ${pickerOpen ? '' : 'rotate-180'}`} />
                            </button>

                            {pickerOpen && (
                                // 中の選択欄の一覧は position: fixed で描くため、窓にぼかしや変形は掛けない
                                //（掛けると一覧の位置の基準が窓に変わってずれる）
                                <div
                                    role="dialog"
                                    aria-label={t(CHAT_INPUT_I18N_KEYS.modelPicker)}
                                    style={{ maxHeight: pickerMaxHeight }}
                                    className="absolute bottom-full left-0 mb-2 z-50 w-[min(340px,calc(100vw-2rem))] flex flex-col gap-3 p-4 overflow-y-auto rounded-ui-lg border border-line-strong bg-[rgb(var(--c-bg-rgb))] shadow-2xl"
                                >
                                    <PickerRow label={t(CHAT_INPUT_I18N_KEYS.provider)}>
                                        <KeyboardSafeSelect
                                            value={selectedModelProvider}
                                            onChange={(value) => onSelectModelProvider(value as ModelProvider)}
                                            options={providerOptions}
                                            ariaLabel={t(CHAT_INPUT_I18N_KEYS.provider)}
                                            className="w-full"
                                            topBoundaryRef={modelPickerTopBoundaryRef}
                                        />
                                    </PickerRow>

                                    {selectedModelProvider === 'openai_compat' && apiConnectionChoices.length > 0 && (
                                        <PickerRow label={t(CHAT_INPUT_I18N_KEYS.apiConnection)}>
                                            <KeyboardSafeSelect
                                                value={selectedApiConnectionId}
                                                onChange={(value) => {
                                                    const firstModel = apiModelsForConnection(visibleModels, value)[0];
                                                    if (firstModel) onSelectModel(firstModel.id);
                                                }}
                                                options={apiConnectionChoices.map(connection => ({
                                                    value: connection.id,
                                                    label: connection.label,
                                                }))}
                                                ariaLabel={t(CHAT_INPUT_I18N_KEYS.apiConnection)}
                                                className="w-full"
                                                topBoundaryRef={modelPickerTopBoundaryRef}
                                            />
                                        </PickerRow>
                                    )}

                                    <PickerRow
                                        label={t(CHAT_INPUT_I18N_KEYS.model)}
                                        help={selectedModelProvider === 'openai_compat'
                                            ? (visibleModels.length === 0
                                                ? t(CHAT_INPUT_I18N_KEYS.openaiCompatNoModels)
                                                /* 行動選択肢はフェーズ1では openai_compat 未対応。 */
                                                : t(CHAT_INPUT_I18N_KEYS.actionChoiceUnsupported))
                                            : undefined}
                                    >
                                        <KeyboardSafeSelect
                                            value={selectedModel}
                                            onChange={onSelectModel}
                                            options={modelOptions}
                                            ariaLabel={t(CHAT_INPUT_I18N_KEYS.model)}
                                            className="w-full"
                                            topBoundaryRef={modelPickerTopBoundaryRef}
                                        />
                                    </PickerRow>

                                    <PickerRow label={t(CHAT_INPUT_I18N_KEYS.responseTimeout)}>
                                        <input
                                            type="number"
                                            min={MIN_CHAT_RESPONSE_TIMEOUT_MINUTES}
                                            step={1}
                                            inputMode="numeric"
                                            value={responseTimeoutInput}
                                            onChange={(e) => setResponseTimeoutInput(e.target.value)}
                                            onBlur={commitResponseTimeout}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    e.preventDefault();
                                                    commitResponseTimeout();
                                                    e.currentTarget.blur();
                                                }
                                            }}
                                            aria-label={t(CHAT_INPUT_I18N_KEYS.responseTimeout)}
                                            className="w-24 bg-surface border border-line-strong text-fg text-xs rounded px-2 py-1.5 outline-none focus:border-accent"
                                        />
                                    </PickerRow>

                                    {selectedModelProvider === 'claude' && (
                                        <PickerRow label={t(CHAT_INPUT_I18N_KEYS.claudeEffort)}>
                                            <KeyboardSafeSelect
                                                value={claudeEffort}
                                                onChange={(value) => onSelectClaudeEffort(value as ClaudeEffort)}
                                                options={CLAUDE_EFFORT_VALUES.map((effort) => ({
                                                    value: effort,
                                                    label: t(CLAUDE_EFFORT_I18N_KEY_BY_VALUE[effort]),
                                                }))}
                                                ariaLabel={t(CHAT_INPUT_I18N_KEYS.claudeEffort)}
                                                className="w-full"
                                                topBoundaryRef={modelPickerTopBoundaryRef}
                                            />
                                        </PickerRow>
                                    )}

                                    {selectedModelProvider === 'antigravity' && antigravityThinkingLevels.length > 0 && (
                                        <PickerRow label={t(CHAT_INPUT_I18N_KEYS.antigravityThinking)}>
                                            <KeyboardSafeSelect
                                                value={antigravityThinking}
                                                onChange={(value) => onSelectAntigravityThinking(value as AntigravityThinking)}
                                                options={antigravityThinkingLevels.map((level) => ({
                                                    value: level,
                                                    label: t(ANTIGRAVITY_THINKING_I18N_KEY_BY_VALUE[level]),
                                                }))}
                                                ariaLabel={t(CHAT_INPUT_I18N_KEYS.antigravityThinking)}
                                                className="w-full"
                                                topBoundaryRef={modelPickerTopBoundaryRef}
                                            />
                                        </PickerRow>
                                    )}

                                    {selectedModelProvider === 'antigravity' && (
                                        <PickerRow
                                            label={t(CHAT_INPUT_I18N_KEYS.antigravityStreamGuardLimit)}
                                            help={t(CHAT_INPUT_I18N_KEYS.antigravityStreamGuardLimitTitle)}
                                        >
                                            <input
                                                type="number"
                                                min={MIN_ANTIGRAVITY_STREAM_GUARD_LIMIT}
                                                step={MIN_ANTIGRAVITY_STREAM_GUARD_LIMIT}
                                                inputMode="numeric"
                                                value={streamGuardLimitInput}
                                                onChange={(e) => setStreamGuardLimitInput(e.target.value)}
                                                onBlur={commitStreamGuardLimit}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        e.preventDefault();
                                                        commitStreamGuardLimit();
                                                        e.currentTarget.blur();
                                                    }
                                                }}
                                                aria-label={t(CHAT_INPUT_I18N_KEYS.antigravityStreamGuardLimit)}
                                                className="w-24 bg-surface border border-line-strong text-fg text-xs rounded px-2 py-1.5 outline-none focus:border-accent"
                                            />
                                        </PickerRow>
                                    )}

                                    {/* Antigravity はファイル経由方式へ一本化済みのためトグルなし
                                        （24_Antigravity一時ファイル一本化と暴走対策設計.md）。
                                        Gemini は stdout 主経路を残しつつファイル経由方式を選べる。
                                        Claude はファイル経由方式へ一本化済みのためトグルなし。 */}
                                    {selectedModelProvider === 'gemini' && (
                                        <label
                                            onPointerDown={keepFocusOnPointerDown}
                                            className="flex items-center gap-2 text-xs text-fg cursor-pointer"
                                            title={t(CHAT_INPUT_I18N_KEYS.geminiTempFileMode)}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={geminiTempFileMode}
                                                onChange={(e) => onToggleGeminiTempFileMode(e.target.checked)}
                                                className="accent-[var(--c-accent)]"
                                            />
                                            <span>{t(CHAT_INPUT_I18N_KEYS.fileRelay)}</span>
                                        </label>
                                    )}

                                    <button
                                        type="button"
                                        onPointerDown={keepFocusOnPointerDown}
                                        onClick={() => { setPickerOpen(false); onOpenModelSettings(); }}
                                        className="self-start flex items-center gap-1.5 h-7 px-2 -ml-2 rounded-ui text-xs text-fg-muted hover:text-fg hover:bg-surface"
                                    >
                                        <Settings size={13} />
                                        {t(CHAT_INPUT_I18N_KEYS.modelSettings)}
                                    </button>
                                </div>
                            )}
                        </div>

                        <div className="flex-1" />

                        {/* 送信・停止は、押したときに入力欄から外さない（外れるとキーボードが閉じて配置が動き、
                            指で押した1回目が押下にならない） */}
                        {isLoading ? (
                            <button
                                onPointerDown={keepFocusOnPointerDown}
                                onClick={onStop}
                                className="grid place-items-center w-9 h-9 shrink-0 rounded-lg bg-danger text-on-accent transition-colors hover:brightness-110"
                                title={t(CHAT_INPUT_I18N_KEYS.stop)}
                                aria-label={t(CHAT_INPUT_I18N_KEYS.stop)}
                            >
                                <Square size={16} fill="currentColor" />
                            </button>
                        ) : (
                            <button
                                onPointerDown={keepFocusOnPointerDown}
                                onClick={onSend}
                                disabled={disabled || (!input.trim() && !allowEmptySend)}
                                className="grid place-items-center w-9 h-9 shrink-0 rounded-lg bg-accent text-on-accent transition-colors hover:brightness-110 disabled:bg-surface-2 disabled:text-fg-muted disabled:hover:brightness-100"
                                title={t(CHAT_INPUT_I18N_KEYS.send)}
                                aria-label={t(CHAT_INPUT_I18N_KEYS.send)}
                            >
                                <Send size={16} />
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
