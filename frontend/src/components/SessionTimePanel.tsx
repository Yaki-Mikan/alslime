/**
 * SessionTimePanel.tsx - セッション時刻表示パネル
 * 
 * CharacterStatusPanelと同様のUIで、セッション時刻情報を表示する。
 * - セッション中 + 時刻インクリメントON時に表示
 * - 現在のセッション時刻、インクリメント設定時間、次のインクリメント時間を表示
 * - 編集アイコンで編集モードに切り替え可能
 * - 編集モードでは即時反映（500msのdebounce）、保存/キャンセルボタンなし
 * - 次のインクリメント時間は編集モード以外でも常に編集可能
 */

import React, { useState, useEffect, useRef } from 'react';
import { Clock, Edit2, ChevronRight, ChevronDown, Save } from 'lucide-react';
import type { DateTimeSettingsState, DateTimeValue, IncrementValues } from '../types/datetime';
import { resolveMessage, type I18NCatalog } from '../api/i18n';
import { CHAT_VIEW_I18N_KEYS, CHAT_VIEW_TEXT_FALLBACK_JA, COMMON_I18N_KEYS, COMMON_TEXT_FALLBACK_JA, SESSION_TIME_I18N_KEYS, SESSION_TIME_TEXT_FALLBACK_JA } from '../constants/i18n';

interface SessionTimePanelProps {
    dateTimeSettings: DateTimeSettingsState | null;
    onChange?: (settings: DateTimeSettingsState) => void;
    isCharacterPanelOpen?: boolean; // 💛状態パネルが開いているかどうか
    hasTitleBar?: boolean; // タイトルバーの有無
    isTitleEditing?: boolean; // タイトル編集中かどうか
    uiCatalog?: I18NCatalog | null;
    // セッション未反映の変更があるとき、ヘッダーに反映ボタンを表示する
    isSessionDirty?: boolean;
    onApplyToSession?: () => void;
    applyToSessionState?: 'idle' | 'applying' | 'done';
    // ハンバーガーメニュー（セッション状態ドロワー）内に埋め込むモード。
    // 浮動配置と外側クリックでの自動クローズを無効化し、開閉セクションとして振る舞う。
    embedded?: boolean;
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

export const SessionTimePanel: React.FC<SessionTimePanelProps> = ({
    dateTimeSettings,
    onChange,
    isCharacterPanelOpen = false,
    hasTitleBar = false,
    isTitleEditing = false,
    uiCatalog = null,
    isSessionDirty = false,
    onApplyToSession,
    applyToSessionState = 'idle',
    embedded = false
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);
    const debounceTimerRef = useRef<number | null>(null);
    const yearOptions = generateYearOptions();
    const t = (key: string) => resolveMessage(
        uiCatalog,
        key,
        SESSION_TIME_TEXT_FALLBACK_JA[key] || CHAT_VIEW_TEXT_FALLBACK_JA[key] || COMMON_TEXT_FALLBACK_JA[key] || key
    );
    const formatText = (template: string, values: Record<string, string | number>) =>
        Object.entries(values).reduce((text, [key, value]) => text.split(`{{${key}}}`).join(String(value)), template);
    const unitText = (key: string, count: number) => formatText(t(key), { count });

    // 外部クリックで閉じる
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            // クリック対象がdata-panel属性を持つ要素内なら無視（他パネルのクリック）
            const target = event.target as HTMLElement;
            if (target.closest('[data-panel]')) {
                return;
            }
            if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
                setIsOpen(false);
                setIsEditing(false);
            }
        };

        // 埋め込みモードではドロワー側が開閉を管理するため、外側クリックで閉じない
        if (isOpen && !embedded) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen, embedded]);

    // クリーンアップ：アンマウント時にタイマーをクリア
    useEffect(() => {
        return () => {
            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
            }
        };
    }, []);

    // debounce付きのonChange
    const debouncedOnChange = (newSettings: DateTimeSettingsState) => {
        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
        }
        debounceTimerRef.current = window.setTimeout(() => {
            onChange?.(newSettings);
        }, 500);
    };

    // 表示条件: dateTimeSettings.enabledがtrue（インクリメントなしでも時刻表示は可能）
    const shouldShow = dateTimeSettings?.enabled;

    if (!shouldShow) return null;

    // タイトル編集中は非表示
    if (isTitleEditing) return null;

    // currentSessionTimeがない場合はincrement.enabledがfalseでも現在時刻を初期値として使用
    const sessionTime = dateTimeSettings.currentSessionTime || dateTimeSettings.fixedDateTime || {
        year: new Date().getFullYear(),
        month: new Date().getMonth() + 1,
        day: new Date().getDate(),
        hour: new Date().getHours(),
        minute: new Date().getMinutes(),
        second: new Date().getSeconds()
    };
    const increment = dateTimeSettings.increment;
    const totalElapsedDays = dateTimeSettings.totalElapsedDays ?? 0;
    const detailMode = increment?.detailMode ?? false;

    // 次のインクリメント時間（デフォルトは通常のincrement.values）
    const nextIncrement = increment?.nextIncrement ?? increment?.values;

    // セッション時刻を更新（debounce付き）
    const updateSessionTime = (field: keyof DateTimeValue, value: number) => {
        if (!dateTimeSettings?.currentSessionTime) return;
        debouncedOnChange({
            ...dateTimeSettings,
            currentSessionTime: {
                ...dateTimeSettings.currentSessionTime,
                [field]: value
            }
        });
    };

    // インクリメント設定時間を更新（debounce付き）
    const updateIncrementValues = (field: keyof IncrementValues, value: number) => {
        if (!dateTimeSettings?.increment) return;
        debouncedOnChange({
            ...dateTimeSettings,
            increment: {
                ...dateTimeSettings.increment,
                values: {
                    ...dateTimeSettings.increment.values,
                    [field]: value
                }
            }
        });
    };

    // 次のインクリメント時間を更新（debounce付き）
    const updateNextIncrement = (field: keyof IncrementValues, value: number) => {
        if (!dateTimeSettings?.increment) return;
        const currentNextIncrement = dateTimeSettings.increment.nextIncrement ?? { ...dateTimeSettings.increment.values };
        debouncedOnChange({
            ...dateTimeSettings,
            increment: {
                ...dateTimeSettings.increment,
                nextIncrement: {
                    ...currentNextIncrement,
                    [field]: value
                }
            }
        });
    };

    // 時刻を整形
    const formatTime = (dt: DateTimeValue) => {
        return `${dt.year}/${String(dt.month).padStart(2, '0')}/${String(dt.day).padStart(2, '0')} ${String(dt.hour).padStart(2, '0')}:${String(dt.minute).padStart(2, '0')}:${String(dt.second || 0).padStart(2, '0')}`;
    };

    // インクリメント設定を整形（詳細モードに応じて）
    const formatIncrement = (values: IncrementValues | undefined, showDetail: boolean) => {
        if (!values) return t(SESSION_TIME_I18N_KEYS.zeroMinute);
        if (showDetail) {
            const parts = [
                values.years ? unitText(SESSION_TIME_I18N_KEYS.yearUnit, values.years) : '',
                values.months ? unitText(SESSION_TIME_I18N_KEYS.monthUnit, values.months) : '',
                values.days ? unitText(SESSION_TIME_I18N_KEYS.dayUnit, values.days) : '',
                values.hours ? unitText(SESSION_TIME_I18N_KEYS.hourUnit, values.hours) : '',
                values.minutes ? unitText(SESSION_TIME_I18N_KEYS.minuteUnit, values.minutes) : '',
                values.seconds ? unitText(SESSION_TIME_I18N_KEYS.secondUnit, values.seconds) : '',
            ].filter(Boolean).join(' ');
            return parts || t(SESSION_TIME_I18N_KEYS.zeroMinute);
        } else {
            const parts = [
                values.hours ? unitText(SESSION_TIME_I18N_KEYS.hourUnit, values.hours) : '',
                values.minutes ? unitText(SESSION_TIME_I18N_KEYS.minuteUnit, values.minutes) : '',
            ].filter(Boolean).join(' ');
            return parts || t(SESSION_TIME_I18N_KEYS.zeroMinute);
        }
    };

    // 💛状態パネルの開閉状態に応じて位置を調整
    // パネル間の距離を約14pxに統一
    // 閉じているとき: 状態ボタン右端(約106px), 時刻パネル left-30 (120px) → 差 14px
    // 開いているとき: 状態パネル右端(left-4 + w-96 = 16 + 384 = 400px) → 時刻は 400 + 4 = 404px
    const leftPosition = isCharacterPanelOpen ? 'left-[404px]' : 'left-30';

    return (
        <div ref={panelRef} data-panel="time" className={embedded ? 'w-full' : `absolute ${hasTitleBar ? 'top-28' : 'top-16'} ${leftPosition} z-30`}>
            {!isOpen ? (
                <button
                    onClick={() => setIsOpen(true)}
                    className={`flex items-center gap-2 bg-gray-800/80 backdrop-blur border border-gray-700 text-blue-400 px-3 py-2 ${embedded ? 'w-full rounded-lg' : 'rounded-full shadow-lg'} hover:bg-gray-700 transition-all font-medium text-sm group`}
                >
                    <Clock size={16} className="group-hover:scale-110 transition-transform" />
                    <span>{t(SESSION_TIME_I18N_KEYS.closedTitle)}</span>
                    <ChevronRight size={14} className={`text-gray-500 ${embedded ? 'ml-auto' : ''}`} />
                </button>
            ) : (
                <div className={`bg-gray-900/95 backdrop-blur-md border border-gray-700 rounded-xl shadow-2xl ${embedded ? 'w-full' : 'w-72'} overflow-hidden flex flex-col animate-in fade-in slide-in-from-top-2 duration-200`}>
                    {/* Header */}
                    <div className="px-4 py-3 bg-gray-800 border-b border-gray-700 flex items-center justify-between">
                        <div className="flex items-center gap-2 text-blue-400 font-medium">
                            <Clock size={16} />
                            <span>{t(SESSION_TIME_I18N_KEYS.title)}</span>
                        </div>
                        <div className="flex items-center gap-1">
                            {(isSessionDirty || applyToSessionState === 'done') && onApplyToSession && (
                                <button
                                    onClick={onApplyToSession}
                                    disabled={applyToSessionState === 'applying'}
                                    className={`p-1.5 rounded transition-colors ${applyToSessionState === 'done'
                                        ? 'text-emerald-400'
                                        : 'text-emerald-400 hover:text-emerald-300 hover:bg-gray-700 disabled:opacity-60'}`}
                                    title={t(CHAT_VIEW_I18N_KEYS.applyToSession)}
                                >
                                    <Save size={14} className={applyToSessionState === 'applying' ? 'animate-pulse' : ''} />
                                </button>
                            )}
                            <button
                                onClick={() => setIsEditing(!isEditing)}
                                className={`p-1.5 hover:bg-gray-700 rounded transition-colors ${isEditing ? 'text-blue-400' : 'text-gray-400 hover:text-blue-400'}`}
                                title={isEditing ? t(COMMON_I18N_KEYS.finishEdit) : t(COMMON_I18N_KEYS.edit)}
                            >
                                <Edit2 size={14} />
                            </button>
                            <button
                                onClick={() => { setIsOpen(false); setIsEditing(false); }}
                                className="p-1.5 hover:bg-gray-700 rounded text-gray-400 hover:text-white transition-colors"
                            >
                                <ChevronDown size={16} />
                            </button>
                        </div>
                    </div>

                    {/* Content */}
                    <div className="p-4 space-y-4 max-h-[60vh] overflow-y-auto custom-scrollbar">
                        {/* 現在のセッション時刻 */}
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-gray-400">{t(SESSION_TIME_I18N_KEYS.currentTime)}</label>
                            {isEditing ? (
                                <div className="flex flex-wrap items-center gap-1">
                                    <select
                                        value={sessionTime.year}
                                        onChange={(e) => updateSessionTime('year', parseInt(e.target.value))}
                                        className="bg-gray-800 border border-gray-600 rounded px-1.5 py-1 text-xs outline-none focus:border-blue-500"
                                    >
                                        {yearOptions.map(y => (
                                            <option key={y} value={y}>{y}</option>
                                        ))}
                                    </select>
                                    <span className="text-gray-500 text-xs">/</span>
                                    <select
                                        value={sessionTime.month}
                                        onChange={(e) => updateSessionTime('month', parseInt(e.target.value))}
                                        className="bg-gray-800 border border-gray-600 rounded px-1.5 py-1 text-xs outline-none focus:border-blue-500 w-12"
                                    >
                                        {[...Array(12)].map((_, i) => (
                                            <option key={i + 1} value={i + 1}>{String(i + 1).padStart(2, '0')}</option>
                                        ))}
                                    </select>
                                    <span className="text-gray-500 text-xs">/</span>
                                    <select
                                        value={sessionTime.day}
                                        onChange={(e) => updateSessionTime('day', parseInt(e.target.value))}
                                        className="bg-gray-800 border border-gray-600 rounded px-1.5 py-1 text-xs outline-none focus:border-blue-500 w-12"
                                    >
                                        {[...Array(31)].map((_, i) => (
                                            <option key={i + 1} value={i + 1}>{String(i + 1).padStart(2, '0')}</option>
                                        ))}
                                    </select>
                                    <select
                                        value={sessionTime.hour}
                                        onChange={(e) => updateSessionTime('hour', parseInt(e.target.value))}
                                        className="bg-gray-800 border border-gray-600 rounded px-1.5 py-1 text-xs outline-none focus:border-blue-500 w-12"
                                    >
                                        {[...Array(24)].map((_, i) => (
                                            <option key={i} value={i}>{String(i).padStart(2, '0')}</option>
                                        ))}
                                    </select>
                                    <span className="text-gray-500 text-xs">:</span>
                                    <select
                                        value={sessionTime.minute}
                                        onChange={(e) => updateSessionTime('minute', parseInt(e.target.value))}
                                        className="bg-gray-800 border border-gray-600 rounded px-1.5 py-1 text-xs outline-none focus:border-blue-500 w-12"
                                    >
                                        {[...Array(60)].map((_, i) => (
                                            <option key={i} value={i}>{String(i).padStart(2, '0')}</option>
                                        ))}
                                    </select>
                                    <span className="text-gray-500 text-xs">:</span>
                                    <select
                                        value={sessionTime.second || 0}
                                        onChange={(e) => updateSessionTime('second', parseInt(e.target.value))}
                                        className="bg-gray-800 border border-gray-600 rounded px-1.5 py-1 text-xs outline-none focus:border-blue-500 w-12"
                                    >
                                        {[...Array(60)].map((_, i) => (
                                            <option key={i} value={i}>{String(i).padStart(2, '0')}</option>
                                        ))}
                                    </select>
                                </div>
                            ) : (
                                <div className="text-sm font-medium text-gray-200">
                                    {formatTime(sessionTime)}
                                </div>
                            )}
                        </div>
                        {/* インクリメント設定時間 */}
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-gray-400">{t(SESSION_TIME_I18N_KEYS.increment)}</label>
                            {isEditing ? (
                                <div className="flex flex-wrap items-center gap-1">
                                    {detailMode && (
                                        <>
                                            <select
                                                value={increment?.values.years ?? 0}
                                                onChange={(e) => updateIncrementValues('years', parseInt(e.target.value))}
                                                className="bg-gray-800 border border-gray-600 rounded px-1 py-1 text-xs outline-none focus:border-blue-500 w-14"
                                            >
                                                {[...Array(11)].map((_, i) => (
                                                    <option key={i} value={i}>{unitText(SESSION_TIME_I18N_KEYS.yearUnit, i)}</option>
                                                ))}
                                            </select>
                                            <select
                                                value={increment?.values.months ?? 0}
                                                onChange={(e) => updateIncrementValues('months', parseInt(e.target.value))}
                                                className="bg-gray-800 border border-gray-600 rounded px-1 py-1 text-xs outline-none focus:border-blue-500 w-16"
                                            >
                                                {[...Array(12)].map((_, i) => (
                                                    <option key={i} value={i}>{unitText(SESSION_TIME_I18N_KEYS.monthUnit, i)}</option>
                                                ))}
                                            </select>
                                            <select
                                                value={increment?.values.days ?? 0}
                                                onChange={(e) => updateIncrementValues('days', parseInt(e.target.value))}
                                                className="bg-gray-800 border border-gray-600 rounded px-1 py-1 text-xs outline-none focus:border-blue-500 w-14"
                                            >
                                                {[...Array(31)].map((_, i) => (
                                                    <option key={i} value={i}>{unitText(SESSION_TIME_I18N_KEYS.dayUnit, i)}</option>
                                                ))}
                                            </select>
                                        </>
                                    )}
                                    <select
                                        value={increment?.values.hours ?? 0}
                                        onChange={(e) => updateIncrementValues('hours', parseInt(e.target.value))}
                                        className="bg-gray-800 border border-gray-600 rounded px-1 py-1 text-xs outline-none focus:border-blue-500 w-16"
                                    >
                                        {[...Array(24)].map((_, i) => (
                                            <option key={i} value={i}>{unitText(SESSION_TIME_I18N_KEYS.hourUnit, i)}</option>
                                        ))}
                                    </select>
                                    <select
                                        value={increment?.values.minutes ?? 0}
                                        onChange={(e) => updateIncrementValues('minutes', parseInt(e.target.value))}
                                        className="bg-gray-800 border border-gray-600 rounded px-1 py-1 text-xs outline-none focus:border-blue-500 w-14"
                                    >
                                        {[...Array(60)].map((_, i) => (
                                            <option key={i} value={i}>{unitText(SESSION_TIME_I18N_KEYS.minuteUnit, i)}</option>
                                        ))}
                                    </select>
                                    {detailMode && (
                                        <select
                                            value={increment?.values.seconds ?? 0}
                                            onChange={(e) => updateIncrementValues('seconds', parseInt(e.target.value))}
                                            className="bg-gray-800 border border-gray-600 rounded px-1 py-1 text-xs outline-none focus:border-blue-500 w-14"
                                        >
                                            {[...Array(60)].map((_, i) => (
                                                <option key={i} value={i}>{unitText(SESSION_TIME_I18N_KEYS.secondUnit, i)}</option>
                                            ))}
                                        </select>
                                    )}
                                </div>
                            ) : (
                                <div className="text-sm font-medium text-gray-200">
                                    {formatIncrement(increment?.values, detailMode)}
                                </div>
                            )}
                        </div>

                        {/* 次のインクリメント時間（常に編集可能） */}
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-gray-400">{t(SESSION_TIME_I18N_KEYS.nextIncrement)}</label>
                            <div className="flex flex-wrap items-center gap-1">
                                {detailMode && (
                                    <>
                                        <select
                                            value={nextIncrement?.years ?? 0}
                                            onChange={(e) => updateNextIncrement('years', parseInt(e.target.value))}
                                            className="bg-gray-800 border border-gray-600 rounded px-1 py-1 text-xs outline-none focus:border-blue-500 w-14"
                                        >
                                            {[...Array(11)].map((_, i) => (
                                                <option key={i} value={i}>{unitText(SESSION_TIME_I18N_KEYS.yearUnit, i)}</option>
                                            ))}
                                        </select>
                                        <select
                                            value={nextIncrement?.months ?? 0}
                                            onChange={(e) => updateNextIncrement('months', parseInt(e.target.value))}
                                            className="bg-gray-800 border border-gray-600 rounded px-1 py-1 text-xs outline-none focus:border-blue-500 w-16"
                                        >
                                            {[...Array(12)].map((_, i) => (
                                                <option key={i} value={i}>{unitText(SESSION_TIME_I18N_KEYS.monthUnit, i)}</option>
                                            ))}
                                        </select>
                                        <select
                                            value={nextIncrement?.days ?? 0}
                                            onChange={(e) => updateNextIncrement('days', parseInt(e.target.value))}
                                            className="bg-gray-800 border border-gray-600 rounded px-1 py-1 text-xs outline-none focus:border-blue-500 w-14"
                                        >
                                            {[...Array(31)].map((_, i) => (
                                                <option key={i} value={i}>{unitText(SESSION_TIME_I18N_KEYS.dayUnit, i)}</option>
                                            ))}
                                        </select>
                                    </>
                                )}
                                <select
                                    value={nextIncrement?.hours ?? 0}
                                    onChange={(e) => updateNextIncrement('hours', parseInt(e.target.value))}
                                    className="bg-gray-800 border border-gray-600 rounded px-1 py-1 text-xs outline-none focus:border-blue-500 w-16"
                                >
                                    {[...Array(24)].map((_, i) => (
                                        <option key={i} value={i}>{unitText(SESSION_TIME_I18N_KEYS.hourUnit, i)}</option>
                                    ))}
                                </select>
                                <select
                                    value={nextIncrement?.minutes ?? 0}
                                    onChange={(e) => updateNextIncrement('minutes', parseInt(e.target.value))}
                                    className="bg-gray-800 border border-gray-600 rounded px-1 py-1 text-xs outline-none focus:border-blue-500 w-14"
                                >
                                    {[...Array(60)].map((_, i) => (
                                        <option key={i} value={i}>{unitText(SESSION_TIME_I18N_KEYS.minuteUnit, i)}</option>
                                    ))}
                                </select>
                                {detailMode && (
                                    <select
                                        value={nextIncrement?.seconds ?? 0}
                                        onChange={(e) => updateNextIncrement('seconds', parseInt(e.target.value))}
                                        className="bg-gray-800 border border-gray-600 rounded px-1 py-1 text-xs outline-none focus:border-blue-500 w-14"
                                    >
                                        {[...Array(60)].map((_, i) => (
                                            <option key={i} value={i}>{unitText(SESSION_TIME_I18N_KEYS.secondUnit, i)}</option>
                                        ))}
                                    </select>
                                )}
                            </div>
                        </div>

                        {/* 累積経過日数（整数部分のみ） */}
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-gray-400">{t(SESSION_TIME_I18N_KEYS.elapsedDays).split('{{days}}')[0] || t(SESSION_TIME_I18N_KEYS.elapsedDays)}</label>
                            <div className="text-sm font-medium text-gray-200">
                                {formatText(t(SESSION_TIME_I18N_KEYS.elapsedDays), { days: Math.floor(totalElapsedDays) })}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
