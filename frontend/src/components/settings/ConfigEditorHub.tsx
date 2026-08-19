/**
 * ConfigEditorHub.tsx - 設定ファイルエディタ／設定自動生成／画像生成統合設定のタブホスト
 *
 * 設定インポートエクスポート_設計.md §9 のタブ統合＋レビュー002対応 1章のタブ新設。
 * 「設定ファイル」「設定自動生成」は全ユーザー、「画像生成統合設定」は
 * 支援者（FeatureComfyUI 有効）のみ表示する。
 * 各子モーダルは常時マウントされるため、設定自動生成のジョブポーリングは
 * モーダルを閉じても継続する（レビュー002対応 7.2 の裏実行）。
 */

import React, { useState } from 'react';
import { AudioLines, FileText, Palette, Bot } from 'lucide-react';
import { ConfigEditorModal, COMFY_DIRECTIVE_CATEGORY_ID, CONFIG_GEN_INSTRUCTION_CATEGORY_ID } from './ConfigEditorModal';
import type { OpenFileRequest } from './ConfigEditorModal';
import { ConfigGenModal } from './ConfigGenModal';
import { ComfyUIIntegratedSettingsModal } from '../comfyui/ComfyUIIntegratedSettingsModal';
import { TTSIntegratedSettingsModal } from '../tts/TTSIntegratedSettingsModal';
import { resolveMessage, type I18NCatalog } from '../../api/i18n';
import type { ApiProviderInstructionTarget } from '../../api/api-providers';

// ConfigEditorTab は Hub のタブ識別子（開き元が初期タブを指定する際にも使う）。
export type ConfigEditorTab = 'config' | 'configGen' | 'imageGen' | 'tts';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    backendUrl: string;
    uiCatalog?: I18NCatalog | null;
    // FeatureComfyUI の有効状態（Chat が保持する enabledFeatures 由来）。
    imageGenEnabled: boolean;
    // FeatureTTS 有効かつ TTS 実体（サイドカー / in-process）連携済みの状態。
    // 要件（07 の4章）により、両方が揃わなければタブ・モーダルとも一切表示しない。
    ttsEnabled?: boolean;
    // 設定ファイルエディタの種別「画像生成分析指示」の表示可否
    //（ComfyUI機能が有効な支援レベル かつ モジュール連携済み。Chat 側で判定）。
    comfyDirectiveVisible?: boolean;
    // 開いた時に表示するタブ（未指定は設定ファイル）。
    // 設定メニューの画像生成設定からの導線が imageGen 指定で使う。
    initialTab?: ConfigEditorTab;
    openApiProviderInstruction?: ApiProviderInstructionTarget | null;
    onOpenApiProviderInstructionConsumed?: () => void;
    // 画像生成統合設定タブで初期選択するキャラクター名（会話設定のキャラ詳細
    // 設定横アイコンから imageGen 指定で開く導線用。空なら初期選択なし）。
    integratedInitialCharacter?: string;
}

type Tab = ConfigEditorTab;

export const ConfigEditorHub: React.FC<Props> = ({
    isOpen,
    onClose,
    backendUrl,
    uiCatalog = null,
    imageGenEnabled,
    ttsEnabled = false,
    comfyDirectiveVisible = false,
    initialTab = 'config',
    openApiProviderInstruction = null,
    onOpenApiProviderInstructionConsumed,
    integratedInitialCharacter = '',
}) => {
    const [tab, setTab] = useState<Tab>('config');
    // 設定自動生成 → 設定ファイルタブへの「このファイルを開いて」要求（消費後に null へ戻る）。
    const [openFileRequest, setOpenFileRequest] = useState<OpenFileRequest | null>(null);

    // 開くたびに指定タブ（既定は設定ファイルエディタ）から始める
    //（レンダー中の前回値比較で調整し、effect 内 setState による多段レンダーを避ける）。
    const [prevIsOpen, setPrevIsOpen] = useState(false);
    if (isOpen !== prevIsOpen) {
        setPrevIsOpen(isOpen);
        if (isOpen) setTab(initialTab);
    }

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
            {ttsEnabled && tabButton('tts', <AudioLines size={13} />, t('configEditor.tab.tts', 'TTS設定'), 'bg-orange-800 text-orange-100')}
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
                comfyDirectiveVisible={comfyDirectiveVisible}
            />
            <ConfigGenModal
                isOpen={isOpen && tab === 'configGen'}
                onClose={onClose}
                backendUrl={backendUrl}
                uiCatalog={uiCatalog}
                headerTabs={headerTabs}
                onOpenInEditor={(file, content) => {
                    // 左エディタで編集中の本文も持ち込む（設定ファイルタブ側でサーバー内容と比較して未保存扱いにする）。
                    setOpenFileRequest({ categoryId: file.categoryId, dirName: file.dirName, fileName: file.fileName, content });
                    setTab('config');
                }}
                onOpenInstructionInEditor={instructionId => {
                    // 設定ファイルタブへ切り替え、設定自動生成指示種別の該当ファイルを開く
                    setOpenFileRequest({ categoryId: CONFIG_GEN_INSTRUCTION_CATEGORY_ID, dirName: '', fileName: instructionId });
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
                    initialSelectedCharacter={integratedInitialCharacter || undefined}
                    onOpenDirectiveInEditor={comfyDirectiveVisible
                        ? directiveId => {
                            // 設定ファイルタブへ切り替え、画像生成分析指示種別の該当ファイルを開く
                            setOpenFileRequest({ categoryId: COMFY_DIRECTIVE_CATEGORY_ID, dirName: '', fileName: directiveId });
                            setTab('config');
                        }
                        : undefined}
                />
            )}
            {ttsEnabled && (
                <TTSIntegratedSettingsModal
                    isOpen={isOpen && tab === 'tts'}
                    onClose={onClose}
                    backendUrl={backendUrl}
                    uiCatalog={uiCatalog}
                    headerTabs={headerTabs}
                    initialSelectedCharacter={integratedInitialCharacter || undefined}
                />
            )}
        </>
    );
};
