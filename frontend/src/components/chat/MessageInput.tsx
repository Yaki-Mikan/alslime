/**
 * MessageInput.tsx - メッセージ入力コンポーネント
 *
 * チャットの入力エリアを提供するコンポーネント。
 * - 多段テキストエリア（自動リサイズ）
 * - 送信ボタン
 * - ストップボタン（生成中）
 */

import React, { useRef, useEffect } from 'react';
import { Send, ChevronUp, Square, Settings } from 'lucide-react';
import type { Model, ModelProvider } from '../../hooks/useChat';
import { modelProviderOf } from '../../hooks/useChat';
import { resolveMessage, type I18NCatalog } from '../../api/i18n';
import { CHAT_INPUT_I18N_KEYS, CHAT_INPUT_TEXT_FALLBACK_JA } from '../../constants/i18n';

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
    geminiTempFileMode: boolean;
    onToggleGeminiTempFileMode: (enabled: boolean) => void;
    showBackgroundThrough?: boolean;
    backgroundAreaOpacity?: number;
    uiCatalog: I18NCatalog | null;
    /** 入力が空でも送信を許可する（行動選択肢を選択済みのとき。支援者向け） */
    allowEmptySend?: boolean;

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
    geminiTempFileMode,
    onToggleGeminiTempFileMode,
    showBackgroundThrough = false,
    backgroundAreaOpacity = 0.95,
    uiCatalog,
    allowEmptySend = false,
}) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const visibleModels = models.filter(m => modelProviderOf(m) === selectedModelProvider);
    const t = (key: string) => resolveMessage(uiCatalog, key, CHAT_INPUT_TEXT_FALLBACK_JA[key] || key);

    // テキストエリアの高さ自動調整
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
        }
    }, [input]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.nativeEvent.isComposing) return;

        if (e.key === 'Enter') {
            // Shift + Enter で送信
            if (e.shiftKey) {
                e.preventDefault();
                if (!disabled) {
                    onSend();
                }
            }
            // Enterのみの場合は改行（デフォルト挙動）
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
                            </select>
                            <ChevronUp size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                        </div>

                        <div className="relative">
                            <select
                                value={selectedModel}
                                onChange={(e) => onSelectModel(e.target.value)}
                                className="bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded pl-2 pr-7 py-1.5 outline-none focus:border-blue-500 disabled:opacity-50 appearance-none cursor-pointer hover:bg-gray-700 transition-colors min-w-[140px]"
                            >
                                {visibleModels.map(m => (
                                    <option key={m.id} value={m.id}>{m.description}</option>
                                ))}
                            </select>
                            <ChevronUp size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                        </div>

                        {/* モデル設定モーダルを開くアイコンボタン */}
                        <button
                            onClick={onOpenModelSettings}
                            className="p-1.5 bg-gray-800 border border-gray-700 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors flex-shrink-0"
                            title={t(CHAT_INPUT_I18N_KEYS.modelSettings)}
                        >
                            <Settings size={14} />
                        </button>

                        {/* Antigravity は一時ファイル方式へ一本化済みのためトグルなし
                            （24_Antigravity一時ファイル一本化と暴走対策設計.md）。
                            Gemini は stdout 主経路を残しつつ一時ファイル方式を選べる
                            （25_Gemini一時ファイル方式導入検討設計.md）。 */}
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
                                <span>{t(CHAT_INPUT_I18N_KEYS.tempFile)}</span>
                            </label>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
