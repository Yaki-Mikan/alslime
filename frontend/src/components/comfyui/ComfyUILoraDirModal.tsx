/**
 * ComfyUILoraDirModal.tsx - LoRAディレクトリ設定モーダル
 *
 * 各カテゴリに対応するLoRAのディレクトリ名を設定する。
 * ベースディレクトリ + カテゴリごとのサブディレクトリで
 * LoRAフィルタ用プレフィックスを構築する。
 */

import React, { useState, useEffect, useCallback } from 'react';
import { X, Loader2, Save, FolderOpen } from 'lucide-react';
import { getLoraDirConfig, saveLoraDirConfig, getLoraDirDefaults } from '../../api/comfyui';
import type { LoraDirConfig } from '../../api/comfyui';
import { createComfyUIText, formatComfyText } from './i18n';
import type { I18NCatalog } from '../../api/i18n';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    backendUrl: string;
    uiCatalog?: I18NCatalog | null;
}

export const ComfyUILoraDirModal: React.FC<Props> = ({
    isOpen,
    onClose,
    backendUrl,
    uiCatalog = null,
}) => {
    const { COMMON, LORA, SECTION_NAMES } = createComfyUIText(uiCatalog);
    const [config, setConfig] = useState<LoraDirConfig | null>(null);
    const [defaults, setDefaults] = useState<LoraDirConfig | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isDirty, setIsDirty] = useState(false);
    const [saveMessage, setSaveMessage] = useState<string | null>(null);

    const loadData = useCallback(async () => {
        setIsLoading(true);
        try {
            const [data, defs] = await Promise.all([
                getLoraDirConfig(backendUrl),
                getLoraDirDefaults(backendUrl),
            ]);
            setConfig(data);
            setDefaults(defs);
            setIsDirty(false);
        } catch (error) {
            console.error('[ComfyUILoraDirModal] config load failed:', error);
        } finally {
            setIsLoading(false);
        }
    }, [backendUrl]);

    useEffect(() => {
        if (isOpen) {
            loadData();
            setSaveMessage(null);
        }
    }, [isOpen, loadData]);

    const updateCategoryDirectory = (id: string, value: string) => {
        if (!config) return;
        setConfig({
            ...config,
            categories: config.categories.map(c =>
                c.id === id ? { ...c, directory: value } : c
            ),
        });
        setIsDirty(true);
        setSaveMessage(null);
    };

    const handleSave = async () => {
        if (!config) return;
        setIsSaving(true);
        try {
            await saveLoraDirConfig(backendUrl, config);
            setIsDirty(false);
            setSaveMessage(COMMON.MESSAGES.SAVED);
            setTimeout(() => setSaveMessage(null), 3000);
        } catch (error) {
            console.error('[ComfyUILoraDirModal] save failed:', error);
            setSaveMessage(COMMON.MESSAGES.SAVE_FAILED);
        } finally {
            setIsSaving(false);
        }
    };

    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) onClose();
    };

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
            onClick={handleBackdropClick}
        >
            <div className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-xl border border-gray-700 overflow-hidden">
                {/* ヘッダー */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 bg-gray-800">
                    <div className="flex items-center gap-2">
                        <FolderOpen size={18} className="text-yellow-400" />
                        <h3 className="font-semibold text-gray-100 text-lg">{SECTION_NAMES.LORA_DIR_SETTINGS}</h3>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 hover:bg-gray-700 rounded text-gray-400 hover:text-gray-200 transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* 本体 */}
                <div className="p-5 space-y-5 max-h-[60vh] overflow-y-auto custom-scrollbar">
                    {isLoading ? (
                        <div className="flex justify-center py-8">
                            <Loader2 size={24} className="animate-spin text-gray-500" />
                        </div>
                    ) : config ? (
                        <div className="space-y-3">
                            <p className="text-xs text-gray-500">
                                {COMMON.MESSAGES.LORA_DIR_DESCRIPTION}
                            </p>
                            {config.categories.map((cat) => {
                                const defaultDir = defaults?.categories.find(d => d.id === cat.id)?.directory || '';
                                return (
                                <div key={cat.id} className="flex items-center gap-2">
                                    <span className="text-sm text-gray-300 w-28 shrink-0">{cat.label}</span>
                                    <input
                                        type="text"
                                        value={cat.directory}
                                        onChange={(e) => updateCategoryDirectory(cat.id, e.target.value)}
                                        placeholder={LORA.PLACEHOLDERS.DIRECTORY_NAME}
                                        className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 outline-none focus:border-yellow-500 transition-colors"
                                    />
                                    <button
                                        onClick={() => updateCategoryDirectory(cat.id, defaultDir)}
                                        disabled={cat.directory === defaultDir}
                                        className="px-2 py-1 text-xs text-gray-400 hover:text-yellow-400 bg-gray-800 border border-gray-700 rounded hover:border-yellow-600 transition-colors disabled:opacity-30 shrink-0"
                                        title={formatComfyText(COMMON.MESSAGES.DEFAULT_VALUE, { value: defaultDir })}
                                    >
                                        {COMMON.BUTTONS.RESET}
                                    </button>
                                </div>
                                );
                            })}
                        </div>
                    ) : null}
                </div>

                {/* フッター */}
                <div className="flex items-center justify-between px-5 py-4 border-t border-gray-700 bg-gray-800/50">
                    <div className="text-sm">
                        {saveMessage && (
                            <span className={saveMessage === COMMON.MESSAGES.SAVE_FAILED ? 'text-red-400' : 'text-green-400'}>
                                {saveMessage}
                            </span>
                        )}
                    </div>
                    <div className="flex gap-3">
                        <button
                            onClick={onClose}
                            className="px-5 py-2 text-sm text-gray-300 hover:text-gray-100 hover:bg-gray-700 rounded-lg transition-colors"
                        >
                            {COMMON.BUTTONS.CLOSE}
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={isSaving || !isDirty}
                            className="px-5 py-2 text-sm text-white bg-yellow-600 hover:bg-yellow-500 disabled:opacity-40 rounded-lg transition-colors flex items-center gap-1.5"
                        >
                            <Save size={14} />
                            {isSaving ? COMMON.BUTTONS.SAVING : COMMON.BUTTONS.SAVE}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
