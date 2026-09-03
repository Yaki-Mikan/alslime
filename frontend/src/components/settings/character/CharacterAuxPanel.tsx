/**
 * CharacterAuxPanel - 設定ファイルエディタ（キャラクター種別）の中央エリア。
 *
 * 表情画像／画像生成設定／音声紐づけ／設定紐づけを 1 列に縦に並べ、区画ごとに開閉できる。
 * 画像生成・音声は支援者 Tier かつサイドカー active（Hub から届く真偽値）のときだけ区画を出す。
 * 本体 .md を保存していないキャラクター（dirName 無し）では保存先が無いため案内だけを出す。
 * 各区画の保存は独立（別ファイル・別 API）。未保存変更がある区画は見出しに印を出す。
 */

import React, { useCallback, useState } from 'react';
import { ImageIcon, Palette, AudioLines, Link2, ChevronDown, ChevronRight } from 'lucide-react';
import { resolveMessage, type I18NCatalog } from '../../../api/i18n';
import { CONFIG_EDITOR_I18N_KEYS, CONFIG_EDITOR_TEXT_FALLBACK_JA, COMMON_TEXT_FALLBACK_JA } from '../../../constants/i18n';
import { EmotionImageTab } from './EmotionImageTab';
import { ImageGenTab } from './ImageGenTab';
import { VoiceTab } from './VoiceTab';
import { LinkedSettingsTab } from './LinkedSettingsTab';

type AuxSection = 'emotion' | 'imageGen' | 'voice' | 'linked';

interface Props {
    backendUrl: string;
    /** 開いているキャラクターのディレクトリ名。未保存キャラは null */
    dirName: string | null;
    imageGenEnabled: boolean;
    ttsEnabled: boolean;
    uiCatalog?: I18NCatalog | null;
    /** いずれかの区画に未保存変更があるかの通知 */
    onDirtyChange?: (dirty: boolean) => void;
}

const Section: React.FC<{
    icon: React.ReactNode;
    label: string;
    open: boolean;
    onToggle: () => void;
    dirty?: boolean;
    dirtyTitle?: string;
    children: React.ReactNode;
}> = ({ icon, label, open, onToggle, dirty, dirtyTitle, children }) => (
    <div className="border border-gray-700 rounded-lg overflow-hidden">
        <button
            onClick={onToggle}
            className="w-full flex items-center justify-between p-3 bg-gray-800/80 hover:bg-gray-800 transition-colors"
        >
            <div className="flex items-center gap-2 text-sm font-medium text-gray-200">
                {icon}
                {label}
                {dirty && <span className="text-yellow-300 text-xs" title={dirtyTitle}>●</span>}
            </div>
            {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </button>
        {/* 閉じても state を保つため hidden で隠す（未保存の編集を捨てない） */}
        <div className={open ? 'p-4 bg-gray-900' : 'hidden'}>{children}</div>
    </div>
);

export const CharacterAuxPanel: React.FC<Props> = ({ backendUrl, dirName, imageGenEnabled, ttsEnabled, uiCatalog = null, onDirtyChange }) => {
    const t = (key: string) => resolveMessage(uiCatalog, key, CONFIG_EDITOR_TEXT_FALLBACK_JA[key] || COMMON_TEXT_FALLBACK_JA[key] || key);
    const [dirtySections, setDirtySections] = useState<Record<AuxSection, boolean>>({ emotion: false, imageGen: false, voice: false, linked: false });
    const [openSections, setOpenSections] = useState<Record<AuxSection, boolean>>({ emotion: true, imageGen: false, voice: false, linked: false });

    const toggle = (key: AuxSection) => () => setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));

    const markDirty = useCallback((key: AuxSection) => (dirty: boolean) => {
        setDirtySections(prev => {
            if (prev[key] === dirty) return prev;
            const next = { ...prev, [key]: dirty };
            onDirtyChange?.(Object.values(next).some(Boolean));
            return next;
        });
    }, [onDirtyChange]);

    if (!dirName) {
        return (
            <div className="h-full flex items-center justify-center">
                <p className="text-sm text-gray-500 text-center px-6">{t(CONFIG_EDITOR_I18N_KEYS.characterSaveFirst)}</p>
            </div>
        );
    }

    const unsaved = t(CONFIG_EDITOR_I18N_KEYS.characterUnsaved);

    return (
        // dirName が変わったら各区画の state を捨てる（別キャラの未保存内容を持ち越さない）
        // scrollbar-gutter: stable で、区画の開閉でスクロールバーが出たり消えたりしても中身の幅が変わらないようにする
        <div key={dirName} className="h-full overflow-y-auto custom-scrollbar px-4 py-3 space-y-3" style={{ scrollbarGutter: 'stable' }}>
            <Section
                icon={<ImageIcon size={16} className="text-blue-300" />}
                label={t(CONFIG_EDITOR_I18N_KEYS.characterTabEmotion)}
                open={openSections.emotion}
                onToggle={toggle('emotion')}
            >
                <EmotionImageTab backendUrl={backendUrl} dirName={dirName} uiCatalog={uiCatalog} imageGenEnabled={imageGenEnabled} />
            </Section>

            {imageGenEnabled && (
                <Section
                    icon={<Palette size={16} className="text-pink-300" />}
                    label={t(CONFIG_EDITOR_I18N_KEYS.characterTabImageGen)}
                    open={openSections.imageGen}
                    onToggle={toggle('imageGen')}
                    dirty={dirtySections.imageGen}
                    dirtyTitle={unsaved}
                >
                    <ImageGenTab
                        backendUrl={backendUrl}
                        dirName={dirName}
                        active
                        uiCatalog={uiCatalog}
                        onDirtyChange={markDirty('imageGen')}
                    />
                </Section>
            )}

            {ttsEnabled && (
                <Section
                    icon={<AudioLines size={16} className="text-orange-300" />}
                    label={t(CONFIG_EDITOR_I18N_KEYS.characterTabVoice)}
                    open={openSections.voice}
                    onToggle={toggle('voice')}
                >
                    <VoiceTab backendUrl={backendUrl} dirName={dirName} uiCatalog={uiCatalog} />
                </Section>
            )}

            <Section
                icon={<Link2 size={16} className="text-green-300" />}
                label={t(CONFIG_EDITOR_I18N_KEYS.characterTabLinked)}
                open={openSections.linked}
                onToggle={toggle('linked')}
                dirty={dirtySections.linked}
                dirtyTitle={unsaved}
            >
                <LinkedSettingsTab
                    backendUrl={backendUrl}
                    dirName={dirName}
                    uiCatalog={uiCatalog}
                    onDirtyChange={markDirty('linked')}
                />
            </Section>
        </div>
    );
};
