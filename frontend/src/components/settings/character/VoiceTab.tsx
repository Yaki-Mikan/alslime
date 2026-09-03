/**
 * VoiceTab - 設定ファイルエディタ（キャラクター種別）の音声紐づけタブ。
 *
 * TTS 統合設定・会話設定内の音声パネルと同じ TTSCharacterAssignForm を埋め込む
 * （保存ボタンはフォーム内蔵）。対象キャラクターは開いているキャラクターに固定。
 */

import React from 'react';
import { TTSCharacterAssignForm } from '../../tts/TTSCharacterAssignForm';
import type { I18NCatalog } from '../../../api/i18n';

interface Props {
    backendUrl: string;
    dirName: string;
    uiCatalog?: I18NCatalog | null;
}

export const VoiceTab: React.FC<Props> = ({ backendUrl, dirName, uiCatalog = null }) => (
    <TTSCharacterAssignForm
        backendUrl={backendUrl}
        characterDirName={dirName}
        uiCatalog={uiCatalog}
    />
);
