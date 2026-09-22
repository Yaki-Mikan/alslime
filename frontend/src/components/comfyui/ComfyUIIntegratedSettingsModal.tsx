/**
 * ComfyUIIntegratedSettingsModal.tsx - 画像生成統合設定モーダル
 *
 * キャラクター画像生成設定・タグマッピング設定・画像生成テストを
 * 1つの大型モーダルに統合し、テスト生成しながら設定を調整・保存できる。
 * PC環境専用（横幅1280px以上）。
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X, ChevronDown, ChevronRight, Users, Tag, Palette, FileText, Workflow, User } from 'lucide-react';
import { useIsWideScreen } from '../../hooks/useIsWideScreen';
import { CollapsibleSectionHeader } from '../common/CollapsibleSectionHeader';
import {
    getCharacterImageGenConfig,
    saveCharacterImageGenConfig,
    getLoraTriggerWords,
    getComfyUIConfig,
    saveComfyUIConfig,
    listComfyUITemplates,
    listApiServicePresets,
} from '../../api/comfyui';
import { useComfyLoras } from './useComfyLoras';
import { withTrailingEmptyLora } from './loraEntries';
import type { CharacterImageGenConfig, TemplateInfo, ApiServiceId, ImageBackend, NovelAIPreset } from '../../api/comfyui';
import { BackendTabs, type BackendSelection } from './BackendTabs';
import { UserAppearanceSection } from './apiservice/UserAppearanceSection';
import { NovelAIPresetSection } from './apiservice/NovelAIPresetSection';
import { ApiServiceModelSelect } from './apiservice/ApiServiceModelSelect';
import { AutoSoundEffectsToggle } from './apiservice/AutoSoundEffectsToggle';
import type { DanbooruTagFormat, TriggerWordFormat } from '../../api/comfyui';
import { getCharacterTags } from '../../api/files';
import type { CharacterTagInfo } from '../../api/files';
import { createComfyUIText } from './i18n';
import type { I18NCatalog } from '../../api/i18n';
import { IntegratedDanbooruSearch } from './integrated/IntegratedDanbooruSearch';
import { IntegratedCharacterSection } from './integrated/IntegratedCharacterSection';
import { IntegratedTagMappingSection } from './integrated/IntegratedTagMappingSection';
import { IntegratedGenerateTestSection } from './integrated/IntegratedGenerateTestSection';
import { IntegratedWorkflowSection } from './integrated/IntegratedWorkflowSection';
import { IntegratedDirectiveSection } from './integrated/IntegratedDirectiveSection';
import { TagJudgeWorkflowPanel } from './TagJudgeWorkflowPanel';
import { CollapsibleSection } from '../settings/CollapsibleSection';
import { resolveMessage } from '../../api/i18n';
import { useDanbooruTagFormat } from './useDanbooruTagFormat';
import { useTriggerWordFormat } from './useTriggerWordFormat';
import { useAppearancePromptGen, type AppearancePromptHandle } from '../../hooks/useAppearancePromptGen';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    backendUrl: string;
    initialSelectedCharacter?: string;
    danbooruTagFormat?: DanbooruTagFormat;
    uiCatalog?: I18NCatalog | null;
    // タブ統合（設計 §9）: 設定ファイルエディタとのタブ切り替え UI をヘッダーへ差し込む。
    // 未指定なら従来どおり単独モーダルとして表示する。
    headerTabs?: React.ReactNode;
    // タグ判定指示ファイルを設定ファイルエディタで開く（Hub が config タブへ切り替えて
    // 該当ファイルを開いた状態にする。未指定ならボタンは表示しない）。
    onOpenDirectiveInEditor?: (directiveId: string) => void;
    // キャラクター容姿プロンプト作成の小窓の状態（Hub が持つ。キャラクター画像生成設定へ流す）。
    appearancePrompt?: AppearancePromptHandle;
}

const DEFAULT_CONFIG: CharacterImageGenConfig = {
    characterName: '',
    workName: '',
    aliases: [],
    characterPrompt: '',
    physicalFeatures: '',
    lora: [],
    outfits: [],
    extraPositive: '',
    extraNegative: '',
};

export const ComfyUIIntegratedSettingsModal: React.FC<Props> = ({
    isOpen,
    onClose,
    backendUrl,
    initialSelectedCharacter,
    danbooruTagFormat,
    uiCatalog = null,
    headerTabs,
    onOpenDirectiveInEditor,
    appearancePrompt,
}) => {
    const { INTEGRATED_SETTINGS_TITLE, COMMON, DANBOORU, SECTION_NAMES } = createComfyUIText(uiCatalog);
    // ===== セクション開閉 =====
    const isWideScreen = useIsWideScreen();
    // 狭画面で縦積みにした時の右側（ワークフロー＋テスト生成）の開閉
    const [rightOpen, setRightOpen] = useState(true);
    const showRight = isWideScreen || rightOpen;
    const [isCharacterOpen, setIsCharacterOpen] = useState(true);
    const [isTagMappingOpen, setIsTagMappingOpen] = useState(true);
    const [isDirectiveOpen, setIsDirectiveOpen] = useState(false);

    // ===== キャラクター設定（リフトアップ: テスト生成に渡すため） =====
    const [characters, setCharacters] = useState<CharacterTagInfo[]>([]);
    const [selectedCharacter, setSelectedCharacter] = useState('');
    const [charConfig, setCharConfig] = useState<CharacterImageGenConfig>({ ...DEFAULT_CONFIG });
    const [charIsDirty, setCharIsDirty] = useState(false);
    const [charIsLoading, setCharIsLoading] = useState(false);
    // 容姿プロンプト作成の小窓の状態。親から渡されない開き方（ロールプレイ設定から直接開く等）では
    // この画面で持つ。
    const ownAppearancePrompt = useAppearancePromptGen(backendUrl);
    const effectiveAppearancePrompt = appearancePrompt ?? ownAppearancePrompt;

    // ===== LoRA一覧（未接続時の扱いは useComfyLoras に集約） =====
    const {
        lorasByCategory,
        comfyUnreachable,
        retry: handleRefreshLoras,
    } = useComfyLoras(backendUrl, ['character', 'outfit'], isOpen);
    const availableLoras = lorasByCategory['character'] ?? [];
    const availableOutfitLoras = lorasByCategory['outfit'] ?? [];

    // ===== テスト生成連動 =====
    const [useLeftCharacter, setUseLeftCharacter] = useState(true);

    // ===== 画像生成バックエンド（全画面共用・即時保存）と API サービス側の状態 =====
    const [imageBackend, setImageBackend] = useState<ImageBackend>('comfyui');
    const [apiService, setApiService] = useState<ApiServiceId>('novelai');
    const [apiPresets, setApiPresets] = useState<NovelAIPreset[]>([]);
    const [selectedPreset, setSelectedPreset] = useState('');
    // 使用モデル（全体の設定の値。モデル選択の部品が読み書きし、ここは表示と連動のために持つ）
    const [apiModelId, setApiModelId] = useState('');
    const [isApiModelSaving, setIsApiModelSaving] = useState(false);
    const [isUserAppearanceOpen, setIsUserAppearanceOpen] = useState(true);
    const isApi = imageBackend === 'api';
    const handleBackendChange = useCallback((selection: BackendSelection) => {
        setImageBackend(selection.imageBackend);
        setApiService(selection.apiService);
    }, []);
    const reloadApiPresets = useCallback(async () => {
        try {
            setApiPresets(await listApiServicePresets(backendUrl, apiService));
        } catch (error) {
            console.error('[ComfyUIIntegratedSettingsModal] api presets load failed:', error);
        }
    }, [backendUrl, apiService]);
    useEffect(() => {
        if (!isOpen || !isApi) return;
        void reloadApiPresets();
    }, [isOpen, isApi, reloadApiPresets]);

    // ===== ワークフロー選択（独立セクション。テスト生成と共有） =====
    const [templates, setTemplates] = useState<TemplateInfo[]>([]);
    const [selectedTemplate, setSelectedTemplate] = useState('');

    // テンプレート一覧を再取得し、選択状態を補正する
    // （現選択が有効ならそのまま、無効ならデフォルト設定→先頭の順にフォールバック）
    const reloadTemplates = useCallback(async () => {
        try {
            const [templateList, config] = await Promise.all([
                listComfyUITemplates(backendUrl),
                getComfyUIConfig(backendUrl),
            ]);
            setTemplates(templateList);
            setSelectedTemplate(prev => {
                if (prev && templateList.some(t => t.name === prev)) return prev;
                const savedDefault = config.defaultTemplateId || '';
                if (savedDefault && templateList.some(t => t.name === savedDefault)) return savedDefault;
                return templateList.length > 0 ? templateList[0].name : '';
            });
        } catch (error) {
            console.error('[ComfyUIIntegratedSettingsModal] template reload failed:', error);
        }
    }, [backendUrl]);

    // ===== フォーマット設定（統合画面内で即時保存） =====
    // override に渡すことで、変更後はこの state 値が下位へ即反映される。
    const [danbooruFormatOverride, setDanbooruFormatOverride] = useState<DanbooruTagFormat | undefined>(danbooruTagFormat);
    const [triggerFormatOverride, setTriggerFormatOverride] = useState<TriggerWordFormat | undefined>(undefined);
    const effectiveDanbooruTagFormat = useDanbooruTagFormat(backendUrl, isOpen, danbooruFormatOverride);
    const effectiveTriggerWordFormat = useTriggerWordFormat(backendUrl, isOpen, triggerFormatOverride);

    // 起動時に現在のフォーマット設定を読み込む（override 未指定なら config 値で初期化）
    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        (async () => {
            try {
                const config = await getComfyUIConfig(backendUrl);
                if (cancelled) return;
                if (danbooruTagFormat === undefined) setDanbooruFormatOverride(config.danbooruTagFormat || 'underscore');
                setTriggerFormatOverride(config.triggerWordFormat || 'raw');
            } catch { /* 読み込み失敗時はフックの既定にフォールバック */ }
        })();
        return () => { cancelled = true; };
    }, [isOpen, backendUrl, danbooruTagFormat]);

    // フォーマット変更時の即時保存（config 全体を読み直して該当値だけ差し替えて PUT）
    const persistFormat = useCallback(async (patch: { danbooruTagFormat?: DanbooruTagFormat; triggerWordFormat?: TriggerWordFormat }) => {
        try {
            const config = await getComfyUIConfig(backendUrl);
            await saveComfyUIConfig(backendUrl, { ...config, ...patch });
        } catch { /* 保存失敗は握りつぶし（UI状態は維持） */ }
    }, [backendUrl]);

    const handleChangeDanbooruFormat = useCallback((fmt: DanbooruTagFormat) => {
        setDanbooruFormatOverride(fmt);
        void persistFormat({ danbooruTagFormat: fmt });
    }, [persistFormat]);

    const handleChangeTriggerFormat = useCallback((fmt: TriggerWordFormat) => {
        setTriggerFormatOverride(fmt);
        void persistFormat({ triggerWordFormat: fmt });
    }, [persistFormat]);

    // 初期データ取得（LoRA 一覧は useComfyLoras が isOpen に追従して取得する）
    useEffect(() => {
        if (!isOpen) return;
        (async () => {
            try {
                const charResult = await getCharacterTags();
                setCharacters(charResult.characters);
            } catch (error) {
                console.error('[ComfyUIIntegratedSettingsModal] character list load failed:', error);
            }
        })();
        void reloadTemplates();
    }, [isOpen, backendUrl, reloadTemplates]);

    // キャラ名 → ディレクトリ名変換（画像生成設定の保存/読み込みはディレクトリ名を使う）
    const getCharDirName = useCallback((name: string) => {
        // 一覧に無い名前は版サフィックス（`_v3` 等）を剥がしてディレクトリ名とみなす
        //（存在しない `キャラ名_v3` ディレクトリを作らない）。
        return characters.find(c => c.name === name)?.dirName || name.replace(/_v\d+$/, '');
    }, [characters]);

    const resolveCharacterName = useCallback((name: string) => {
        const normalized = name.trim();
        if (!normalized) return '';
        return characters.find(c => c.name === normalized || c.dirName === normalized)?.name || normalized;
    }, [characters]);

    // キャラ設定読み込み
    const loadCharConfig = useCallback(async (name: string) => {
        if (!name) {
            setCharConfig({ ...DEFAULT_CONFIG });
            setCharIsDirty(false);
            return;
        }
        setCharIsLoading(true);
        try {
            const loaded = await getCharacterImageGenConfig(backendUrl, getCharDirName(name));
            loaded.lora = withTrailingEmptyLora(loaded.lora);
            if (!loaded.outfits) {
                loaded.outfits = [];
            }
            loaded.outfits = loaded.outfits.map(outfit => ({
                ...outfit,
                lora: withTrailingEmptyLora(outfit.lora),
            }));
            setCharConfig(loaded);
            setCharIsDirty(false);
        } catch {
            setCharConfig({ ...DEFAULT_CONFIG });
        } finally {
            setCharIsLoading(false);
        }
    }, [backendUrl, getCharDirName]);

    const handleCharacterChange = useCallback((name: string) => {
        setSelectedCharacter(name);
        loadCharConfig(name);
    }, [loadCharConfig]);

    // 指定キャラの初期選択は開くたびに一度だけ適用する（開いた後のユーザーの
    // 選択変更を指定キャラへ引き戻さないため。閉じたら次回開く時に再適用）。
    const initialCharacterAppliedRef = useRef(false);
    useEffect(() => {
        if (!isOpen) {
            initialCharacterAppliedRef.current = false;
            return;
        }
        if (initialCharacterAppliedRef.current) return;
        if (characters.length === 0) return;
        const resolvedName = initialSelectedCharacter ? resolveCharacterName(initialSelectedCharacter) : '';
        if (resolvedName && selectedCharacter !== resolvedName) {
            handleCharacterChange(resolvedName);
        } else if (selectedCharacter && !charIsDirty) {
            // 同じキャラで開き直したときも読み直す（閉じている間に別の画面で保存された内容を出すため）。
            // 未保存の編集があるときは、それを残す。
            loadCharConfig(selectedCharacter);
        }
        initialCharacterAppliedRef.current = true;
    }, [isOpen, initialSelectedCharacter, characters, resolveCharacterName, selectedCharacter, handleCharacterChange, charIsDirty, loadCharConfig]);

    const updateCharConfig = useCallback(<K extends keyof CharacterImageGenConfig>(
        key: K,
        value: CharacterImageGenConfig[K]
    ) => {
        setCharConfig(prev => ({ ...prev, [key]: value }));
        setCharIsDirty(true);
    }, []);

    // キャラ設定保存
    const handleSaveCharConfig = useCallback(async () => {
        if (!selectedCharacter) return;
        try {
            const cleanConfig = {
                ...charConfig,
                lora: charConfig.lora.filter(l => l.name),
                outfits: charConfig.outfits
                    .map(outfit => ({
                        ...outfit,
                        name: outfit.name.trim(),
                        prompt: outfit.prompt.trim(),
                        lora: outfit.lora.filter(l => l.name),
                    }))
                    .filter(outfit => outfit.name || outfit.prompt || outfit.lora.length > 0),
            };
            await saveCharacterImageGenConfig(backendUrl, getCharDirName(selectedCharacter), cleanConfig);
            setCharIsDirty(false);
            return true;
        } catch (error) {
            console.error('[ComfyUIIntegratedSettingsModal] character config save failed:', error);
            return false;
        }
    }, [backendUrl, selectedCharacter, charConfig, getCharDirName]);

    // トリガーワード取得
    const handleFetchTriggerWords = useCallback(async (loraName: string) => {
        if (!loraName) return null;
        try {
            const result = await getLoraTriggerWords(backendUrl, loraName);
            if (result.success) {
                const lines = (result.triggerLines && result.triggerLines.length > 0)
                    ? result.triggerLines
                    : (result.triggerWords.length > 0 ? [result.triggerWords.join(', ')] : []);
                return { words: result.triggerWords, lines };
            }
        } catch { /* 無視 */ }
        return null;
    }, [backendUrl]);

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm"
        >
            <div
                className="bg-gray-900 rounded-xl shadow-2xl border border-gray-700 overflow-hidden flex flex-col"
                style={{ width: '90vw', height: '90vh' }}
            >
                {/* ヘッダー */}
                <div className={`flex justify-between gap-3 px-6 py-4 border-b border-gray-700 bg-gray-800 shrink-0 ${isWideScreen ? 'items-center' : 'items-start'}`}>
                    <div className={isWideScreen ? 'flex items-center gap-4' : 'flex flex-col gap-2 flex-1 min-w-0'}>
                        <h2 className="text-lg font-semibold text-gray-100 flex items-center gap-2">
                            <Palette size={20} className="text-purple-400" />
                            {INTEGRATED_SETTINGS_TITLE}
                        </h2>
                        {headerTabs}
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 hover:bg-gray-700 rounded text-gray-400 hover:text-gray-200 transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* 画像生成バックエンドの切替（全画面共用・即時保存）。API 側は直下にサービスの選択 */}
                <div className="px-6 py-2 border-b border-gray-700 bg-gray-800/60 shrink-0">
                    <BackendTabs
                        backendUrl={backendUrl}
                        uiCatalog={uiCatalog}
                        active={isOpen}
                        onChange={handleBackendChange}
                        initial={{ imageBackend, apiService }}
                        compact
                    />
                </div>

                {/* メインコンテンツ: 左右分割（狭画面では縦積み） */}
                <div className={isWideScreen ? 'flex flex-1 overflow-hidden' : 'flex flex-col flex-1 overflow-y-auto'}>
                    {/* ===== 左側: 設定エリア（スクロール可） ===== */}
                    <div className={isWideScreen ? 'w-1/2 overflow-y-auto custom-scrollbar border-r border-gray-700 p-5 space-y-4' : 'shrink-0 border-b border-gray-700 p-5 space-y-4'}>
                        {/* タグ・トリガーワード形式設定（即時保存。API サービスでは区切りが固定のため非表示） */}
                        {!isApi && (
                        <div className="border border-gray-700 rounded-lg p-4 bg-gray-800/30 space-y-3">
                            <div className="flex items-center gap-2 text-sm font-medium text-gray-400">
                                <Tag size={16} className="text-green-400" />
                                {SECTION_NAMES.TAG_TRIGGER_FORMAT}
                            </div>
                            {!isWideScreen ? (
                            /* 狭画面: ラベルの下にプルダウンを縦に並べる */
                            <div className="flex flex-col gap-3">
                                <div>
                                    <span className="block text-xs text-gray-500 mb-1">{DANBOORU.LABELS.DANBOORU_TAGS}</span>
                                    <select
                                        value={effectiveDanbooruTagFormat}
                                        onChange={e => handleChangeDanbooruFormat(e.target.value as DanbooruTagFormat)}
                                        className="w-full min-w-0 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 outline-none focus:border-green-500"
                                    >
                                        <option value="underscore">{COMMON.MESSAGES.UNDERSCORE}</option>
                                        <option value="space">{COMMON.MESSAGES.SPACE}</option>
                                        <option value="anima">{COMMON.MESSAGES.ANIMA}</option>
                                    </select>
                                </div>
                                <div>
                                    <span className="block text-xs text-gray-500 mb-1">{DANBOORU.LABELS.TRIGGER_WORDS}</span>
                                    <select
                                        value={effectiveTriggerWordFormat}
                                        onChange={e => handleChangeTriggerFormat(e.target.value as TriggerWordFormat)}
                                        className="w-full min-w-0 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 outline-none focus:border-cyan-500"
                                    >
                                        <option value="raw">{COMMON.MESSAGES.RAW}</option>
                                        <option value="underscore">{COMMON.MESSAGES.UNDERSCORE}</option>
                                        <option value="space">{COMMON.MESSAGES.SPACE}</option>
                                        <option value="anima">{COMMON.MESSAGES.ANIMA}</option>
                                    </select>
                                </div>
                            </div>
                            ) : (
                            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                                {/* Danbooruタグ形式（2択） */}
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-gray-500 w-24 shrink-0">{DANBOORU.LABELS.DANBOORU_TAGS}</span>
                                    <div className="inline-flex rounded-lg border border-gray-700 bg-gray-800 p-1">
                                        <button type="button" onClick={() => handleChangeDanbooruFormat('underscore')}
                                            className={`px-3 py-1 text-xs rounded transition-colors ${effectiveDanbooruTagFormat === 'underscore' ? 'bg-green-700 text-white' : 'text-gray-300 hover:bg-gray-700'}`}>
                                            {COMMON.MESSAGES.UNDERSCORE}
                                        </button>
                                        <button type="button" onClick={() => handleChangeDanbooruFormat('space')}
                                            className={`px-3 py-1 text-xs rounded transition-colors ${effectiveDanbooruTagFormat === 'space' ? 'bg-green-700 text-white' : 'text-gray-300 hover:bg-gray-700'}`}>
                                            {COMMON.MESSAGES.SPACE}
                                        </button>
                                        <button type="button" onClick={() => handleChangeDanbooruFormat('anima')}
                                            className={`px-3 py-1 text-xs rounded transition-colors ${effectiveDanbooruTagFormat === 'anima' ? 'bg-green-700 text-white' : 'text-gray-300 hover:bg-gray-700'}`}>
                                            {COMMON.MESSAGES.ANIMA}
                                        </button>
                                    </div>
                                </div>
                                {/* トリガーワード形式（3択） */}
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-gray-500 w-24 shrink-0">{DANBOORU.LABELS.TRIGGER_WORDS}</span>
                                    <div className="inline-flex rounded-lg border border-gray-700 bg-gray-800 p-1">
                                        <button type="button" onClick={() => handleChangeTriggerFormat('raw')}
                                            className={`px-3 py-1 text-xs rounded transition-colors ${effectiveTriggerWordFormat === 'raw' ? 'bg-cyan-700 text-white' : 'text-gray-300 hover:bg-gray-700'}`}>
                                            {COMMON.MESSAGES.RAW}
                                        </button>
                                        <button type="button" onClick={() => handleChangeTriggerFormat('underscore')}
                                            className={`px-3 py-1 text-xs rounded transition-colors ${effectiveTriggerWordFormat === 'underscore' ? 'bg-cyan-700 text-white' : 'text-gray-300 hover:bg-gray-700'}`}>
                                            {COMMON.MESSAGES.UNDERSCORE}
                                        </button>
                                        <button type="button" onClick={() => handleChangeTriggerFormat('space')}
                                            className={`px-3 py-1 text-xs rounded transition-colors ${effectiveTriggerWordFormat === 'space' ? 'bg-cyan-700 text-white' : 'text-gray-300 hover:bg-gray-700'}`}>
                                            {COMMON.MESSAGES.SPACE}
                                        </button>
                                        <button type="button" onClick={() => handleChangeTriggerFormat('anima')}
                                            className={`px-3 py-1 text-xs rounded transition-colors ${effectiveTriggerWordFormat === 'anima' ? 'bg-cyan-700 text-white' : 'text-gray-300 hover:bg-gray-700'}`}>
                                            {COMMON.MESSAGES.ANIMA}
                                        </button>
                                    </div>
                                </div>
                            </div>
                            )}
                            <p className="text-xs text-gray-500">
                                {COMMON.MESSAGES.FORMAT_AUTO_SAVE_DESC}
                            </p>
                        </div>
                        )}

                        {/* タグ検索（常時表示） */}
                        <IntegratedDanbooruSearch backendUrl={backendUrl} danbooruTagFormat={effectiveDanbooruTagFormat} uiCatalog={uiCatalog} />

                        {/* キャラクター画像生成設定（開閉可） */}
                        <div className="border border-pink-600/40 rounded-lg overflow-hidden">
                            <button
                                onClick={() => setIsCharacterOpen(!isCharacterOpen)}
                                className="w-full flex items-center gap-2 px-4 py-3 bg-gray-800/80 hover:bg-gray-800 text-sm font-medium text-pink-300 transition-colors"
                            >
                                {isCharacterOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                <Users size={16} className="text-pink-400" />
                                {SECTION_NAMES.CHARACTER_SETTINGS}
                                {charIsDirty && <span className="ml-auto text-xs text-yellow-400">{COMMON.BUTTONS.UNSAVED}</span>}
                            </button>
                            {isCharacterOpen && (
                                <div className="p-4">
                                    <IntegratedCharacterSection
                                        characters={characters}
                                        selectedCharacter={selectedCharacter}
                                        onCharacterChange={handleCharacterChange}
                                        config={charConfig}
                                        onUpdateConfig={updateCharConfig}
                                        danbooruTagFormat={effectiveDanbooruTagFormat}
                                        isLoading={charIsLoading}
                                        isDirty={charIsDirty}
                                        onSave={handleSaveCharConfig}
                                        availableLoras={availableLoras}
                                        availableOutfitLoras={availableOutfitLoras}
                                        comfyUnreachable={comfyUnreachable}
                                        onRefreshLoras={handleRefreshLoras}
                                        onFetchTriggerWords={handleFetchTriggerWords}
                                        triggerWordFormat={effectiveTriggerWordFormat}
                                        uiCatalog={uiCatalog}
                                        backendUrl={backendUrl}
                                        appearancePrompt={effectiveAppearancePrompt}
                                        appearanceTarget={selectedCharacter
                                            ? { dirName: getCharDirName(selectedCharacter), fileName: selectedCharacter, displayName: selectedCharacter }
                                            : null}
                                        characterDirName={selectedCharacter ? getCharDirName(selectedCharacter) : undefined}
                                        onReloadConfig={() => loadCharConfig(selectedCharacter)}
                                        imageBackend={imageBackend}
                                        apiService={apiService}
                                        referenceRefreshKey={apiModelId}
                                    />
                                </div>
                            )}
                        </div>

                        {/* タグ判定・ワークフロー設定（開閉可）。
                            形式×ワークフロー対応表と指示ファイル編集は同じタグ判定の設定のため
                            1セクションへまとめて扱う */}
                        <div className="border border-amber-600/40 rounded-lg overflow-hidden">
                            <button
                                onClick={() => setIsDirectiveOpen(!isDirectiveOpen)}
                                className="w-full flex items-center gap-2 px-4 py-3 bg-gray-800/80 hover:bg-gray-800 text-sm font-medium text-amber-300 transition-colors"
                            >
                                {isDirectiveOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                <Workflow size={16} className="text-amber-400" />
                                {isApi ? SECTION_NAMES.TAG_JUDGE_GENERATION_SETTINGS : SECTION_NAMES.TAG_JUDGE_WORKFLOW_SETTINGS}
                            </button>
                            {isDirectiveOpen && (
                                <div className="p-4 space-y-3">
                                    {/* 形式×ワークフロー対応表（個別開閉可） */}
                                    <CollapsibleSection
                                        defaultOpen
                                        title={
                                            <>
                                                <Workflow size={16} className="text-green-400" />
                                                {COMMON.MESSAGES.FORMAT_WORKFLOW_HEADING}
                                            </>
                                        }
                                    >
                                        {/* バックエンドの切替で読み直す（切替後の側の対応表を出す） */}
                                        <TagJudgeWorkflowPanel
                                            key={imageBackend}
                                            backendUrl={backendUrl}
                                            uiCatalog={uiCatalog}
                                            templates={templates}
                                            showHeading={false}
                                            stacked={!isWideScreen}
                                        />
                                    </CollapsibleSection>

                                    {/* タグ判定指示ファイル編集（個別開閉可） */}
                                    <CollapsibleSection
                                        defaultOpen
                                        title={
                                            <>
                                                <FileText size={16} className="text-amber-400" />
                                                {resolveMessage(uiCatalog, 'comfyDirective.title', 'タグ判定指示ファイル')}
                                            </>
                                        }
                                    >
                                        <IntegratedDirectiveSection
                                            key={imageBackend}
                                            backendUrl={backendUrl}
                                            uiCatalog={uiCatalog}
                                            onOpenInEditor={onOpenDirectiveInEditor}
                                            backend={imageBackend}
                                        />
                                    </CollapsibleSection>
                                </div>
                            )}
                        </div>

                        {/* タグマッピング設定（開閉可） */}
                        <div className="border border-cyan-600/40 rounded-lg overflow-hidden">
                            <button
                                onClick={() => setIsTagMappingOpen(!isTagMappingOpen)}
                                className="w-full flex items-center gap-2 px-4 py-3 bg-gray-800/80 hover:bg-gray-800 text-sm font-medium text-cyan-300 transition-colors"
                            >
                                {isTagMappingOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                <Tag size={16} className="text-cyan-400" />
                                {SECTION_NAMES.TAG_MAPPING}
                            </button>
                            {isTagMappingOpen && (
                                <div className="p-4">
                                    <IntegratedTagMappingSection key={imageBackend} backendUrl={backendUrl} danbooruTagFormat={effectiveDanbooruTagFormat} triggerWordFormat={effectiveTriggerWordFormat} uiCatalog={uiCatalog} />
                                </div>
                            )}
                        </div>

                        {/* ユーザーの容姿設定（API サービスのみ。呼び名・容姿・服装・参照画像。即時保存） */}
                        {isApi && (
                            <div className="border border-green-600/40 rounded-lg overflow-hidden">
                                <button
                                    onClick={() => setIsUserAppearanceOpen(!isUserAppearanceOpen)}
                                    className="w-full flex items-center gap-2 px-4 py-3 bg-gray-800/80 hover:bg-gray-800 text-sm font-medium text-green-300 transition-colors"
                                >
                                    {isUserAppearanceOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                    <User size={16} className="text-green-400" />
                                    {SECTION_NAMES.USER_APPEARANCE}
                                </button>
                                {isUserAppearanceOpen && (
                                    <div className="p-4">
                                        <UserAppearanceSection
                                            backendUrl={backendUrl}
                                            uiCatalog={uiCatalog}
                                            service={apiService}
                                            active={isOpen}
                                            hideHeading
                                            referenceRefreshKey={apiModelId}
                                        />
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* ===== 右側: ワークフロー選択 + テスト生成（sticky固定。狭画面では開閉見出し付きで下に積む） ===== */}
                    <div className={isWideScreen ? 'w-1/2 overflow-y-auto custom-scrollbar p-5' : 'shrink-0'}>
                        {!isWideScreen && (
                            <CollapsibleSectionHeader
                                label={resolveMessage(uiCatalog, 'comfyui.integrated.sectionWorkflowTest', 'ワークフロー・テスト生成')}
                                open={rightOpen}
                                onToggle={() => setRightOpen(v => !v)}
                            />
                        )}
                        {showRight && (
                        <div className={isWideScreen ? 'sticky top-0 space-y-4' : 'p-5 space-y-4'}>
                            {/* 右 1: ComfyUI ではテスト生成用ワークフロー、API サービスでは生成プリセット */}
                            {isApi ? (
                                <div className="space-y-3">
                                    {/* 使用モデル（生成プリセットとは別に選ぶ。切り替えたら即時保存） */}
                                    <ApiServiceModelSelect
                                        backendUrl={backendUrl}
                                        uiCatalog={uiCatalog}
                                        service={apiService}
                                        active={isOpen}
                                        onModelChange={setApiModelId}
                                        onSavingChange={setIsApiModelSaving}
                                    />
                                    {/* 自動効果音描画（全体で 1 つの値。切り替えたら即時保存） */}
                                    <AutoSoundEffectsToggle
                                        modelId={apiModelId}
                                        backendUrl={backendUrl}
                                        uiCatalog={uiCatalog}
                                        service={apiService}
                                        active={isOpen}
                                        showHelp
                                        size="sm"
                                    />
                                    <h3 className="flex items-center gap-2 text-sm font-semibold text-green-300">
                                        <Palette size={16} className="text-green-400" />
                                        {SECTION_NAMES.API_SERVICE_PRESET}
                                    </h3>
                                    <NovelAIPresetSection
                                        backendUrl={backendUrl}
                                        uiCatalog={uiCatalog}
                                        service={apiService}
                                        active={isOpen}
                                        presets={apiPresets}
                                        modelId={apiModelId}
                                        onPresetsChanged={reloadApiPresets}
                                        onSelectedChange={setSelectedPreset}
                                        hideHeading
                                    />
                                </div>
                            ) : (
                                <IntegratedWorkflowSection
                                    backendUrl={backendUrl}
                                    templates={templates}
                                    selectedTemplate={selectedTemplate}
                                    onTemplateChange={setSelectedTemplate}
                                    onTemplatesReload={reloadTemplates}
                                    uiCatalog={uiCatalog}
                                />
                            )}
                            <IntegratedGenerateTestSection
                                key={imageBackend}
                                backendUrl={backendUrl}
                                selectedTemplate={selectedTemplate}
                                selectedPreset={isApi ? selectedPreset : undefined}
                                useLeftCharacter={useLeftCharacter}
                                onToggleUseLeftCharacter={() => setUseLeftCharacter(prev => !prev)}
                                leftCharacterName={getCharDirName(selectedCharacter)}
                                leftCharConfig={charConfig}
                                characters={characters}
                                uiCatalog={uiCatalog}
                                generateDisabled={isApi && isApiModelSaving}
                            />
                        </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
