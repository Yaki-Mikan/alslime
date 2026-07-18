/**
 * ConfigEditorHub.tsx - 設定ファイルエディタ／画像生成統合設定のタブホスト
 *
 * 設定インポートエクスポート_設計.md §9 のタブ統合。
 * 支援者（FeatureComfyUI 有効）ならヘッダーにタブを出して両画面を切り替えられる。
 * 支援者でなければタブ自体を描画せず、従来どおり設定ファイルエディタ単独になる
 * （API 側でも tier を判定しているため、フロント出し分けは表示だけの責務）。
 */

import React, { useEffect, useState } from 'react';
import { FileText, Palette } from 'lucide-react';
import { ConfigEditorModal } from './ConfigEditorModal';
import { ComfyUIIntegratedSettingsModal } from '../comfyui/ComfyUIIntegratedSettingsModal';
import { resolveMessage, type I18NCatalog } from '../../api/i18n';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    backendUrl: string;
    uiCatalog?: I18NCatalog | null;
    // FeatureComfyUI の有効状態（Chat が保持する enabledFeatures 由来）。
    imageGenEnabled: boolean;
}

type Tab = 'config' | 'imageGen';

export const ConfigEditorHub: React.FC<Props> = ({
    isOpen,
    onClose,
    backendUrl,
    uiCatalog = null,
    imageGenEnabled,
}) => {
    const [tab, setTab] = useState<Tab>('config');

    // 開くたびに設定ファイルエディタ側から始める。
    useEffect(() => {
        if (isOpen) setTab('config');
    }, [isOpen]);

    const t = (key: string, fallback: string) => resolveMessage(uiCatalog, key, fallback);

    // 支援者のみタブを描画する（設計 §9: 支援者でなければタブも出ない）。
    const headerTabs = imageGenEnabled ? (
        <div className="inline-flex rounded-lg border border-gray-600 bg-gray-800/80 p-1">
            <button
                type="button"
                onClick={() => setTab('config')}
                className={`flex items-center gap-1.5 px-3 py-1 text-xs rounded transition-colors ${tab === 'config'
                    ? 'bg-green-800 text-green-100'
                    : 'text-gray-300 hover:bg-gray-700'}`}
            >
                <FileText size={13} />
                {t('configEditor.tab.files', '設定ファイル')}
            </button>
            <button
                type="button"
                onClick={() => setTab('imageGen')}
                className={`flex items-center gap-1.5 px-3 py-1 text-xs rounded transition-colors ${tab === 'imageGen'
                    ? 'bg-purple-800 text-purple-100'
                    : 'text-gray-300 hover:bg-gray-700'}`}
            >
                <Palette size={13} />
                {t('configEditor.tab.imageGen', '画像生成統合設定')}
            </button>
        </div>
    ) : null;

    return (
        <>
            <ConfigEditorModal
                isOpen={isOpen && tab === 'config'}
                onClose={onClose}
                backendUrl={backendUrl}
                uiCatalog={uiCatalog}
                headerTabs={headerTabs}
            />
            {imageGenEnabled && (
                <ComfyUIIntegratedSettingsModal
                    isOpen={isOpen && tab === 'imageGen'}
                    onClose={onClose}
                    backendUrl={backendUrl}
                    uiCatalog={uiCatalog}
                    headerTabs={headerTabs}
                />
            )}
        </>
    );
};
