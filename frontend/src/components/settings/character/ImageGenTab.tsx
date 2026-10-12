/**
 * ImageGenTab - 設定ファイルエディタ（キャラクター種別）の画像生成設定タブ。
 *
 * 素材づくりのキャラ画像の「このキャラの画像設定」と同じフォーム（IntegratedCharacterSection）を
 * キャラクター選択なしで埋め込む。state と API は useCharacterImageGenEditor に集約。
 * 設定ファイルの画面では保存ボタンを隠し、上の帯の「保存」から ref の save を呼ぶ。
 */

import React, { useEffect, useImperativeHandle } from 'react';
import { IntegratedCharacterSection } from '../../comfyui/integrated/IntegratedCharacterSection';
import { IntegratedDanbooruSearch } from '../../comfyui/integrated/IntegratedDanbooruSearch';
import { useDanbooruTagFormat } from '../../comfyui/useDanbooruTagFormat';
import { useCharacterImageGenEditor } from '../../comfyui/useCharacterImageGenEditor';
import { resolveMessage, type I18NCatalog } from '../../../api/i18n';
import { CONFIG_EDITOR_I18N_KEYS, CONFIG_EDITOR_TEXT_FALLBACK_JA } from '../../../constants/i18n';
import type { AppearancePromptHandle } from '../../../hooks/useAppearancePromptGen';
import type { SaveHandle } from './CharacterTagsEditor';

interface Props {
    backendUrl: string;
    dirName: string;
    /** 開いている設定ファイル名（容姿プロンプト作成の対象）。無ければボタンは押せない */
    fileName?: string | null;
    active: boolean;
    uiCatalog?: I18NCatalog | null;
    onDirtyChange?: (dirty: boolean) => void;
    appearancePrompt?: AppearancePromptHandle;
    /** 保存ボタンを出さない（上の帯の「保存」でまとめて保存するとき） */
    hideSaveButton?: boolean;
}

export const ImageGenTab = React.forwardRef<SaveHandle, Props>(({ backendUrl, dirName, fileName = null, active, uiCatalog = null, onDirtyChange, appearancePrompt, hideSaveButton = false }, ref) => {
    const editor = useCharacterImageGenEditor(backendUrl, dirName, active);
    // タグ検索の結果をコピーするときの書き方（設定画面の画像生成で選んだもの）
    const danbooruTagFormat = useDanbooruTagFormat(backendUrl, active, undefined);
    const t = (key: string) => resolveMessage(uiCatalog, key, CONFIG_EDITOR_TEXT_FALLBACK_JA[key] || key);

    useEffect(() => {
        onDirtyChange?.(editor.isDirty);
    }, [editor.isDirty, onDirtyChange]);

    useImperativeHandle(ref, () => ({
        save: async () => (editor.isDirty ? (await editor.save()) !== false : true),
    }));

    return (
        <div className="space-y-4">
        {/* タグ検索（素材づくりのキャラのタブと同じ。キャラの設定なので「キャラ/作品のみ」の切り替えを出す） */}
        <IntegratedDanbooruSearch backendUrl={backendUrl} danbooruTagFormat={danbooruTagFormat} uiCatalog={uiCatalog} characterFilter />
        <IntegratedCharacterSection
            hideCharacterSelector
            hideSaveButton={hideSaveButton}
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
        </div>
    );
});
ImageGenTab.displayName = 'ImageGenTab';
