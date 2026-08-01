/**
 * ConfigEditorHub.tsx - 設定ファイルエディタ／設定自動生成／画像生成統合設定のタブホスト
 *
 * 設定インポートエクスポート_設計.md §9 のタブ統合＋レビュー002対応 1章のタブ新設。
 * 「設定ファイル」「設定自動生成」は全ユーザー、「画像生成統合設定」は
 * 支援者（FeatureComfyUI 有効）のみ表示する。
 * 各子モーダルは常時マウントされるため、設定自動生成のジョブポーリングは
 * モーダルを閉じても継続する（レビュー002対応 7.2 の裏実行）。
 */

import React, { useEffect, useState } from 'react';
import { FileText, Palette, Bot } from 'lucide-react';
import { ConfigEditorModal } from './ConfigEditorModal';
import type { OpenFileRequest } from './ConfigEditorModal';
import { ConfigGenModal } from './ConfigGenModal';
import { ComfyUIIntegratedSettingsModal } from '../comfyui/ComfyUIIntegratedSettingsModal';
import { resolveMessage, type I18NCatalog } from '../../api/i18n';
import type { ApiProviderInstructionTarget } from '../../api/api-providers';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    backendUrl: string;
    uiCatalog?: I18NCatalog | null;
    // FeatureComfyUI の有効状態（Chat が保持する enabledFeatures 由来）。
    imageGenEnabled: boolean;
    openApiProviderInstruction?: ApiProviderInstructionTarget | null;
    onOpenApiProviderInstructionConsumed?: () => void;
}

type Tab = 'config' | 'configGen' | 'imageGen';

export const ConfigEditorHub: React.FC<Props> = ({
    isOpen,
    onClose,
    backendUrl,
    uiCatalog = null,
    imageGenEnabled,
    openApiProviderInstruction = null,
    onOpenApiProviderInstructionConsumed,
}) => {
    const [tab, setTab] = useState<Tab>('config');
    // 設定自動生成 → 設定ファイルタブへの「このファイルを開いて」要求（消費後に null へ戻る）。
    const [openFileRequest, setOpenFileRequest] = useState<OpenFileRequest | null>(null);

    // 開くたびに設定ファイルエディタ側から始める。
    useEffect(() => {
        if (isOpen) setTab('config');
    }, [isOpen]);

    const t = (key: string, fallback: string) => resolveMessage(uiCatalog, key, fallback);

    const tabButton = (target: Tab, icon: React.ReactNode, label: string, activeCls: string) => (
        <button
            type="button"
            onClick={() => setTab(target)}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs rounded transition-colors ${tab === target
                ? activeCls
                : 'text-gray-300 hover:bg-gray-700'}`}
        >
            {icon}
            {label}
        </button>
    );

    // 設定自動生成タブの追加により、タブは常時描画する（画像生成のみ支援者限定）。
    const headerTabs = (
        <div className="inline-flex rounded-lg border border-gray-600 bg-gray-800/80 p-1">
            {tabButton('config', <FileText size={13} />, t('configEditor.tab.files', '設定ファイル'), 'bg-green-800 text-green-100')}
            {tabButton('configGen', <Bot size={13} />, t('configGen.tab', '設定自動生成'), 'bg-purple-800 text-purple-100')}
            {imageGenEnabled && tabButton('imageGen', <Palette size={13} />, t('configEditor.tab.imageGen', '画像生成統合設定'), 'bg-purple-800 text-purple-100')}
        </div>
    );

    return (
        <>
            <ConfigEditorModal
                isOpen={isOpen && tab === 'config'}
                onClose={onClose}
                backendUrl={backendUrl}
                uiCatalog={uiCatalog}
                headerTabs={headerTabs}
                openFileRequest={openFileRequest}
                onOpenFileRequestConsumed={() => setOpenFileRequest(null)}
                openApiProviderInstruction={openApiProviderInstruction}
                onOpenApiProviderInstructionConsumed={onOpenApiProviderInstructionConsumed}
            />
            <ConfigGenModal
                isOpen={isOpen && tab === 'configGen'}
                onClose={onClose}
                backendUrl={backendUrl}
                uiCatalog={uiCatalog}
                headerTabs={headerTabs}
                onOpenInEditor={file => {
                    setOpenFileRequest({ categoryId: file.categoryId, dirName: file.dirName, fileName: file.fileName });
                    setTab('config');
                }}
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
