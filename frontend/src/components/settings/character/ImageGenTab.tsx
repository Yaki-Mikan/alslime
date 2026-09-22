/**
 * ImageGenTab - 設定ファイルエディタ（キャラクター種別）の画像生成設定タブ。
 *
 * 画像生成統合設定の「キャラクター画像生成設定」と同じフォーム（IntegratedCharacterSection）を
 * キャラクター選択なしで埋め込む。state と API は useCharacterImageGenEditor に集約。
 */

import React, { useEffect } from 'react';
import { IntegratedCharacterSection } from '../../comfyui/integrated/IntegratedCharacterSection';
import { useCharacterImageGenEditor } from '../../comfyui/useCharacterImageGenEditor';
import { resolveMessage, type I18NCatalog } from '../../../api/i18n';
import { CONFIG_EDITOR_I18N_KEYS, CONFIG_EDITOR_TEXT_FALLBACK_JA } from '../../../constants/i18n';
import type { AppearancePromptHandle } from '../../../hooks/useAppearancePromptGen';

interface Props {
    backendUrl: string;
    dirName: string;
    /** 開いている設定ファイル名（容姿プロンプト作成の対象）。無ければボタンは押せない */
    fileName?: string | null;
    active: boolean;
    uiCatalog?: I18NCatalog | null;
    onDirtyChange?: (dirty: boolean) => void;
    appearancePrompt?: AppearancePromptHandle;
}

export const ImageGenTab: React.FC<Props> = ({ backendUrl, dirName, fileName = null, active, uiCatalog = null, onDirtyChange, appearancePrompt }) => {
    const editor = useCharacterImageGenEditor(backendUrl, dirName, active);
    const t = (key: string) => resolveMessage(uiCatalog, key, CONFIG_EDITOR_TEXT_FALLBACK_JA[key] || key);

    useEffect(() => {
        onDirtyChange?.(editor.isDirty);
    }, [editor.isDirty, onDirtyChange]);

    return (
        <IntegratedCharacterSection
            hideCharacterSelector
            selectedCharacter={dirName}
            workNameHint={t(CONFIG_EDITOR_I18N_KEYS.characterImageGenWorkNameHint)}
            config={editor.config}
            onUpdateConfig={editor.updateConfig}
            isLoading={editor.isLoading}
            isDirty={editor.isDirty}
            onSave={editor.save}
            availableLoras={editor.availableLoras}
            availableOutfitLoras={editor.availableOutfitLoras}
            comfyUnreachable={editor.comfyUnreachable}
            onRefreshLoras={editor.refreshLoras}
            onFetchTriggerWords={editor.fetchTriggerWords}
            triggerWordFormat={editor.triggerWordFormat}
            uiCatalog={uiCatalog}
            backendUrl={backendUrl}
            appearancePrompt={appearancePrompt}
            appearanceTarget={fileName ? { dirName, fileName, displayName: fileName } : null}
            characterDirName={dirName}
            onReloadConfig={editor.reload}
        />
    );
};
