/**
 * EmotionCatalogModal.tsx - 表情種別管理モーダル
 *
 * キャラクターの表情（心情）種別を GUI で編集するモーダル。
 * ReplacementConfigModal のデザインを踏襲。
 * - default 行は 1 行目固定・全項目編集不可（サーバー側でも規定値へ正規化される）
 * - 無効にした表情は AI へ候補として渡されない
 */
import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Trash2, Save, AlertCircle, Smile } from 'lucide-react';
import {
    getEmotionCatalog,
    saveEmotionCatalog,
    EmotionCatalogApiError
} from '../../api/emotion-catalog';
import type { EmotionCatalogEntry } from '../../api/emotion-catalog';
import { ToggleSwitch } from '../common/ToggleSwitch';
import { resolveMessage, type I18NCatalog } from '../../api/i18n';
import { COMMON_I18N_KEYS, COMMON_TEXT_FALLBACK_JA, EMOTION_CATALOG_I18N_KEYS, EMOTION_CATALOG_TEXT_FALLBACK_JA } from '../../constants/i18n';
import { notifyCharacterImagesUpdated } from '../../lib/characterImageEvents';

// ======================
// Props
// ======================

interface EmotionCatalogModalProps {
    isOpen: boolean;
    onClose: () => void;
    backendUrl: string;
    uiCatalog?: I18NCatalog | null;
}

// 編集用の行。key 用のローカル id を付与する
interface EditableEntry extends EmotionCatalogEntry {
    id: string;
}

const DEFAULT_EMOTION_NAME = 'default';

// ======================
// コンポーネント
// ======================

export const EmotionCatalogModal: React.FC<EmotionCatalogModalProps> = ({
    isOpen,
    onClose,
    backendUrl,
    uiCatalog = null,
}) => {
    const t = (key: string) => resolveMessage(
        uiCatalog,
        key,
        EMOTION_CATALOG_TEXT_FALLBACK_JA[key] || COMMON_TEXT_FALLBACK_JA[key] || key
    );
    // 編集中の表情リスト
    const [emotions, setEmotions] = useState<EditableEntry[]>([]);
    // 元のリスト（変更検出用）
    const [originalEmotions, setOriginalEmotions] = useState<EmotionCatalogEntry[]>([]);
    // ローディング状態
    const [isLoading, setIsLoading] = useState(false);
    // 保存中状態
    const [isSaving, setIsSaving] = useState(false);
    // エラーメッセージ
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const stripId = (items: EditableEntry[]): EmotionCatalogEntry[] =>
        items.map(({ id: _id, ...rest }) => rest);

    // 変更があるかどうか
    const isDirty = useCallback(() => {
        return JSON.stringify(stripId(emotions)) !== JSON.stringify(originalEmotions);
    }, [emotions, originalEmotions]);

    // 空の表情行を生成
    const createEmptyItem = (): EditableEntry => ({
        id: `new_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        name: '',
        label: '',
        description: '',
        enabled: true,
    });

    const withIds = (items: EmotionCatalogEntry[]): EditableEntry[] =>
        items.map((item, index) => ({ ...item, id: `loaded_${index}_${item.name}` }));

    // カタログを読み込み
    const loadCatalog = useCallback(async () => {
        setIsLoading(true);
        setErrorMessage(null);
        try {
            const catalog = await getEmotionCatalog(backendUrl);
            // default はサーバー側で先頭へ整列済み。末尾に空の入力行を足す
            const items = catalog.emotions || [];
            setEmotions([...withIds(items), createEmptyItem()]);
            setOriginalEmotions(items);
        } catch (error) {
            console.error('Failed to load emotion catalog:', error);
            setErrorMessage(t(EMOTION_CATALOG_I18N_KEYS.loadError));
            setEmotions([createEmptyItem()]);
            setOriginalEmotions([]);
        } finally {
            setIsLoading(false);
        }
    }, [backendUrl]);

    // カタログを保存
    const handleSave = async () => {
        setIsSaving(true);
        setErrorMessage(null);
        try {
            // 表情名が空の行は除外して保存する
            const validEmotions = stripId(emotions).filter(e => e.name.trim() !== '');
            const saved = await saveEmotionCatalog(backendUrl, {
                version: '1.0',
                emotions: validEmotions,
                lastModified: new Date().toISOString(),
            });
            setOriginalEmotions(saved.emotions);
            setEmotions([...withIds(saved.emotions), createEmptyItem()]);
            // 表情種別の変更はチャット画面のアイコン表示にも影響するため通知する
            notifyCharacterImagesUpdated();
            onClose();
        } catch (error) {
            console.error('Failed to save emotion catalog:', error);
            const messageKey = error instanceof EmotionCatalogApiError ? error.messageKey : undefined;
            setErrorMessage(messageKey ? t(messageKey) : t(EMOTION_CATALOG_I18N_KEYS.saveError));
        } finally {
            setIsSaving(false);
        }
    };

    // 初期化
    useEffect(() => {
        if (isOpen) {
            loadCatalog();
        }
    }, [isOpen, loadCatalog]);

    // 行を更新
    const updateItem = (index: number, updates: Partial<EmotionCatalogEntry>) => {
        setEmotions(prev => {
            const newItems = [...prev];
            newItems[index] = { ...newItems[index], ...updates };

            // 最後の行に入力があったら新しい空の行を追加
            if (index === newItems.length - 1) {
                const lastItem = newItems[index];
                if (lastItem.name.trim() !== '' || lastItem.description.trim() !== '') {
                    newItems.push(createEmptyItem());
                }
            }

            return newItems;
        });
    };

    // 行を削除
    const removeItem = (index: number) => {
        setEmotions(prev => {
            if (prev.length <= 1) return prev;
            return prev.filter((_, i) => i !== index);
        });
    };

    if (!isOpen) return null;

    // 祖先の transform 等で fixed の基準が親要素に化けると、開いた場所（設定メニュー内など）へ
    // 閉じ込められて細く表示される。body 直下へポータル描画して必ず画面中央に出す。
    return createPortal(
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] border border-gray-700 overflow-hidden flex flex-col">
                {/* ヘッダー */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 bg-gray-800 shrink-0">
                    <div className="flex items-center gap-2">
                        <Smile size={20} className="text-purple-400" />
                        <h3 className="font-semibold text-gray-100 text-lg">{t(EMOTION_CATALOG_I18N_KEYS.title)}</h3>
                        {isDirty() && (
                            <span className="text-xs text-amber-400 ml-2">{t(EMOTION_CATALOG_I18N_KEYS.dirty)}</span>
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
                        {t(EMOTION_CATALOG_I18N_KEYS.description)}
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
                                <div className="col-span-3">{t(EMOTION_CATALOG_I18N_KEYS.name)}</div>
                                <div className="col-span-2">{t(EMOTION_CATALOG_I18N_KEYS.label)}</div>
                                <div className="col-span-4">{t(EMOTION_CATALOG_I18N_KEYS.itemDescription)}</div>
                                <div className="col-span-2 text-center">{t(EMOTION_CATALOG_I18N_KEYS.enabled)}</div>
                                <div className="col-span-1"></div>
                            </div>

                            {/* 表情リスト */}
                            {emotions.map((item, index) => {
                                const isDefaultRow = item.name.trim().toLowerCase() === DEFAULT_EMOTION_NAME;
                                const isLastEmptyItem = index === emotions.length - 1 &&
                                    item.name.trim() === '' &&
                                    item.description.trim() === '';
                                const inputClass = (locked: boolean) =>
                                    `w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm outline-none focus:border-purple-500 transition-colors placeholder-gray-500 ${locked
                                        ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                                        : 'text-gray-200'
                                    }`;

                                return (
                                    <div
                                        key={item.id}
                                        className={`grid grid-cols-12 gap-3 items-center ${isLastEmptyItem ? 'opacity-60' : ''}`}
                                    >
                                        {/* 表情名 */}
                                        <div className="col-span-3">
                                            <input
                                                type="text"
                                                value={item.name}
                                                onChange={(e) => updateItem(index, { name: e.target.value })}
                                                placeholder={t(EMOTION_CATALOG_I18N_KEYS.namePlaceholder)}
                                                disabled={isDefaultRow}
                                                className={inputClass(isDefaultRow)}
                                            />
                                        </div>

                                        {/* 表示名 */}
                                        <div className="col-span-2">
                                            <input
                                                type="text"
                                                value={item.label}
                                                onChange={(e) => updateItem(index, { label: e.target.value })}
                                                placeholder={t(EMOTION_CATALOG_I18N_KEYS.labelPlaceholder)}
                                                disabled={isDefaultRow}
                                                className={inputClass(isDefaultRow)}
                                            />
                                        </div>

                                        {/* 説明 */}
                                        <div className="col-span-4">
                                            <input
                                                type="text"
                                                value={item.description}
                                                onChange={(e) => updateItem(index, { description: e.target.value })}
                                                placeholder={t(EMOTION_CATALOG_I18N_KEYS.descriptionPlaceholder)}
                                                disabled={isDefaultRow}
                                                className={inputClass(isDefaultRow)}
                                            />
                                        </div>

                                        {/* 有効トグル */}
                                        <div className="col-span-2 flex justify-center">
                                            <ToggleSwitch
                                                checked={item.enabled}
                                                onChange={(on) => updateItem(index, { enabled: on })}
                                                accent="purple"
                                                size="sm"
                                                disabled={isDefaultRow}
                                            />
                                        </div>

                                        {/* 削除ボタン */}
                                        <div className="col-span-1 flex justify-center">
                                            {!isLastEmptyItem && !isDefaultRow && (
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
        </div>,
        document.body
    );
};
