/**
 * ServerSettingsModal.tsx - 起動設定モーダル
 *
 * 設定メニュー整理で SettingsModal のトップから分離した。
 * - 起動設定（開閉: ポート / 待受アドレス / LAN公開）
 * - CLI 実行ファイルパス（開閉: 各CLI）
 */

import React, { useEffect, useState } from 'react';
import { X, Server } from 'lucide-react';
import { ToggleSwitch } from '../common/ToggleSwitch';
import { CollapsibleSection } from './CollapsibleSection';
import { fetchServerSettings, updateServerSettings, type ServerSettings } from '../../api/server-settings';
import { resolveMessage, type I18NCatalog } from '../../api/i18n';
import { SERVER_SETTINGS_NETWORK, SETTINGS_I18N_KEYS, SETTINGS_TEXT_FALLBACK_JA } from '../../constants/i18n';
import { BACKEND_URL } from '../../api/base-url';

interface ServerSettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    uiCatalog: I18NCatalog | null;
}

export const ServerSettingsModal: React.FC<ServerSettingsModalProps> = ({
    isOpen,
    onClose,
    uiCatalog,
}) => {
    const t = (key: string) => resolveMessage(uiCatalog, key, SETTINGS_TEXT_FALLBACK_JA[key] || key);

    const [serverSettings, setServerSettings] = useState<ServerSettings | null>(null);
    const [serverPortInput, setServerPortInput] = useState('');
    const [serverSettingsDirty, setServerSettingsDirty] = useState(false);
    const [serverSettingsError, setServerSettingsError] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        const fetchData = async () => {
            setServerSettingsError(null);
            try {
                const server = await fetchServerSettings(BACKEND_URL);
                setServerSettings(server.settings);
                setServerPortInput(String(server.settings.port));
                setServerSettingsDirty(false);
            } catch (err) {
                setServerSettingsError(t(SETTINGS_I18N_KEYS.serverLoadError));
                console.error('Failed to fetch server settings:', err);
            }
        };
        fetchData();
    }, [isOpen]);

    // 決定ボタン: ポート番号を検証してから保存する
    const handleConfirm = async () => {
        if (!serverSettingsDirty || !serverSettings) {
            onClose();
            return;
        }
        const parsedPort = Number(serverPortInput);
        if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
            setServerSettingsError(t(SETTINGS_I18N_KEYS.serverPortInvalid));
            return;
        }
        setIsSaving(true);
        setServerSettingsError(null);
        try {
            const saved = await updateServerSettings(BACKEND_URL, {
                ...serverSettings,
                port: parsedPort,
                bindAddress: serverSettings.bindAddress.trim(),
            });
            setServerSettings(saved.settings);
            setServerPortInput(String(saved.settings.port));
            setServerSettingsDirty(false);
        } catch (error) {
            setServerSettingsError(t(SETTINGS_I18N_KEYS.serverSaveError));
            console.error('Failed to save server settings:', error);
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
                        <Server size={20} className="text-cyan-400" />
                        <h3 className="font-semibold text-gray-100 text-lg">{t(SETTINGS_I18N_KEYS.serverTitle)}</h3>
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
                    {serverSettingsError && (
                        <p className="text-xs text-red-300 bg-red-950/30 border border-red-900/50 rounded px-3 py-2">
                            {serverSettingsError}
                        </p>
                    )}

                    {serverSettings ? (
                        <>
                            {/* 起動設定（開閉） */}
                            <CollapsibleSection title={t(SETTINGS_I18N_KEYS.serverTitle)} defaultOpen>
                                <label className="block">
                                    <span className="text-xs text-gray-500">{t(SETTINGS_I18N_KEYS.serverPortLabel)}</span>
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        pattern="[0-9]*"
                                        value={serverPortInput}
                                        onChange={(e) => {
                                            const next = e.target.value.replace(/[^\d]/g, '');
                                            setServerPortInput(next);
                                            setServerSettingsError(null);
                                            setServerSettingsDirty(true);
                                        }}
                                        className="mt-1 w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-blue-500"
                                    />
                                </label>
                                <label className="block">
                                    <span className="text-xs text-gray-500">{t(SETTINGS_I18N_KEYS.serverBindAddressLabel)}</span>
                                    <input
                                        type="text"
                                        value={serverSettings.bindAddress}
                                        onChange={(e) => {
                                            setServerSettings(prev => prev ? ({
                                                ...prev,
                                                bindAddress: e.target.value,
                                            }) : prev);
                                            setServerSettingsDirty(true);
                                        }}
                                        className="mt-1 w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-blue-500"
                                    />
                                </label>
                                <ToggleSwitch
                                    checked={serverSettings.lanPublic}
                                    onChange={(on) => {
                                        setServerSettings(prev => prev ? ({
                                            ...prev,
                                            lanPublic: on,
                                            bindAddress: on && prev.bindAddress === SERVER_SETTINGS_NETWORK.localBindAddress
                                                ? SERVER_SETTINGS_NETWORK.lanBindAddress
                                                : prev.bindAddress,
                                        }) : prev);
                                        setServerSettingsDirty(true);
                                    }}
                                    label={<span className="text-sm text-gray-300">{t(SETTINGS_I18N_KEYS.serverLanPublicLabel)}</span>}
                                    accent="cyan"
                                    className="w-full justify-between px-1"
                                />
                                <p className="text-xs text-gray-500 px-1">
                                    {t(SETTINGS_I18N_KEYS.serverDescription)}
                                </p>
                            </CollapsibleSection>

                            {/* CLI 実行ファイルパス（開閉） */}
                            <CollapsibleSection title={t(SETTINGS_I18N_KEYS.cliPathsTitle)}>
                                {([
                                    { key: 'gemini' as const, label: SETTINGS_I18N_KEYS.cliPathsGeminiLabel },
                                    { key: 'claude' as const, label: SETTINGS_I18N_KEYS.cliPathsClaudeLabel },
                                    { key: 'antigravity' as const, label: SETTINGS_I18N_KEYS.cliPathsAntigravityLabel },
                                ]).map(({ key, label }) => (
                                    <label key={key} className="block">
                                        <span className="text-xs text-gray-500">{t(label)}</span>
                                        <input
                                            type="text"
                                            value={serverSettings.cliPaths?.[key] ?? ''}
                                            placeholder={t(SETTINGS_I18N_KEYS.cliPathsPlaceholder)}
                                            onChange={(e) => {
                                                const next = e.target.value;
                                                setServerSettings(prev => prev ? ({
                                                    ...prev,
                                                    cliPaths: {
                                                        gemini: prev.cliPaths?.gemini ?? '',
                                                        claude: prev.cliPaths?.claude ?? '',
                                                        antigravity: prev.cliPaths?.antigravity ?? '',
                                                        [key]: next,
                                                    },
                                                }) : prev);
                                                setServerSettingsDirty(true);
                                            }}
                                            className="mt-1 w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-blue-500"
                                        />
                                    </label>
                                ))}
                                <p className="text-xs text-gray-500 px-1">
                                    {t(SETTINGS_I18N_KEYS.cliPathsDescription)}
                                </p>
                            </CollapsibleSection>
                        </>
                    ) : null}
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
