/**
 * ConfigEditorHub.tsx - 設定ファイルエディタ／設定自動生成／画像生成統合設定のタブホスト
 *
 * 設定インポートエクスポート_設計.md §9 のタブ統合＋レビュー002対応 1章のタブ新設。
 * 「設定ファイル」「設定自動生成」は全ユーザー、「画像生成統合設定」は
 * 支援者（FeatureComfyUI 有効）かつ ComfyUI 連携済みのときのみ表示する。
 * 各子モーダルは常時マウントされるため、設定自動生成のジョブポーリングは
 * モーダルを閉じても継続する（レビュー002対応 7.2 の裏実行）。
 */

import React, { useState, useEffect } from 'react';
import { AudioLines, FileText, Palette, Bot } from 'lucide-react';
import { ConfigEditorModal, COMFY_DIRECTIVE_CATEGORY_ID, CONFIG_GEN_INSTRUCTION_CATEGORY_ID } from './ConfigEditorModal';
import type { OpenFileRequest } from './ConfigEditorModal';
import { ConfigGenModal } from './ConfigGenModal';
import { ComfyUIIntegratedSettingsModal } from '../comfyui/ComfyUIIntegratedSettingsModal';
import { TTSIntegratedSettingsModal } from '../tts/TTSIntegratedSettingsModal';
import { resolveMessage, type I18NCatalog } from '../../api/i18n';
import { useIsWideScreen } from '../../hooks/useIsWideScreen';
import { useAppearancePromptGen } from '../../hooks/useAppearancePromptGen';
import type { ApiProviderInstructionTarget } from '../../api/api-providers';

// ConfigEditorTab は Hub のタブ識別子（開き元が初期タブを指定する際にも使う）。
export type ConfigEditorTab = 'config' | 'configGen' | 'imageGen' | 'tts';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    backendUrl: string;
    uiCatalog?: I18NCatalog | null;
    // FeatureComfyUI 有効かつ ComfyUI 実体（サイドカー / in-process）連携済みの状態。
    // false のときは画像生成タブ・画像生成統合設定・容姿プロンプト作成を一切描画しない。
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
    // 開いた時に設定ファイルタブで開くファイル（会話設定のキャラ詳細横アイコンからの導線）。
    // 消費したら onInitialOpenFileConsumed で null に戻してもらう。
    initialOpenFile?: OpenFileRequest | null;
    onInitialOpenFileConsumed?: () => void;
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
    initialOpenFile = null,
    onInitialOpenFileConsumed,
    openApiProviderInstruction = null,
    onOpenApiProviderInstructionConsumed,
    integratedInitialCharacter = '',
}) => {
    const [tab, setTab] = useState<Tab>('config');
    // 設定自動生成 → 設定ファイルタブへの「このファイルを開いて」要求（消費後に null へ戻る）。
    const [openFileRequest, setOpenFileRequest] = useState<OpenFileRequest | null>(null);
    // 外部（会話設定）から「このファイルを開いて」と指定された場合は設定ファイルタブで開く
    useEffect(() => {
        if (!isOpen || !initialOpenFile) return;
        setOpenFileRequest(initialOpenFile);
        setTab('config');
        onInitialOpenFileConsumed?.();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, initialOpenFile]);

    // 開くたびに指定タブ（既定は設定ファイルエディタ）から始める
    //（レンダー中の前回値比較で調整し、effect 内 setState による多段レンダーを避ける）。
    const [prevIsOpen, setPrevIsOpen] = useState(false);
    if (isOpen !== prevIsOpen) {
        setPrevIsOpen(isOpen);
        if (isOpen) setTab(initialTab);
    }
    // 開いている途中で画像生成が使えなくなった（権利失効・モジュール停止）ときは
    // 何も描画されない画像生成タブに留まらず、設定ファイルタブへ戻す。
    if (!imageGenEnabled && tab === 'imageGen') {
        setTab('config');
    }
    // TTS も同じく、開いている途中で使えなくなった（権利失効・モジュール停止）ときは
    // 何も描画されない TTS タブに留まらず、設定ファイルタブへ戻す。
    if (!ttsEnabled && tab === 'tts') {
        setTab('config');
    }

    const t = (key: string, fallback: string) => resolveMessage(uiCatalog, key, fallback);
    const isWideScreen = useIsWideScreen();
    // キャラクター容姿プロンプト作成の小窓の状態。設定ファイルエディタ（画像生成設定区画）と
    // 画像生成統合設定の両方から同じものを使う。Hub は常時マウントなので、区画の開閉や
    // タブ切替、小窓を閉じても分析は続く。
    const appearancePrompt = useAppearancePromptGen(backendUrl);

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

    // 狭画面ではタブを並べる幅が無いのでプルダウンで切り替える
    const tabOptions: Array<[Tab, string]> = [
        ['config', t('configEditor.tab.files', '設定ファイル')],
        ['configGen', t('configGen.tab', '設定自動生成')],
        ...(imageGenEnabled ? [['imageGen', t('configEditor.tab.imageGen', '画像生成統合設定')] as [Tab, string]] : []),
        ...(ttsEnabled ? [['tts', t('configEditor.tab.tts', 'TTS設定')] as [Tab, string]] : []),
    ];
    // 設定自動生成タブの追加により、タブは常時描画する（画像生成のみ支援者限定）。
    const headerTabs = !isWideScreen ? (
        <select
            value={tab}
            onChange={e => setTab(e.target.value as Tab)}
            className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-gray-500"
        >
            {tabOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
    ) : (
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
                imageGenEnabled={imageGenEnabled}
                ttsEnabled={ttsEnabled}
                appearancePrompt={imageGenEnabled ? appearancePrompt : undefined}
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
                    appearancePrompt={appearancePrompt}
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
