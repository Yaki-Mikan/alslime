import React from 'react';
import { Type, ALargeSmall, AlignJustify, MoveVertical, Thermometer, FoldVertical } from 'lucide-react';
import {
    BASIC_SETTINGS_I18N_KEYS,
    BASIC_SETTINGS_TEXT_FALLBACK_JA
} from '../../constants/i18n';
import { resolveMessage, type I18NCatalog } from '../../api/i18n';
import type { Settings } from '../../types/Settings';
import { ToggleSwitch } from '../common/ToggleSwitch';

interface BasicSettingsProps {
    settings: Settings;
    onChange: (settings: Settings) => void;
    uiCatalog: I18NCatalog | null;
}

const FONT_OPTIONS: Array<{ value: string; labelKey: string }> = [
    { value: 'system-ui, -apple-system, sans-serif', labelKey: BASIC_SETTINGS_I18N_KEYS.fontSystem },
    { value: '"Noto Sans JP", sans-serif', labelKey: BASIC_SETTINGS_I18N_KEYS.fontNotoSansJP },
    { value: '"Hiragino Sans", sans-serif', labelKey: BASIC_SETTINGS_I18N_KEYS.fontHiragino },
    { value: '"Yu Gothic", sans-serif', labelKey: BASIC_SETTINGS_I18N_KEYS.fontYuGothic },
    { value: '"Meiryo", sans-serif', labelKey: BASIC_SETTINGS_I18N_KEYS.fontMeiryo },
    { value: 'monospace', labelKey: BASIC_SETTINGS_I18N_KEYS.fontMonospace },
];

export const BasicSettings: React.FC<BasicSettingsProps> = ({ settings, onChange, uiCatalog }) => {
    const t = (key: string) => resolveMessage(uiCatalog, key, BASIC_SETTINGS_TEXT_FALLBACK_JA[key] || key);

    return (
        <div className="space-y-6">
            {/* UI表示言語はハブ画面（SettingsModal）のプルダウンに一本化した（設定メニュー整理） */}

            {/* フォント */}
            <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium text-gray-300">
                    <Type size={16} className="text-blue-400" />
                    {t(BASIC_SETTINGS_I18N_KEYS.font)}
                </label>
                <select
                    value={settings.fontFamily}
                    onChange={(e) => onChange({ ...settings, fontFamily: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-gray-100 focus:border-blue-500 outline-none"
                >
                    {FONT_OPTIONS.map((font) => (
                        <option key={font.value} value={font.value}>
                            {t(font.labelKey)}
                        </option>
                    ))}
                </select>
            </div>

            {/* フォントサイズ */}
            <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium text-gray-300">
                    <ALargeSmall size={16} className="text-blue-400" />
                    {t(BASIC_SETTINGS_I18N_KEYS.fontSize)}
                    <span className="text-gray-500 font-normal">
                        {settings.fontSize || 14}px
                    </span>
                </label>
                <input
                    type="range"
                    min="10"
                    max="24"
                    step="1"
                    value={settings.fontSize || 14}
                    onChange={(e) => onChange({ ...settings, fontSize: parseInt(e.target.value) })}
                    className="w-full accent-blue-500"
                />
                <div className="flex justify-between text-xs text-gray-500">
                    <span>10px</span>
                    <span>14px</span>
                    <span>24px</span>
                </div>
            </div>

            {/* 行間 */}
            <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium text-gray-300">
                    <AlignJustify size={16} className="text-blue-400" />
                    {t(BASIC_SETTINGS_I18N_KEYS.lineHeight)}
                    <span className="text-gray-500 font-normal">
                        {(settings.lineHeight || 1.625).toFixed(2)} em
                    </span>
                </label>
                <input
                    type="range"
                    min="1.0"
                    max="2.5"
                    step="0.05"
                    value={settings.lineHeight || 1.625}
                    onChange={(e) => onChange({ ...settings, lineHeight: parseFloat(e.target.value) })}
                    className="w-full accent-blue-500"
                />
                <div className="flex justify-between text-xs text-gray-500">
                    <span>1.0</span>
                    <span>1.625</span>
                    <span>2.5</span>
                </div>
            </div>

            {/* 空行の高さ */}
            <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium text-gray-300">
                    <MoveVertical size={16} className="text-blue-400" />
                    {t(BASIC_SETTINGS_I18N_KEYS.emptyLineHeight)}
                    <span className="text-gray-500 font-normal">
                        {settings.emptyLineHeight.toFixed(1)} em
                    </span>
                </label>
                <input
                    type="range"
                    min="0.2"
                    max="2.0"
                    step="0.1"
                    value={settings.emptyLineHeight}
                    onChange={(e) => onChange({ ...settings, emptyLineHeight: parseFloat(e.target.value) })}
                    className="w-full accent-blue-500"
                />
                <div className="flex justify-between text-xs text-gray-500">
                    <span>0.2</span>
                    <span>1.0</span>
                    <span>2.0</span>
                </div>
            </div>

            {/* 温度設定 */}
            <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium text-gray-300">
                    <Thermometer size={16} className="text-blue-400" />
                    {t(BASIC_SETTINGS_I18N_KEYS.temperature)}
                    <span className="text-gray-500 font-normal">
                        {(settings.temperature ?? 1.0).toFixed(1)}
                    </span>
                </label>
                <input
                    type="range"
                    min="0.0"
                    max="2.0"
                    step="0.1"
                    value={settings.temperature ?? 1.0}
                    onChange={(e) => onChange({ ...settings, temperature: parseFloat(e.target.value) })}
                    className="w-full accent-blue-500"
                />
                <div className="flex justify-between text-xs text-gray-500">
                    <span>{t(BASIC_SETTINGS_I18N_KEYS.temperatureLow)}</span>
                    <span>1.0</span>
                    <span>{t(BASIC_SETTINGS_I18N_KEYS.temperatureHigh)}</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                    {t(BASIC_SETTINGS_I18N_KEYS.temperatureDescription)}
                </p>
            </div>

            <hr className="border-gray-700" />

            {/* 連続した空行を1行にまとめる */}
            <div className="space-y-2">
                <ToggleSwitch
                    checked={settings.collapseEmptyLines ?? true}
                    onChange={(on) => onChange({ ...settings, collapseEmptyLines: on })}
                    label={
                        <span className="flex items-center gap-2">
                            <FoldVertical size={16} className="text-blue-400" />
                            {t(BASIC_SETTINGS_I18N_KEYS.collapseEmptyLines)}
                        </span>
                    }
                    accent="blue"
                    className="w-full justify-between"
                />
                <p className="text-xs text-gray-500">
                    {t(BASIC_SETTINGS_I18N_KEYS.collapseEmptyLinesDescription)}
                </p>
            </div>
        </div>
    );
};
