/**
 * MessageInput.tsx - メッセージ入力コンポーネント
 *
 * チャットの入力エリアを提供するコンポーネント。
 * - 多段テキストエリア（自動リサイズ）
 * - 送信ボタン
 * - ストップボタン（生成中）
 */

import React, { useRef, useEffect, useState } from 'react';
import { Send, ChevronUp, Square, Settings } from 'lucide-react';
import type { Model, ModelProvider } from '../../hooks/useChat';
import { modelProviderOf } from '../../hooks/useChat';
import { resolveMessage, type I18NCatalog } from '../../api/i18n';
import { CHAT_INPUT_I18N_KEYS, CHAT_INPUT_TEXT_FALLBACK_JA, CLAUDE_EFFORT_I18N_KEY_BY_VALUE } from '../../constants/i18n';
import { CLAUDE_EFFORT_VALUES, type ClaudeEffort } from '../../constants/claude';
import { CHAT_SEND_KEYS, DEFAULT_CHAT_SEND_KEY, type ChatSendKey } from '../../types/Settings';
import {
    MIN_ANTIGRAVITY_STREAM_GUARD_LIMIT,
    normalizeAntigravityStreamGuardLimit,
} from '../../constants/antigravity';
import { apiModelsForConnection, apiRemoteModelLabel, buildAPIConnectionChoices } from './modelSelection';

const COARSE_POINTER_MEDIA_QUERY = '(pointer: coarse)';

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
    /** モデル選択右のアイコンボタン押下でAIモデル設定モーダルを開く */
    onOpenModelSettings: () => void;
    claudeEffort: ClaudeEffort;
    onSelectClaudeEffort: (effort: ClaudeEffort) => void;
    antigravityStreamGuardLimit: number;
    onSelectAntigravityStreamGuardLimit: (limit: number) => void;
    geminiTempFileMode: boolean;
    onToggleGeminiTempFileMode: (enabled: boolean) => void;
    showBackgroundThrough?: boolean;
    backgroundAreaOpacity?: number;
    uiCatalog: I18NCatalog | null;
    /** 入力が空でも送信を許可する（行動選択肢を選択済みのとき。支援者向け） */
    allowEmptySend?: boolean;
    /** チャット入力欄で送信に使うキー */
    chatSendKey?: ChatSendKey;

}

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
    antigravityStreamGuardLimit,
    onSelectAntigravityStreamGuardLimit,
    geminiTempFileMode,
    onToggleGeminiTempFileMode,
    showBackgroundThrough = false,
    backgroundAreaOpacity = 0.95,
    uiCatalog,
    allowEmptySend = false,
    chatSendKey = DEFAULT_CHAT_SEND_KEY,
}) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [streamGuardLimitInput, setStreamGuardLimitInput] = useState(
        String(antigravityStreamGuardLimit)
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
    const t = (key: string) => resolveMessage(uiCatalog, key, CHAT_INPUT_TEXT_FALLBACK_JA[key] || key);

    // テキストエリアの高さ自動調整
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
        }
    }, [input]);

    useEffect(() => {
        setStreamGuardLimitInput(String(antigravityStreamGuardLimit));
    }, [antigravityStreamGuardLimit]);

    const commitStreamGuardLimit = () => {
        const normalized = normalizeAntigravityStreamGuardLimit(streamGuardLimitInput);
        setStreamGuardLimitInput(String(normalized));
        onSelectAntigravityStreamGuardLimit(normalized);
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
            className={`mt-auto border-t border-gray-700 p-4 relative${showBackgroundThrough && backgroundAreaOpacity > 0 ? ' backdrop-blur-sm' : ''}`}
            style={{ backgroundColor: `rgba(3, 7, 18, ${showBackgroundThrough ? backgroundAreaOpacity : 0.95})` }}
        >
            <div className="max-w-4xl mx-auto flex flex-col gap-3">

                <div className="relative flex items-end gap-2 bg-gray-800 p-2 rounded-xl border border-gray-700 focus-within:border-blue-500 transition-colors shadow-inner">
                    <textarea
                        ref={textareaRef}
                        value={input}
                        onChange={onInputChange}
                        onKeyDown={handleKeyDown}
                        enterKeyHint="enter"
                        placeholder={t(CHAT_INPUT_I18N_KEYS.placeholder)}
                        className="w-full bg-transparent text-gray-100 placeholder-gray-500 outline-none resize-none py-3 min-h-[44px] max-h-[200px] font-sans"
                        rows={1}
                    />

                    <div className="flex flex-col gap-1 pb-1">
                        {isLoading ? (
                            <button
                                onClick={onStop}
                                className="p-2 bg-red-600 hover:bg-red-500 rounded-lg text-white transition-all shadow-lg hover:shadow-red-500/20 flex-shrink-0"
                                title={t(CHAT_INPUT_I18N_KEYS.stop)}
                            >
                                <Square size={20} fill="currentColor" />
                            </button>
                        ) : (
                            <button
                                onClick={onSend}
                                disabled={disabled || (!input.trim() && !allowEmptySend)}
                                className="p-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg text-white transition-all shadow-lg hover:shadow-blue-500/20 flex-shrink-0"
                                title={t(CHAT_INPUT_I18N_KEYS.send)}
                            >
                                <Send size={20} />
                            </button>
                        )}
                    </div>
                </div>

                {/* フッターコントロール (モデル選択など) */}
                <div className="flex justify-center items-center gap-4 px-1">
                    <div className="flex flex-wrap justify-center items-center gap-2">
                        <div className="relative">
                            <select
                                value={selectedModelProvider}
                                onChange={(e) => onSelectModelProvider(e.target.value as ModelProvider)}
                                className="bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded pl-2 pr-7 py-1.5 outline-none focus:border-blue-500 appearance-none cursor-pointer hover:bg-gray-700 transition-colors min-w-[116px]"
                            >
                                <option value="antigravity">Antigravity</option>
                                <option value="claude">Claude</option>
                                <option value="gemini">Gemini</option>
                                <option value="openai_compat">{t('chatInput.providerOpenAICompat')}</option>
                            </select>
                            <ChevronUp size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                        </div>

                        {selectedModelProvider === 'openai_compat' && apiConnectionChoices.length > 0 && (
                            <div className="relative">
                                <select
                                    value={selectedApiConnectionId}
                                    onChange={(e) => {
                                        const firstModel = apiModelsForConnection(visibleModels, e.target.value)[0];
                                        if (firstModel) onSelectModel(firstModel.id);
                                    }}
                                    aria-label={t(CHAT_INPUT_I18N_KEYS.apiConnection)}
                                    className="bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded pl-2 pr-7 py-1.5 outline-none focus:border-blue-500 appearance-none cursor-pointer hover:bg-gray-700 transition-colors min-w-[120px]"
                                >
                                    {apiConnectionChoices.map(connection => (
                                        <option key={connection.id} value={connection.id}>{connection.label}</option>
                                    ))}
                                </select>
                                <ChevronUp size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                            </div>
                        )}

                        <div className="relative">
                            <select
                                value={selectedModel}
                                onChange={(e) => onSelectModel(e.target.value)}
                                className="bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded pl-2 pr-7 py-1.5 outline-none focus:border-blue-500 disabled:opacity-50 appearance-none cursor-pointer hover:bg-gray-700 transition-colors min-w-[140px]"
                            >
                                {modelChoices.map(m => (
                                    <option key={m.id} value={m.id}>
                                        {selectedModelProvider === 'openai_compat' ? apiRemoteModelLabel(m) : m.description}
                                    </option>
                                ))}
                            </select>
                            <ChevronUp size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                        </div>

                        {selectedModelProvider === 'openai_compat' && visibleModels.length === 0 && (
                            <span className="text-xs text-amber-400">
                                {t('chatInput.openaiCompatNoModels')}
                            </span>
                        )}
                        {selectedModelProvider === 'openai_compat' && (
                            /* 行動選択肢はフェーズ1では openai_compat 未対応。 */
                            <span className="text-[10px] text-gray-500" title={t('chatInput.actionChoiceUnsupported')}>
                                {t('chatInput.actionChoiceUnsupported')}
                            </span>
                        )}

                        {selectedModelProvider === 'claude' && (
                            <div className="relative">
                                <select
                                    value={claudeEffort}
                                    onChange={(e) => onSelectClaudeEffort(e.target.value as ClaudeEffort)}
                                    title={t(CHAT_INPUT_I18N_KEYS.claudeEffort)}
                                    aria-label={t(CHAT_INPUT_I18N_KEYS.claudeEffort)}
                                    className="bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded pl-2 pr-7 py-1.5 outline-none focus:border-blue-500 appearance-none cursor-pointer hover:bg-gray-700 transition-colors min-w-[104px]"
                                >
                                    {CLAUDE_EFFORT_VALUES.map((effort) => (
                                        <option key={effort || 'default'} value={effort}>
                                            {t(CLAUDE_EFFORT_I18N_KEY_BY_VALUE[effort])}
                                        </option>
                                    ))}
                                </select>
                                <ChevronUp size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                            </div>
                        )}

                        {/* モデル設定モーダルを開くアイコンボタン */}
                        <button
                            onClick={onOpenModelSettings}
                            className="p-1.5 bg-gray-800 border border-gray-700 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors flex-shrink-0"
                            title={t(CHAT_INPUT_I18N_KEYS.modelSettings)}
                        >
                            <Settings size={14} />
                        </button>

                        {selectedModelProvider === 'antigravity' && (
                            <label
                                className="flex items-center gap-1.5 text-xs text-gray-400"
                                title={t(CHAT_INPUT_I18N_KEYS.antigravityStreamGuardLimitTitle)}
                            >
                                <span className="whitespace-nowrap">
                                    {t(CHAT_INPUT_I18N_KEYS.antigravityStreamGuardLimit)}
                                </span>
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
                                    aria-label={t(CHAT_INPUT_I18N_KEYS.antigravityStreamGuardLimitTitle)}
                                    className="w-14 bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded px-1.5 py-1.5 outline-none focus:border-blue-500"
                                />
                            </label>
                        )}

                        {/* Antigravity はファイル経由方式へ一本化済みのためトグルなし
                            （24_Antigravity一時ファイル一本化と暴走対策設計.md）。
                            Gemini は stdout 主経路を残しつつファイル経由方式を選べる。
                            Claude はファイル経由方式へ一本化済みのためトグルなし。 */}
                        {selectedModelProvider === 'gemini' && (
                            <label
                                className={`flex items-center gap-2 text-xs cursor-pointer ${geminiTempFileMode ? 'text-purple-300' : 'text-gray-400'}`}
                                title={t(CHAT_INPUT_I18N_KEYS.geminiTempFileMode)}
                            >
                                <input
                                    type="checkbox"
                                    checked={geminiTempFileMode}
                                    onChange={(e) => onToggleGeminiTempFileMode(e.target.checked)}
                                    className="accent-purple-500"
                                />
                                <span>{t(CHAT_INPUT_I18N_KEYS.fileRelay)}</span>
                            </label>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
