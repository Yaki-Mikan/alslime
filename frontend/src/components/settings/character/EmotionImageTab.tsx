/**
 * EmotionImageTab - 設定ファイルエディタ（キャラクター種別）の表情画像区画。
 *
 * 会話設定の画像管理パネルを埋め込みモードで置く。操作ごとに即時 API 保存されるため
 * 区画独自の保存ボタンは無い。画像生成の利用条件を満たすときは「表情画像生成」モーダルも持つ。
 */

import React, { useState } from 'react';
import { CharacterImagePanel } from '../../SSRP/CharacterImagePanel';
import { EmotionImageGenModal } from '../../comfyui/EmotionImageGenModal';
import type { I18NCatalog } from '../../../api/i18n';

interface Props {
    backendUrl: string;
    dirName: string;
    uiCatalog?: I18NCatalog | null;
    /** 画像生成の利用条件（支援者 Tier 充足 AND 画像生成サイドカー active） */
    imageGenEnabled?: boolean;
}

export const EmotionImageTab: React.FC<Props> = ({ backendUrl, dirName, uiCatalog = null, imageGenEnabled = false }) => {
    const [genTarget, setGenTarget] = useState<{ emotion: string } | null>(null);
    // 登録完了後に画像パネルを読み直させるためのキー（パネルは characterName の変化で再取得するため、
    // 同じキャラのまま再取得させる手段としてマウントし直す）
    const [panelKey, setPanelKey] = useState(0);

    return (
        <>
            <CharacterImagePanel
                key={panelKey}
                characterName={dirName}
                backendUrl={backendUrl}
                uiCatalog={uiCatalog}
                embedded
                imageGenEnabled={imageGenEnabled}
                onOpenEmotionImageGen={imageGenEnabled ? emotion => setGenTarget({ emotion }) : undefined}
            />
            {imageGenEnabled && (
                <EmotionImageGenModal
                    isOpen={genTarget !== null}
                    onClose={() => { setGenTarget(null); setPanelKey(k => k + 1); }}
                    backendUrl={backendUrl}
                    uiCatalog={uiCatalog}
                    initialCharacterDirName={dirName}
                    initialEmotion={genTarget?.emotion || 'default'}
                    onRegistered={() => setPanelKey(k => k + 1)}
                />
            )}
        </>
    );
};
