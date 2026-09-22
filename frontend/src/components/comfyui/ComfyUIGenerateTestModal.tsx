/**
 * ComfyUIGenerateTestModal.tsx - 画像生成テストモーダル
 *
 * テンプレート・キャラクター・タグを選択し、合成エンジン経由で画像生成テストを行う。
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X, Search, Palette, RefreshCw, ChevronDown, ChevronRight, Save, Pencil } from 'lucide-react';
import { parseDirectReplacements } from './directReplacements';
import {
    listComfyUITemplates,
    getTagCategories,
    getTagMapping,
    generateImage,
    generateApiServiceTest,
    imageDataUrlFromBase64,
    getCharacterImageGenConfig,
    saveCharacterImageGenConfig,
    getComfyUIConfig,
    listApiServicePresets,
    emptyCharacterApiServiceConfig,
} from '../../api/comfyui';
import { getCharacterTags } from '../../api/files';
import type {
    TemplateInfo,
    TagCategory,
    TagMappingFile,
    GenerateResult,
    CharacterImageGenConfig,
    ImageBackend,
    ApiServiceId,
    NovelAIPreset,
} from '../../api/comfyui';
import type { CharacterTagInfo } from '../../api/files';
import { createComfyUIText, formatComfyText } from './i18n';
import { resolveBackendError, type I18NCatalog } from '../../api/i18n';
import { normalizeApiService, normalizeImageBackend } from './apiservice/services';
import { ApiGenerateResultDetails } from './apiservice/ApiGenerateResultDetails';

interface ComfyUIGenerateTestModalProps {
    isOpen: boolean;
    onClose: () => void;
    backendUrl: string;
    onOpenIntegrated?: () => void;
    uiCatalog?: I18NCatalog | null;
}

export const ComfyUIGenerateTestModal: React.FC<ComfyUIGenerateTestModalProps> = ({
    isOpen,
    onClose,
    backendUrl,
    onOpenIntegrated,
    uiCatalog = null,
}) => {
    const { CHARACTER, COMMON, GENERATE_TEST, INTEGRATED, SECTION_NAMES } = createComfyUIText(uiCatalog);
    // テンプレート
    const [templates, setTemplates] = useState<TemplateInfo[]>([]);
    const [selectedTemplate, setSelectedTemplate] = useState('');
    // 画像生成バックエンド（全画面共用の選択）。API サービスではテンプレートの代わりに生成プリセットを選ぶ。
    const [imageBackend, setImageBackend] = useState<ImageBackend>('comfyui');
    const [apiService, setApiService] = useState<ApiServiceId>('novelai');
    const [apiPresets, setApiPresets] = useState<NovelAIPreset[]>([]);
    const [selectedPreset, setSelectedPreset] = useState('');
    const [intermediateStep, setIntermediateStep] = useState<number | null>(null);
    // その回の生成にだけ使う追加プロンプト（API サービス用のテスト生成のみ）
    const [extraPrompt, setExtraPrompt] = useState('');
    const isApi = imageBackend === 'api';
    // キャラクタープロンプトの読み書き先。API サービスでは API 側ブロック（NAI が読む方）を使う。
    const charPromptOf = useCallback((cfg: CharacterImageGenConfig | null): string => {
        if (!cfg) return '';
        return isApi ? (cfg.apiService?.[apiService]?.characterPrompt || '') : (cfg.characterPrompt || '');
    }, [isApi, apiService]);
    const withCharPrompt = useCallback((cfg: CharacterImageGenConfig, prompt: string): CharacterImageGenConfig => {
        if (!isApi) return { ...cfg, characterPrompt: prompt };
        const current = cfg.apiService?.[apiService] ?? emptyCharacterApiServiceConfig();
        return { ...cfg, apiService: { ...(cfg.apiService ?? {}), [apiService]: { ...current, characterPrompt: prompt } } };
    }, [isApi, apiService]);

    // キャラクター
    const [characters, setCharacters] = useState<CharacterTagInfo[]>([]);
    const [selectedCharacter, setSelectedCharacter] = useState('');
    const [isCharDropdownOpen, setIsCharDropdownOpen] = useState(false);
    const [charSearchQuery, setCharSearchQuery] = useState('');
    const charDropdownRef = useRef<HTMLDivElement>(null);

    // タグカテゴリ + 各カテゴリのタグ一覧
    const [categories, setCategories] = useState<TagCategory[]>([]);
    const [tagMappings, setTagMappings] = useState<Record<string, TagMappingFile>>({});
    const [tagSelections, setTagSelections] = useState<Record<string, string>>({});

    // その他（プレースホルダ直指定。1行1件の「プレースホルダ名: 値」）
    const [directPlaceholdersText, setDirectPlaceholdersText] = useState('');

    // 生成
    const [isGenerating, setIsGenerating] = useState(false);
    const [result, setResult] = useState<GenerateResult | null>(null);
    const [generatedImage, setGeneratedImage] = useState<string | null>(null);

    // キャラクター設定
    const [charConfig, setCharConfig] = useState<CharacterImageGenConfig | null>(null);
    const [isCharConfigEditing, setIsCharConfigEditing] = useState(false);
    const [editCharName, setEditCharName] = useState('');
    const [editWorkName, setEditWorkName] = useState('');
    const [editCharPrompt, setEditCharPrompt] = useState('');
    const [isSavingCharConfig, setIsSavingCharConfig] = useState(false);

    // 解決済みプロンプト表示
    const [showPositive, setShowPositive] = useState(false);
    const [showNegative, setShowNegative] = useState(false);
    const [showLoras, setShowLoras] = useState(false);

    // 初回読み込み
    useEffect(() => {
        if (!isOpen) return;
        (async () => {
            try {
                const [templateList, charResult, catDef, config] = await Promise.all([
                    listComfyUITemplates(backendUrl),
                    getCharacterTags(),
                    getTagCategories(backendUrl),
                    getComfyUIConfig(backendUrl).catch(() => null),
                ]);
                setTemplates(templateList);
                if (templateList.length > 0 && !selectedTemplate) {
                    setSelectedTemplate(templateList[0].name);
                }
                setCharacters(charResult.characters);
                setCategories(catDef.categories || []);
                if (config) {
                    const backend = normalizeImageBackend(config.imageBackend);
                    const service = normalizeApiService(config.apiService);
                    setImageBackend(backend);
                    setApiService(service);
                    if (backend === 'api') {
                        try {
                            const presets = await listApiServicePresets(backendUrl, service);
                            setApiPresets(presets);
                            setSelectedPreset(prev => (prev && presets.some(p => p.name === prev)) ? prev : (config.apiPresetDefault || presets[0]?.name || ''));
                        } catch (e) {
                            console.error('[ComfyUIGenerateTestModal] api presets load failed:', e);
                        }
                    }
                }

                // 全カテゴリのタグマッピングを一括取得
                const mappings: Record<string, TagMappingFile> = {};
                await Promise.all(
                    (catDef.categories || []).map(async (cat) => {
                        const m = await getTagMapping(backendUrl, cat.id);
                        mappings[cat.id] = m;
                    })
                );
                setTagMappings(mappings);
            } catch (e) {
                console.error('[ComfyUIGenerateTestModal] initialization failed:', e);
            }
        })();
    }, [isOpen, backendUrl]);

    // キャラ名 → ディレクトリ名変換
    const getCharDirName = useCallback((name: string) => {
        return characters.find(c => c.name === name)?.dirName || name;
    }, [characters]);

    // キャラクター選択時に設定を読み込む
    useEffect(() => {
        if (!selectedCharacter) {
            setCharConfig(null);
            setIsCharConfigEditing(false);
            return;
        }
        (async () => {
            try {
                const config = await getCharacterImageGenConfig(backendUrl, getCharDirName(selectedCharacter));
                setCharConfig(config);
                setEditCharName(config.characterName || '');
                setEditWorkName(config.workName || '');
                setEditCharPrompt(charPromptOf(config));
                setIsCharConfigEditing(false);
            } catch (e) {
                console.error('[ComfyUIGenerateTestModal] character config load failed:', e);
                setCharConfig(null);
            }
        })();
    }, [selectedCharacter, backendUrl, getCharDirName, charPromptOf]);

    // キャラ設定保存
    const handleSaveCharConfig = useCallback(async () => {
        if (!charConfig || !selectedCharacter) return;
        setIsSavingCharConfig(true);
        try {
            // キャラ名・作品名は共用、容姿プロンプトは選択中のバックエンド側へ書く。
            const updated = withCharPrompt({
                ...charConfig,
                characterName: editCharName,
                workName: editWorkName,
            }, editCharPrompt);
            await saveCharacterImageGenConfig(backendUrl, getCharDirName(selectedCharacter), updated);
            setCharConfig(updated);
            setIsCharConfigEditing(false);
        } catch (e: any) {
            console.error('[ComfyUIGenerateTestModal] character config save failed:', e);
        } finally {
            setIsSavingCharConfig(false);
        }
    }, [charConfig, selectedCharacter, editCharName, editWorkName, editCharPrompt, backendUrl, getCharDirName, withCharPrompt]);

    // 外側クリックでキャラドロップダウン閉じる
    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (charDropdownRef.current && !charDropdownRef.current.contains(e.target as Node)) {
                setIsCharDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    // キャラ検索フィルタ
    const filteredCharacters = charSearchQuery.trim()
        ? characters.filter(c => c.name.toLowerCase().includes(charSearchQuery.trim().toLowerCase()))
        : characters;

    // タグ選択更新
    const updateTagSelection = useCallback((categoryId: string, value: string) => {
        setTagSelections(prev => ({ ...prev, [categoryId]: value }));
    }, []);

    // 生成（API サービスでは途中経過を受けて画像を差し替え、final で確定する）
    const handleGenerate = useCallback(async () => {
        if (!isApi && !selectedTemplate) return;
        setIsGenerating(true);
        setResult(null);
        setGeneratedImage(null);
        setIntermediateStep(null);
        try {
            const directReplacements = parseDirectReplacements(directPlaceholdersText);
            const request = {
                templateName: isApi ? '' : selectedTemplate,
                characterName: getCharDirName(selectedCharacter),
                tagSelections,
                ...(directReplacements ? { directReplacements } : {}),
                ...(isApi ? { presetName: selectedPreset, backend: 'api' as ImageBackend } : {}),
                // 自由入力は API サービス用のテスト生成の、その回にだけ使う。
                ...(isApi && extraPrompt.trim() ? { extraPrompt } : {}),
            };
            const res = isApi
                ? await generateApiServiceTest(backendUrl, request, (stepIx, image) => {
                    setIntermediateStep(stepIx);
                    setGeneratedImage(imageDataUrlFromBase64(image));
                })
                : await generateImage(backendUrl, request);
            setResult(res);
            setIntermediateStep(null);
            if (res.success && res.imageBase64 && res.mimeType) {
                setGeneratedImage(`data:${res.mimeType};base64,${res.imageBase64}`);
            } else if (!res.success) {
                setGeneratedImage(null);
            }
        } catch (e: any) {
            setResult({ success: false, error: e.message || GENERATE_TEST.MESSAGES.GENERATE_FAILED });
            setGeneratedImage(null);
        } finally {
            setIsGenerating(false);
        }
    }, [backendUrl, isApi, selectedTemplate, selectedPreset, selectedCharacter, tagSelections, directPlaceholdersText, getCharDirName, extraPrompt]);

    // 再生成（seed違い）
    const handleRegenerate = useCallback(() => {
        handleGenerate();
    }, [handleGenerate]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
            <div
                className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-2xl border border-gray-700 flex flex-col max-h-[90vh]"
                onClick={e => e.stopPropagation()}
            >
                {/* ヘッダー */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 bg-gray-800">
                    <div className="flex items-center gap-2">
                        <Palette size={18} className="text-purple-400" />
                        <h2 className="text-lg font-semibold text-gray-100">{SECTION_NAMES.GENERATE_TEST}</h2>
                    </div>
                    <button onClick={onClose} className="p-1.5 hover:bg-gray-700 rounded text-gray-400 hover:text-gray-200 transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* 本体 */}
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 custom-scrollbar">

                    {/* テンプレート選択（API サービスでは生成プリセット選択） */}
                    {isApi ? (
                        <div className="space-y-1">
                            <label className="text-sm font-medium text-gray-400">{GENERATE_TEST.LABELS.PRESET}</label>
                            <select
                                value={selectedPreset}
                                onChange={e => setSelectedPreset(e.target.value)}
                                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-purple-500"
                            >
                                <option value="">{GENERATE_TEST.MESSAGES.COMMON_PRESET_OPTION}</option>
                                {apiPresets.map(p => (
                                    <option key={p.name} value={p.name}>{p.name}</option>
                                ))}
                            </select>
                        </div>
                    ) : (
                        <div className="space-y-1">
                            <label className="text-sm font-medium text-gray-400">{GENERATE_TEST.LABELS.TEMPLATE}</label>
                            <select
                                value={selectedTemplate}
                                onChange={e => setSelectedTemplate(e.target.value)}
                                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-purple-500"
                            >
                                {templates.map(t => (
                                    <option key={t.name} value={t.name}>{t.name}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    {/* キャラクター選択（検索付きインライン展開） */}
                    <div className="space-y-1" ref={charDropdownRef}>
                        <label className="text-sm font-medium text-gray-400">{GENERATE_TEST.LABELS.CHARACTER}</label>
                        <div
                            onClick={() => { setIsCharDropdownOpen(!isCharDropdownOpen); setCharSearchQuery(''); }}
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm cursor-pointer hover:border-purple-500 transition-colors flex items-center justify-between"
                        >
                            <span className={selectedCharacter ? 'text-gray-200' : 'text-gray-500'}>
                                {selectedCharacter || CHARACTER.PLACEHOLDERS.SELECT_CHARACTER}
                            </span>
                            <Search size={14} className="text-gray-500" />
                        </div>

                        {isCharDropdownOpen && (
                            <div className="bg-gray-800 border border-gray-600 rounded-lg overflow-hidden">
                                <div className="p-2 border-b border-gray-700">
                                    <input
                                        type="text"
                                        value={charSearchQuery}
                                        onChange={e => setCharSearchQuery(e.target.value)}
                                        placeholder={CHARACTER.PLACEHOLDERS.SEARCH_CHARACTER}
                                        className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200 outline-none focus:border-purple-500"
                                        autoFocus
                                    />
                                </div>
                                <div className="max-h-48 overflow-y-auto custom-scrollbar">
                                    <button
                                        onClick={() => {
                                            setSelectedCharacter('');
                                            setIsCharDropdownOpen(false);
                                        }}
                                        className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-700 transition-colors ${
                                            !selectedCharacter ? 'bg-purple-600/30 text-purple-200' : 'text-gray-500'
                                        }`}
                                    >
                                        {GENERATE_TEST.PLACEHOLDERS.NOT_SELECTED}
                                    </button>
                                    {filteredCharacters.map(c => (
                                        <button
                                            key={c.path}
                                            onClick={() => {
                                                setSelectedCharacter(c.name);
                                                setIsCharDropdownOpen(false);
                                            }}
                                            className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-700 transition-colors ${
                                                selectedCharacter === c.name ? 'bg-purple-600/30 text-purple-200' : 'text-gray-300'
                                            }`}
                                        >
                                            {c.name}
                                        </button>
                                    ))}
                                    {filteredCharacters.length === 0 && (
                                        <p className="text-xs text-gray-600 text-center py-3">{GENERATE_TEST.MESSAGES.NO_CHARACTER_FOUND}</p>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* キャラクター設定表示/編集 */}
                    {selectedCharacter && charConfig && (
                        <div className="space-y-2 border border-gray-700 rounded-lg p-3 bg-gray-800/30">
                            <div className="flex items-center justify-between">
                                <span className="text-sm font-medium text-gray-400">{GENERATE_TEST.LABELS.CHARACTER_SETTINGS}</span>
                                <div className="flex items-center gap-1.5">
                                    {isCharConfigEditing ? (
                                        <>
                                            <button
                                                onClick={handleSaveCharConfig}
                                                disabled={isSavingCharConfig}
                                                className="flex items-center gap-1 px-2 py-1 bg-green-700 hover:bg-green-600 disabled:opacity-50 rounded text-xs text-white transition-colors"
                                            >
                                                <Save size={12} />
                                                {COMMON.BUTTONS.SAVE}
                                            </button>
                                            <button
                                                onClick={() => {
                                                    setEditCharName(charConfig.characterName || '');
                                                    setEditWorkName(charConfig.workName || '');
                                                    setEditCharPrompt(charPromptOf(charConfig));
                                                    setIsCharConfigEditing(false);
                                                }}
                                                className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs text-gray-300 transition-colors"
                                            >
                                                {COMMON.BUTTONS.CANCEL}
                                            </button>
                                        </>
                                    ) : (
                                        <button
                                            onClick={() => setIsCharConfigEditing(true)}
                                            className="flex items-center gap-1 px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs text-gray-300 transition-colors"
                                        >
                                            <Pencil size={12} />
                                            {COMMON.BUTTONS.EDIT}
                                        </button>
                                    )}
                                </div>
                            </div>
                            {isCharConfigEditing ? (
                                <div className="space-y-2">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs text-gray-500 w-20 shrink-0">{GENERATE_TEST.LABELS.CHAR_NAME}</span>
                                        <input
                                            type="text"
                                            value={editCharName}
                                            onChange={e => setEditCharName(e.target.value)}
                                            className="flex-1 bg-gray-900 border border-gray-600 rounded px-2 py-1 text-sm text-gray-200 outline-none focus:border-purple-500"
                                        />
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs text-gray-500 w-20 shrink-0">{GENERATE_TEST.LABELS.CHAR_WORK_NAME}</span>
                                        <input
                                            type="text"
                                            value={editWorkName}
                                            onChange={e => setEditWorkName(e.target.value)}
                                            className="flex-1 bg-gray-900 border border-gray-600 rounded px-2 py-1 text-sm text-gray-200 outline-none focus:border-purple-500"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <span className="text-xs text-gray-500">{CHARACTER.LABELS.CHARACTER_PROMPT}</span>
                                        <textarea
                                            value={editCharPrompt}
                                            onChange={e => setEditCharPrompt(e.target.value)}
                                            rows={3}
                                            className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-200 outline-none focus:border-purple-500 resize-y"
                                        />
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-1 text-sm">
                                    <div className="flex gap-2">
                                        <span className="text-gray-500 w-20 shrink-0">{GENERATE_TEST.LABELS.CHAR_NAME}</span>
                                        <span className="text-gray-200">{charConfig.characterName || GENERATE_TEST.PLACEHOLDERS.NOT_SET}</span>
                                    </div>
                                    <div className="flex gap-2">
                                        <span className="text-gray-500 w-20 shrink-0">{GENERATE_TEST.LABELS.CHAR_WORK_NAME}</span>
                                        <span className="text-gray-200">{charConfig.workName || GENERATE_TEST.PLACEHOLDERS.NOT_SET}</span>
                                    </div>
                                    <div className="space-y-0.5">
                                        <span className="text-gray-500">{CHARACTER.LABELS.CHARACTER_PROMPT}</span>
                                        <p className="text-gray-300 text-xs break-all bg-gray-800/50 rounded px-2 py-1">
                                            {charPromptOf(charConfig) || GENERATE_TEST.PLACEHOLDERS.NOT_SET}
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* タグ選択 */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-400">{GENERATE_TEST.LABELS.TAG_SELECTION}</label>
                        <div className="border border-gray-700 rounded-lg p-3 space-y-2">
                            {categories.map(cat => {
                                const mapping = tagMappings[cat.id];
                                const hasTags = mapping && mapping.tags.length > 0;
                                return (
                                    <div key={cat.id} className="flex items-center gap-2">
                                        <span className="text-sm text-gray-400 w-24 shrink-0">{cat.label}</span>
                                        <select
                                            value={tagSelections[cat.id] || ''}
                                            onChange={e => updateTagSelection(cat.id, e.target.value)}
                                            disabled={!hasTags}
                                            className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 outline-none focus:border-purple-500 disabled:opacity-40"
                                        >
                                            <option value="">{GENERATE_TEST.PLACEHOLDERS.NONE}</option>
                                            {hasTags && mapping.tags.map(tag => (
                                                <option key={tag.key} value={tag.key}>{tag.key}</option>
                                            ))}
                                        </select>
                                    </div>
                                );
                            })}
                            {categories.length === 0 && (
                                <p className="text-xs text-gray-600 text-center">{GENERATE_TEST.MESSAGES.NO_CATEGORY}</p>
                            )}
                        </div>
                    </div>

                    {/* その他（プレースホルダ直指定） */}
                    <div className="space-y-1">
                        <label className="text-sm font-medium text-gray-400">{GENERATE_TEST.LABELS.DIRECT_PLACEHOLDERS}</label>
                        <textarea
                            value={directPlaceholdersText}
                            onChange={e => setDirectPlaceholdersText(e.target.value)}
                            placeholder={GENERATE_TEST.PLACEHOLDERS.DIRECT_PLACEHOLDERS}
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-purple-500 resize-y transition-colors"
                            rows={2}
                        />
                    </div>

                    {/* 追加プロンプト（自由入力。API サービス用のテスト生成のみ） */}
                    {isApi && (
                        <div className="space-y-1">
                            <label className="text-sm font-medium text-gray-400" htmlFor="generate-test-extra-prompt">{GENERATE_TEST.LABELS.EXTRA_PROMPT}</label>
                            <textarea
                                id="generate-test-extra-prompt"
                                value={extraPrompt}
                                onChange={e => setExtraPrompt(e.target.value)}
                                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-purple-500 resize-y transition-colors"
                                rows={3}
                            />
                            <p className="text-xs text-gray-500">{GENERATE_TEST.MESSAGES.EXTRA_PROMPT_DESC}</p>
                        </div>
                    )}

                    {/* 生成ボタン */}
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleGenerate}
                            disabled={isGenerating || (!isApi && !selectedTemplate)}
                            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded-lg text-sm text-white transition-colors"
                        >
                            {isGenerating ? (
                                <>
                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                                    {intermediateStep !== null
                                        ? formatComfyText(GENERATE_TEST.MESSAGES.INTERMEDIATE, { step: intermediateStep + 1 })
                                        : GENERATE_TEST.MESSAGES.GENERATING}
                                </>
                            ) : (
                                <>
                                    <Palette size={14} />
                                    {COMMON.BUTTONS.GENERATE}
                                </>
                            )}
                        </button>
                        {generatedImage && (
                            <button
                                onClick={handleRegenerate}
                                disabled={isGenerating}
                                className="flex items-center gap-1 px-3 py-2.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded-lg text-sm text-gray-300 transition-colors"
                                title={GENERATE_TEST.MESSAGES.RESEED_TOOLTIP}
                            >
                                <RefreshCw size={14} />
                                {COMMON.BUTTONS.REGENERATE}
                            </button>
                        )}
                    </div>

                    {/* エラー表示 */}
                    {result && !result.success && (
                        <div className="bg-red-900/30 border border-red-700 rounded-lg px-3 py-2 text-sm text-red-300">
                            {resolveBackendError(uiCatalog, result.error)}
                        </div>
                    )}

                    {/* 生成結果画像 */}
                    {generatedImage && (
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-400">{GENERATE_TEST.LABELS.RESULT}</label>
                            <div className="border border-gray-700 rounded-lg overflow-hidden bg-gray-800 flex items-center justify-center">
                                <img
                                    src={generatedImage}
                                    alt={GENERATE_TEST.LABELS.RESULT}
                                    className="max-h-[400px] object-contain cursor-pointer"
                                    onClick={() => window.open(generatedImage, '_blank')}
                                    title={GENERATE_TEST.MESSAGES.CLICK_TO_ZOOM}
                                />
                            </div>
                        </div>
                    )}

                    {/* 解決済みプロンプト */}
                    {result?.success && result.resolvedPrompt && (
                        <div className="space-y-1">
                            <label className="text-sm font-medium text-gray-400">{GENERATE_TEST.LABELS.RESOLVED_PROMPT}</label>
                            <div className="border border-gray-700 rounded-lg overflow-hidden text-xs">
                                {/* ポジティブ */}
                                <button
                                    onClick={() => setShowPositive(!showPositive)}
                                    className="w-full flex items-center gap-1 px-3 py-1.5 bg-gray-800/70 hover:bg-gray-800 text-gray-400 transition-colors border-b border-gray-700"
                                >
                                    {showPositive ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                    {GENERATE_TEST.LABELS.POSITIVE_PROMPT}
                                </button>
                                {showPositive && (
                                    <div className="px-3 py-2 text-gray-300 bg-gray-800/30 border-b border-gray-700 break-all">
                                        {result.resolvedPrompt.positive || GENERATE_TEST.PLACEHOLDERS.NONE}
                                    </div>
                                )}

                                {/* ネガティブ */}
                                <button
                                    onClick={() => setShowNegative(!showNegative)}
                                    className="w-full flex items-center gap-1 px-3 py-1.5 bg-gray-800/70 hover:bg-gray-800 text-gray-400 transition-colors border-b border-gray-700"
                                >
                                    {showNegative ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                    {GENERATE_TEST.LABELS.NEGATIVE_PROMPT}
                                </button>
                                {showNegative && (
                                    <div className="px-3 py-2 text-gray-300 bg-gray-800/30 border-b border-gray-700 break-all">
                                        {result.resolvedPrompt.negative || GENERATE_TEST.PLACEHOLDERS.NONE}
                                    </div>
                                )}

                                {/* LoRA（ComfyUI 連携のみ） */}
                                {result.backend !== 'api' && (
                                    <>
                                        <button
                                            onClick={() => setShowLoras(!showLoras)}
                                            className="w-full flex items-center gap-1 px-3 py-1.5 bg-gray-800/70 hover:bg-gray-800 text-gray-400 transition-colors"
                                        >
                                            {showLoras ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                            {GENERATE_TEST.MESSAGES.APPLIED_LORA} ({result.resolvedPrompt.lorasApplied.length}{COMMON.MESSAGES.COUNT_SUFFIX})
                                        </button>
                                        {showLoras && (
                                            <div className="px-3 py-2 text-gray-300 bg-gray-800/30 break-all">
                                                {result.resolvedPrompt.lorasApplied.length > 0
                                                    ? result.resolvedPrompt.lorasApplied.join(', ')
                                                    : GENERATE_TEST.PLACEHOLDERS.NONE}
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                            {result.backend === 'api' && (
                                <ApiGenerateResultDetails result={result} uiCatalog={uiCatalog} />
                            )}
                        </div>
                    )}
                </div>

                {/* フッター */}
                <div className="flex items-center justify-between px-5 py-3 border-t border-gray-700 bg-gray-800/50">
                    <div>
                        {onOpenIntegrated && (
                            <button
                                onClick={() => { onClose(); onOpenIntegrated(); }}
                                className="px-3 py-1.5 text-xs text-purple-300 border border-purple-600/50 rounded hover:bg-purple-900/30 transition-colors"
                            >
                                {INTEGRATED.OPEN_BUTTON_LABEL}
                            </button>
                        )}
                    </div>
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm text-gray-300 hover:text-gray-100 hover:bg-gray-700 rounded-lg transition-colors"
                    >
                        {COMMON.BUTTONS.CLOSE}
                    </button>
                </div>
            </div>
        </div>
    );
};
