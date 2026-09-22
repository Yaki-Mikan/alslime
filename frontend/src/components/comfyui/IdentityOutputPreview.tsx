/**
 * IdentityOutputPreview.tsx - キャラクター名・作品名の出力表示
 *
 * キャラクター名と作品名は ComfyUI 用と API サービス用で共用の値。プロンプトへ出すときの
 * 表記（ComfyUI 用は Danbooru タグ形式の設定、API サービス用は送信時の区切り）を欄の下に並べて示す。
 */

import React from 'react';
import type { DanbooruTagFormat } from '../../api/comfyui';
import type { I18NCatalog } from '../../api/i18n';
import { createComfyUIText } from './i18n';
import { formatForApiService, formatIdentityForComfyUI } from './danbooru-format';
import { useDanbooruTagFormat } from './useDanbooruTagFormat';

interface IdentityOutputPreviewProps {
    backendUrl: string;
    active: boolean;
    characterName: string;
    workName: string;
    /** 親が区切りの設定を持っていれば渡す（無ければ保存済みの設定を読む） */
    danbooruTagFormat?: DanbooruTagFormat;
    uiCatalog?: I18NCatalog | null;
}

export const IdentityOutputPreview: React.FC<IdentityOutputPreviewProps> = ({
    backendUrl,
    active,
    characterName,
    workName,
    danbooruTagFormat,
    uiCatalog = null,
}) => {
    const { CHARACTER } = createComfyUIText(uiCatalog);
    const format = useDanbooruTagFormat(backendUrl, active, danbooruTagFormat);
    const joined = [characterName, workName].filter((v) => v.trim() !== '').join(', ');
    const comfyOutput = formatIdentityForComfyUI(joined, format);
    const apiOutput = formatForApiService(joined);

    return (
        <div className="space-y-0.5 text-xs" data-testid="identity-output-preview">
            <p className="text-gray-600">{CHARACTER.HELP.IDENTITY_OUTPUT_DESC}</p>
            <p className="text-gray-500">
                {CHARACTER.LABELS.OUTPUT_COMFYUI}:{' '}
                <code className="text-green-300 break-all">{comfyOutput || CHARACTER.LABELS.OUTPUT_EMPTY}</code>
            </p>
            <p className="text-gray-500">
                {CHARACTER.LABELS.OUTPUT_API}:{' '}
                <code className="text-pink-300 break-all">{apiOutput || CHARACTER.LABELS.OUTPUT_EMPTY}</code>
            </p>
        </div>
    );
};
