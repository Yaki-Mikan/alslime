/**
 * SoundEffectsSummary.tsx - 「生成へ指定した効果音」の表示（テスト生成の結果の詳細と、会話の画像の詳細で共用）
 *
 * 絵に実際に描かれたかどうかではなく、生成へ指定した内容を出す。種別ごとに、指定ありは一覧、
 * 不要と判定・判定結果を採用できずはその旨の一文を出す。種別が無い（判定を行わなかった生成、
 * この情報を持たない古い画像）ときは何も出さない。
 */

import React from 'react';
import type { ImageSoundEffect, ImageSoundEffectsStatus } from '../../../api/comfyui';
import type { I18NCatalog } from '../../../api/i18n';
import { createComfyUIText } from '../i18n';

interface Props {
    soundEffects?: ImageSoundEffect[];
    status?: ImageSoundEffectsStatus;
    uiCatalog?: I18NCatalog | null;
    className?: string;
}

export const SoundEffectsSummary: React.FC<Props> = ({ soundEffects, status, uiCatalog = null, className = '' }) => {
    const { GENERATE_TEST } = createComfyUIText(uiCatalog);
    const effects = soundEffects ?? [];
    if (status === 'notNeeded') {
        return <p className={`text-xs text-gray-400 ${className}`} data-testid="sound-effects-summary">{GENERATE_TEST.MESSAGES.SOUND_EFFECTS_NOT_NEEDED}</p>;
    }
    if (status === 'rejected') {
        return <p className={`text-xs text-amber-200 ${className}`} data-testid="sound-effects-summary">{GENERATE_TEST.MESSAGES.SOUND_EFFECTS_REJECTED}</p>;
    }
    if (status !== 'specified' || effects.length === 0) return null;
    return (
        <div className={`text-xs text-gray-400 space-y-0.5 ${className}`} data-testid="sound-effects-summary">
            <p className="font-medium text-gray-300">{GENERATE_TEST.LABELS.SOUND_EFFECTS}</p>
            {effects.map((effect, idx) => (
                <p key={idx} className="break-all">
                    <span className="text-gray-200">{effect.text}</span>
                    {effect.style && <span className="text-gray-500"> — {effect.style}</span>}
                </p>
            ))}
        </div>
    );
};
