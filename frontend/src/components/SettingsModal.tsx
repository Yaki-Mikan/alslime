/**
 * SettingsModal.tsx - 設定メニューのハブ画面
 *
 * 設定メニュー整理（設定メニュー整理/やりたいこと.md）でトップをボタン一覧のハブに再構成した。
 * 各カテゴリの実体は以下のサブモーダルに分離されている。
 * - AIモデル設定       → AIModelSettingsModal
 * - 画像生成設定       → ComfyUISettingsModal（支援者機能が有効な場合のみ表示）
 * - 基本チャット設定   → ChatBasicSettingsModal
 * - 起動設定           → ServerSettingsModal
 * - デバッグ設定       → DebugSettingsModal
 * 言語設定のみプルダウンをトップへ直置きし、変更時に即保存する。
 */

import React, { useEffect, useState } from 'react';
import { X, Settings as SettingsIcon, LogOut, Activity, Bot, Bug, ChevronDown, Cpu, Heart, MessageSquare, Package, Server, Tag, Palette } from 'lucide-react';
import type { Settings } from '../types/Settings';
import { AIModelSettingsModal } from './settings/AIModelSettingsModal';
import { ChatBasicSettingsModal } from './settings/ChatBasicSettingsModal';
import { ServerSettingsModal } from './settings/ServerSettingsModal';
import { DebugSettingsModal } from './settings/DebugSettingsModal';
import { ComfyUISettingsModal } from './comfyui/ComfyUISettingsModal';
import { ProcessLimitsModal } from './ProcessLimitsModal';
import { SystemDiagnosticsModal } from './SystemDiagnosticsModal';
import { SponsorModal } from './SponsorModal';
import { SettingsPackModal } from './settings/SettingsPackModal';
import { rebuildCharacterFilters } from '../api/files';
import { fetchI18NLanguages, resolveMessage, type I18NCatalog } from '../api/i18n';
import { BACKEND_URL } from '../api/base-url';
import { FEATURE_COMFYUI, isFeatureEnabled } from '../constants/features';
import { DEFAULT_UI_LANGUAGE, SETTINGS_I18N_KEYS, SETTINGS_TEXT_FALLBACK_JA, UI_LANGUAGE_LABELS, UI_LANGUAGE_OPTIONS } from '../constants/i18n';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    settings: Settings;
    onSave: (settings: Settings) => Promise<void>;
    onLogout?: () => void;
    uiCatalog: I18NCatalog | null;
    // backend の tier gate（機能フラグ）。Chat が一度だけ取得して配布する（04調査 中#4）。
    enabledFeatures?: Record<string, boolean> | null;
    // モデル一覧編集の保存後にチャット側のモデル一覧を再取得させる（useChat.refreshModels）。
    onModelsChanged?: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
    isOpen,
    onClose,
    settings,
    onSave,
    onLogout,
    uiCatalog,
    enabledFeatures = null,
    onModelsChanged,
}) => {
    const t = (key: string) => resolveMessage(uiCatalog, key, SETTINGS_TEXT_FALLBACK_JA[key] || key);
    const formatText = (template: string, values: Record<string, string | number>) => {
        return Object.entries(values).reduce((text, [key, value]) => {
            return text.split(`{{${key}}}`).join(String(value));
        }, template);
    };

    // サブモーダルの開閉状態
    const [isAIModelOpen, setIsAIModelOpen] = useState(false);
    const [isComfyUISettingsOpen, setIsComfyUISettingsOpen] = useState(false);
    const [isChatBasicOpen, setIsChatBasicOpen] = useState(false);
    const [isServerSettingsOpen, setIsServerSettingsOpen] = useState(false);
    const [isDebugOpen, setIsDebugOpen] = useState(false);
    const [isProcessLimitsOpen, setIsProcessLimitsOpen] = useState(false);
    const [isSystemDiagnosticsOpen, setIsSystemDiagnosticsOpen] = useState(false);
    const [isSponsorOpen, setIsSponsorOpen] = useState(false);
    const [isSettingsPackOpen, setIsSettingsPackOpen] = useState(false);

    // 言語設定（トップ直置き。変更時に即保存する）
    const [uiLanguageOptions, setUILanguageOptions] = useState(UI_LANGUAGE_OPTIONS);
    const [isSavingLanguage, setIsSavingLanguage] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        const fetchLanguages = async () => {
            try {
                const languages = await fetchI18NLanguages(BACKEND_URL);
                setUILanguageOptions(languages.languages.map(lang => ({
                    value: lang,
                    label: UI_LANGUAGE_LABELS[lang] || lang,
                })));
            } catch (langErr) {
                setUILanguageOptions(UI_LANGUAGE_OPTIONS);
                console.error('Failed to fetch UI languages:', langErr);
            }
        };
        fetchLanguages();
    }, [isOpen]);

    // 言語変更は即保存（祝日カレンダーは日本語UI専用のため他言語では無効化する）
    const handleLanguageChange = async (lang: string) => {
        setIsSavingLanguage(true);
        try {
            await onSave({
                ...settings,
                uiLanguage: lang,
                holidayCalendarEnabled: lang === DEFAULT_UI_LANGUAGE
                    ? settings.holidayCalendarEnabled
                    : false,
            });
        } catch (error) {
            console.error('Failed to save UI language:', error);
        }
        setIsSavingLanguage(false);
    };

    // キャラタグマスタ更新（即時実行）
    const handleRebuildTagMaster = async () => {
        try {
            const result = await rebuildCharacterFilters();
            alert(formatText(t(SETTINGS_I18N_KEYS.tagMasterSuccess), {
                totalCharacters: result.stats.totalCharacters,
                withTags: result.stats.withTags,
                withoutTags: result.stats.withoutTags,
                works: result.works.length,
                tags: result.tags.length,
            }));
        } catch (error) {
            alert(t(SETTINGS_I18N_KEYS.tagMasterFailure));
            console.error(error);
        }
    };

    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) onClose();
    };

    if (!isOpen) return null;

    // ハブのカテゴリボタン共通スタイル
    const hubButtonClass = (borderColor: string) =>
        `w-full flex items-center justify-center gap-2 px-4 py-3 bg-gray-800 hover:bg-gray-700 border ${borderColor} rounded-lg text-sm text-gray-300 transition-colors`;

    return (
        <>
            <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
                onClick={handleBackdropClick}
            >
                <div className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg border border-gray-700 overflow-hidden">
                    {/* ヘッダー */}
                    <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 bg-gray-800">
                        <div className="flex items-center gap-2">
                            <SettingsIcon size={20} className="text-blue-400" />
                            <h3 className="font-semibold text-gray-100 text-lg">{t(SETTINGS_I18N_KEYS.title)}</h3>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-1.5 hover:bg-gray-700 rounded text-gray-400 hover:text-gray-200 transition-colors"
                        >
                            <X size={20} />
                        </button>
                    </div>

                    {/* カテゴリボタン一覧 */}
                    <div className="p-5 space-y-3 max-h-[60vh] overflow-y-auto custom-scrollbar">
                        {/* 支援者機能 / 設定パック */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <button
                                onClick={() => setIsSponsorOpen(true)}
                                className="flex items-center justify-center gap-2 px-4 py-3 bg-gray-800 hover:bg-gray-700 border border-pink-700 rounded-lg text-sm text-gray-300 hover:text-pink-300 transition-colors"
                                title={resolveMessage(uiCatalog, 'sponsor.title', '支援者機能')}
                            >
                                <Heart size={16} />
                                {resolveMessage(uiCatalog, 'sponsor.title', '支援者機能')}
                            </button>
                            <button
                                onClick={() => setIsSettingsPackOpen(true)}
                                className="flex items-center justify-center gap-2 px-4 py-3 bg-gray-800 hover:bg-gray-700 border border-emerald-700 rounded-lg text-sm text-gray-300 hover:text-emerald-300 transition-colors"
                                title={resolveMessage(uiCatalog, 'settingsPack.title', '設定パック')}
                            >
                                <Package size={16} />
                                {resolveMessage(uiCatalog, 'settingsPack.title', '設定パック')}
                            </button>
                        </div>

                        {/* AIモデル設定 */}
                        <button
                            onClick={() => setIsAIModelOpen(true)}
                            className={hubButtonClass('border-blue-600')}
                            title={t(SETTINGS_I18N_KEYS.aiModelDescription)}
                        >
                            <Bot size={16} className="text-blue-400" />
                            {t(SETTINGS_I18N_KEYS.aiModelLabel)}
                        </button>

                        {/* 画像生成設定（支援者機能が有効な場合のみ表示） */}
                        {isFeatureEnabled(enabledFeatures, FEATURE_COMFYUI) && (
                            <button
                                onClick={() => setIsComfyUISettingsOpen(true)}
                                className={hubButtonClass('border-green-600')}
                                title={t(SETTINGS_I18N_KEYS.comfyUIDescription)}
                            >
                                <Palette size={16} className="text-green-400" />
                                {t(SETTINGS_I18N_KEYS.comfyUIButtonLabel)}
                            </button>
                        )}

                        {/* 言語設定（ここはそのままプルダウン） */}
                        <div className="pt-1">
                            <h4 className="text-sm font-medium text-gray-400 mb-2 px-1">{t(SETTINGS_I18N_KEYS.uiLanguageTitle)}</h4>
                            <div className="relative">
                                <select
                                    value={settings.uiLanguage}
                                    disabled={isSavingLanguage}
                                    onChange={(e) => handleLanguageChange(e.target.value)}
                                    className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2.5 text-sm text-gray-200 outline-none focus:border-blue-500 appearance-none cursor-pointer hover:bg-gray-700 pr-8 disabled:opacity-50"
                                >
                                    {uiLanguageOptions.map(option => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                </select>
                                <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                            </div>
                            <p className="text-xs text-gray-500 mt-1 px-1">
                                {t(SETTINGS_I18N_KEYS.uiLanguageDescription)}
                            </p>
                        </div>

                        {/* 基本チャット設定 */}
                        <button
                            onClick={() => setIsChatBasicOpen(true)}
                            className={hubButtonClass('border-blue-600')}
                            title={t(SETTINGS_I18N_KEYS.chatBasicDescription)}
                        >
                            <MessageSquare size={16} className="text-blue-400" />
                            {t(SETTINGS_I18N_KEYS.chatBasicLabel)}
                        </button>

                        {/* キャラタグマスタ更新（即時実行） */}
                        <button
                            onClick={handleRebuildTagMaster}
                            className={hubButtonClass('border-teal-600')}
                            title={t(SETTINGS_I18N_KEYS.tagMasterDescription)}
                        >
                            <Tag size={16} className="text-teal-400" />
                            {t(SETTINGS_I18N_KEYS.tagMasterButton)}
                        </button>

                        {/* 起動設定 */}
                        <button
                            onClick={() => setIsServerSettingsOpen(true)}
                            className={hubButtonClass('border-cyan-600')}
                            title={t(SETTINGS_I18N_KEYS.serverDescription)}
                        >
                            <Server size={16} className="text-cyan-400" />
                            {t(SETTINGS_I18N_KEYS.serverTitle)}
                        </button>

                        {/* 同時実行数管理 */}
                        <button
                            onClick={() => setIsProcessLimitsOpen(true)}
                            className={hubButtonClass('border-gray-600')}
                            title={t(SETTINGS_I18N_KEYS.processLimitsDescription)}
                        >
                            <Cpu size={16} className="text-gray-400" />
                            {t(SETTINGS_I18N_KEYS.processLimitsLabel)}
                        </button>

                        {/* デバッグ設定 */}
                        <button
                            onClick={() => setIsDebugOpen(true)}
                            className={hubButtonClass('border-amber-700')}
                            title={t(SETTINGS_I18N_KEYS.debugDescription)}
                        >
                            <Bug size={16} className="text-amber-400" />
                            {t(SETTINGS_I18N_KEYS.debugLabel)}
                        </button>

                        {/* システム診断 / ログアウト */}
                        <div className="pt-3 border-t border-gray-700">
                            <h4 className="text-sm font-medium text-gray-400 mb-3 px-1">{t(SETTINGS_I18N_KEYS.systemTitle)}</h4>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <button
                                    onClick={() => setIsSystemDiagnosticsOpen(true)}
                                    className="flex items-center justify-center gap-2 px-4 py-3 bg-gray-800 hover:bg-gray-700 border border-cyan-700 rounded-lg text-sm text-gray-300 hover:text-cyan-300 transition-colors"
                                    title={t(SETTINGS_I18N_KEYS.diagnosticsLabel)}
                                >
                                    <Activity size={16} />
                                    {t(SETTINGS_I18N_KEYS.diagnosticsLabel)}
                                </button>
                                {onLogout && (
                                    <button
                                        onClick={onLogout}
                                        className="flex items-center justify-center gap-2 px-4 py-3 bg-gray-800 hover:bg-red-900/30 border border-gray-600 hover:border-red-800 rounded-lg text-sm text-gray-300 hover:text-red-400 transition-colors"
                                        title={t(SETTINGS_I18N_KEYS.logoutLabel)}
                                    >
                                        <LogOut size={16} />
                                        {t(SETTINGS_I18N_KEYS.logoutLabel)}
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* フッター */}
                    <div className="flex justify-end gap-3 px-5 py-4 border-t border-gray-700 bg-gray-800/50">
                        <button
                            onClick={onClose}
                            className="px-5 py-2 text-sm text-gray-300 hover:text-gray-100 hover:bg-gray-700 rounded-lg transition-colors"
                        >
                            {t(SETTINGS_I18N_KEYS.close)}
                        </button>
                    </div>
                </div>
            </div>

            {/* AIモデル設定モーダル */}
            <AIModelSettingsModal
                isOpen={isAIModelOpen}
                onClose={() => setIsAIModelOpen(false)}
                uiCatalog={uiCatalog}
                onModelsChanged={onModelsChanged}
            />

            {/* 基本チャット設定モーダル */}
            <ChatBasicSettingsModal
                isOpen={isChatBasicOpen}
                onClose={() => setIsChatBasicOpen(false)}
                settings={settings}
                onSave={onSave}
                uiCatalog={uiCatalog}
            />

            {/* 起動設定モーダル */}
            <ServerSettingsModal
                isOpen={isServerSettingsOpen}
                onClose={() => setIsServerSettingsOpen(false)}
                uiCatalog={uiCatalog}
            />

            {/* デバッグ設定モーダル */}
            <DebugSettingsModal
                isOpen={isDebugOpen}
                onClose={() => setIsDebugOpen(false)}
                settings={settings}
                onSave={onSave}
                uiCatalog={uiCatalog}
            />

            {/* ComfyUI設定モーダル（セッション内背景画像はアプリ設定なので settings/onSave を渡す） */}
            <ComfyUISettingsModal
                isOpen={isComfyUISettingsOpen}
                onClose={() => setIsComfyUISettingsOpen(false)}
                backendUrl={BACKEND_URL}
                uiCatalog={uiCatalog}
                appSettings={settings}
                onAppSettingsSave={onSave}
            />

            {/* 同時実行数設定モーダル */}
            <ProcessLimitsModal
                isOpen={isProcessLimitsOpen}
                onClose={() => setIsProcessLimitsOpen(false)}
                uiCatalog={uiCatalog}
            />

            {/* システム診断モーダル */}
            <SystemDiagnosticsModal
                isOpen={isSystemDiagnosticsOpen}
                onClose={() => setIsSystemDiagnosticsOpen(false)}
                backendUrl={BACKEND_URL}
                uiLanguage={settings.uiLanguage}
                uiCatalog={uiCatalog}
            />

            {/* 設定パックモーダル */}
            <SettingsPackModal
                isOpen={isSettingsPackOpen}
                onClose={() => setIsSettingsPackOpen(false)}
                backendUrl={BACKEND_URL}
                uiCatalog={uiCatalog}
            />

            {/* 支援者機能モーダル */}
            <SponsorModal
                isOpen={isSponsorOpen}
                onClose={() => setIsSponsorOpen(false)}
                backendUrl={BACKEND_URL}
                uiCatalog={uiCatalog}
            />
        </>
    );
};
