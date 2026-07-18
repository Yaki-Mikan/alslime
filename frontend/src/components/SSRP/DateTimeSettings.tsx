/**
 * DateTimeSettings.tsx - 日付時刻設定コンポーネント
 * 
 * 会話設定メニュー内の日付時刻設定グループを表示・管理する。
 * - 日付時刻をプロンプトに含めるトグル（ロック機能付き）
 * - 現在日付時刻/固定日付時刻の選択
 * - 固定日付時刻のプルダウン入力
 * - 時刻インクリメント設定
 * - 日付時刻プリセット機能
 * - 時刻設定グループプリセット機能
 */

import React, { useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronRight, Lock, Unlock, Save, Trash2, FolderOpen, Clock, Pencil, X as CloseIcon } from 'lucide-react';
import { ToggleSwitch } from '../common/ToggleSwitch';
import type {
    DateTimeSettingsState,
    DateTimeValue,
    IncrementValues
} from '../../types/datetime';
import {
    listDateTimePresets,
    getDateTimePreset,
    saveDateTimePreset,
    deleteDateTimePreset,
    listDateTimeGroupPresets,
    getDateTimeGroupPreset,
    saveDateTimeGroupPreset,
    deleteDateTimeGroupPreset,
    type DateTimeGroupPreset
} from '../../api/datetime-presets';
import { resolveMessage, type I18NCatalog } from '../../api/i18n';
import {
    DATE_TIME_SETTINGS_I18N_KEYS,
    DATE_TIME_SETTINGS_TEXT_FALLBACK_JA,
    SESSION_TIME_I18N_KEYS,
    SESSION_TIME_TEXT_FALLBACK_JA
} from '../../constants/i18n';

interface DateTimeSettingsProps {
    settings: DateTimeSettingsState;
    onChange: (settings: DateTimeSettingsState) => void;
    isLocked?: boolean;
    onLockChange?: (locked: boolean) => void;
    backendUrl?: string;
    uiCatalog?: I18NCatalog | null;
}

// 年の範囲を生成（現在年の前後100年）
const generateYearOptions = (): number[] => {
    const currentYear = new Date().getFullYear();
    const years: number[] = [];
    for (let y = currentYear - 100; y <= currentYear + 100; y++) {
        years.push(y);
    }
    return years;
};

// 月の日数を取得
const getDaysInMonth = (year: number, month: number): number => {
    return new Date(year, month, 0).getDate();
};

export const DateTimeSettings: React.FC<DateTimeSettingsProps> = ({
    settings,
    onChange,
    isLocked = false,
    onLockChange,
    backendUrl = '',
    uiCatalog = null
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [isPresetPanelOpen, setIsPresetPanelOpen] = useState(false);
    const [isGroupPresetPanelOpen, setIsGroupPresetPanelOpen] = useState(false);
    const [isSessionTimeEditMode, setIsSessionTimeEditMode] = useState(false);
    const yearOptions = generateYearOptions();

    // プリセット関連の状態
    const [dateTimePresets, setDateTimePresets] = useState<string[]>([]);
    const [selectedPreset, setSelectedPreset] = useState<string>('');
    const [newPresetName, setNewPresetName] = useState<string>('');

    // グループプリセット関連の状態
    const [groupPresets, setGroupPresets] = useState<string[]>([]);
    const [selectedGroupPreset, setSelectedGroupPreset] = useState<string>('');
    const [newGroupPresetName, setNewGroupPresetName] = useState<string>('');
    const t = (key: string) => resolveMessage(
        uiCatalog,
        key,
        DATE_TIME_SETTINGS_TEXT_FALLBACK_JA[key] || SESSION_TIME_TEXT_FALLBACK_JA[key] || key
    );
    const formatText = (template: string, values: Record<string, string | number>) =>
        Object.entries(values).reduce((text, [key, value]) => text.split(`{{${key}}}`).join(String(value)), template);
    const unitText = (key: string, count: number) => formatText(t(key), { count });
    const formatIncrement = (values: IncrementValues | undefined) => {
        if (!values) return t(SESSION_TIME_I18N_KEYS.zeroMinute);
        return [
            values.years ? unitText(SESSION_TIME_I18N_KEYS.yearUnit, values.years) : '',
            values.months ? unitText(SESSION_TIME_I18N_KEYS.monthUnit, values.months) : '',
            values.days ? unitText(SESSION_TIME_I18N_KEYS.dayUnit, values.days) : '',
            values.hours ? unitText(SESSION_TIME_I18N_KEYS.hourUnit, values.hours) : '',
            values.minutes ? unitText(SESSION_TIME_I18N_KEYS.minuteUnit, values.minutes) : '',
            values.seconds ? unitText(SESSION_TIME_I18N_KEYS.secondUnit, values.seconds) : '',
        ].filter(Boolean).join(' ') || t(SESSION_TIME_I18N_KEYS.zeroMinute);
    };

    // プリセット一覧を読み込み
    const loadPresets = useCallback(async () => {
        const presets = await listDateTimePresets(backendUrl);
        setDateTimePresets(presets);
    }, [backendUrl]);

    const loadGroupPresets = useCallback(async () => {
        const presets = await listDateTimeGroupPresets(backendUrl);
        setGroupPresets(presets);
    }, [backendUrl]);

    // 初回読み込み
    useEffect(() => {
        if (isOpen) {
            loadPresets();
            loadGroupPresets();
        }
    }, [isOpen, loadPresets, loadGroupPresets]);

    // 設定更新ヘルパー
    const updateSettings = (updates: Partial<DateTimeSettingsState>) => {
        onChange({ ...settings, ...updates });
    };

    // 固定日付時刻更新ヘルパー
    const updateFixedDateTime = (field: keyof DateTimeValue, value: number) => {
        const newFixedDateTime = { ...settings.fixedDateTime, [field]: value };

        // 日付のバリデーション（2月30日などを補正）
        const daysInMonth = getDaysInMonth(newFixedDateTime.year, newFixedDateTime.month);
        if (newFixedDateTime.day > daysInMonth) {
            newFixedDateTime.day = daysInMonth;
        }

        updateSettings({ fixedDateTime: newFixedDateTime });
    };

    // インクリメント設定更新ヘルパー
    const updateIncrement = (field: keyof typeof settings.increment, value: any) => {
        updateSettings({
            increment: { ...settings.increment, [field]: value }
        });
    };

    // インクリメント値更新ヘルパー
    const updateIncrementValues = (field: keyof IncrementValues, value: number) => {
        updateSettings({
            increment: {
                ...settings.increment,
                values: { ...settings.increment.values, [field]: value }
            }
        });
    };

    // 「日付を今日にする」トグル変更時
    useEffect(() => {
        if (settings.useTodayDate && settings.mode === 'fixed') {
            const now = new Date();
            updateSettings({
                fixedDateTime: {
                    ...settings.fixedDateTime,
                    year: now.getFullYear(),
                    month: now.getMonth() + 1,
                    day: now.getDate()
                }
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [settings.useTodayDate]);

    // 詳細モードOFF時に年月日秒を0リセット
    const handleDetailModeChange = (enabled: boolean) => {
        if (!enabled) {
            // 確認なしでリセット
            updateSettings({
                increment: {
                    ...settings.increment,
                    detailMode: false,
                    values: {
                        hours: settings.increment.values.hours,
                        minutes: settings.increment.values.minutes
                    }
                }
            });
        } else {
            updateIncrement('detailMode', true);
        }
    };

    // ===== 日付時刻プリセット操作 =====
    const handleLoadDateTimePreset = async () => {
        if (!selectedPreset) return;
        const value = await getDateTimePreset(backendUrl, selectedPreset);
        if (value) {
            updateSettings({ fixedDateTime: value, mode: 'fixed' });
        }
    };

    const handleSaveDateTimePreset = async () => {
        if (!newPresetName.trim()) return;
        const success = await saveDateTimePreset(backendUrl, newPresetName.trim(), settings.fixedDateTime);
        if (success) {
            await loadPresets();
            setNewPresetName('');
        }
    };

    const handleDeleteDateTimePreset = async () => {
        if (!selectedPreset) return;
        if (!confirm(formatText(t(DATE_TIME_SETTINGS_I18N_KEYS.deletePresetConfirm), { name: selectedPreset }))) return;
        const success = await deleteDateTimePreset(backendUrl, selectedPreset);
        if (success) {
            await loadPresets();
            setSelectedPreset('');
        }
    };

    // ===== 時刻設定グループプリセット操作 =====
    const handleLoadGroupPreset = async () => {
        if (!selectedGroupPreset) return;
        const preset = await getDateTimeGroupPreset(backendUrl, selectedGroupPreset);
        if (preset) {
            updateSettings({
                enabled: preset.enabled,
                mode: preset.mode,
                fixedDateTime: preset.fixedDateTime,
                useTodayDate: preset.useTodayDate,
                increment: preset.increment,  // nextIncrementもincrement内に含まれる（B7）
                ...(preset.linkRelationshipToElapsed !== undefined
                    ? { linkRelationshipToElapsed: preset.linkRelationshipToElapsed }
                    : {})
            });
        }
    };

    const handleSaveGroupPreset = async () => {
        if (!newGroupPresetName.trim()) return;
        const preset: DateTimeGroupPreset = {
            enabled: settings.enabled,
            mode: settings.mode,
            fixedDateTime: settings.fixedDateTime,
            useTodayDate: settings.useTodayDate,
            increment: settings.increment,  // nextIncrementもincrement内に含まれる（B7）
            linkRelationshipToElapsed: settings.linkRelationshipToElapsed
        };
        const success = await saveDateTimeGroupPreset(backendUrl, newGroupPresetName.trim(), preset);
        if (success) {
            await loadGroupPresets();
            setNewGroupPresetName('');
        }
    };

    const handleDeleteGroupPreset = async () => {
        if (!selectedGroupPreset) return;
        if (!confirm(formatText(t(DATE_TIME_SETTINGS_I18N_KEYS.deleteGroupPresetConfirm), { name: selectedGroupPreset }))) return;
        const success = await deleteDateTimeGroupPreset(backendUrl, selectedGroupPreset);
        if (success) {
            await loadGroupPresets();
            setSelectedGroupPreset('');
        }
    };

    return (
        <div className="border border-gray-700 rounded-lg overflow-hidden">
            {/* ヘッダー */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between px-4 py-3 bg-gray-800/50 hover:bg-gray-800 transition-colors"
            >
                <div className="flex items-center gap-2">
                    {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    <span className="text-sm font-medium text-gray-300">{t(DATE_TIME_SETTINGS_I18N_KEYS.title)}</span>
                </div>
                {settings.enabled && (
                    <span className="text-xs text-green-400 bg-green-900/30 px-2 py-0.5 rounded">
                        {t(DATE_TIME_SETTINGS_I18N_KEYS.enabledBadge)}
                    </span>
                )}
            </button>

            {/* 本体 */}
            {isOpen && (
                <div className="p-4 space-y-4 bg-gray-900/30 animate-fade-in">
                    {/* 日付時刻をプロンプトに含めるトグル */}
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-300">{t(DATE_TIME_SETTINGS_I18N_KEYS.includeInPrompt)}</span>
                            {onLockChange && (
                                <button
                                    onClick={() => onLockChange(!isLocked)}
                                    className={`p-1 rounded transition-colors ${isLocked
                                        ? 'text-yellow-500 hover:text-yellow-400'
                                        : 'text-gray-500 hover:text-gray-400'
                                        }`}
                                    title={isLocked ? t(DATE_TIME_SETTINGS_I18N_KEYS.unlock) : t(DATE_TIME_SETTINGS_I18N_KEYS.lock)}
                                >
                                    {isLocked ? <Lock size={14} /> : <Unlock size={14} />}
                                </button>
                            )}
                        </div>
                        <ToggleSwitch
                            checked={settings.enabled}
                            onChange={(on) => updateSettings({ enabled: on })}
                            accent="blue"
                        />
                    </div>

                    {/* 有効時のみ表示 */}
                    {settings.enabled && (
                        <div className="space-y-4 pl-2 border-l-2 border-blue-600/30">
                            {/* モード選択 */}
                            <div className="flex items-center gap-2 text-sm">
                                <span className={settings.mode === 'current' ? 'text-gray-200' : 'text-gray-600'}>{t(DATE_TIME_SETTINGS_I18N_KEYS.currentMode)}</span>
                                <ToggleSwitch
                                    checked={settings.mode === 'fixed'}
                                    onChange={(on) => updateSettings({ mode: on ? 'fixed' : 'current' })}
                                    accent="blue"
                                    size="sm"
                                />
                                <span className={settings.mode === 'fixed' ? 'text-blue-300' : 'text-gray-600'}>{t(DATE_TIME_SETTINGS_I18N_KEYS.fixedMode)}</span>
                            </div>

                            {/* 固定日付時刻設定 */}
                            {settings.mode === 'fixed' && (
                                <div className="space-y-3 pl-4">
                                    {/* 日付プルダウン */}
                                    <div className="flex flex-wrap items-center gap-2">
                                        <select
                                            value={settings.fixedDateTime.year}
                                            onChange={(e) => updateFixedDateTime('year', parseInt(e.target.value))}
                                            disabled={settings.useTodayDate}
                                            className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm outline-none focus:border-blue-500 transition-colors disabled:opacity-50"
                                        >
                                            {yearOptions.map(y => (
                                                <option key={y} value={y}>{unitText(SESSION_TIME_I18N_KEYS.yearUnit, y)}</option>
                                            ))}
                                        </select>
                                        <select
                                            value={settings.fixedDateTime.month}
                                            onChange={(e) => updateFixedDateTime('month', parseInt(e.target.value))}
                                            disabled={settings.useTodayDate}
                                            className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm outline-none focus:border-blue-500 transition-colors disabled:opacity-50"
                                        >
                                            {[...Array(12)].map((_, i) => (
                                                <option key={i + 1} value={i + 1}>{unitText(SESSION_TIME_I18N_KEYS.monthUnit, i + 1)}</option>
                                            ))}
                                        </select>
                                        <select
                                            value={settings.fixedDateTime.day}
                                            onChange={(e) => updateFixedDateTime('day', parseInt(e.target.value))}
                                            disabled={settings.useTodayDate}
                                            className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm outline-none focus:border-blue-500 transition-colors disabled:opacity-50"
                                        >
                                            {[...Array(getDaysInMonth(settings.fixedDateTime.year, settings.fixedDateTime.month))].map((_, i) => (
                                                <option key={i + 1} value={i + 1}>{unitText(SESSION_TIME_I18N_KEYS.dayUnit, i + 1)}</option>
                                            ))}
                                        </select>
                                    </div>

                                    {/* 時刻プルダウン */}
                                    <div className="flex flex-wrap items-center gap-2">
                                        <select
                                            value={settings.fixedDateTime.hour}
                                            onChange={(e) => updateFixedDateTime('hour', parseInt(e.target.value))}
                                            className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm outline-none focus:border-blue-500 transition-colors"
                                        >
                                            {[...Array(24)].map((_, i) => (
                                                <option key={i} value={i}>{unitText(SESSION_TIME_I18N_KEYS.hourUnit, i)}</option>
                                            ))}
                                        </select>
                                        <select
                                            value={settings.fixedDateTime.minute}
                                            onChange={(e) => updateFixedDateTime('minute', parseInt(e.target.value))}
                                            className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm outline-none focus:border-blue-500 transition-colors"
                                        >
                                            {[...Array(60)].map((_, i) => (
                                                <option key={i} value={i}>{unitText(SESSION_TIME_I18N_KEYS.minuteUnit, i)}</option>
                                            ))}
                                        </select>
                                    </div>

                                    {/* 日付を今日にするトグル */}
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-gray-400">{t(DATE_TIME_SETTINGS_I18N_KEYS.useTodayDate)}</span>
                                        <button
                                            onClick={() => updateSettings({ useTodayDate: !settings.useTodayDate })}
                                            className={`relative w-10 h-5 rounded-full transition-colors ${settings.useTodayDate ? 'bg-blue-600' : 'bg-gray-700'
                                                }`}
                                        >
                                            <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform shadow ${settings.useTodayDate ? 'translate-x-5' : 'translate-x-0.5'
                                                }`} />
                                        </button>
                                    </div>

                                    {/* 日付時刻プリセット */}
                                    <div className="pt-2 border-t border-gray-700">
                                        <button
                                            onClick={() => setIsPresetPanelOpen(!isPresetPanelOpen)}
                                            className="flex items-center gap-2 text-xs text-gray-400 hover:text-gray-300 transition-colors"
                                        >
                                            {isPresetPanelOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                            <FolderOpen size={12} />
                                            <span>{t(DATE_TIME_SETTINGS_I18N_KEYS.presetTitle)}</span>
                                        </button>

                                        {isPresetPanelOpen && (
                                            <div className="mt-2 p-2 bg-gray-800/50 rounded space-y-2">
                                                {/* 読み込み */}
                                                <div className="flex items-center gap-2">
                                                    <select
                                                        value={selectedPreset}
                                                        onChange={(e) => setSelectedPreset(e.target.value)}
                                                        className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs outline-none focus:border-blue-500"
                                                    >
                                                        <option value="">{t(DATE_TIME_SETTINGS_I18N_KEYS.selectPreset)}</option>
                                                        {dateTimePresets.map(name => (
                                                            <option key={name} value={name}>{name}</option>
                                                        ))}
                                                    </select>
                                                    <button
                                                        onClick={handleLoadDateTimePreset}
                                                        disabled={!selectedPreset}
                                                        className="p-1 text-blue-400 hover:text-blue-300 disabled:opacity-50 disabled:cursor-not-allowed"
                                                        title={t(DATE_TIME_SETTINGS_I18N_KEYS.load)}
                                                    >
                                                        <FolderOpen size={14} />
                                                    </button>
                                                    <button
                                                        onClick={handleDeleteDateTimePreset}
                                                        disabled={!selectedPreset}
                                                        className="p-1 text-red-400 hover:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed"
                                                        title={t(DATE_TIME_SETTINGS_I18N_KEYS.delete)}
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                </div>
                                                {/* 保存 */}
                                                <div className="flex items-center gap-2">
                                                    <input
                                                        type="text"
                                                        value={newPresetName}
                                                        onChange={(e) => setNewPresetName(e.target.value)}
                                                        placeholder={t(DATE_TIME_SETTINGS_I18N_KEYS.newPresetName)}
                                                        className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs outline-none focus:border-blue-500"
                                                    />
                                                    <button
                                                        onClick={handleSaveDateTimePreset}
                                                        disabled={!newPresetName.trim()}
                                                        className="p-1 text-green-400 hover:text-green-300 disabled:opacity-50 disabled:cursor-not-allowed"
                                                        title={t(DATE_TIME_SETTINGS_I18N_KEYS.save)}
                                                    >
                                                        <Save size={14} />
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* 時刻インクリメント */}
                            <div className="pt-3 border-t border-gray-700 space-y-3">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm text-gray-300">{t(DATE_TIME_SETTINGS_I18N_KEYS.incrementTitle)}</span>
                                    <button
                                        onClick={() => updateIncrement('enabled', !settings.increment.enabled)}
                                        className={`relative w-10 h-5 rounded-full transition-colors ${settings.increment.enabled ? 'bg-green-600' : 'bg-gray-700'
                                            }`}
                                    >
                                        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform shadow ${settings.increment.enabled ? 'translate-x-5' : 'translate-x-0.5'
                                            }`} />
                                    </button>
                                </div>

                                {settings.increment.enabled && (
                                    <div className="space-y-3 pl-4">
                                        <p className="text-xs text-gray-500">
                                            {t(DATE_TIME_SETTINGS_I18N_KEYS.incrementDescription)}
                                        </p>

                                        {/* 基本モード: 時・分 */}
                                        <div className="flex flex-wrap items-center gap-2">
                                            <select
                                                value={settings.increment.values.hours}
                                                onChange={(e) => updateIncrementValues('hours', parseInt(e.target.value))}
                                                className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm outline-none focus:border-green-500 transition-colors"
                                            >
                                                {[...Array(24)].map((_, i) => (
                                                    <option key={i} value={i}>{unitText(SESSION_TIME_I18N_KEYS.hourUnit, i)}</option>
                                                ))}
                                            </select>
                                            <select
                                                value={settings.increment.values.minutes}
                                                onChange={(e) => updateIncrementValues('minutes', parseInt(e.target.value))}
                                                className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm outline-none focus:border-green-500 transition-colors"
                                            >
                                                {[...Array(60)].map((_, i) => (
                                                    <option key={i} value={i}>{unitText(SESSION_TIME_I18N_KEYS.minuteUnit, i)}</option>
                                                ))}
                                            </select>
                                        </div>

                                        {/* 詳細モードトグル */}
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs text-gray-500">{t(DATE_TIME_SETTINGS_I18N_KEYS.detailMode)}</span>
                                            <button
                                                onClick={() => handleDetailModeChange(!settings.increment.detailMode)}
                                                className={`relative w-8 h-4 rounded-full transition-colors ${settings.increment.detailMode ? 'bg-green-600' : 'bg-gray-700'
                                                    }`}
                                            >
                                                <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform shadow ${settings.increment.detailMode ? 'translate-x-4' : 'translate-x-0.5'
                                                    }`} />
                                            </button>
                                        </div>

                                        {/* 詳細モード: 年月日秒 */}
                                        {settings.increment.detailMode && (
                                            <div className="flex flex-wrap items-center gap-2 pt-2">
                                                <select
                                                    value={settings.increment.values.years ?? 0}
                                                    onChange={(e) => updateIncrementValues('years', parseInt(e.target.value))}
                                                    className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm outline-none focus:border-green-500 transition-colors"
                                                >
                                                    {[...Array(101)].map((_, i) => (
                                                        <option key={i} value={i}>{unitText(SESSION_TIME_I18N_KEYS.yearUnit, i)}</option>
                                                    ))}
                                                </select>
                                                <select
                                                    value={settings.increment.values.months ?? 0}
                                                    onChange={(e) => updateIncrementValues('months', parseInt(e.target.value))}
                                                    className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm outline-none focus:border-green-500 transition-colors"
                                                >
                                                    {[...Array(12)].map((_, i) => (
                                                        <option key={i} value={i}>{unitText(SESSION_TIME_I18N_KEYS.monthUnit, i)}</option>
                                                    ))}
                                                </select>
                                                <select
                                                    value={settings.increment.values.days ?? 0}
                                                    onChange={(e) => updateIncrementValues('days', parseInt(e.target.value))}
                                                    className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm outline-none focus:border-green-500 transition-colors"
                                                >
                                                    {[...Array(31)].map((_, i) => (
                                                        <option key={i} value={i}>{unitText(SESSION_TIME_I18N_KEYS.dayUnit, i)}</option>
                                                    ))}
                                                </select>
                                                <select
                                                    value={settings.increment.values.seconds ?? 0}
                                                    onChange={(e) => updateIncrementValues('seconds', parseInt(e.target.value))}
                                                    className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm outline-none focus:border-green-500 transition-colors"
                                                >
                                                    {[...Array(60)].map((_, i) => (
                                                        <option key={i} value={i}>{unitText(SESSION_TIME_I18N_KEYS.secondUnit, i)}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}

                                        {/* つきあいの長さ連動（新機能）: ONでセッション経過時刻ぶんつきあいの長さを進める */}
                                        <div className="flex items-center justify-between pt-2 border-t border-gray-800">
                                            <span className="text-xs text-gray-500">{t(DATE_TIME_SETTINGS_I18N_KEYS.linkRelationship)}</span>
                                            <button
                                                onClick={() => updateSettings({ linkRelationshipToElapsed: !settings.linkRelationshipToElapsed })}
                                                className={`relative w-8 h-4 rounded-full transition-colors ${settings.linkRelationshipToElapsed ? 'bg-green-600' : 'bg-gray-700'
                                                    }`}
                                            >
                                                <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform shadow ${settings.linkRelationshipToElapsed ? 'translate-x-4' : 'translate-x-0.5'
                                                    }`} />
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* セッション中の時刻表示（インクリメント有効時のみ） */}
                            {settings.increment?.enabled && settings.currentSessionTime && (
                                <div className="pt-3 border-t border-gray-700 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2 text-sm text-gray-300">
                                            <Clock size={14} className="text-blue-400" />
                                            <span>{t(DATE_TIME_SETTINGS_I18N_KEYS.sessionInfo)}</span>
                                        </div>
                                        <button
                                            onClick={() => setIsSessionTimeEditMode(!isSessionTimeEditMode)}
                                            className={`p-1 rounded transition-colors ${isSessionTimeEditMode ? 'text-blue-400 bg-blue-500/20' : 'text-gray-500 hover:text-gray-300'}`}
                                            title={isSessionTimeEditMode ? t(DATE_TIME_SETTINGS_I18N_KEYS.finishSessionTimeEdit) : t(DATE_TIME_SETTINGS_I18N_KEYS.editSessionTime)}
                                        >
                                            {isSessionTimeEditMode ? <CloseIcon size={14} /> : <Pencil size={14} />}
                                        </button>
                                    </div>

                                    {/* 編集モード時のUI */}
                                    {isSessionTimeEditMode ? (
                                        <div className="pl-5 space-y-3">
                                            <div className="space-y-2">
                                                <span className="text-xs text-gray-500">{t(DATE_TIME_SETTINGS_I18N_KEYS.editCurrentTime)}</span>
                                                <div className="flex flex-wrap items-center gap-1">
                                                    <select
                                                        value={settings.currentSessionTime.year}
                                                        onChange={(e) => updateSettings({
                                                            currentSessionTime: { ...settings.currentSessionTime!, year: parseInt(e.target.value) }
                                                        })}
                                                        className="bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-xs outline-none focus:border-blue-500"
                                                    >
                                                        {yearOptions.map(y => (
                                                            <option key={y} value={y}>{y}</option>
                                                        ))}
                                                    </select>
                                                    <span className="text-gray-500">/</span>
                                                    <select
                                                        value={settings.currentSessionTime.month}
                                                        onChange={(e) => updateSettings({
                                                            currentSessionTime: { ...settings.currentSessionTime!, month: parseInt(e.target.value) }
                                                        })}
                                                        className="bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-xs outline-none focus:border-blue-500"
                                                    >
                                                        {[...Array(12)].map((_, i) => (
                                                            <option key={i + 1} value={i + 1}>{String(i + 1).padStart(2, '0')}</option>
                                                        ))}
                                                    </select>
                                                    <span className="text-gray-500">/</span>
                                                    <select
                                                        value={settings.currentSessionTime.day}
                                                        onChange={(e) => updateSettings({
                                                            currentSessionTime: { ...settings.currentSessionTime!, day: parseInt(e.target.value) }
                                                        })}
                                                        className="bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-xs outline-none focus:border-blue-500"
                                                    >
                                                        {[...Array(31)].map((_, i) => (
                                                            <option key={i + 1} value={i + 1}>{String(i + 1).padStart(2, '0')}</option>
                                                        ))}
                                                    </select>
                                                    <select
                                                        value={settings.currentSessionTime.hour}
                                                        onChange={(e) => updateSettings({
                                                            currentSessionTime: { ...settings.currentSessionTime!, hour: parseInt(e.target.value) }
                                                        })}
                                                        className="bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-xs outline-none focus:border-blue-500"
                                                    >
                                                        {[...Array(24)].map((_, i) => (
                                                            <option key={i} value={i}>{String(i).padStart(2, '0')}</option>
                                                        ))}
                                                    </select>
                                                    <span className="text-gray-500">:</span>
                                                    <select
                                                        value={settings.currentSessionTime.minute}
                                                        onChange={(e) => updateSettings({
                                                            currentSessionTime: { ...settings.currentSessionTime!, minute: parseInt(e.target.value) }
                                                        })}
                                                        className="bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-xs outline-none focus:border-blue-500"
                                                    >
                                                        {[...Array(60)].map((_, i) => (
                                                            <option key={i} value={i}>{String(i).padStart(2, '0')}</option>
                                                        ))}
                                                    </select>
                                                    <span className="text-gray-500">:</span>
                                                    <select
                                                        value={settings.currentSessionTime.second || 0}
                                                        onChange={(e) => updateSettings({
                                                            currentSessionTime: { ...settings.currentSessionTime!, second: parseInt(e.target.value) }
                                                        })}
                                                        className="bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-xs outline-none focus:border-blue-500"
                                                    >
                                                        {[...Array(60)].map((_, i) => (
                                                            <option key={i} value={i}>{String(i).padStart(2, '0')}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                            </div>
                                            <p className="text-[10px] text-gray-600">{t(DATE_TIME_SETTINGS_I18N_KEYS.nextSendHint)}</p>
                                        </div>
                                    ) : (
                                        /* 表示モード */
                                        <div className="pl-5 space-y-1 text-xs text-gray-400">
                                            <div className="flex items-center gap-2">
                                                <span className="text-gray-500 w-28">{t(DATE_TIME_SETTINGS_I18N_KEYS.currentTimeLabel)}</span>
                                                <span className="text-gray-200 font-mono">
                                                    {`${settings.currentSessionTime.year}/${String(settings.currentSessionTime.month).padStart(2, '0')}/${String(settings.currentSessionTime.day).padStart(2, '0')} ${String(settings.currentSessionTime.hour).padStart(2, '0')}:${String(settings.currentSessionTime.minute).padStart(2, '0')}:${String(settings.currentSessionTime.second || 0).padStart(2, '0')}`}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className="text-gray-500 w-28">{t(DATE_TIME_SETTINGS_I18N_KEYS.incrementLabel)}</span>
                                                <span className="text-gray-200 font-mono">
                                                    {formatIncrement(settings.increment.values)}
                                                </span>
                                            </div>
                                            {typeof settings.totalElapsedDays === 'number' && (
                                                <div className="flex items-center gap-2">
                                                    <span className="text-gray-500 w-28">{t(DATE_TIME_SETTINGS_I18N_KEYS.elapsedDaysLabel)}</span>
                                                    <span className="text-gray-200 font-mono">
                                                        {formatText(t(DATE_TIME_SETTINGS_I18N_KEYS.elapsedDaysValue), { days: settings.totalElapsedDays.toFixed(4) })}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
            {/* 時刻設定グループプリセット（開閉状態に関わらず表示） */}
            <div className="p-4 pt-0">
                <div className="pt-3 border-t border-gray-700">
                    <button
                        onClick={() => setIsGroupPresetPanelOpen(!isGroupPresetPanelOpen)}
                        className="flex items-center gap-2 text-xs text-gray-400 hover:text-gray-300 transition-colors"
                    >
                        {isGroupPresetPanelOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        <FolderOpen size={12} />
                        <span>{t(DATE_TIME_SETTINGS_I18N_KEYS.groupPresetTitle)}</span>
                    </button>

                    {isGroupPresetPanelOpen && (
                        <div className="mt-2 p-2 bg-gray-800/50 rounded space-y-2">
                            <p className="text-xs text-gray-500 mb-2">
                                {t(DATE_TIME_SETTINGS_I18N_KEYS.groupPresetDescription)}
                            </p>
                            {/* 読み込み */}
                            <div className="flex items-center gap-2">
                                <select
                                    value={selectedGroupPreset}
                                    onChange={(e) => setSelectedGroupPreset(e.target.value)}
                                    className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs outline-none focus:border-blue-500"
                                >
                                    <option value="">{t(DATE_TIME_SETTINGS_I18N_KEYS.selectGroupPreset)}</option>
                                    {groupPresets.map(name => (
                                        <option key={name} value={name}>{name}</option>
                                    ))}
                                </select>
                                <button
                                    onClick={handleLoadGroupPreset}
                                    disabled={!selectedGroupPreset}
                                    className="p-1 text-blue-400 hover:text-blue-300 disabled:opacity-50 disabled:cursor-not-allowed"
                                    title={t(DATE_TIME_SETTINGS_I18N_KEYS.load)}
                                >
                                    <FolderOpen size={14} />
                                </button>
                                <button
                                    onClick={handleDeleteGroupPreset}
                                    disabled={!selectedGroupPreset}
                                    className="p-1 text-red-400 hover:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed"
                                    title={t(DATE_TIME_SETTINGS_I18N_KEYS.delete)}
                                >
                                    <Trash2 size={14} />
                                </button>
                            </div>
                            {/* 保存 */}
                            <div className="flex items-center gap-2">
                                <input
                                    type="text"
                                    value={newGroupPresetName}
                                    onChange={(e) => setNewGroupPresetName(e.target.value)}
                                    placeholder={t(DATE_TIME_SETTINGS_I18N_KEYS.newGroupPresetName)}
                                    className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs outline-none focus:border-blue-500"
                                />
                                <button
                                    onClick={handleSaveGroupPreset}
                                    disabled={!newGroupPresetName.trim()}
                                    className="p-1 text-green-400 hover:text-green-300 disabled:opacity-50 disabled:cursor-not-allowed"
                                    title={t(DATE_TIME_SETTINGS_I18N_KEYS.save)}
                                >
                                    <Save size={14} />
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default DateTimeSettings;
