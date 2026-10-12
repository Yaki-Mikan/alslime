/**
 * MaterialView.tsx - 素材づくり
 *
 * キャラや場面の素材（設定ファイル・キャラ・声・タグ・ワークフロー）を作る画面。
 * キャラはキャラごとの画像の設定と声の紐づけ、声は声そのものの登録。
 * 設定ファイルと設定自動生成は窓の外枠を外して埋め込み、画面を離れても部品は残す
 *（設定自動生成の進み具合の読み取りを続けるため。呼び出し側は一度開いたら隠すだけにする）。
 */
import React, { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { resolveMessage, type I18NCatalog } from '../../api/i18n';
import type { ApiProviderInstructionTarget } from '../../api/api-providers';
import { MATERIAL_I18N_KEYS, MATERIAL_TEXT_FALLBACK_JA } from '../../constants/i18n';
import { useAppearancePromptGen } from '../../hooks/useAppearancePromptGen';
import { Button, Segmented } from '../ui';
import { ConfigEditorModal } from '../settings/ConfigEditorModal';
import type { OpenFileRequest } from '../settings/ConfigEditorModal';
import { AiCreatePanel } from './files/AiCreatePanel';
import { CharacterImagesTab, type CharacterSection } from './images/CharacterImagesTab';
import { TTSSettingsPanel } from '../settings/sections/media/TTSSettingsPanel';
import { TagMappingTab } from './tags/TagMappingTab';
import { WorkflowTab } from './workflow/WorkflowTab';

export type MaterialTab = 'files' | 'images' | 'voice' | 'tags' | 'workflow';

/** 素材づくりをどのタブ・どのファイルで開くかの依頼。受け取ったら onRequestConsumed で消してもらう */
export interface MaterialRequest {
    tab: MaterialTab;
    /** 設定ファイルのタブで開くファイル */
    openFile?: OpenFileRequest;
    /** API 接続先の指示ファイルを開く */
    apiProviderInstruction?: ApiProviderInstructionTarget;
    /** キャラのタブで選ぶキャラ（キャラ名） */
    character?: string;
    /** キャラのタブで、選ぶキャラと一緒に開く区画 */
    section?: CharacterSection;
}

interface MaterialViewProps {
    backendUrl: string;
    uiCatalog: I18NCatalog | null;
    /** 画像生成が使える（支援者の権利とモジュールの両方がそろっている） */
    imageGenEnabled: boolean;
    /** 読み上げが使える（同上） */
    ttsEnabled: boolean;
    /** 設定ファイルの種別「画像生成分析指示」を出すか */
    comfyDirectiveVisible: boolean;
    /** 画面を見せているか（隠している間は中の窓を閉じる） */
    active: boolean;
    request: MaterialRequest | null;
    onRequestConsumed: () => void;
    /** 今の会話の参加キャラ（キャラ一覧の固定の段に出す） */
    sessionCharacterPaths: string[];
}

export const MaterialView: React.FC<MaterialViewProps> = ({
    backendUrl,
    uiCatalog,
    imageGenEnabled,
    ttsEnabled,
    comfyDirectiveVisible,
    active,
    request,
    onRequestConsumed,
    sessionCharacterPaths,
}) => {
    const t = (key: string, fallback?: string) => resolveMessage(uiCatalog, key, fallback || MATERIAL_TEXT_FALLBACK_JA[key] || key);
    const [selectedTab, setTab] = useState<MaterialTab>('files');
    // 設定ファイルのタブの中で、本文の編集（editor）と AI で作る（gen）を切り替える
    const [filesMode, setFilesMode] = useState<'editor' | 'gen'>('editor');
    const [openFileRequest, setOpenFileRequest] = useState<OpenFileRequest | null>(null);
    const [apiProviderInstruction, setApiProviderInstruction] = useState<ApiProviderInstructionTarget | null>(null);
    const [initialCharacter, setInitialCharacter] = useState('');
    const [initialSection, setInitialSection] = useState<CharacterSection | undefined>(undefined);
    // キャラの見た目からプロンプトを作る小窓の状態。設定ファイルとキャラ画像の両方で使い、閉じても分析は続く
    const appearancePrompt = useAppearancePromptGen(backendUrl);

    // 使えなくなったタブ（支援者の権利が切れた・モジュールが止まった）は設定ファイルとして見せる
    const imageTabs: MaterialTab[] = ['tags', 'workflow'];
    const tab: MaterialTab = (!imageGenEnabled && imageTabs.includes(selectedTab))
        || (!ttsEnabled && selectedTab === 'voice')
        || (!imageGenEnabled && !ttsEnabled && selectedTab === 'images')
        ? 'files'
        : selectedTab;

    // 外からの依頼（会話設定のキャラ詳細・設定画面など）を受け取る
    useEffect(() => {
        if (!request) return;
        setTab(request.tab);
        if (request.openFile) {
            setOpenFileRequest(request.openFile);
            setFilesMode('editor');
        }
        if (request.apiProviderInstruction) {
            setApiProviderInstruction(request.apiProviderInstruction);
            setFilesMode('editor');
        }
        if (request.character !== undefined) {
            setInitialCharacter(request.character);
            setInitialSection(request.section);
        }
        onRequestConsumed();
        // 依頼を受け取ったときだけ動かす
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [request]);

    const tabs: { value: MaterialTab; label: string }[] = [
        { value: 'files', label: t(MATERIAL_I18N_KEYS.tabFiles) },
        ...(imageGenEnabled || ttsEnabled ? [{ value: 'images' as const, label: t(MATERIAL_I18N_KEYS.tabImages) }] : []),
        ...(ttsEnabled ? [{ value: 'voice' as const, label: t(MATERIAL_I18N_KEYS.tabVoice) }] : []),
        ...(imageGenEnabled ? [
            { value: 'tags' as const, label: t(MATERIAL_I18N_KEYS.tabTags) },
            { value: 'workflow' as const, label: t(MATERIAL_I18N_KEYS.tabWorkflow) },
        ] : []),
    ];

    const filesVisible = active && tab === 'files';
    // キャラのタブは一度開いてから組み込む（開くまでキャラ一覧や集計を読まない）。一度組み込んだら隠すだけにする
    const [imagesMounted, setImagesMounted] = useState(false);
    if (active && tab === 'images' && !imagesMounted) setImagesMounted(true);
    const [voiceMounted, setVoiceMounted] = useState(false);
    if (active && tab === 'voice' && !voiceMounted) setVoiceMounted(true);
    const [tagsMounted, setTagsMounted] = useState(false);
    if (active && tab === 'tags' && !tagsMounted) setTagsMounted(true);
    const [workflowMounted, setWorkflowMounted] = useState(false);
    if (active && tab === 'workflow' && !workflowMounted) setWorkflowMounted(true);

    return (
        <div className="flex-1 min-h-0 flex flex-col">
            <header className="shrink-0 flex flex-wrap items-center gap-x-5 gap-y-2 px-4 sm:px-6 py-3 border-b border-line">
                <h1 className="font-head text-base font-bold tracking-wide">{t(MATERIAL_I18N_KEYS.title)}</h1>
                {tabs.length > 1 && (
                    <Segmented<MaterialTab> label={t(MATERIAL_I18N_KEYS.title)} value={tab} onChange={setTab} options={tabs} />
                )}
            </header>

            {/* 設定ファイル：本文の編集と AI で作るを切り替える */}
            <ConfigEditorModal
                isOpen={filesVisible && filesMode === 'editor'}
                backendUrl={backendUrl}
                uiCatalog={uiCatalog}
                headerActions={(
                    <Button size="sm" variant="primary" onClick={() => setFilesMode('gen')}>
                        <Sparkles size={14} />
                        {t(MATERIAL_I18N_KEYS.aiCreate)}
                    </Button>
                )}
                openFileRequest={openFileRequest}
                onOpenFileRequestConsumed={() => setOpenFileRequest(null)}
                openApiProviderInstruction={apiProviderInstruction}
                onOpenApiProviderInstructionConsumed={() => setApiProviderInstruction(null)}
                comfyDirectiveVisible={comfyDirectiveVisible}
                imageGenEnabled={imageGenEnabled}
                ttsEnabled={ttsEnabled}
                appearancePrompt={imageGenEnabled ? appearancePrompt : undefined}
            />
            <AiCreatePanel
                active={filesVisible && filesMode === 'gen'}
                backendUrl={backendUrl}
                uiCatalog={uiCatalog}
                onClose={() => setFilesMode('editor')}
                onOpenInEditor={(file, content) => {
                    setOpenFileRequest({ categoryId: file.categoryId, dirName: file.dirName, fileName: file.fileName, content });
                    setFilesMode('editor');
                }}
            />

            {(imageGenEnabled || ttsEnabled) && imagesMounted && (
                <CharacterImagesTab
                    backendUrl={backendUrl}
                    uiCatalog={uiCatalog}
                    active={active && tab === 'images'}
                    imageGenEnabled={imageGenEnabled}
                    ttsEnabled={ttsEnabled}
                    sessionCharacterPaths={sessionCharacterPaths}
                    initialCharacter={tab === 'images' ? initialCharacter : undefined}
                    initialSection={tab === 'images' ? initialSection : undefined}
                    appearancePrompt={appearancePrompt}
                    onOpenFile={c => {
                        setOpenFileRequest({ categoryId: 'character', dirName: c.dirName, fileName: c.name });
                        setFilesMode('editor');
                        setTab('files');
                    }}
                />
            )}

            {/* 声：声そのものの登録（一覧・試聴・削除・参照音声からの登録） */}
            {ttsEnabled && voiceMounted && (
                <div className={active && tab === 'voice' ? 'flex-1 min-h-0 overflow-y-auto p-4 sm:p-6' : 'hidden'}>
                    <div className="max-w-7xl">
                        <TTSSettingsPanel backendUrl={backendUrl} uiCatalog={uiCatalog} active={active && tab === 'voice'} part="voices" />
                    </div>
                </div>
            )}

            {imageGenEnabled && tagsMounted && (
                <TagMappingTab backendUrl={backendUrl} uiCatalog={uiCatalog} active={active && tab === 'tags'} />
            )}

            {imageGenEnabled && workflowMounted && (
                <WorkflowTab backendUrl={backendUrl} uiCatalog={uiCatalog} active={active && tab === 'workflow'} />
            )}
        </div>
    );
};

export default MaterialView;
