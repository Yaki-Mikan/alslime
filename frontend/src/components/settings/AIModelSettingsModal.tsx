/**
 * AIModelSettingsModal.tsx - AIモデル設定モーダル
 *
 * 設定メニュー整理で SettingsModal のトップから分離した。
 * - デフォルト会話プリセット
 * - デフォルトプロバイダ（開閉: デフォルトプロバイダ + プロバイダ別デフォルトモデル）
 * - モデル一覧の編集（ModelListEditorModal へ）
 */

import React, { useEffect, useState } from 'react';
import { X, Bot, ChevronDown, ListPlus } from 'lucide-react';
import axios from '../../lib/axios';
import { CollapsibleSection } from './CollapsibleSection';
import { ModelListEditorModal } from './ModelListEditorModal';
import { listSSRPAllPresets } from '../../api/datetime-presets';
import { getGlobalSettings, updateGlobalSettings } from '../../api/global-settings';
import { modelProviderOf, type Model, type ModelProvider } from '../../hooks/useChat';
import { resolveMessage, type I18NCatalog } from '../../api/i18n';
import { SETTINGS_I18N_KEYS, SETTINGS_TEXT_FALLBACK_JA } from '../../constants/i18n';
import { BACKEND_URL } from '../../api/base-url';

interface AIModelSettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    uiCatalog: I18NCatalog | null;
    // モデル一覧編集の保存後にチャット側のモデル一覧を再取得させる（useChat.refreshModels）。
    onModelsChanged?: () => void;
}

export const AIModelSettingsModal: React.FC<AIModelSettingsModalProps> = ({
    isOpen,
    onClose,
    uiCatalog,
    onModelsChanged,
}) => {
    const t = (key: string) => resolveMessage(uiCatalog, key, SETTINGS_TEXT_FALLBACK_JA[key] || key);

    // デフォルト会話プリセット
    const [ssrpAllPresets, setSSRPAllPresets] = useState<string[]>([]);
    const [defaultPresetName, setDefaultPresetName] = useState<string>('');
    const [defaultPresetDirty, setDefaultPresetDirty] = useState(false);

    // デフォルトプロバイダ設定（チャット欄の初期プロバイダ。空 = antigravity）
    const [defaultProvider, setDefaultProvider] = useState<string>('');
    const [defaultProviderDirty, setDefaultProviderDirty] = useState(false);

    // プロバイダ別デフォルトモデル設定
    const [availableModels, setAvailableModels] = useState<Model[]>([]);
    const [defaultModels, setDefaultModels] = useState<Record<ModelProvider, string>>({ gemini: '', claude: '', antigravity: '' });
    const [defaultModelsDirty, setDefaultModelsDirty] = useState(false);

    // モデル一覧編集モーダルの開閉状態
    const [isModelEditorOpen, setIsModelEditorOpen] = useState(false);

    const [isSaving, setIsSaving] = useState(false);

    // モデル一覧編集の保存後にドロップダウンへ即時反映するための再取得。
    const refreshAvailableModels = async () => {
        try {
            const modelsRes = await axios.get(`${BACKEND_URL}/api/models`);
            setAvailableModels(modelsRes.data.models || []);
        } catch (err) {
            console.error('Failed to refresh models:', err);
        }
    };

    // プリセット一覧・グローバル設定・モデル一覧を取得
    useEffect(() => {
        if (!isOpen) return;
        const fetchData = async () => {
            try {
                const [presets, globalSettings] = await Promise.all([
                    listSSRPAllPresets(BACKEND_URL),
                    getGlobalSettings(BACKEND_URL),
                ]);
                setSSRPAllPresets(presets);
                setDefaultPresetName(globalSettings.defaultSSRPPresetName || '');
                const savedDefaultModels = (globalSettings.defaultModels || {}) as Record<string, string>;
                setDefaultModels({
                    gemini: savedDefaultModels.gemini || '',
                    claude: savedDefaultModels.claude || '',
                    antigravity: savedDefaultModels.antigravity || '',
                });
                setDefaultProvider(globalSettings.defaultProvider || '');
            } catch (err) {
                console.error('Failed to fetch presets/global settings:', err);
            }
            await refreshAvailableModels();
        };
        fetchData();
        setDefaultPresetDirty(false);
        setDefaultProviderDirty(false);
        setDefaultModelsDirty(false);
    }, [isOpen]);

    // 決定ボタン: 変更分だけまとめて保存
    const handleConfirm = async () => {
        setIsSaving(true);
        try {
            const updates: Record<string, unknown> = {};
            if (defaultPresetDirty) {
                updates.defaultSSRPPresetName = defaultPresetName || undefined;
            }
            if (defaultProviderDirty) {
                updates.defaultProvider = defaultProvider;
            }
            if (defaultModelsDirty) {
                updates.defaultModels = defaultModels;
            }
            if (Object.keys(updates).length > 0) {
                await updateGlobalSettings(BACKEND_URL, updates);
            }
        } catch (error) {
            console.error('Failed to save AI model settings:', error);
            setIsSaving(false);
            return;
        }
        setIsSaving(false);
        onClose();
    };

    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) onClose();
    };

    if (!isOpen) return null;

    return (
        <>
            <div
                className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
                onClick={handleBackdropClick}
            >
                <div className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg border border-gray-700 overflow-hidden">
                    {/* ヘッダー */}
                    <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 bg-gray-800">
                        <div className="flex items-center gap-2">
                            <Bot size={20} className="text-blue-400" />
                            <h3 className="font-semibold text-gray-100 text-lg">{t(SETTINGS_I18N_KEYS.aiModelLabel)}</h3>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-1.5 hover:bg-gray-700 rounded text-gray-400 hover:text-gray-200 transition-colors"
                        >
                            <X size={20} />
                        </button>
                    </div>

                    {/* 本体 */}
                    <div className="p-5 space-y-6 max-h-[60vh] overflow-y-auto custom-scrollbar">
                        {/* デフォルト会話プリセット */}
                        <div>
                            <h4 className="text-sm font-medium text-gray-400 mb-3 px-1">{t(SETTINGS_I18N_KEYS.defaultPresetTitle)}</h4>
                            <div className="relative">
                                <select
                                    value={defaultPresetName}
                                    onChange={(e) => {
                                        setDefaultPresetName(e.target.value);
                                        setDefaultPresetDirty(true);
                                    }}
                                    className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2.5 text-sm text-gray-200 outline-none focus:border-blue-500 appearance-none cursor-pointer hover:bg-gray-700 pr-8"
                                >
                                    <option value="">{t(SETTINGS_I18N_KEYS.defaultPresetNone)}</option>
                                    {ssrpAllPresets.map(name => (
                                        <option key={name} value={name}>{name}</option>
                                    ))}
                                </select>
                                <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                            </div>
                            <p className="text-xs text-gray-500 mt-2 px-1">
                                {t(SETTINGS_I18N_KEYS.defaultPresetDescription)}
                            </p>
                        </div>

                        {/* デフォルトプロバイダ（開閉） */}
                        <CollapsibleSection title={t(SETTINGS_I18N_KEYS.defaultProviderTitle)}>
                            {/* デフォルトプロバイダ */}
                            <div>
                                <h4 className="text-sm font-medium text-gray-400 mb-2 px-1">{t(SETTINGS_I18N_KEYS.defaultProviderTitle)}</h4>
                                <div className="relative">
                                    <select
                                        value={defaultProvider}
                                        onChange={(e) => {
                                            setDefaultProvider(e.target.value);
                                            setDefaultProviderDirty(true);
                                        }}
                                        className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-blue-500 appearance-none cursor-pointer hover:bg-gray-700 pr-8"
                                    >
                                        <option value="">{t(SETTINGS_I18N_KEYS.defaultProviderNone)}</option>
                                        <option value="antigravity">Antigravity</option>
                                        <option value="claude">Claude</option>
                                        <option value="gemini">Gemini</option>
                                    </select>
                                    <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                                </div>
                                <p className="text-xs text-gray-500 mt-2 px-1">
                                    {t(SETTINGS_I18N_KEYS.defaultProviderDescription)}
                                </p>
                            </div>

                            {/* プロバイダ別デフォルトモデル */}
                            <div className="pt-3 border-t border-gray-700">
                                <h4 className="text-sm font-medium text-gray-400 mb-2 px-1">{t(SETTINGS_I18N_KEYS.defaultModelsTitle)}</h4>
                                <div className="space-y-2">
                                    {([
                                        ['gemini', t(SETTINGS_I18N_KEYS.defaultModelsGeminiLabel)],
                                        ['claude', t(SETTINGS_I18N_KEYS.defaultModelsClaudeLabel)],
                                        ['antigravity', t(SETTINGS_I18N_KEYS.defaultModelsAntigravityLabel)],
                                    ] as [ModelProvider, string][]).map(([provider, label]) => (
                                        <div key={provider} className="flex items-center gap-2">
                                            <span className="w-24 shrink-0 text-sm text-gray-300 px-1">{label}</span>
                                            <div className="relative flex-1">
                                                <select
                                                    value={defaultModels[provider]}
                                                    onChange={(e) => {
                                                        setDefaultModels(prev => ({ ...prev, [provider]: e.target.value }));
                                                        setDefaultModelsDirty(true);
                                                    }}
                                                    className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-blue-500 appearance-none cursor-pointer hover:bg-gray-700 pr-8"
                                                >
                                                    <option value="">{t(SETTINGS_I18N_KEYS.defaultModelsNone)}</option>
                                                    {availableModels
                                                        .filter(m => m.id !== '' && modelProviderOf(m) === provider)
                                                        .map(m => (
                                                            <option key={m.id} value={m.id}>{m.description || m.id}</option>
                                                        ))}
                                                </select>
                                                <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <p className="text-xs text-gray-500 mt-2 px-1">
                                    {t(SETTINGS_I18N_KEYS.defaultModelsDescription)}
                                </p>
                            </div>
                        </CollapsibleSection>

                        {/* モデル一覧の編集 */}
                        <div>
                            <button
                                onClick={() => setIsModelEditorOpen(true)}
                                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gray-800 hover:bg-gray-700 border border-blue-600 rounded-lg text-sm text-gray-300 transition-colors"
                            >
                                <ListPlus size={16} className="text-blue-400" />
                                {t(SETTINGS_I18N_KEYS.modelEditorLabel)}
                            </button>
                            <p className="text-xs text-gray-500 mt-2 text-center">
                                {t(SETTINGS_I18N_KEYS.modelEditorDescription)}
                            </p>
                        </div>
                    </div>

                    {/* フッター */}
                    <div className="flex justify-end gap-3 px-5 py-4 border-t border-gray-700 bg-gray-800/50">
                        <button
                            onClick={onClose}
                            className="px-5 py-2 text-sm text-gray-300 hover:text-gray-100 hover:bg-gray-700 rounded-lg transition-colors"
                        >
                            {t(SETTINGS_I18N_KEYS.cancel)}
                        </button>
                        <button
                            onClick={handleConfirm}
                            disabled={isSaving}
                            className="px-5 py-2 text-sm text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg transition-colors"
                        >
                            {isSaving ? t(SETTINGS_I18N_KEYS.saving) : t(SETTINGS_I18N_KEYS.confirm)}
                        </button>
                    </div>
                </div>
            </div>

            {/* モデル一覧編集モーダル */}
            <ModelListEditorModal
                isOpen={isModelEditorOpen}
                onClose={() => setIsModelEditorOpen(false)}
                uiCatalog={uiCatalog}
                onSaved={() => {
                    refreshAvailableModels();
                    onModelsChanged?.();
                }}
            />
        </>
    );
};
