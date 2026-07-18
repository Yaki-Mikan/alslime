/**
 * ReplacementConfigModal.tsx - 置換設定編集モーダル
 * 
 * テキスト置換設定をGUIで編集するためのモーダルコンポーネント
 * ParameterSchemaEditorModalのデザインを踏襲
 */
import React, { useState, useEffect, useCallback } from 'react';
import { X, Trash2, Save, AlertCircle, RefreshCw } from 'lucide-react';
import {
    getReplacementConfig,
    saveReplacementConfig
} from '../../api/replacement';
import type {
    ReplacementConfig,
    ReplacementItem,
    ReplacementSource
} from '../../api/replacement';
import { resolveMessage, type I18NCatalog } from '../../api/i18n';
import { COMMON_I18N_KEYS, COMMON_TEXT_FALLBACK_JA, REPLACEMENT_CONFIG_I18N_KEYS, REPLACEMENT_CONFIG_TEXT_FALLBACK_JA } from '../../constants/i18n';


// ======================
// Props
// ======================

interface ReplacementConfigModalProps {
    isOpen: boolean;
    onClose: () => void;
    backendUrl: string;
    uiCatalog?: I18NCatalog | null;
}

// ======================
// コンポーネント
// ======================

export const ReplacementConfigModal: React.FC<ReplacementConfigModalProps> = ({
    isOpen,
    onClose,
    backendUrl,
    uiCatalog = null,
}) => {
    const t = (key: string) => resolveMessage(
        uiCatalog,
        key,
        REPLACEMENT_CONFIG_TEXT_FALLBACK_JA[key] || COMMON_TEXT_FALLBACK_JA[key] || key
    );
    // 編集中の置換設定リスト
    const [replacements, setReplacements] = useState<ReplacementItem[]>([]);
    // 元の設定（変更検出用）
    const [originalReplacements, setOriginalReplacements] = useState<ReplacementItem[]>([]);
    // ローディング状態
    const [isLoading, setIsLoading] = useState(false);
    // 保存中状態
    const [isSaving, setIsSaving] = useState(false);
    // エラーメッセージ
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    // 変更があるかどうか
    const isDirty = useCallback(() => {
        return JSON.stringify(replacements) !== JSON.stringify(originalReplacements);
    }, [replacements, originalReplacements]);

    // 設定を読み込み
    const loadConfig = useCallback(async () => {
        setIsLoading(true);
        setErrorMessage(null);
        try {
            const config = await getReplacementConfig(backendUrl);
            // 空の入力フィールドを追加（動的追加用）
            const items = [...(config.replacements || []), createEmptyItem()];
            setReplacements(items);
            setOriginalReplacements(config.replacements || []);
        } catch (error) {
            console.error('Failed to load replacement config:', error);
            setErrorMessage(t(REPLACEMENT_CONFIG_I18N_KEYS.loadError));
            setReplacements([createEmptyItem()]);
            setOriginalReplacements([]);
        } finally {
            setIsLoading(false);
        }
    }, [backendUrl]);

    // 空の置換項目を生成
    const createEmptyItem = (): ReplacementItem => ({
        id: `new_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        target: '',
        replacementSource: 'manual',
        manualValue: '',
        enabled: true,
        description: '',
    });

    // 設定を保存
    const handleSave = async () => {
        setIsSaving(true);
        setErrorMessage(null);
        try {
            // 有効な設定のみを抽出（置換対象が空のものは除外）
            const validReplacements = replacements.filter(r => r.target.trim() !== '');

            const config: ReplacementConfig = {
                version: '2.0',
                replacements: validReplacements,
                lastModified: new Date().toISOString()
            };

            await saveReplacementConfig(backendUrl, config);
            setOriginalReplacements(validReplacements);
            // 空の入力フィールドを追加
            setReplacements([...validReplacements, createEmptyItem()]);
            onClose();
        } catch (error) {
            console.error('Failed to save replacement config:', error);
            setErrorMessage(t(REPLACEMENT_CONFIG_I18N_KEYS.saveError));
        } finally {
            setIsSaving(false);
        }
    };

    // 初期化
    useEffect(() => {
        if (isOpen) {
            loadConfig();
        }
    }, [isOpen, loadConfig]);

    // 項目を更新
    const updateItem = (index: number, updates: Partial<ReplacementItem>) => {
        setReplacements(prev => {
            const newItems = [...prev];
            newItems[index] = { ...newItems[index], ...updates };

            // 最後の項目に入力があったら新しい空の項目を追加
            if (index === newItems.length - 1) {
                const lastItem = newItems[index];
                if (lastItem.target.trim() !== '' || lastItem.manualValue.trim() !== '') {
                    newItems.push(createEmptyItem());
                }
            }

            return newItems;
        });
    };

    // 項目を削除
    const removeItem = (index: number) => {
        setReplacements(prev => {
            // 最後の1つは削除しない（常に空の入力フィールドを維持）
            if (prev.length <= 1) return prev;
            return prev.filter((_, i) => i !== index);
        });
    };

    // ソース選択肢
    const sourceOptions: { value: ReplacementSource; label: string }[] = [
        { value: 'manual', label: t(REPLACEMENT_CONFIG_I18N_KEYS.sourceManual) },
        { value: 'user', label: t(REPLACEMENT_CONFIG_I18N_KEYS.sourceUser) },
        { value: 'character', label: t(REPLACEMENT_CONFIG_I18N_KEYS.sourceCharacter) },
    ];

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] border border-gray-700 overflow-hidden flex flex-col">
                {/* ヘッダー */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 bg-gray-800 shrink-0">
                    <div className="flex items-center gap-2">
                        <RefreshCw size={20} className="text-purple-400" />
                        <h3 className="font-semibold text-gray-100 text-lg">{t(REPLACEMENT_CONFIG_I18N_KEYS.title)}</h3>
                        {isDirty() && (
                            <span className="text-xs text-amber-400 ml-2">{t(REPLACEMENT_CONFIG_I18N_KEYS.dirty)}</span>
                        )}
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 hover:bg-gray-700 rounded text-gray-400 hover:text-gray-200 transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* 説明文 */}
                <div className="px-5 py-3 border-b border-gray-700 bg-gray-800/50 shrink-0">
                    <p className="text-sm text-gray-400">
                        {t(REPLACEMENT_CONFIG_I18N_KEYS.description)}
                    </p>
                </div>

                {/* エラーメッセージ */}
                {errorMessage && (
                    <div className="mx-5 mt-4 p-3 bg-red-900/30 border border-red-700 rounded-lg flex items-center gap-2 text-red-300 shrink-0">
                        <AlertCircle size={18} />
                        <span>{errorMessage}</span>
                    </div>
                )}

                {/* メインコンテンツ */}
                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-12">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500"></div>
                        </div>
                    ) : (
                        <>
                            {/* ヘッダー行 */}
                            <div className="grid grid-cols-12 gap-3 text-xs text-gray-500 font-medium uppercase tracking-wide">
                                <div className="col-span-3">{t(REPLACEMENT_CONFIG_I18N_KEYS.target)}</div>
                                <div className="col-span-3">{t(REPLACEMENT_CONFIG_I18N_KEYS.source)}</div>
                                <div className="col-span-3">{t(REPLACEMENT_CONFIG_I18N_KEYS.value)}</div>
                                <div className="col-span-2">{t(REPLACEMENT_CONFIG_I18N_KEYS.itemDescription)}</div>
                                <div className="col-span-1"></div>
                            </div>

                            {/* 置換設定リスト */}
                            {replacements.map((item, index) => {
                                const isLastEmptyItem = index === replacements.length - 1 &&
                                    item.target.trim() === '' &&
                                    item.manualValue.trim() === '';
                                const isManualSource = item.replacementSource === 'manual';

                                return (
                                    <div
                                        key={item.id}
                                        className={`grid grid-cols-12 gap-3 items-center ${isLastEmptyItem ? 'opacity-60' : ''
                                            }`}
                                    >
                                        {/* 置換対象 */}
                                        <div className="col-span-3">
                                            <input
                                                type="text"
                                                value={item.target}
                                                onChange={(e) => updateItem(index, { target: e.target.value })}
                                                placeholder="{{userName}}"
                                                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-gray-200 text-sm outline-none focus:border-purple-500 transition-colors placeholder-gray-500"
                                            />
                                        </div>

                                        {/* 置換後ソース */}
                                        <div className="col-span-3">
                                            <select
                                                value={item.replacementSource}
                                                onChange={(e) => updateItem(index, {
                                                    replacementSource: e.target.value as ReplacementSource
                                                })}
                                                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-gray-200 text-sm outline-none focus:border-purple-500 transition-colors"
                                            >
                                                {sourceOptions.map(opt => (
                                                    <option key={opt.value} value={opt.value}>
                                                        {opt.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>

                                        {/* 置換後文字列 */}
                                        <div className="col-span-3">
                                            <input
                                                type="text"
                                                value={item.manualValue}
                                                onChange={(e) => updateItem(index, { manualValue: e.target.value })}
                                                placeholder={isManualSource ? t(REPLACEMENT_CONFIG_I18N_KEYS.manualPlaceholder) : t(REPLACEMENT_CONFIG_I18N_KEYS.autoPlaceholder)}
                                                disabled={!isManualSource}
                                                className={`w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm outline-none focus:border-purple-500 transition-colors placeholder-gray-500 ${!isManualSource
                                                    ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                                                    : 'text-gray-200'
                                                    }`}
                                            />
                                        </div>

                                        {/* 説明 */}
                                        <div className="col-span-2">
                                            <input
                                                type="text"
                                                value={item.description || ''}
                                                onChange={(e) => updateItem(index, { description: e.target.value })}
                                                placeholder={t(REPLACEMENT_CONFIG_I18N_KEYS.descriptionPlaceholder)}
                                                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-gray-200 text-sm outline-none focus:border-purple-500 transition-colors placeholder-gray-500"
                                            />
                                        </div>

                                        {/* 削除ボタン */}
                                        <div className="col-span-1 flex justify-center">
                                            {!isLastEmptyItem && (
                                                <button
                                                    onClick={() => removeItem(index)}
                                                    className="p-2 text-gray-500 hover:text-red-400 hover:bg-red-900/20 rounded-lg transition-colors"
                                                    title={t(COMMON_I18N_KEYS.delete)}
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </>
                    )}
                </div>

                {/* フッター */}
                <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-gray-700 bg-gray-800 shrink-0">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-gray-400 hover:text-gray-200 hover:bg-gray-700 rounded-lg transition-colors"
                    >
                        {t(COMMON_I18N_KEYS.cancel)}
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isSaving || !isDirty()}
                        className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-white transition-colors"
                    >
                        <Save size={16} />
                        {isSaving ? t(COMMON_I18N_KEYS.saving) : t(COMMON_I18N_KEYS.save)}
                    </button>
                </div>
            </div>
        </div>
    );
};
