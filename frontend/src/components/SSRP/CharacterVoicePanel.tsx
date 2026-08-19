/**
 * CharacterVoicePanel.tsx - キャラクター音声設定パネル
 *
 * 会話設定画面のキャラクター詳細設定内に配置される開閉可能なパネル
 * （CharacterImagePanel と同じ軽量インターフェース・自己完結開閉。要件6.4）。
 * 配置は個別パラメータの直後・CharacterImagePanel の直前。表示条件は親の canUseTTS。
 * 編集の実体は TTSCharacterAssignForm（保存先 /api/tts/character-config/{name}）。
 */
import React, { useState } from 'react';
import { AudioLines, ChevronDown, ChevronRight } from 'lucide-react';
import { TTSCharacterAssignForm } from '../tts/TTSCharacterAssignForm';
import { resolveMessage, type I18NCatalog } from '../../api/i18n';

interface CharacterVoicePanelProps {
    characterName: string;
    backendUrl: string;
    uiCatalog?: I18NCatalog | null;
    // 会話設定側VoiceDesign（値の正本は会話設定プリセット側の state。要件6.5）。
    // undefined（親が結線しない）場合は欄を表示しない。
    presetVoiceDesign?: { mode: 'append' | 'replace'; text: string };
    onPresetVoiceDesignChange?: (value: { mode: 'append' | 'replace'; text: string }) => void;
}

export const CharacterVoicePanel: React.FC<CharacterVoicePanelProps> = ({
    characterName,
    backendUrl,
    uiCatalog = null,
    presetVoiceDesign,
    onPresetVoiceDesignChange,
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const t = (key: string, fallback: string) => resolveMessage(uiCatalog, key, fallback);

    if (!characterName) return null;

    const preset = presetVoiceDesign ?? { mode: 'append' as const, text: '' };

    return (
        <div className="mt-4 border border-gray-700 rounded-lg overflow-hidden">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between p-3 bg-gray-800/80 hover:bg-gray-800 transition-colors"
            >
                <div className="flex items-center gap-2 text-gray-200">
                    <AudioLines size={18} className="text-orange-400" />
                    <span className="font-medium">{t('tts.voicePanel.title', '音声設定')}</span>
                </div>
                {isOpen ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
            </button>
            {isOpen && (
                <div className="p-4 bg-gray-900 space-y-4">
                    <TTSCharacterAssignForm
                        backendUrl={backendUrl}
                        characterDirName={characterName}
                        uiCatalog={uiCatalog}
                    />
                    {onPresetVoiceDesignChange && (
                        <div className="border-t border-gray-700/60 pt-3 space-y-2">
                            <div className="flex items-center gap-2">
                                <label className="text-xs text-gray-400">
                                    {t('tts.voicePanel.presetVoiceDesign', '会話設定側VoiceDesign（この会話設定でのみ有効）')}
                                </label>
                                <select
                                    value={preset.mode}
                                    onChange={e => onPresetVoiceDesignChange({ ...preset, mode: e.target.value as 'append' | 'replace' })}
                                    className="ml-auto bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded px-2 py-1 outline-none focus:border-orange-500"
                                >
                                    <option value="append">{t('tts.voicePanel.modeAppend', '追記')}</option>
                                    <option value="replace">{t('tts.voicePanel.modeReplace', '置換')}</option>
                                </select>
                            </div>
                            <textarea
                                value={preset.text}
                                onChange={e => onPresetVoiceDesignChange({ ...preset, text: e.target.value })}
                                rows={2}
                                placeholder={t('tts.voicePanel.presetVoiceDesignPlaceholder', 'この会話設定での声の指示（例: 囁くように話す）')}
                                className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-3 py-2 outline-none focus:border-orange-500 resize-y"
                            />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
