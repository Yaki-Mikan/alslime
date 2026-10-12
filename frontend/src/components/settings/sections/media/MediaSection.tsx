/**
 * MediaSection.tsx - 設定画面「画像生成・読み上げ」
 *
 * 上の切り替えで画像生成と読み上げを分ける。一度開いた側は隠すだけにして下書きを保ち、
 * 保存の帯からの保存・元に戻すは両方に対して行う。
 * キャラごとの画像と声・タグ・ワークフローは素材づくりにあるので、そこへの入口を置く。
 */
import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { BACKEND_URL } from '../../../../api/base-url';
import { resolveMessage } from '../../../../api/i18n';
import { SETTINGS_VIEW_I18N_KEYS, SETTINGS_VIEW_TEXT_FALLBACK_JA } from '../../../../constants/i18n';
import { TTSSettingsPanel } from './TTSSettingsPanel';
import { Button, Segmented, cn } from '../../../ui';
import type { SectionCommonProps, SectionHandle } from '../sectionTypes';
import { ImageGenSettings } from './ImageGenSettings';

export type MediaMaterialTab = 'images' | 'voice' | 'tags' | 'workflow';
type MediaPart = 'image' | 'tts';

interface MediaSectionProps extends SectionCommonProps {
    imageGenAvailable: boolean;
    ttsAvailable: boolean;
    /** 素材づくりの指定のタブを開く */
    onOpenMaterial: (tab: MediaMaterialTab) => void;
}

export const MediaSection = React.forwardRef<SectionHandle, MediaSectionProps>(
    ({ onDirtyChange, uiCatalog, imageGenAvailable, ttsAvailable, onOpenMaterial }, ref) => {
        const t = (key: string) => resolveMessage(uiCatalog, key, SETTINGS_VIEW_TEXT_FALLBACK_JA[key] || key);
        const [selectedPart, setPart] = useState<MediaPart>(imageGenAvailable ? 'image' : 'tts');
        const part: MediaPart = !imageGenAvailable ? 'tts' : !ttsAvailable ? 'image' : selectedPart;
        // 一度開いた側だけ組み込み、あとは隠すだけにする
        const [visited, setVisited] = useState<Record<MediaPart, boolean>>({ image: false, tts: false });
        if (!visited[part]) setVisited(prev => ({ ...prev, [part]: true }));

        const imageRef = useRef<SectionHandle>(null);
        const ttsRef = useRef<SectionHandle>(null);
        const [dirty, setDirty] = useState<Record<MediaPart, boolean>>({ image: false, tts: false });
        const setPartDirty = useCallback((key: MediaPart, value: boolean) => {
            setDirty(prev => (prev[key] === value ? prev : { ...prev, [key]: value }));
        }, []);
        const anyDirty = dirty.image || dirty.tts;
        useEffect(() => { onDirtyChange(anyDirty); }, [anyDirty, onDirtyChange]);
        const onImageDirty = useCallback((value: boolean) => setPartDirty('image', value), [setPartDirty]);
        const onTtsDirty = useCallback((value: boolean) => setPartDirty('tts', value), [setPartDirty]);

        useImperativeHandle(ref, () => ({
            save: async () => {
                const failed: string[] = [];
                if (dirty.image && imageRef.current) failed.push(...await imageRef.current.save());
                if (dirty.tts && ttsRef.current) failed.push(...await ttsRef.current.save());
                return failed;
            },
            revert: () => {
                imageRef.current?.revert();
                ttsRef.current?.revert();
            },
        }));

        const parts: { value: MediaPart; label: string }[] = [
            ...(imageGenAvailable ? [{ value: 'image' as const, label: t(SETTINGS_VIEW_I18N_KEYS.mediaImageGen) }] : []),
            ...(ttsAvailable ? [{ value: 'tts' as const, label: t(SETTINGS_VIEW_I18N_KEYS.mediaTts) }] : []),
        ];

        return (
            <>
                <div className="mb-6 space-y-3">
                    {parts.length > 1 && (
                        <Segmented<MediaPart> label={t(SETTINGS_VIEW_I18N_KEYS.categoryMedia)} value={part} onChange={setPart} options={parts} />
                    )}
                    <div className="flex flex-wrap items-center gap-2 rounded-ui border border-line bg-surface px-4 py-3">
                        <p className="flex-1 min-w-[12rem] text-xs text-fg-muted">{t(SETTINGS_VIEW_I18N_KEYS.mediaGuide)}</p>
                        {(imageGenAvailable || ttsAvailable) && <Button size="sm" variant="secondary" onClick={() => onOpenMaterial('images')}>{t(SETTINGS_VIEW_I18N_KEYS.mediaOpenImages)}</Button>}
                        {ttsAvailable && <Button size="sm" variant="secondary" onClick={() => onOpenMaterial('voice')}>{t(SETTINGS_VIEW_I18N_KEYS.mediaOpenVoice)}</Button>}
                    </div>
                </div>

                {imageGenAvailable && visited.image && (
                    <div className={cn(part !== 'image' && 'hidden')}>
                        <ImageGenSettings ref={imageRef} uiCatalog={uiCatalog} active onDirtyChange={onImageDirty} onOpenMaterial={onOpenMaterial} />
                    </div>
                )}
                {ttsAvailable && visited.tts && (
                    <div className={cn(part !== 'tts' && 'hidden')}>
                        <TTSSettingsPanel
                            active
                            backendUrl={BACKEND_URL}
                            uiCatalog={uiCatalog}
                            onDirtyChange={onTtsDirty}
                            handleRef={ttsRef}
                        />
                    </div>
                )}
            </>
        );
    },
);
MediaSection.displayName = 'MediaSection';

export default MediaSection;
