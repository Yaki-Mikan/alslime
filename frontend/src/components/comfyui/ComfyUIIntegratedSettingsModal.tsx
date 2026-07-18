/**
 * ComfyUIIntegratedSettingsModal.tsx - 画像生成統合設定モーダル
 *
 * キャラクター画像生成設定・タグマッピング設定・画像生成テストを
 * 1つの大型モーダルに統合し、テスト生成しながら設定を調整・保存できる。
 * PC環境専用（横幅1280px以上）。
 */

import React, { useState, useEffect, useCallback } from 'react';
import { X, ChevronDown, ChevronRight, Users, Tag, Palette, FileText } from 'lucide-react';
import {
    getCharacterImageGenConfig,
    saveCharacterImageGenConfig,
    getLorasByCategory,
    refreshComfyUILoras,
    getLoraTriggerWords,
    getComfyUIConfig,
    saveComfyUIConfig,
    listComfyUITemplates,
} from '../../api/comfyui';
import type { CharacterImageGenConfig, TemplateInfo } from '../../api/comfyui';
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
import { resolveMessage } from '../../api/i18n';
import { useDanbooruTagFormat } from './useDanbooruTagFormat';
import { useTriggerWordFormat } from './useTriggerWordFormat';

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
}) => {
    const { INTEGRATED_SETTINGS_TITLE, COMMON, DANBOORU, SECTION_NAMES } = createComfyUIText(uiCatalog);
    // ===== セクション開閉 =====
    const [isCharacterOpen, setIsCharacterOpen] = useState(true);
    const [isTagMappingOpen, setIsTagMappingOpen] = useState(true);
    const [isDirectiveOpen, setIsDirectiveOpen] = useState(false);

    // ===== キャラクター設定（リフトアップ: テスト生成に渡すため） =====
    const [characters, setCharacters] = useState<CharacterTagInfo[]>([]);
    const [selectedCharacter, setSelectedCharacter] = useState('');
    const [charConfig, setCharConfig] = useState<CharacterImageGenConfig>({ ...DEFAULT_CONFIG });
    const [charIsDirty, setCharIsDirty] = useState(false);
    const [charIsLoading, setCharIsLoading] = useState(false);

    // ===== LoRA一覧 =====
    const [availableLoras, setAvailableLoras] = useState<string[]>([]);
    const [availableOutfitLoras, setAvailableOutfitLoras] = useState<string[]>([]);

    // ===== テスト生成連動 =====
    const [useLeftCharacter, setUseLeftCharacter] = useState(true);

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

    // 初期データ取得
    useEffect(() => {
        if (!isOpen) return;
        (async () => {
            try {
                const [charResult, loras, outfitLoras] = await Promise.all([
                    getCharacterTags(),
                    getLorasByCategory(backendUrl, 'character'),
                    getLorasByCategory(backendUrl, 'outfit'),
                ]);
                setCharacters(charResult.characters);
                setAvailableLoras(loras);
                setAvailableOutfitLoras(outfitLoras);
            } catch (error) {
                console.error('[ComfyUIIntegratedSettingsModal] initialization failed:', error);
            }
        })();
        void reloadTemplates();
    }, [isOpen, backendUrl, reloadTemplates]);

    // キャラ名 → ディレクトリ名変換（画像生成設定の保存/読み込みはディレクトリ名を使う）
    const getCharDirName = useCallback((name: string) => {
        return characters.find(c => c.name === name)?.dirName || name;
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
            if (!loaded.lora || loaded.lora.length === 0) {
                loaded.lora = [{ name: '', strengthModel: 1.0, strengthClip: 1.0 }];
            }
            if (!loaded.outfits) {
                loaded.outfits = [];
            }
            loaded.outfits = loaded.outfits.map(outfit => ({
                ...outfit,
                lora: outfit.lora && outfit.lora.length > 0
                    ? outfit.lora
                    : [{ name: '', strengthModel: 1.0, strengthClip: 1.0 }],
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

    useEffect(() => {
        if (!isOpen || !initialSelectedCharacter || characters.length === 0) return;
        const resolvedName = resolveCharacterName(initialSelectedCharacter);
        if (resolvedName && selectedCharacter !== resolvedName) {
            handleCharacterChange(resolvedName);
        }
    }, [isOpen, initialSelectedCharacter, characters, resolveCharacterName, selectedCharacter, handleCharacterChange]);

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

    // LoRA再読込
    const handleRefreshLoras = useCallback(async () => {
        try {
            await refreshComfyUILoras(backendUrl);
            const [loras, outfitLoras] = await Promise.all([
                getLorasByCategory(backendUrl, 'character'),
                getLorasByCategory(backendUrl, 'outfit'),
            ]);
            setAvailableLoras(loras);
            setAvailableOutfitLoras(outfitLoras);
        } catch (error) {
            console.error('[ComfyUIIntegratedSettingsModal] lora refresh failed:', error);
        }
    }, [backendUrl]);

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
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700 bg-gray-800 shrink-0">
                    <div className="flex items-center gap-4">
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

                {/* メインコンテンツ: 左右分割 */}
                <div className="flex flex-1 overflow-hidden">
                    {/* ===== 左側: 設定エリア（スクロール可） ===== */}
                    <div className="w-1/2 overflow-y-auto custom-scrollbar border-r border-gray-700 p-5 space-y-4">
                        {/* タグ・トリガーワード形式設定（即時保存） */}
                        <div className="border border-gray-700 rounded-lg p-4 bg-gray-800/30 space-y-3">
                            <div className="flex items-center gap-2 text-sm font-medium text-gray-400">
                                <Tag size={16} className="text-green-400" />
                                {SECTION_NAMES.TAG_TRIGGER_FORMAT}
                            </div>
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
                                    </div>
                                </div>
                            </div>
                            <p className="text-xs text-gray-500">
                                {COMMON.MESSAGES.FORMAT_AUTO_SAVE_DESC}
                            </p>
                        </div>

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
                                        isLoading={charIsLoading}
                                        isDirty={charIsDirty}
                                        onSave={handleSaveCharConfig}
                                        availableLoras={availableLoras}
                                        availableOutfitLoras={availableOutfitLoras}
                                        onRefreshLoras={handleRefreshLoras}
                                        onFetchTriggerWords={handleFetchTriggerWords}
                                        triggerWordFormat={effectiveTriggerWordFormat}
                                        uiCatalog={uiCatalog}
                                    />
                                </div>
                            )}
                        </div>

                        {/* タグ判定指示ファイル（開閉可。設計 §9） */}
                        <div className="border border-amber-600/40 rounded-lg overflow-hidden">
                            <button
                                onClick={() => setIsDirectiveOpen(!isDirectiveOpen)}
                                className="w-full flex items-center gap-2 px-4 py-3 bg-gray-800/80 hover:bg-gray-800 text-sm font-medium text-amber-300 transition-colors"
                            >
                                {isDirectiveOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                <FileText size={16} className="text-amber-400" />
                                {resolveMessage(uiCatalog, 'comfyDirective.title', 'タグ判定指示ファイル')}
                            </button>
                            {isDirectiveOpen && (
                                <div className="p-4">
                                    <IntegratedDirectiveSection backendUrl={backendUrl} uiCatalog={uiCatalog} />
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
                                    <IntegratedTagMappingSection backendUrl={backendUrl} danbooruTagFormat={effectiveDanbooruTagFormat} triggerWordFormat={effectiveTriggerWordFormat} uiCatalog={uiCatalog} />
                                </div>
                            )}
                        </div>
                    </div>

                    {/* ===== 右側: ワークフロー選択 + テスト生成（sticky固定） ===== */}
                    <div className="w-1/2 overflow-y-auto custom-scrollbar p-5">
                        <div className="sticky top-0 space-y-4">
                            <IntegratedWorkflowSection
                                backendUrl={backendUrl}
                                templates={templates}
                                selectedTemplate={selectedTemplate}
                                onTemplateChange={setSelectedTemplate}
                                onTemplatesReload={reloadTemplates}
                                uiCatalog={uiCatalog}
                            />
                            <IntegratedGenerateTestSection
                                backendUrl={backendUrl}
                                selectedTemplate={selectedTemplate}
                                useLeftCharacter={useLeftCharacter}
                                onToggleUseLeftCharacter={() => setUseLeftCharacter(prev => !prev)}
                                leftCharacterName={getCharDirName(selectedCharacter)}
                                leftCharConfig={charConfig}
                                characters={characters}
                                uiCatalog={uiCatalog}
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
