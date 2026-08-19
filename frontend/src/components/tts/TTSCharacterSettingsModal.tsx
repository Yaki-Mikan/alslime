/**
 * TTSCharacterSettingsModal.tsx - キャラクター音声紐づけモーダル（小画面用）
 *
 * 画面幅が統合設定の最小幅に満たない環境向けの導線
 * （ComfyUICharacterSettingsModal と同じ役割分担。設計04の5-3）。
 * キャラクター選択と TTSCharacterAssignForm（Voice選択・VoiceDesign・cfg上書き）を持つ。
 */
import React, { useEffect, useState } from 'react';
import { AudioLines, X } from 'lucide-react';
import { TTSCharacterAssignForm } from './TTSCharacterAssignForm';
import { getCharacterTags } from '../../api/files';
import type { CharacterTagInfo } from '../../api/files';
import { resolveMessage, type I18NCatalog } from '../../api/i18n';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    backendUrl: string;
    initialSelectedCharacter?: string;
    uiCatalog?: I18NCatalog | null;
}

export const TTSCharacterSettingsModal: React.FC<Props> = ({
    isOpen,
    onClose,
    backendUrl,
    initialSelectedCharacter = '',
    uiCatalog = null,
}) => {
    const t = (key: string, fallback: string) => resolveMessage(uiCatalog, key, fallback);
    const [characters, setCharacters] = useState<CharacterTagInfo[]>([]);
    const [selectedName, setSelectedName] = useState('');

    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        (async () => {
            try {
                const result = await getCharacterTags();
                if (cancelled) return;
                setCharacters(result.characters);
                if (initialSelectedCharacter) {
                    const found = result.characters.find(
                        c => c.name === initialSelectedCharacter || c.dirName === initialSelectedCharacter
                    );
                    setSelectedName(found?.name || initialSelectedCharacter);
                }
            } catch (error) {
                console.error('[TTSCharacterSettingsModal] character list load failed:', error);
            }
        })();
        return () => { cancelled = true; };
    }, [isOpen, initialSelectedCharacter]);

    if (!isOpen) return null;

    // 一覧に無い名前は版サフィックス（`_v3` 等）を剥がしてディレクトリ名とみなす（存在しないディレクトリを作らない）。
    const dirName = characters.find(c => c.name === selectedName)?.dirName || selectedName.replace(/_v\d+$/, '');

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-md border border-gray-700 overflow-hidden flex flex-col max-h-[85vh]">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-700 bg-gray-800 shrink-0">
                    <AudioLines size={18} className="text-orange-400" />
                    <h3 className="text-sm font-semibold text-gray-100">
                        {t('tts.charModal.title', 'キャラクター音声設定')}
                    </h3>
                    <button
                        onClick={onClose}
                        className="ml-auto p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
                    >
                        <X size={16} />
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3">
                    <div>
                        <label className="block text-xs text-gray-400 mb-1">
                            {t('tts.charAssign.character', 'キャラクター')}
                        </label>
                        <select
                            value={selectedName}
                            onChange={e => setSelectedName(e.target.value)}
                            className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-3 py-2 outline-none focus:border-orange-500"
                        >
                            <option value="">{t('tts.charAssign.selectCharacter', 'キャラクターを選択')}</option>
                            {characters.map(c => (
                                <option key={c.dirName} value={c.name}>{c.name}</option>
                            ))}
                        </select>
                    </div>
                    {selectedName && (
                        <TTSCharacterAssignForm
                            backendUrl={backendUrl}
                            characterDirName={dirName}
                            uiCatalog={uiCatalog}
                        />
                    )}
                </div>
            </div>
        </div>
    );
};
