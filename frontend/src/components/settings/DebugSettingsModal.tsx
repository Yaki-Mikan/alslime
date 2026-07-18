/**
 * DebugSettingsModal.tsx - デバッグ設定モーダル
 *
 * 設定メニュー整理で SettingsModal のトップから分離した。
 * Settings 型で「デバッグ用」とされているバックアップ系トグルを集約する。
 * - 初回応答のみバックアップ
 * - レスポンスバックアップ（全量）
 */

import React, { useEffect, useState } from 'react';
import { X, Bug, Database } from 'lucide-react';
import { ToggleSwitch } from '../common/ToggleSwitch';
import type { Settings } from '../../types/Settings';
import { resolveMessage, type I18NCatalog } from '../../api/i18n';
import { SETTINGS_I18N_KEYS, SETTINGS_TEXT_FALLBACK_JA } from '../../constants/i18n';

interface DebugSettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    settings: Settings;
    onSave: (settings: Settings) => Promise<void>;
    uiCatalog: I18NCatalog | null;
}

export const DebugSettingsModal: React.FC<DebugSettingsModalProps> = ({
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

    useEffect(() => {
        if (isOpen) {
            setLocalSettings(settings);
        }
    }, [isOpen, settings]);

    // 決定ボタン
    const handleConfirm = async () => {
        setIsSaving(true);
        try {
            await onSave(localSettings);
        } catch (error) {
            console.error('Failed to save debug settings:', error);
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
        <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
            onClick={handleBackdropClick}
        >
            <div className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg border border-gray-700 overflow-hidden">
                {/* ヘッダー */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 bg-gray-800">
                    <div className="flex items-center gap-2">
                        <Bug size={20} className="text-amber-400" />
                        <h3 className="font-semibold text-gray-100 text-lg">{t(SETTINGS_I18N_KEYS.debugLabel)}</h3>
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
                    {/* 初回応答のみバックアップ */}
                    <div>
                        <ToggleSwitch
                            checked={localSettings.enableFirstResponseBackup ?? false}
                            onChange={(on) => setLocalSettings(prev => ({ ...prev, enableFirstResponseBackup: on }))}
                            label={
                                <span className="flex items-center gap-2">
                                    <Database size={16} className="text-amber-400" />
                                    <span className="text-sm font-medium text-gray-300">{t(SETTINGS_I18N_KEYS.firstResponseBackupLabel)}</span>
                                </span>
                            }
                            accent="amber"
                            className="w-full justify-between px-1"
                        />
                        <p className="text-xs text-gray-500 mt-2 px-1">
                            {t(SETTINGS_I18N_KEYS.firstResponseBackupDescription)}
                        </p>
                    </div>

                    {/* レスポンスバックアップ */}
                    <div className="pt-4 border-t border-gray-700">
                        <ToggleSwitch
                            checked={localSettings.enableResponseBackup ?? false}
                            onChange={(on) => setLocalSettings(prev => ({ ...prev, enableResponseBackup: on }))}
                            label={
                                <span className="flex items-center gap-2">
                                    <Database size={16} className="text-amber-400" />
                                    <span className="text-sm font-medium text-gray-300">{t(SETTINGS_I18N_KEYS.responseBackupLabel)}</span>
                                </span>
                            }
                            accent="amber"
                            className="w-full justify-between px-1"
                        />
                        <p className="text-xs text-gray-500 mt-2 px-1">
                            {t(SETTINGS_I18N_KEYS.responseBackupDescription)}
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
    );
};
