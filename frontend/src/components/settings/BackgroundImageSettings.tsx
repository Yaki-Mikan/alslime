/**
 * BackgroundImageSettings.tsx - セッション内背景画像の設定フォーム
 *
 * 画像付き応答を背景に表示する機能の設定。画像生成設定系の中身のため、
 * 設定メニュー整理で BasicSettings（基本チャット設定）から
 * ComfyUI 画像生成設定モーダルへ移動した。
 */

import React from 'react';
import { Image as ImageIcon } from 'lucide-react';
import {
    BASIC_SETTINGS_I18N_KEYS,
    BASIC_SETTINGS_TEXT_FALLBACK_JA
} from '../../constants/i18n';
import { resolveMessage, type I18NCatalog } from '../../api/i18n';
import type { Settings } from '../../types/Settings';
import { ToggleSwitch } from '../common/ToggleSwitch';

interface BackgroundImageSettingsProps {
    settings: Settings;
    onChange: (settings: Settings) => void;
    uiCatalog: I18NCatalog | null;
}

export const BackgroundImageSettings: React.FC<BackgroundImageSettingsProps> = ({ settings, onChange, uiCatalog }) => {
    const t = (key: string) => resolveMessage(uiCatalog, key, BASIC_SETTINGS_TEXT_FALLBACK_JA[key] || key);

    return (
        <div className="space-y-2">
            <ToggleSwitch
                checked={settings.enableBackgroundImage ?? false}
                onChange={(on) => onChange({ ...settings, enableBackgroundImage: on })}
                label={
                    <span className="flex items-center gap-2">
                        <ImageIcon size={16} className="text-blue-400" />
                        {t(BASIC_SETTINGS_I18N_KEYS.backgroundImage)}
                    </span>
                }
                accent="blue"
                className="w-full justify-between"
            />
            <p className="text-xs text-gray-500">
                {t(BASIC_SETTINGS_I18N_KEYS.backgroundImageDescription)}
            </p>
            {(settings.enableBackgroundImage ?? false) && (
                <div className="space-y-3 pt-1">
                    {/* 背景画像の透明度 */}
                    <div className="space-y-1">
                        <div className="flex items-center justify-between">
                            <span className="text-xs text-gray-400">{t(BASIC_SETTINGS_I18N_KEYS.backgroundOpacity)}</span>
                            <span className="text-xs text-gray-500">{Math.round((settings.backgroundImageOpacity ?? 1.0) * 100)}%</span>
                        </div>
                        <input
                            type="range"
                            min="0.1"
                            max="1.0"
                            step="0.05"
                            value={settings.backgroundImageOpacity ?? 1.0}
                            onChange={(e) => onChange({ ...settings, backgroundImageOpacity: parseFloat(e.target.value) })}
                            className="w-full accent-blue-600"
                        />
                        <div className="flex justify-between text-xs text-gray-600">
                            <span>10%</span>
                            <span>100%</span>
                        </div>
                    </div>

                    {/* メッセージバブルの不透明度 */}
                    <div className="space-y-1">
                        <div className="flex items-center justify-between">
                            <span className="text-xs text-gray-400">{t(BASIC_SETTINGS_I18N_KEYS.messageBubbleOpacity)}</span>
                            <span className="text-xs text-gray-500">{Math.round((settings.messageBubbleOpacity ?? 0.8) * 100)}%</span>
                        </div>
                        <input
                            type="range"
                            min="0.3"
                            max="1.0"
                            step="0.05"
                            value={settings.messageBubbleOpacity ?? 0.8}
                            onChange={(e) => onChange({ ...settings, messageBubbleOpacity: parseFloat(e.target.value) })}
                            className="w-full accent-blue-600"
                        />
                        <div className="flex justify-between text-xs text-gray-600">
                            <span>30%</span>
                            <span>100%</span>
                        </div>
                    </div>

                    {/* 縮尺方法 */}
                    <div className="space-y-1">
                        <span className="text-xs text-gray-400">{t(BASIC_SETTINGS_I18N_KEYS.imageFit)}</span>
                        <div className="flex gap-2">
                            <button
                                onClick={() => onChange({ ...settings, backgroundImageFit: 'cover' })}
                                className={`flex-1 px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                                    (settings.backgroundImageFit ?? 'cover') === 'cover'
                                        ? 'bg-blue-600/30 border-blue-500 text-blue-200'
                                        : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500'
                                }`}
                            >
                                {t(BASIC_SETTINGS_I18N_KEYS.imageFitCover)}
                            </button>
                            <button
                                onClick={() => onChange({ ...settings, backgroundImageFit: 'contain' })}
                                className={`flex-1 px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                                    (settings.backgroundImageFit ?? 'cover') === 'contain'
                                        ? 'bg-blue-600/30 border-blue-500 text-blue-200'
                                        : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500'
                                }`}
                            >
                                {t(BASIC_SETTINGS_I18N_KEYS.imageFitContain)}
                            </button>
                        </div>
                        <p className="text-xs text-gray-600">
                            {(settings.backgroundImageFit ?? 'cover') === 'cover'
                                ? t(BASIC_SETTINGS_I18N_KEYS.imageFitCoverDescription)
                                : t(BASIC_SETTINGS_I18N_KEYS.imageFitContainDescription)
                            }
                        </p>
                    </div>

                    {(settings.backgroundImageFit ?? 'cover') === 'cover' && (
                        <div className="space-y-1">
                            <span className="text-xs text-gray-400">{t(BASIC_SETTINGS_I18N_KEYS.imageScope)}</span>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => onChange({ ...settings, backgroundImageScope: 'history' })}
                                    className={`flex-1 px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                                        (settings.backgroundImageScope ?? 'history') === 'history'
                                            ? 'bg-blue-600/30 border-blue-500 text-blue-200'
                                            : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500'
                                    }`}
                                >
                                    {t(BASIC_SETTINGS_I18N_KEYS.imageScopeHistory)}
                                </button>
                                <button
                                    onClick={() => onChange({ ...settings, backgroundImageScope: 'chat' })}
                                    className={`flex-1 px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                                        (settings.backgroundImageScope ?? 'history') === 'chat'
                                            ? 'bg-blue-600/30 border-blue-500 text-blue-200'
                                            : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500'
                                    }`}
                                >
                                    {t(BASIC_SETTINGS_I18N_KEYS.imageScopeChat)}
                                </button>
                            </div>
                            <p className="text-xs text-gray-600">
                                {(settings.backgroundImageScope ?? 'history') === 'chat'
                                    ? t(BASIC_SETTINGS_I18N_KEYS.imageScopeChatDescription)
                                    : t(BASIC_SETTINGS_I18N_KEYS.imageScopeHistoryDescription)
                                }
                            </p>
                        </div>
                    )}

                    {(settings.backgroundImageFit ?? 'cover') === 'cover' && (settings.backgroundImageScope ?? 'history') === 'chat' && (
                        <div className="space-y-3">
                            <ToggleSwitch
                                checked={settings.backgroundChatInputAreaMatchImageOpacity ?? false}
                                onChange={(on) => onChange({ ...settings, backgroundChatInputAreaMatchImageOpacity: on })}
                                label={t(BASIC_SETTINGS_I18N_KEYS.matchImageOpacity)}
                                labelPosition="right"
                                labelClassName="text-xs text-gray-400"
                                accent="blue"
                                size="sm"
                            />

                            <div className="space-y-1">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-gray-400">{t(BASIC_SETTINGS_I18N_KEYS.chatInputAreaOpacity)}</span>
                                    <span className="text-xs text-gray-500">
                                        {(settings.backgroundChatInputAreaMatchImageOpacity ?? false)
                                            ? t(BASIC_SETTINGS_I18N_KEYS.opacitySameAsBackground)
                                            : `${Math.round((settings.backgroundChatInputAreaOpacity ?? 0.45) * 100)}%`
                                        }
                                    </span>
                                </div>
                                <input
                                    type="range"
                                    min="0"
                                    max="1.0"
                                    step="0.05"
                                    value={settings.backgroundChatInputAreaOpacity ?? 0.45}
                                    onChange={(e) => onChange({ ...settings, backgroundChatInputAreaOpacity: parseFloat(e.target.value) })}
                                    disabled={settings.backgroundChatInputAreaMatchImageOpacity ?? false}
                                    className="w-full accent-blue-600 disabled:opacity-40"
                                />
                                <div className="flex justify-between text-xs text-gray-600">
                                    <span>{t(BASIC_SETTINGS_I18N_KEYS.transparent)}</span>
                                    <span>{t(BASIC_SETTINGS_I18N_KEYS.opaque)}</span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
