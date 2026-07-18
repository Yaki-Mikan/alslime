/**
 * ChatBasicSettingsModal.tsx - 基本チャット設定モーダル
 *
 * 設定メニュー整理で SettingsModal のトップから分離した。
 * - フォント / フォントサイズ / 行間 / 空行 / 生成温度 / 背景画像（BasicSettings）
 * - 祝日情報を反映（日本語UIのみ）
 * - キャラクター表示設定
 * - キャラパラメータ項目の管理（ParameterSchemaEditorModal へ）
 * - テキスト置換設定（ReplacementConfigModal へ）
 */

import React, { useEffect, useState } from 'react';
import { X, MessageSquare, CalendarDays, FileText, RefreshCw, User } from 'lucide-react';
import { ToggleSwitch } from '../common/ToggleSwitch';
import { BasicSettings } from './BasicSettings';
import { ParameterSchemaEditorModal } from './ParameterSchemaEditorModal';
import { ReplacementConfigModal } from '../SSRP/ReplacementConfigModal';
import type { Settings } from '../../types/Settings';
import { resolveMessage, type I18NCatalog } from '../../api/i18n';
import { DEFAULT_UI_LANGUAGE, SETTINGS_I18N_KEYS, SETTINGS_TEXT_FALLBACK_JA } from '../../constants/i18n';
import { BACKEND_URL } from '../../api/base-url';

interface ChatBasicSettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    settings: Settings;
    onSave: (settings: Settings) => Promise<void>;
    uiCatalog: I18NCatalog | null;
}

export const ChatBasicSettingsModal: React.FC<ChatBasicSettingsModalProps> = ({
    isOpen,
    onClose,
    settings,
    onSave,
    uiCatalog,
}) => {
    const t = (key: string) => resolveMessage(uiCatalog, key, SETTINGS_TEXT_FALLBACK_JA[key] || key);

    // 編集中の設定（ローカル状態）
    const [localSettings, setLocalSettings] = useState<Settings>(settings);
    const [isSaving, setIsSaving] = useState(false);

    // 項目設定管理モーダルの開閉状態
    const [isSchemaEditorOpen, setIsSchemaEditorOpen] = useState(false);
    // 置換設定モーダルの開閉状態
    const [isReplacementConfigOpen, setIsReplacementConfigOpen] = useState(false);

    // モーダルが開いたときに最新の設定を反映
    useEffect(() => {
        if (isOpen) {
            setLocalSettings(settings);
        }
    }, [isOpen, settings]);

    // 決定ボタン
    const handleConfirm = async () => {
        setIsSaving(true);
        try {
            const settingsToSave = localSettings.uiLanguage === DEFAULT_UI_LANGUAGE
                ? localSettings
                : { ...localSettings, holidayCalendarEnabled: false };
            await onSave(settingsToSave);
        } catch (error) {
            console.error('Failed to save chat basic settings:', error);
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
                            <MessageSquare size={20} className="text-blue-400" />
                            <h3 className="font-semibold text-gray-100 text-lg">{t(SETTINGS_I18N_KEYS.chatBasicLabel)}</h3>
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
                        {/* デフォルトユーザー名 */}
                        <div>
                            <label className="flex items-center gap-2 text-sm font-medium text-gray-300 mb-2">
                                <User size={16} className="text-blue-400" />
                                {t(SETTINGS_I18N_KEYS.defaultUserNameLabel)}
                            </label>
                            <input
                                type="text"
                                value={localSettings.defaultUserName || ''}
                                onChange={(e) => setLocalSettings(prev => ({
                                    ...prev,
                                    defaultUserName: e.target.value,
                                }))}
                                placeholder={t(SETTINGS_I18N_KEYS.defaultUserNamePlaceholder)}
                                className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-gray-200 outline-none focus:border-blue-500"
                            />
                            <p className="text-xs text-gray-500 mt-2 px-1">
                                {t(SETTINGS_I18N_KEYS.defaultUserNameDescription)}
                            </p>
                        </div>

                        <BasicSettings
                            settings={localSettings}
                            onChange={setLocalSettings}
                            uiCatalog={uiCatalog}
                        />

                        {/* 祝日情報を反映（日本語UIのみ） */}
                        {localSettings.uiLanguage === DEFAULT_UI_LANGUAGE && (
                            <div className="pt-4 border-t border-gray-700">
                                <ToggleSwitch
                                    checked={localSettings.holidayCalendarEnabled ?? false}
                                    onChange={(on) => setLocalSettings(prev => ({
                                        ...prev,
                                        holidayCalendarEnabled: on,
                                    }))}
                                    label={
                                        <span className="flex items-center gap-2">
                                            <CalendarDays size={16} className="text-blue-400" />
                                            <span className="text-sm font-medium text-gray-300">{t(SETTINGS_I18N_KEYS.holidayCalendarLabel)}</span>
                                        </span>
                                    }
                                    accent="blue"
                                    className="w-full justify-between px-1"
                                />
                                <p className="text-xs text-gray-500 mt-2 px-1">
                                    {t(SETTINGS_I18N_KEYS.holidayCalendarDescription)}
                                </p>
                            </div>
                        )}

                        {/* キャラクターアイコン表示モード */}
                        <div className="pt-4 border-t border-gray-700">
                            <h4 className="text-sm font-medium text-gray-400 mb-3 px-1">{t(SETTINGS_I18N_KEYS.characterDisplayTitle)}</h4>
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <label className="text-sm text-gray-300">{t(SETTINGS_I18N_KEYS.characterIconSizeLabel)}</label>
                                    <select
                                        value={localSettings.characterIconSize || 40}
                                        onChange={(e) => setLocalSettings(prev => ({
                                            ...prev,
                                            characterIconSize: Number(e.target.value)
                                        }))}
                                        className="bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-sm text-gray-200 outline-none focus:border-blue-500"
                                    >
                                        <option value={40}>{t(SETTINGS_I18N_KEYS.characterIconSmall)}</option>
                                        <option value={100}>100px</option>
                                        <option value={150}>150px</option>
                                        <option value={200}>200px</option>
                                        <option value={250}>250px</option>
                                        <option value={300}>300px</option>
                                        <option value={350}>350px</option>
                                        <option value={400}>400px</option>
                                        <option value={450}>450px</option>
                                        <option value={500}>{t(SETTINGS_I18N_KEYS.characterIconMax)}</option>
                                    </select>
                                </div>
                                <p className="text-xs text-gray-500 px-1">
                                    {t(SETTINGS_I18N_KEYS.characterDisplayDescription)}
                                </p>
                            </div>
                        </div>

                        {/* キャラパラメータ項目の管理 */}
                        <div className="pt-4 border-t border-gray-700">
                            <button
                                onClick={() => setIsSchemaEditorOpen(true)}
                                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gray-800 hover:bg-gray-700 border border-purple-600 rounded-lg text-sm text-gray-300 transition-colors"
                            >
                                <FileText size={16} className="text-purple-400" />
                                {t(SETTINGS_I18N_KEYS.schemaManagerLabel)}
                            </button>
                            <p className="text-xs text-gray-500 mt-2 text-center">
                                {t(SETTINGS_I18N_KEYS.schemaManagerDescription)}
                            </p>
                        </div>

                        {/* テキスト置換設定 */}
                        <div className="pt-4 border-t border-gray-700">
                            <button
                                onClick={() => setIsReplacementConfigOpen(true)}
                                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gray-800 hover:bg-gray-700 border border-purple-600 rounded-lg text-sm text-gray-300 transition-colors"
                            >
                                <RefreshCw size={16} className="text-purple-400" />
                                {t(SETTINGS_I18N_KEYS.replacementConfigLabel)}
                            </button>
                            <p className="text-xs text-gray-500 mt-2 text-center">
                                {t(SETTINGS_I18N_KEYS.replacementConfigDescription)}
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

            {/* 項目設定管理モーダル */}
            <ParameterSchemaEditorModal
                isOpen={isSchemaEditorOpen}
                onClose={() => setIsSchemaEditorOpen(false)}
                uiCatalog={uiCatalog}
            />

            {/* 置換設定モーダル */}
            <ReplacementConfigModal
                isOpen={isReplacementConfigOpen}
                onClose={() => setIsReplacementConfigOpen(false)}
                backendUrl={BACKEND_URL}
                uiCatalog={uiCatalog}
            />
        </>
    );
};
