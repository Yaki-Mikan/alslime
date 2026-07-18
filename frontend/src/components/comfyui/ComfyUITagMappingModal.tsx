/**
 * ComfyUITagMappingModal.tsx - その他画像生成設定モーダル
 *
 * カテゴリ別のタグマッピング（照合キー・danbooru語・LoRA）を管理する。
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X, Plus, Trash2, Search, Save, Tag, ArrowUpDown, ArrowUp, ArrowDown, Layers, List, Pencil } from 'lucide-react';
import {
    getTagCategories,
    getTagMapping,
    saveTagMapping,
    listComfyUITemplates,
    getLorasByCategory,
    getLoraDirConfig,
    saveLoraDirConfig,
    getLoraTriggerWords,
    searchDanbooruTags,
} from '../../api/comfyui';
import type { DanbooruTagFormat, DanbooruTagResult } from '../../api/comfyui';
import type {
    TagCategory,
    TagEntry,
    TagMappingFile,
    TagLoraEntry,
    LoraDirConfig,
    TemplateInfo,
} from '../../api/comfyui';
import { formatDanbooruTag, formatTriggerLine } from './danbooru-format';
import { useDanbooruTagFormat } from './useDanbooruTagFormat';
import { useTriggerWordFormat } from './useTriggerWordFormat';
import { createComfyUIText } from './i18n';
import type { I18NCatalog } from '../../api/i18n';

interface ComfyUITagMappingModalProps {
    isOpen: boolean;
    onClose: () => void;
    backendUrl: string;
    danbooruTagFormat?: DanbooruTagFormat;
    onOpenIntegrated?: () => void;
    uiCatalog?: I18NCatalog | null;
}

export const ComfyUITagMappingModal: React.FC<ComfyUITagMappingModalProps> = ({
    isOpen,
    onClose,
    backendUrl,
    danbooruTagFormat,
    onOpenIntegrated,
    uiCatalog = null,
}) => {
    const { COMMON, DANBOORU, INTEGRATED, LORA, SECTION_NAMES, TAG_MAPPING, TRIGGER_WORDS } = createComfyUIText(uiCatalog);
    const effectiveDanbooruTagFormat = useDanbooruTagFormat(backendUrl, isOpen, danbooruTagFormat);
    const effectiveTriggerWordFormat = useTriggerWordFormat(backendUrl, isOpen);
    // カテゴリ一覧
    const [categories, setCategories] = useState<TagCategory[]>([]);
    const [selectedCategoryId, setSelectedCategoryId] = useState('');

    // タグデータ
    const [mappingData, setMappingData] = useState<TagMappingFile | null>(null);
    const [selectedTagIndex, setSelectedTagIndex] = useState<number | null>(null);
    const [templates, setTemplates] = useState<TemplateInfo[]>([]);

    // LoRA
    const [loraList, setLoraList] = useState<string[]>([]);
    const [loraDropdownIdx, setLoraDropdownIdx] = useState<number | null>(null);
    const [loraSearchQuery, setLoraSearchQuery] = useState('');

    // LoRA詳細モード（M/C個別入力）
    const [loraDetailMode, setLoraDetailMode] = useState<Record<number, boolean>>({});

    // トリガーワード（個別ワード配列：既存表示用）
    const [triggerWords, setTriggerWords] = useState<Record<string, string[]>>({});
    // トリガーワード（行配列：1行＝1グループ。行コピー用）
    const [triggerLines, setTriggerLines] = useState<Record<string, string[]>>({});

    // LoRAディレクトリ設定
    const [loraDirConfig, setLoraDirConfig] = useState<LoraDirConfig | null>(null);
    const [loraDirDirty, setLoraDirDirty] = useState(false);

    // Danbooruタグ検索
    const [danbooruQuery, setDanbooruQuery] = useState('');
    const [danbooruResults, setDanbooruResults] = useState<DanbooruTagResult[]>([]);
    const [danbooruLoading, setDanbooruLoading] = useState(false);
    const [danbooruCopied, setDanbooruCopied] = useState<string | null>(null);

    // ソート
    const [sortOrder, setSortOrder] = useState<'none' | 'asc' | 'desc'>('none');

    // 状態
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isDirty, setIsDirty] = useState(false);
    const [saveMessage, setSaveMessage] = useState<string | null>(null);

    const loraDropdownRef = useRef<HTMLDivElement>(null);

    // 初回: カテゴリ一覧 + LoRAディレクトリ設定読み込み
    useEffect(() => {
        if (!isOpen) return;
        (async () => {
            try {
                const [def, dirConfig, templateList] = await Promise.all([
                    getTagCategories(backendUrl),
                    getLoraDirConfig(backendUrl),
                    listComfyUITemplates(backendUrl),
                ]);
                setCategories(def.categories || []);
                setLoraDirConfig(dirConfig);
                setTemplates(templateList);
                setLoraDirDirty(false);
                if (def.categories.length > 0 && !selectedCategoryId) {
                    setSelectedCategoryId(def.categories[0].id);
                }
            } catch (e) {
                console.error('[ComfyUITagMappingModal] category load failed:', e);
            }
        })();
    }, [isOpen, backendUrl]);

    // カテゴリ変更時: タグデータ + LoRA読み込み
    useEffect(() => {
        if (!isOpen || !selectedCategoryId) return;
        setSelectedTagIndex(null);
        setLoraDropdownIdx(null);
        setLoraDetailMode({});
        setIsDirty(false);
        setSaveMessage(null);

        (async () => {
            setIsLoading(true);
            try {
                const data = await getTagMapping(backendUrl, selectedCategoryId);
                // 各タグのloraが空なら空行を1つ追加（LoRA選択UIを表示するため）
                for (const tag of data.tags) {
                    if (!tag.lora || tag.lora.length === 0) {
                        tag.lora = [{ name: '', strengthModel: 1.0, strengthClip: 1.0 }];
                    }
                }
                setMappingData(data);

                // このカテゴリにLoRAプレフィックスがあればLoRA一覧も取得
                const cat = categories.find(c => c.id === selectedCategoryId);
                if (cat && cat.loraPrefixes.length > 0) {
                    const loras = await getLorasByCategory(backendUrl, selectedCategoryId);
                    setLoraList(loras);
                } else {
                    setLoraList([]);
                }
            } catch (e) {
                console.error('[ComfyUITagMappingModal] tag mapping load failed:', e);
                setMappingData({ categoryId: selectedCategoryId, tags: [] });
            } finally {
                setIsLoading(false);
            }
        })();
    }, [isOpen, selectedCategoryId, categories, backendUrl]);

    // 外側クリックでLoRAドロップダウン閉じる
    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (loraDropdownRef.current && !loraDropdownRef.current.contains(e.target as Node)) {
                setLoraDropdownIdx(null);
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    const selectedCategory = categories.find(c => c.id === selectedCategoryId);
    const hasLoraPrefixes = selectedCategory ? selectedCategory.loraPrefixes.length > 0 : false;
    const selectedTag = mappingData && selectedTagIndex !== null ? mappingData.tags[selectedTagIndex] : null;

    // 現在カテゴリのLoRAディレクトリ値
    const currentLoraDirValue = loraDirConfig
        ? loraDirConfig.categories.find(c => c.id === selectedCategoryId)?.directory || ''
        : '';

    // LoRAディレクトリ更新
    const updateLoraDir = useCallback((value: string) => {
        if (!loraDirConfig) return;
        const newCategories = loraDirConfig.categories.map(c =>
            c.id === selectedCategoryId ? { ...c, directory: value } : c
        );
        setLoraDirConfig({ ...loraDirConfig, categories: newCategories });
        setLoraDirDirty(true);
    }, [loraDirConfig, selectedCategoryId]);

    // ソートされたタグインデックス配列
    const sortedIndices: number[] = mappingData
        ? mappingData.tags.map((_, i) => i).sort((a, b) => {
            if (sortOrder === 'none') return 0;
            const ka = mappingData.tags[a].key;
            const kb = mappingData.tags[b].key;
            const cmp = ka.localeCompare(kb, 'ja');
            return sortOrder === 'asc' ? cmp : -cmp;
        })
        : [];

    // ソート切り替え
    const toggleSort = useCallback(() => {
        setSortOrder(prev => prev === 'none' ? 'asc' : prev === 'asc' ? 'desc' : 'none');
    }, []);

    // タグフィールド更新
    const updateTagField = useCallback((field: keyof TagEntry, value: any) => {
        if (!mappingData || selectedTagIndex === null) return;
        const newTags = [...mappingData.tags];
        newTags[selectedTagIndex] = { ...newTags[selectedTagIndex], [field]: value };
        setMappingData({ ...mappingData, tags: newTags });
        setIsDirty(true);
    }, [mappingData, selectedTagIndex]);

    // LoRA更新
    const updateTagLora = useCallback((loraIndex: number, field: keyof TagLoraEntry, value: any) => {
        if (!mappingData || selectedTagIndex === null) return;
        const tag = mappingData.tags[selectedTagIndex];
        const newLora = [...tag.lora];
        newLora[loraIndex] = { ...newLora[loraIndex], [field]: value };
        updateTagField('lora', newLora);
    }, [mappingData, selectedTagIndex, updateTagField]);

    // トリガーワードUI
    const [triggerWordsLoading, setTriggerWordsLoading] = useState<Record<number, boolean>>({});

    // Danbooruタグ検索（Enter or ボタン押下時） - フィルタなし（全カテゴリ）
    const handleDanbooruSearch = useCallback(async () => {
        const q = danbooruQuery.trim();
        if (!q) return;
        setDanbooruLoading(true);
        setDanbooruResults([]);
        setDanbooruCopied(null);
        try {
            const result = await searchDanbooruTags(backendUrl, q);
            if (result.success) {
                setDanbooruResults(result.results);
            }
        } catch { /* 無視 */ }
        setDanbooruLoading(false);
    }, [backendUrl, danbooruQuery]);

    const handleDanbooruCopy = useCallback(async (value: string) => {
        const formatted = formatDanbooruTag(value, effectiveDanbooruTagFormat);
        try {
            await navigator.clipboard.writeText(formatted);
            setDanbooruCopied(formatted);
            setTimeout(() => setDanbooruCopied(null), 1500);
        } catch {
            setDanbooruCopied(null);
        }
    }, [effectiveDanbooruTagFormat]);

    // トリガーワード取得（ボタン押下時）
    const handleFetchTriggerWords = useCallback(async (loraIdx: number, loraName: string) => {
        if (!loraName) return;
        if (triggerWords[loraName]) {
            return;
        }
        setTriggerWordsLoading(prev => ({ ...prev, [loraIdx]: true }));
        try {
            const result = await getLoraTriggerWords(backendUrl, loraName);
            if (result.success) {
                setTriggerWords(prev => ({ ...prev, [loraName]: result.triggerWords }));
                // 行配列。無ければ triggerWords を1行に包んでフォールバック
                const lines = (result.triggerLines && result.triggerLines.length > 0)
                    ? result.triggerLines
                    : (result.triggerWords.length > 0 ? [result.triggerWords.join(', ')] : []);
                setTriggerLines(prev => ({ ...prev, [loraName]: lines }));
            }
        } catch { /* 無視 */ }
        setTriggerWordsLoading(prev => ({ ...prev, [loraIdx]: false }));
    }, [backendUrl, triggerWords]);

    // LoRA選択
    const selectLora = useCallback((loraIndex: number, loraName: string) => {
        if (!mappingData || selectedTagIndex === null) return;
        const tag = mappingData.tags[selectedTagIndex];
        const newLora = [...tag.lora];
        newLora[loraIndex] = { ...newLora[loraIndex], name: loraName };

        // 最後の行で選択 → 新しい空行を自動追加
        if (loraIndex === newLora.length - 1 && loraName) {
            newLora.push({ name: '', strengthModel: 1.0, strengthClip: 1.0 });
        }

        updateTagField('lora', newLora);
        setLoraDropdownIdx(null);
        setLoraSearchQuery('');
    }, [mappingData, selectedTagIndex, updateTagField]);

    // LoRA削除
    const removeLora = useCallback((loraIndex: number) => {
        if (!mappingData || selectedTagIndex === null) return;
        const tag = mappingData.tags[selectedTagIndex];
        const newLora = tag.lora.filter((_, i) => i !== loraIndex);
        if (newLora.length === 0) {
            newLora.push({ name: '', strengthModel: 1.0, strengthClip: 1.0 });
        }
        updateTagField('lora', newLora);
        setLoraDetailMode({});
    }, [mappingData, selectedTagIndex, updateTagField]);

    // 新規タグ追加
    const addNewTag = useCallback(() => {
        if (!mappingData) return;
        const newTag: TagEntry = {
            key: '',
            description: '',
            prompt: '',
            negativePrompt: '',
            workflowTemplateId: '',
            lora: [{ name: '', strengthModel: 1.0, strengthClip: 1.0 }],
        };
        const newTags = [...mappingData.tags, newTag];
        setMappingData({ ...mappingData, tags: newTags });
        setSelectedTagIndex(newTags.length - 1);
        setLoraDetailMode({});
        setIsDirty(true);
    }, [mappingData]);

    // タグ削除
    const deleteTag = useCallback((index: number) => {
        if (!mappingData) return;
        const newTags = mappingData.tags.filter((_, i) => i !== index);
        setMappingData({ ...mappingData, tags: newTags });
        if (selectedTagIndex === index) {
            setSelectedTagIndex(null);
        } else if (selectedTagIndex !== null && selectedTagIndex > index) {
            setSelectedTagIndex(selectedTagIndex - 1);
        }
        setLoraDetailMode({});
        setIsDirty(true);
    }, [mappingData, selectedTagIndex]);

    // 保存
    const handleSave = useCallback(async () => {
        if (!mappingData || !selectedCategoryId) return;
        setIsSaving(true);
        try {
            // 空LoRA行を除外して保存
            const cleanData: TagMappingFile = {
                ...mappingData,
                tags: mappingData.tags.map(tag => ({
                    ...tag,
                    workflowTemplateId: tag.workflowTemplateId?.trim() || undefined,
                    lora: tag.lora.filter(l => l.name),
                })),
            };
            const promises: Promise<void>[] = [
                saveTagMapping(backendUrl, selectedCategoryId, cleanData),
            ];
            // LoRAディレクトリ設定が変更されていれば一緒に保存
            if (loraDirDirty && loraDirConfig) {
                promises.push(saveLoraDirConfig(backendUrl, loraDirConfig));
            }
            await Promise.all(promises);
            setIsDirty(false);
            setLoraDirDirty(false);
            setSaveMessage(COMMON.MESSAGES.SAVED);
            setTimeout(() => setSaveMessage(null), 3000);
        } catch (e) {
            console.error('[ComfyUITagMappingModal] save failed:', e);
            setSaveMessage(COMMON.MESSAGES.SAVE_FAILED);
        } finally {
            setIsSaving(false);
        }
    }, [mappingData, selectedCategoryId, backendUrl, loraDirDirty, loraDirConfig]);

    // LoRA検索フィルタ
    const filteredLoraList = loraSearchQuery.trim()
        ? loraList.filter(l => l.toLowerCase().includes(loraSearchQuery.trim().toLowerCase()))
        : loraList;

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
            <div
                className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-2xl border border-gray-700 flex flex-col max-h-[85vh]"
                onClick={e => e.stopPropagation()}
            >
                {/* ヘッダー */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
                    <div className="flex items-center gap-2">
                        <Tag size={18} className="text-cyan-400" />
                        <h2 className="text-lg font-semibold text-gray-100">{SECTION_NAMES.OTHER_IMAGE_SETTINGS}</h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-200 transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* 本体 */}
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 custom-scrollbar">
                    {/* カテゴリ選択 */}
                    <div className="space-y-1">
                        <label className="flex items-center gap-2 text-sm font-medium text-gray-400">
                            <Layers size={16} className="text-cyan-400" />
                            {TAG_MAPPING.LABELS.CATEGORY}
                        </label>
                        <select
                            value={selectedCategoryId}
                            onChange={e => setSelectedCategoryId(e.target.value)}
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-cyan-500"
                        >
                            {categories.map(cat => (
                                <option key={cat.id} value={cat.id}>{cat.label}</option>
                            ))}
                        </select>
                    </div>

                    {/* LoRAディレクトリ設定（インライン） */}
                    {loraDirConfig && selectedCategoryId && (
                        <div className="space-y-1">
                            <label className="text-xs text-gray-500">{TAG_MAPPING.LABELS.LORA_DIRECTORY}</label>
                            <input
                                type="text"
                                value={currentLoraDirValue}
                                onChange={e => updateLoraDir(e.target.value)}
                                placeholder={TAG_MAPPING.PLACEHOLDERS.LORA_DIRECTORY}
                                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 outline-none focus:border-cyan-500"
                            />
                            <p className="text-xs text-gray-600">{TAG_MAPPING.HELP.LORA_DIRECTORY_DESC}</p>
                        </div>
                    )}

                    {isLoading ? (
                        <div className="flex items-center justify-center py-8">
                            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-cyan-400" />
                        </div>
                    ) : mappingData && (
                        <>
                            {/* タグ一覧 */}
                            <div className="space-y-1">
                                <label className="flex items-center gap-2 text-sm font-medium text-gray-400">
                                    <List size={16} className="text-cyan-400" />
                                    {TAG_MAPPING.LABELS.TAG_LIST}
                                </label>
                                <div className="border border-gray-700 rounded-lg overflow-hidden">
                                    {/* ヘッダー行 */}
                                    <div className="flex items-center bg-gray-800/70 px-3 py-1.5 text-xs text-gray-500 border-b border-gray-700">
                                        <button
                                            onClick={toggleSort}
                                            className="flex-1 flex items-center gap-1 hover:text-gray-300 transition-colors text-left"
                                        >
                                            {TAG_MAPPING.LABELS.MATCH_KEY}
                                            {sortOrder === 'asc' ? <ArrowUp size={10} /> : sortOrder === 'desc' ? <ArrowDown size={10} /> : <ArrowUpDown size={10} className="opacity-40" />}
                                        </button>
                                        <span className="flex-1">{TAG_MAPPING.LABELS.DANBOORU_PROMPT_SHORT}</span>
                                        {hasLoraPrefixes && <span className="w-16 text-center">LoRA</span>}
                                        <span className="w-8" />
                                    </div>
                                    {/* タグ行 */}
                                    <div className="max-h-40 overflow-y-auto custom-scrollbar">
                                        {sortedIndices.map((idx) => {
                                            const tag = mappingData.tags[idx];
                                            return (
                                            <div
                                                key={idx}
                                                onClick={() => {
                                                    setSelectedTagIndex(idx);
                                                    setLoraDropdownIdx(null);
                                                    setLoraDetailMode({});
                                                }}
                                                className={`flex items-center px-3 py-1.5 text-sm cursor-pointer border-b border-gray-800 transition-colors ${
                                                    selectedTagIndex === idx
                                                        ? 'bg-cyan-600/20 text-cyan-200'
                                                        : 'hover:bg-gray-800/50 text-gray-300'
                                                }`}
                                            >
                                                <span className="flex-1 truncate">{tag.key || TAG_MAPPING.MESSAGES.NOT_SET}</span>
                                                <span className="flex-1 truncate text-gray-400">{tag.prompt || '-'}</span>
                                                {hasLoraPrefixes && (
                                                    <span className="w-16 text-center text-xs">
                                                        {tag.lora.filter(l => l.name).length > 0 ? COMMON.HAS_LORA : COMMON.EMPTY_MARKER}
                                                    </span>
                                                )}
                                                <button
                                                    onClick={e => { e.stopPropagation(); deleteTag(idx); }}
                                                    className="w-8 flex items-center justify-center text-gray-600 hover:text-red-400 transition-colors"
                                                >
                                                    <Trash2 size={12} />
                                                </button>
                                            </div>
                                            );
                                        })}
                                        {mappingData.tags.length === 0 && (
                                            <p className="text-xs text-gray-600 text-center py-3">{TAG_MAPPING.MESSAGES.NO_TAGS}</p>
                                        )}
                                    </div>
                                    {/* 新規追加 */}
                                    <button
                                        onClick={addNewTag}
                                        className="w-full flex items-center justify-center gap-1 px-3 py-2 text-xs text-cyan-400 hover:bg-gray-800/50 transition-colors"
                                    >
                                        <Plus size={12} />
                                        {COMMON.BUTTONS.NEW_ADD}
                                    </button>
                                </div>
                            </div>

                            {/* 選択中のタグ編集 */}
                            {selectedTag && (
                                <div className="space-y-3 border border-gray-700 rounded-lg p-4">
                                    <label className="flex items-center gap-2 text-sm font-medium text-gray-400">
                                        <Pencil size={16} className="text-cyan-400" />
                                        {TAG_MAPPING.LABELS.EDIT_TAG}
                                    </label>

                                    {/* Danbooruタグ検索 */}
                                    <div className="space-y-1.5">
                                        <label className="text-xs text-gray-500">
                                            {DANBOORU.LABELS.TAG_SEARCH}
                                            <span className="text-gray-600 ml-2">{DANBOORU.MESSAGES.CLICK_TO_COPY}</span>
                                        </label>
                                        <div className="flex gap-2">
                                            <input
                                                type="text"
                                                value={danbooruQuery}
                                                onChange={(e) => setDanbooruQuery(e.target.value)}
                                                onKeyDown={(e) => { if (e.key === 'Enter') handleDanbooruSearch(); }}
                                                placeholder={DANBOORU.PLACEHOLDERS.SEARCH_ALL}
                                                className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 outline-none focus:border-cyan-500 transition-colors"
                                            />
                                            <button
                                                onClick={handleDanbooruSearch}
                                                disabled={danbooruLoading || !danbooruQuery.trim()}
                                                className="px-3 py-1.5 bg-gray-800 border border-cyan-700 rounded text-xs text-cyan-400 hover:bg-cyan-900/30 hover:text-cyan-300 disabled:opacity-50 transition-colors flex items-center gap-1"
                                            >
                                                <Search size={12} />
                                                {danbooruLoading ? COMMON.BUTTONS.SEARCHING : COMMON.BUTTONS.SEARCH}
                                            </button>
                                        </div>
                                        {danbooruResults.length > 0 && (
                                            <div className="flex flex-wrap gap-1.5 pl-1">
                                                {danbooruResults.map((tag, i) => {
                                                    const catLabel = DANBOORU.CATEGORY_NAMES[tag.category] || `${tag.category}`;
                                                    const formattedValue = formatDanbooruTag(tag.value, effectiveDanbooruTagFormat);
                                                    return (
                                                        <span
                                                            key={i}
                                                            onClick={() => handleDanbooruCopy(tag.value)}
                                                            className={`border rounded px-2 py-1 text-xs cursor-pointer transition-colors ${
                                                                danbooruCopied === formattedValue
                                                                    ? 'bg-cyan-700/40 border-cyan-500 text-cyan-200'
                                                                    : 'bg-gray-800 border-gray-600 text-cyan-300 hover:bg-gray-700'
                                                            }`}
                                                            title={`${DANBOORU.MESSAGES.CLICK_TO_COPY}${tag.antecedent ? ` (${tag.antecedent})` : ''} [${catLabel}] ${DANBOORU.MESSAGES.POST_COUNT}: ${tag.postCount}`}
                                                        >
                                                            {formattedValue}
                                                            <span className="ml-1 text-gray-500 text-[10px]">{catLabel}</span>
                                                            {danbooruCopied === formattedValue && <span className="ml-1 text-cyan-400">✓</span>}
                                                        </span>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>

                                    {/* 照合キー */}
                                    <div className="space-y-1">
                                        <label className="text-xs text-gray-500">{TAG_MAPPING.LABELS.MATCH_KEY}</label>
                                        <input
                                            type="text"
                                            value={selectedTag.key}
                                            onChange={e => updateTagField('key', e.target.value)}
                                            placeholder={TAG_MAPPING.PLACEHOLDERS.MATCH_KEY}
                                            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 outline-none focus:border-cyan-500"
                                        />
                                    </div>

                                    {/* AIへの説明 */}
                                    <div className="space-y-1">
                                        <label className="text-xs text-gray-500">{TAG_MAPPING.LABELS.AI_DESCRIPTION}</label>
                                        <input
                                            type="text"
                                            value={selectedTag.description || ''}
                                            onChange={e => updateTagField('description', e.target.value)}
                                            placeholder={TAG_MAPPING.PLACEHOLDERS.AI_DESCRIPTION}
                                            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 outline-none focus:border-cyan-500"
                                        />
                                    </div>

                                    {/* danbooru語 */}
                                    <div className="space-y-1">
                                        <label className="text-xs text-gray-500">{TAG_MAPPING.LABELS.DANBOORU_PROMPT}</label>
                                        <textarea
                                            value={selectedTag.prompt}
                                            onChange={e => updateTagField('prompt', e.target.value)}
                                            placeholder={TAG_MAPPING.PLACEHOLDERS.DANBOORU_PROMPT}
                                            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 outline-none focus:border-cyan-500 resize-y"
                                            rows={2}
                                        />
                                    </div>

                                    {/* ネガティブプロンプト */}
                                    <div className="space-y-1">
                                        <label className="text-xs text-gray-500">{TAG_MAPPING.LABELS.NEGATIVE_PROMPT}</label>
                                        <textarea
                                            value={selectedTag.negativePrompt}
                                            onChange={e => updateTagField('negativePrompt', e.target.value)}
                                            placeholder={TAG_MAPPING.PLACEHOLDERS.NEGATIVE_PROMPT}
                                            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 outline-none focus:border-cyan-500 resize-y"
                                            rows={1}
                                        />
                                    </div>

                                    {selectedCategoryId === 'pose' && (
                                        <div className="space-y-1">
                                            <label className="text-xs text-gray-500">{TAG_MAPPING.LABELS.PRIORITY_WORKFLOW}</label>
                                            <select
                                                value={selectedTag.workflowTemplateId || ''}
                                                onChange={e => updateTagField('workflowTemplateId', e.target.value)}
                                                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 outline-none focus:border-cyan-500"
                                            >
                                                <option value="">{TAG_MAPPING.MESSAGES.USE_CURRENT_WORKFLOW}</option>
                                                {templates.map(template => (
                                                    <option key={template.name} value={template.name}>{template.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                    )}

                                    {/* LoRA選択 */}
                                    {hasLoraPrefixes && (
                                        <div className="space-y-1" ref={loraDropdownRef}>
                                            <label className="text-xs text-gray-500">LoRA</label>
                                            {selectedTag.lora.map((lora, loraIdx) => {
                                                const isDetail = loraDetailMode[loraIdx] || false;
                                                return (
                                                    <div key={loraIdx} className="space-y-1">
                                                        <div className="flex items-center gap-1.5">
                                                            {/* LoRA選択ボタン */}
                                                            <div
                                                                onClick={() => {
                                                                    setLoraDropdownIdx(loraDropdownIdx === loraIdx ? null : loraIdx);
                                                                    setLoraSearchQuery('');
                                                                }}
                                                                className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm cursor-pointer hover:border-cyan-500 transition-colors flex items-center justify-between"
                                                            >
                                                                <span className={`truncate ${lora.name ? 'text-gray-200' : 'text-gray-500'}`}>
                                                                    {lora.name || LORA.PLACEHOLDERS.SELECT_LORA}
                                                                </span>
                                                                <Search size={12} className="text-gray-500 shrink-0 ml-1" />
                                                            </div>

                                                            {/* 強度入力 */}
                                                            {lora.name && (
                                                                <>
                                                                    {isDetail ? (
                                                                        <>
                                                                            <input
                                                                                type="number"
                                                                                value={lora.strengthModel}
                                                                                onChange={e => updateTagLora(loraIdx, 'strengthModel', parseFloat(e.target.value) || 0)}
                                                                                step={0.05}
                                                                                className="w-14 bg-gray-800 border border-gray-700 rounded px-1 py-1.5 text-xs text-center text-gray-200 outline-none focus:border-cyan-500"
                                                                                title={LORA.LABELS.MODEL_STRENGTH}
                                                                            />
                                                                            <input
                                                                                type="number"
                                                                                value={lora.strengthClip}
                                                                                onChange={e => updateTagLora(loraIdx, 'strengthClip', parseFloat(e.target.value) || 0)}
                                                                                step={0.05}
                                                                                className="w-14 bg-gray-800 border border-gray-700 rounded px-1 py-1.5 text-xs text-center text-gray-200 outline-none focus:border-cyan-500"
                                                                                title={LORA.LABELS.CLIP_STRENGTH}
                                                                            />
                                                                        </>
                                                                    ) : (
                                                                        <input
                                                                            type="number"
                                                                            value={lora.strengthModel}
                                                                            onChange={e => {
                                                                                const v = parseFloat(e.target.value) || 0;
                                                                                updateTagLora(loraIdx, 'strengthModel', v);
                                                                                updateTagLora(loraIdx, 'strengthClip', v);
                                                                            }}
                                                                            step={0.05}
                                                                            className="w-14 bg-gray-800 border border-gray-700 rounded px-1 py-1.5 text-xs text-center text-gray-200 outline-none focus:border-cyan-500"
                                                                            title={LORA.LABELS.STRENGTH}
                                                                        />
                                                                    )}
                                                                    <button
                                                                        onClick={() => setLoraDetailMode(prev => ({ ...prev, [loraIdx]: !isDetail }))}
                                                                        className={`px-1 py-1 text-xs rounded transition-colors ${isDetail ? 'bg-blue-600/30 text-blue-300' : 'bg-gray-800 text-gray-500 hover:text-gray-300'}`}
                                                                    >
                                                                        {isDetail ? LORA.LABELS.SIMPLE_MODE : LORA.LABELS.DETAIL_MODE}
                                                                    </button>
                                                                </>
                                                            )}

                                                            {/* 削除 */}
                                                            <button
                                                                onClick={() => removeLora(loraIdx)}
                                                                className="p-0.5 text-gray-600 hover:text-red-400 transition-colors"
                                                            >
                                                                <Trash2 size={12} />
                                                            </button>
                                                        </div>

                                                        {/* LoRAドロップダウン */}
                                                        {loraDropdownIdx === loraIdx && (
                                                            <div className="bg-gray-800 border border-gray-600 rounded-lg overflow-hidden">
                                                                <div className="p-2 border-b border-gray-700">
                                                                    <input
                                                                        type="text"
                                                                        value={loraSearchQuery}
                                                                        onChange={e => setLoraSearchQuery(e.target.value)}
                                                                        placeholder={LORA.PLACEHOLDERS.SEARCH_LORA}
                                                                        className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 outline-none focus:border-cyan-500"
                                                                        autoFocus
                                                                    />
                                                                </div>
                                                                <div className="max-h-40 overflow-y-auto custom-scrollbar">
                                                                    {filteredLoraList.length > 0 ? (
                                                                        filteredLoraList.map(loraName => (
                                                                            <button
                                                                                key={loraName}
                                                                                onClick={() => selectLora(loraIdx, loraName)}
                                                                                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-700 transition-colors ${
                                                                                    lora.name === loraName ? 'bg-cyan-600/30 text-cyan-200' : 'text-gray-300'
                                                                                }`}
                                                                            >
                                                                                {loraName}
                                                                            </button>
                                                                        ))
                                                                    ) : (
                                                                        <p className="text-xs text-gray-600 text-center py-3">{TAG_MAPPING.MESSAGES.NO_LORA_FOUND}</p>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        )}
                                                        {/* トリガーワード */}
                                                        {lora.name && (
                                                            <div className="space-y-1.5">
                                                                <button
                                                                    onClick={() => handleFetchTriggerWords(loraIdx, lora.name)}
                                                                    className="px-2 py-1 bg-gray-800 border border-cyan-700 rounded text-xs text-cyan-400 hover:bg-cyan-900/30 hover:text-cyan-300 transition-colors"
                                                                >
                                                                    {triggerWordsLoading[loraIdx] ? TRIGGER_WORDS.LABELS.FETCHING : triggerWords[lora.name] ? TRIGGER_WORDS.LABELS.FETCHED : TRIGGER_WORDS.LABELS.FETCH}
                                                                </button>
                                                                {triggerWords[lora.name] && (
                                                                    <div className="space-y-1 pl-1">
                                                                        {(triggerLines[lora.name] && triggerLines[lora.name].length > 0) ? triggerLines[lora.name].map((line, li) => {
                                                                            const formattedLine = formatTriggerLine(line, effectiveTriggerWordFormat);
                                                                            return (
                                                                                <div
                                                                                    key={li}
                                                                                    onClick={() => { navigator.clipboard.writeText(formattedLine); }}
                                                                                    className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-cyan-300 cursor-pointer hover:bg-gray-700 transition-colors break-words"
                                                                                    title={COMMON.MESSAGES.COPY_ROW_TOOLTIP}
                                                                                >
                                                                                    {formattedLine}
                                                                                </div>
                                                                            );
                                                                        }) : (
                                                                            <span className="text-xs text-gray-600">{TRIGGER_WORDS.MESSAGES.NONE}</span>
                                                                        )}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* フッター */}
                <div className="flex items-center justify-between px-5 py-3 border-t border-gray-700 bg-gray-800/50">
                    <div className="flex items-center gap-3">
                        <span className="text-xs text-green-400">{saveMessage || ''}</span>
                        {onOpenIntegrated && (
                            <button
                                onClick={() => { onClose(); onOpenIntegrated(); }}
                                className="px-3 py-1.5 text-xs text-purple-300 border border-purple-600/50 rounded hover:bg-purple-900/30 transition-colors"
                            >
                                {INTEGRATED.OPEN_BUTTON_LABEL}
                            </button>
                        )}
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-sm text-gray-300 hover:text-gray-100 hover:bg-gray-700 rounded-lg transition-colors"
                        >
                            {COMMON.BUTTONS.CLOSE}
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={isSaving || (!isDirty && !loraDirDirty)}
                            className="px-4 py-2 text-sm text-white bg-green-600 hover:bg-green-500 disabled:opacity-50 rounded-lg transition-colors flex items-center gap-1.5"
                        >
                            <Save size={14} />
                            {isSaving ? COMMON.BUTTONS.SAVING : COMMON.BUTTONS.SAVE}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
