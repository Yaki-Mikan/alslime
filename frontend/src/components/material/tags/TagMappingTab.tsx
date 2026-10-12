/**
 * TagMappingTab.tsx - 素材づくりの「タグ」
 *
 * 左に分類（件数・追加・LoRA の置き場所）、真ん中に選んだ分類のタグの表、右に選んだタグの編集。
 * タグの表と編集は分類ごとにまとめて保存する。有効の切り替えは、保存していない変更が無ければその場で送る。
 * トリガーワードはタグごとには持たないので、LoRA から読み取った値を表示だけする。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, Plus, RefreshCw, Save, Search, Trash2 } from 'lucide-react';
import {
    getAllTagMappings,
    getComfyUIConfig,
    getLoraDirConfig,
    getLoraTriggerWords,
    getLoraTriggerWordsBatch,
    getTagMapping,
    listApiServicePresets,
    listComfyUITemplates,
    saveLoraDirConfig,
    saveTagCategories,
    saveTagMapping,
    setTagEnabled,
    tagTargetsOf,
} from '../../../api/comfyui';
import type {
    ImageBackend,
    LoraDirConfig,
    NovelAIPreset,
    TagCategory,
    TagEntry,
    TagLoraEntry,
    TagMappingFile,
    TemplateInfo,
} from '../../../api/comfyui';
import { formatLabelValue, resolveMessage, type I18NCatalog } from '../../../api/i18n';
import { MATERIAL_I18N_KEYS, MATERIAL_TEXT_FALLBACK_JA } from '../../../constants/i18n';
import { normalizeImageBackend } from '../../comfyui/apiservice/services';
import { formatTriggerLine } from '../../comfyui/danbooru-format';
import { createComfyUIText } from '../../comfyui/i18n';
import { IntegratedDanbooruSearch } from '../../comfyui/integrated/IntegratedDanbooruSearch';
import { LoraStrengthInput } from '../../comfyui/LoraStrengthInput';
import { LoraUnreachableNotice } from '../../comfyui/LoraUnreachableNotice';
import { useComfyLoras } from '../../comfyui/useComfyLoras';
import { useDanbooruTagFormat } from '../../comfyui/useDanbooruTagFormat';
import { useTriggerWordFormat } from '../../comfyui/useTriggerWordFormat';
import { Button, IconButton, Modal, TextArea, TextField, Toggle, cn } from '../../ui';
import { scrollListToSelected } from '../../../lib/listScroll';

const CATEGORY_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

const createEmptyTagLora = (): TagLoraEntry => ({ name: '', strengthModel: 1.0, strengthClip: 1.0 });

// 末尾が名前付きLoRAなら空の選択欄を1つ足し、常に次のLoRAを選べる状態にする（保存時に空行は除く）
const withTrailingEmptyLora = (lora: TagLoraEntry[] | undefined | null): TagLoraEntry[] => {
    const list = lora ? [...lora] : [];
    if (list.length === 0 || list[list.length - 1].name) list.push(createEmptyTagLora());
    return list;
};

interface TagMappingTabProps {
    backendUrl: string;
    uiCatalog: I18NCatalog | null;
    active: boolean;
}

export const TagMappingTab: React.FC<TagMappingTabProps> = ({ backendUrl, uiCatalog, active }) => {
    const { TAG_MAPPING, LORA, TRIGGER_WORDS, COMMON } = createComfyUIText(uiCatalog);
    const t = (key: string) => resolveMessage(uiCatalog, key, MATERIAL_TEXT_FALLBACK_JA[key] || key);
    const format = (template: string, values: Record<string, string | number>) =>
        Object.entries(values).reduce((text, [k, v]) => text.split(`{{${k}}}`).join(String(v)), template);

    const [categories, setCategories] = useState<TagCategory[]>([]);
    const [counts, setCounts] = useState<Record<string, number>>({});
    const [categoryId, setCategoryId] = useState('');
    const [mapping, setMapping] = useState<TagMappingFile | null>(null);
    const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isDirty, setIsDirty] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [loraDirConfig, setLoraDirConfig] = useState<LoraDirConfig | null>(null);
    const [loraDirDirty, setLoraDirDirty] = useState(false);
    const [templates, setTemplates] = useState<TemplateInfo[]>([]);
    const [imageBackend, setImageBackend] = useState<ImageBackend>('comfyui');
    const [apiPresets, setApiPresets] = useState<NovelAIPreset[]>([]);
    const isComfy = imageBackend === 'comfyui';
    const [query, setQuery] = useState('');
    const [sortOrder, setSortOrder] = useState<'none' | 'asc' | 'desc'>('none');
    const [pendingCategory, setPendingCategory] = useState<string | null>(null);
    const [addOpen, setAddOpen] = useState(false);
    const [newId, setNewId] = useState('');
    const [newLabel, setNewLabel] = useState('');
    const [addError, setAddError] = useState('');
    const [toast, setToast] = useState('');
    // LoRA ごとのトリガーワード（行の配列）
    const [triggerLines, setTriggerLines] = useState<Record<string, string[]>>({});
    const [triggerLoading, setTriggerLoading] = useState<Record<string, boolean>>({});
    const [loraPickerIdx, setLoraPickerIdx] = useState<number | null>(null);
    const loraAreaRef = useRef<HTMLDivElement>(null);
    const loraListRef = useRef<HTMLDivElement>(null);
    // LoRA の選択肢は、LoRA の欄の外を押したら閉じる（刷新前と同じ）
    useEffect(() => {
        if (loraPickerIdx === null) return;
        const handleMouseDown = (e: MouseEvent) => {
            if (!loraAreaRef.current?.contains(e.target as Node)) setLoraPickerIdx(null);
        };
        document.addEventListener('mousedown', handleMouseDown);
        return () => document.removeEventListener('mousedown', handleMouseDown);
    }, [loraPickerIdx]);
    // 開いたときは、今選んでいる LoRA の位置まで一覧を送る（番号違いの LoRA へ選び直しやすくするため）
    useEffect(() => {
        if (loraPickerIdx !== null) scrollListToSelected(loraListRef.current);
    }, [loraPickerIdx]);
    const [loraQuery, setLoraQuery] = useState('');
    const [loraDetail, setLoraDetail] = useState<Record<number, boolean>>({});

    const danbooruTagFormat = useDanbooruTagFormat(backendUrl, active, undefined);
    const triggerWordFormat = useTriggerWordFormat(backendUrl, active, undefined);
    const { lorasByCategory, comfyUnreachable, retry: refreshLoras } = useComfyLoras(backendUrl, categoryId ? [categoryId] : [], active && !!categoryId && isComfy);
    const loraList = lorasByCategory[categoryId] ?? [];

    const showToast = (message: string) => {
        setToast(message);
        setTimeout(() => setToast(''), 2500);
    };
    const categoryLabel = (c: TagCategory) => resolveMessage(uiCatalog, `comfyui.tagCategory.${c.id}`, c.label);

    // 初めて出したとき：分類・件数・LoRA の置き場所・ワークフロー・使う仕組み・API プリセット
    useEffect(() => {
        if (!active) return;
        let alive = true;
        Promise.all([
            getAllTagMappings(backendUrl),
            getLoraDirConfig(backendUrl).catch(() => null),
            listComfyUITemplates(backendUrl).catch(() => [] as TemplateInfo[]),
            getComfyUIConfig(backendUrl).catch(() => null),
            listApiServicePresets(backendUrl).catch(() => [] as NovelAIPreset[]),
        ]).then(([bundle, dirs, templateList, cfg, presets]) => {
            if (!alive) return;
            setCategories(bundle.categories);
            setCounts(Object.fromEntries(bundle.mappings.map(m => [m.categoryId, m.tags.length])));
            setLoraDirConfig(dirs);
            setTemplates(templateList);
            if (cfg) setImageBackend(normalizeImageBackend(cfg.imageBackend));
            setApiPresets(presets);
            setCategoryId(prev => prev || bundle.categories[0]?.id || '');
        }).catch(() => {});
        return () => { alive = false; };
    }, [active, backendUrl]);

    // 分類を読み込む
    useEffect(() => {
        if (!active || !categoryId) return;
        let alive = true;
        setIsLoading(true);
        getTagMapping(backendUrl, categoryId)
            .then(data => {
                if (!alive) return;
                setMapping({ ...data, tags: data.tags.map(tag => ({ ...tag, lora: withTrailingEmptyLora(tag.lora) })) });
            })
            .catch(() => { if (alive) setMapping({ categoryId, tags: [] }); })
            .finally(() => { if (alive) setIsLoading(false); });
        return () => { alive = false; };
    }, [active, backendUrl, categoryId]);

    // 表に出す LoRA のトリガーワードをまとめて読む（表示だけ）
    const usedLoras = useMemo(
        () => Array.from(new Set((mapping?.tags ?? []).flatMap(tag => tag.lora.map(l => l.name).filter(Boolean)))),
        [mapping],
    );
    useEffect(() => {
        if (!active || !isComfy) return;
        const missing = usedLoras.filter(name => !(name in triggerLines));
        if (missing.length === 0) return;
        let alive = true;
        getLoraTriggerWordsBatch(backendUrl, missing).then(results => {
            if (!alive) return;
            const next: Record<string, string[]> = {};
            for (const name of missing) {
                const r = results[name];
                next[name] = r?.success
                    ? (r.triggerLines && r.triggerLines.length > 0 ? r.triggerLines : (r.triggerWords.length > 0 ? [r.triggerWords.join(', ')] : []))
                    : [];
            }
            setTriggerLines(prev => ({ ...prev, ...next }));
        }).catch(() => {});
        return () => { alive = false; };
    }, [active, isComfy, backendUrl, usedLoras, triggerLines]);

    const fetchTriggerLines = async (name: string) => {
        if (!name || triggerLines[name]?.length || triggerLoading[name]) return;
        setTriggerLoading(prev => ({ ...prev, [name]: true }));
        try {
            const r = await getLoraTriggerWords(backendUrl, name);
            if (r.success) {
                const lines = r.triggerLines && r.triggerLines.length > 0 ? r.triggerLines : (r.triggerWords.length > 0 ? [r.triggerWords.join(', ')] : []);
                setTriggerLines(prev => ({ ...prev, [name]: lines }));
            }
        } catch { /* 読めなくても編集は続けられる */ }
        setTriggerLoading(prev => ({ ...prev, [name]: false }));
    };

    const selectedTag = mapping && selectedIndex !== null ? mapping.tags[selectedIndex] ?? null : null;

    const updateTag = useCallback((index: number, patch: Partial<TagEntry>) => {
        setMapping(prev => {
            if (!prev) return prev;
            const tags = [...prev.tags];
            tags[index] = { ...tags[index], ...patch };
            return { ...prev, tags };
        });
        setIsDirty(true);
    }, []);

    const updateSelected = (patch: Partial<TagEntry>) => {
        if (selectedIndex !== null) updateTag(selectedIndex, patch);
    };

    const updateSelectedLora = (loraIndex: number, patch: Partial<TagLoraEntry>) => {
        if (!selectedTag) return;
        const lora = [...selectedTag.lora];
        lora[loraIndex] = { ...lora[loraIndex], ...patch };
        updateSelected({ lora: withTrailingEmptyLora(lora) });
    };

    // 有効の切り替え。保存していない変更が無く、照合する言葉があれば、その場で送る
    const toggleEnabled = async (index: number, enabled: boolean) => {
        if (!mapping) return;
        const tag = mapping.tags[index];
        if (isDirty || !tag.key.trim()) {
            updateTag(index, { enabled: enabled ? undefined : false });
            return;
        }
        const apply = (value: boolean) => setMapping(prev => {
            if (!prev) return prev;
            const tags = [...prev.tags];
            tags[index] = { ...tags[index], enabled: value ? undefined : false };
            return { ...prev, tags };
        });
        apply(enabled);
        try {
            await setTagEnabled(backendUrl, categoryId, tag.key, enabled);
        } catch {
            apply(!enabled);
            showToast(t(MATERIAL_I18N_KEYS.tagsEnabledFailed));
        }
    };

    const setTarget = (index: number, key: 'comfyui' | 'api', checked: boolean) => {
        if (!mapping) return;
        const next = { ...tagTargetsOf(mapping.tags[index]), [key]: checked };
        updateTag(index, { targets: next.comfyui && next.api ? undefined : next });
    };

    const addTag = () => {
        if (!mapping) return;
        const tags = [...mapping.tags, { key: '', description: '', prompt: '', negativePrompt: '', workflowTemplateId: '', lora: [createEmptyTagLora()] }];
        setMapping({ ...mapping, tags });
        setSelectedIndex(tags.length - 1);
        setQuery('');
        setIsDirty(true);
    };

    const deleteTag = (index: number) => {
        if (!mapping) return;
        setMapping({ ...mapping, tags: mapping.tags.filter((_, i) => i !== index) });
        setSelectedIndex(prev => (prev === null || prev === index ? null : prev > index ? prev - 1 : prev));
        setIsDirty(true);
    };

    const currentLoraDir = loraDirConfig?.categories.find(c => c.id === categoryId)?.directory ?? '';
    const updateLoraDir = (value: string) => {
        if (!loraDirConfig) return;
        const exists = loraDirConfig.categories.some(c => c.id === categoryId);
        const label = categories.find(c => c.id === categoryId)?.label ?? categoryId;
        const next = exists
            ? loraDirConfig.categories.map(c => (c.id === categoryId ? { ...c, directory: value } : c))
            : [...loraDirConfig.categories, { id: categoryId, label, directory: value }];
        setLoraDirConfig({ ...loraDirConfig, categories: next });
        setLoraDirDirty(true);
    };

    const save = async (): Promise<boolean> => {
        if (!mapping || !categoryId) return false;
        setIsSaving(true);
        try {
            const clean: TagMappingFile = {
                ...mapping,
                tags: mapping.tags.map(tag => ({
                    ...tag,
                    workflowTemplateId: tag.workflowTemplateId?.trim() || undefined,
                    apiPresetId: tag.apiPresetId?.trim() || undefined,
                    lora: tag.lora.filter(l => l.name),
                })),
            };
            const jobs: Promise<void>[] = [];
            if (isDirty) jobs.push(saveTagMapping(backendUrl, categoryId, clean));
            if (loraDirDirty && loraDirConfig) jobs.push(saveLoraDirConfig(backendUrl, loraDirConfig));
            await Promise.all(jobs);
            setIsDirty(false);
            setLoraDirDirty(false);
            setCounts(prev => ({ ...prev, [categoryId]: mapping.tags.length }));
            showToast(t(MATERIAL_I18N_KEYS.tagsSaved));
            return true;
        } catch {
            showToast(t(MATERIAL_I18N_KEYS.tagsSaveFailed));
            return false;
        } finally {
            setIsSaving(false);
        }
    };

    const moveTo = (id: string) => {
        setCategoryId(id);
        setSelectedIndex(null);
        setIsDirty(false);
        setLoraPickerIdx(null);
        setLoraDetail({});
        setQuery('');
    };

    const selectCategory = (id: string) => {
        if (id === categoryId) return;
        if (isDirty || loraDirDirty) {
            setPendingCategory(id);
            return;
        }
        moveTo(id);
    };

    const leave = async (doSave: boolean) => {
        const next = pendingCategory;
        setPendingCategory(null);
        if (!next) return;
        if (doSave && !(await save())) return;
        if (!doSave) {
            setLoraDirDirty(false);
            getLoraDirConfig(backendUrl).then(setLoraDirConfig).catch(() => {});
        }
        moveTo(next);
    };

    const addCategory = async () => {
        const id = newId.trim();
        const label = newLabel.trim() || id;
        if (!CATEGORY_ID_PATTERN.test(id)) { setAddError(t(MATERIAL_I18N_KEYS.tagsCategoryIdInvalid)); return; }
        if (categories.some(c => c.id === id)) { setAddError(t(MATERIAL_I18N_KEYS.tagsCategoryIdExists)); return; }
        const next = [...categories, { id, label, loraPrefixes: [] }];
        try {
            await saveTagCategories(backendUrl, { categories: next });
            setCategories(next);
            setCounts(prev => ({ ...prev, [id]: 0 }));
            setAddOpen(false);
            setNewId('');
            setNewLabel('');
            setAddError('');
            selectCategory(id);
        } catch {
            setAddError(t(MATERIAL_I18N_KEYS.tagsSaveFailed));
        }
    };

    if (!active) return null;

    const q = query.trim().toLowerCase();
    const rows = (mapping?.tags ?? [])
        .map((tag, index) => ({ tag, index }))
        .filter(({ tag }) => !q || tag.key.toLowerCase().includes(q) || tag.prompt.toLowerCase().includes(q) || (tag.description ?? '').toLowerCase().includes(q))
        .sort((a, b) => (sortOrder === 'none' ? 0 : (sortOrder === 'asc' ? 1 : -1) * a.tag.key.localeCompare(b.tag.key, 'ja')));
    const triggerSummary = (tag: TagEntry) => {
        const first = tag.lora.find(l => l.name);
        const lines = first ? triggerLines[first.name] : undefined;
        return lines && lines.length > 0 ? formatTriggerLine(lines[0], triggerWordFormat) : COMMON.EMPTY_MARKER;
    };
    const filteredLoras = loraQuery.trim() ? loraList.filter(l => l.toLowerCase().includes(loraQuery.trim().toLowerCase())) : loraList;
    const fieldCls = 'w-full h-8 px-2 rounded-ui bg-surface border border-line-strong text-fg text-sm outline-none focus:border-accent';
    const labelCls = 'block text-xs text-fg-muted mb-1';
    const currentCategory = categories.find(c => c.id === categoryId);

    return (
        <div className="relative flex-1 min-h-0 grid grid-cols-1 grid-rows-[auto_minmax(0,1fr)] lg:grid-rows-none lg:grid-cols-[220px_minmax(0,1fr)_minmax(320px,380px)] overflow-hidden">
            {/* 分類 */}
            <aside className="flex flex-col min-h-0 border-b lg:border-b-0 lg:border-r border-line max-h-[30vh] lg:max-h-none">
                <div className="shrink-0 flex items-center gap-2 px-3 py-2.5 border-b border-line">
                    <span className="text-xs font-bold text-fg-muted">{t(MATERIAL_I18N_KEYS.tagsCategories)}</span>
                    <Button size="sm" variant="ghost" className="ml-auto" onClick={() => { setAddError(''); setAddOpen(true); }}>
                        <Plus size={14} />
                        {t(MATERIAL_I18N_KEYS.tagsAddCategory)}
                    </Button>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-0.5">
                    {categories.map(c => (
                        <button
                            key={c.id}
                            type="button"
                            onClick={() => selectCategory(c.id)}
                            aria-current={c.id === categoryId ? 'true' : undefined}
                            className={cn('w-full flex items-center gap-2 px-2.5 py-1.5 rounded-ui text-sm text-left', c.id === categoryId ? 'bg-accent-soft' : 'hover:bg-surface-2')}
                        >
                            <span className="flex-1 truncate">{categoryLabel(c)}</span>
                            <span className="text-xs text-fg-muted">{format(t(MATERIAL_I18N_KEYS.tagsCategoryCount), { count: counts[c.id] ?? 0 })}</span>
                        </button>
                    ))}
                </div>
            </aside>

            {/* タグの表 */}
            <section className="flex flex-col min-h-0 min-w-0">
                <div className="shrink-0 flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-line">
                    <h2 className="font-head text-base font-bold mr-2">
                        {TAG_MAPPING.LABELS.TAG_LIST}
                        {currentCategory && <span className="ml-2 text-sm font-normal text-fg-muted">{categoryLabel(currentCategory)}</span>}
                    </h2>
                    <TextField value={query} onChange={e => setQuery(e.target.value)} placeholder={t(MATERIAL_I18N_KEYS.tagsSearch)} className="h-8 text-xs w-44" />
                </div>
                {/* LoRA の置き場所は、分類の選択の下・タグ一覧の上（刷新前と同じ並び） */}
                {isComfy && loraDirConfig && currentCategory && (
                    <div className="shrink-0 px-4 py-2.5 border-b border-line">
                        <label className={labelCls} htmlFor="tag-lora-dir">{TAG_MAPPING.LABELS.LORA_DIRECTORY}</label>
                        <TextField id="tag-lora-dir" value={currentLoraDir} onChange={e => updateLoraDir(e.target.value)} placeholder={TAG_MAPPING.PLACEHOLDERS.LORA_DIRECTORY} className="h-8 text-xs max-w-sm" />
                        <p className="mt-1 text-xs text-fg-muted">{TAG_MAPPING.HELP.LORA_DIRECTORY_DESC}</p>
                    </div>
                )}
                <div className="flex-1 min-h-0 overflow-auto">
                    {isLoading ? (
                        <p className="p-4 text-xs text-fg-muted">{t(MATERIAL_I18N_KEYS.listLoading)}</p>
                    ) : (
                        <table className="w-full min-w-[36rem] text-sm">
                            <thead className="sticky top-0 bg-panel-solid text-xs text-fg-muted whitespace-nowrap">
                                {/* 列の並びは刷新前と同じ（照合キー → danbooru 語 → LoRA → ComfyUI → API → 有効 → 削除） */}
                                <tr className="border-b border-line">
                                    <th className="px-2 py-1.5 font-normal text-left">
                                        <button type="button" className="inline-flex items-center gap-1" onClick={() => setSortOrder(p => (p === 'none' ? 'asc' : p === 'asc' ? 'desc' : 'none'))}>
                                            {TAG_MAPPING.LABELS.MATCH_KEY}
                                            {sortOrder === 'asc' ? <ArrowUp size={11} /> : sortOrder === 'desc' ? <ArrowDown size={11} /> : <ArrowUpDown size={11} className="opacity-40" />}
                                        </button>
                                    </th>
                                    <th className="px-2 py-1.5 font-normal text-left">{TAG_MAPPING.LABELS.DANBOORU_PROMPT_SHORT}</th>
                                    {isComfy && <th className="px-2 py-1.5 font-normal text-left w-24">{TAG_MAPPING.LABELS.LORA}</th>}
                                    {isComfy && <th className="px-2 py-1.5 font-normal text-left">{t(MATERIAL_I18N_KEYS.tagsTriggerWords)}</th>}
                                    <th className="px-2 py-1.5 font-normal text-center w-16">{TAG_MAPPING.LABELS.TARGET_COMFYUI}</th>
                                    <th className="px-2 py-1.5 font-normal text-center w-12">{TAG_MAPPING.LABELS.TARGET_API}</th>
                                    <th className="px-2 py-1.5 font-normal text-center w-14">{TAG_MAPPING.LABELS.ENABLED}</th>
                                    <th className="w-10" />
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map(({ tag, index }) => {
                                    const targets = tagTargetsOf(tag);
                                    const selected = index === selectedIndex;
                                    return (
                                        <tr
                                            key={index}
                                            onClick={() => { setSelectedIndex(index); setLoraPickerIdx(null); setLoraDetail({}); }}
                                            aria-selected={selected}
                                            className={cn('border-b border-line cursor-pointer', selected ? 'bg-accent-soft' : 'hover:bg-surface-2', tag.enabled === false && 'text-fg-muted')}
                                        >
                                            <td className="px-2 py-1.5 max-w-[10rem] truncate">{tag.key || TAG_MAPPING.MESSAGES.NOT_SET}</td>
                                            <td className="px-2 py-1.5 max-w-[14rem] truncate text-fg-muted">{tag.prompt || COMMON.EMPTY_MARKER}</td>
                                            {isComfy && <td className="px-2 py-1.5 max-w-[8rem] truncate text-xs">{tag.lora.filter(l => l.name).map(l => l.name).join(', ') || COMMON.EMPTY_MARKER}</td>}
                                            {isComfy && <td className="px-2 py-1.5 max-w-[12rem] truncate text-xs text-fg-muted">{triggerSummary(tag)}</td>}
                                            <td className="px-2 py-1.5 text-center" onClick={e => e.stopPropagation()}>
                                                <input type="checkbox" checked={targets.comfyui} aria-label={`${tag.key} ${TAG_MAPPING.LABELS.TARGET_COMFYUI}`} onChange={e => setTarget(index, 'comfyui', e.target.checked)} />
                                            </td>
                                            <td className="px-2 py-1.5 text-center" onClick={e => e.stopPropagation()}>
                                                <input type="checkbox" checked={targets.api} aria-label={`${tag.key} ${TAG_MAPPING.LABELS.TARGET_API}`} onChange={e => setTarget(index, 'api', e.target.checked)} />
                                            </td>
                                            <td className="px-2 py-1.5 text-center" onClick={e => e.stopPropagation()}>
                                                <Toggle size="sm" checked={tag.enabled !== false} onChange={v => { void toggleEnabled(index, v); }} title={`${tag.key} ${TAG_MAPPING.LABELS.ENABLED}`} />
                                            </td>
                                            <td className="px-1 py-1 text-center" onClick={e => e.stopPropagation()}>
                                                <IconButton size="sm" label={`${tag.key} ${t(MATERIAL_I18N_KEYS.tagsDelete)}`} onClick={() => deleteTag(index)}>
                                                    <Trash2 size={13} />
                                                </IconButton>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                    {!isLoading && mapping && mapping.tags.length === 0 && <p className="p-4 text-xs text-fg-muted">{TAG_MAPPING.MESSAGES.NO_TAGS}</p>}
                </div>
                {/* 「新規追加」は一覧の下、「保存」は一番下の右（刷新前と同じ並び）。表が長くても隠れないよう、表の外に置く */}
                <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-t border-line">
                    <Button size="sm" variant="secondary" onClick={addTag} disabled={!mapping}>
                        <Plus size={14} />
                        {COMMON.BUTTONS.NEW_ADD}
                    </Button>
                    <Button size="sm" variant="primary" className="ml-auto" disabled={isSaving || (!isDirty && !loraDirDirty)} onClick={() => { void save(); }}>
                        <Save size={14} />
                        {isSaving ? COMMON.BUTTONS.SAVING : COMMON.BUTTONS.SAVE}
                    </Button>
                </div>
            </section>

            {/* 選んだタグ。狭い画面では、選んだときだけタブの領域いっぱいに重ねて出す */}
            <aside
                className={cn(
                    'flex-col min-h-0 overflow-y-auto p-4 space-y-3 lg:flex lg:static lg:border-l border-line lg:bg-none lg:bg-transparent',
                    selectedTag ? 'flex absolute inset-0 z-20 bg-panel-solid' : 'hidden',
                )}
            >
                {selectedTag && (
                    <Button size="sm" variant="ghost" className="lg:hidden self-start -ml-2" onClick={() => setSelectedIndex(null)}>
                        <ChevronLeft size={14} />
                        {t(MATERIAL_I18N_KEYS.tagsBackToTable)}
                    </Button>
                )}
                {/* タグ検索は照合キーの上（刷新前と同じ並び）。タグの選択に関係なく置いたままにし、
                    選び直しても検索語と結果を残す */}
                <IntegratedDanbooruSearch backendUrl={backendUrl} danbooruTagFormat={danbooruTagFormat} uiCatalog={uiCatalog} />
                {!selectedTag ? (
                    <p className="text-sm text-fg-muted">{t(MATERIAL_I18N_KEYS.tagsPickTag)}</p>
                ) : (
                    <>
                        <h3 className="text-sm font-bold text-fg">{TAG_MAPPING.LABELS.EDIT_TAG}</h3>
                        <div>
                            <label className={labelCls} htmlFor="tag-key">{TAG_MAPPING.LABELS.MATCH_KEY}</label>
                            <TextField id="tag-key" value={selectedTag.key} onChange={e => updateSelected({ key: e.target.value })} placeholder={TAG_MAPPING.PLACEHOLDERS.MATCH_KEY} className="h-8" />
                        </div>
                        <div>
                            <label className={labelCls} htmlFor="tag-desc">{TAG_MAPPING.LABELS.AI_DESCRIPTION}</label>
                            <TextField id="tag-desc" value={selectedTag.description || ''} onChange={e => updateSelected({ description: e.target.value })} placeholder={TAG_MAPPING.PLACEHOLDERS.AI_DESCRIPTION} className="h-8" />
                        </div>
                        <div>
                            <label className={labelCls} htmlFor="tag-prompt">{TAG_MAPPING.LABELS.DANBOORU_PROMPT}</label>
                            <TextArea id="tag-prompt" value={selectedTag.prompt} onChange={e => updateSelected({ prompt: e.target.value })} placeholder={TAG_MAPPING.PLACEHOLDERS.DANBOORU_PROMPT} rows={2} />
                        </div>
                        <div>
                            <label className={labelCls} htmlFor="tag-negative">{TAG_MAPPING.LABELS.NEGATIVE_PROMPT}</label>
                            <TextArea id="tag-negative" value={selectedTag.negativePrompt} onChange={e => updateSelected({ negativePrompt: e.target.value })} placeholder={TAG_MAPPING.PLACEHOLDERS.NEGATIVE_PROMPT} rows={1} />
                        </div>
                        <div>
                            <span className={labelCls}>{t(MATERIAL_I18N_KEYS.tagsTargets)}</span>
                            <div className="flex gap-4 text-sm">
                                {(['comfyui', 'api'] as const).map(key => (
                                    <label key={key} className="flex items-center gap-1.5">
                                        <input type="checkbox" checked={tagTargetsOf(selectedTag)[key]} onChange={e => setTarget(selectedIndex!, key, e.target.checked)} />
                                        {key === 'comfyui' ? TAG_MAPPING.LABELS.TARGET_COMFYUI : TAG_MAPPING.LABELS.TARGET_API}
                                    </label>
                                ))}
                            </div>
                        </div>
                        {categoryId === 'pose' && isComfy && (
                            <div>
                                <label className={labelCls} htmlFor="tag-workflow">{TAG_MAPPING.LABELS.PRIORITY_WORKFLOW}</label>
                                <select id="tag-workflow" value={selectedTag.workflowTemplateId || ''} onChange={e => updateSelected({ workflowTemplateId: e.target.value })} className={fieldCls}>
                                    <option value="">{TAG_MAPPING.MESSAGES.USE_CURRENT_WORKFLOW}</option>
                                    {templates.map(x => <option key={x.name} value={x.name}>{x.name}</option>)}
                                </select>
                            </div>
                        )}
                        {categoryId === 'pose' && !isComfy && (
                            <div>
                                <label className={labelCls} htmlFor="tag-preset">{TAG_MAPPING.LABELS.PRIORITY_PRESET}</label>
                                <select id="tag-preset" value={selectedTag.apiPresetId || ''} onChange={e => updateSelected({ apiPresetId: e.target.value })} className={fieldCls}>
                                    <option value="">{TAG_MAPPING.MESSAGES.USE_CURRENT_PRESET}</option>
                                    {apiPresets.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                                </select>
                            </div>
                        )}
                        {isComfy && (
                            <div ref={loraAreaRef} className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-fg-muted">{TAG_MAPPING.LABELS.LORA}</span>
                                    <Button size="sm" variant="ghost" onClick={() => { void refreshLoras(); }} title={COMMON.MESSAGES.REFRESH_TOOLTIP}>
                                        <RefreshCw size={12} />
                                        {COMMON.BUTTONS.REFRESH_LORA}
                                    </Button>
                                </div>
                                {selectedTag.lora.map((lora, loraIdx) => {
                                    const detail = loraDetail[loraIdx] || false;
                                    const strengthCls = 'w-14 h-8 rounded-ui bg-surface border border-line-strong text-xs text-center text-fg outline-none focus:border-accent';
                                    return (
                                        <div key={loraIdx} className="space-y-1.5">
                                            <div className="flex items-center gap-1.5">
                                                <button
                                                    type="button"
                                                    onClick={() => { setLoraPickerIdx(loraPickerIdx === loraIdx ? null : loraIdx); setLoraQuery(''); }}
                                                    className={cn(fieldCls, 'flex-1 min-w-0 flex items-center justify-between text-left')}
                                                >
                                                    <span className={cn('truncate', !lora.name && 'text-fg-muted')}>{lora.name || LORA.PLACEHOLDERS.SELECT_LORA}</span>
                                                    <Search size={12} className="shrink-0 text-fg-muted" />
                                                </button>
                                                {lora.name && (detail ? (
                                                    <>
                                                        <LoraStrengthInput value={lora.strengthModel} onCommit={v => updateSelectedLora(loraIdx, { strengthModel: v })} step={0.05} className={strengthCls} title={LORA.LABELS.MODEL_STRENGTH} />
                                                        <LoraStrengthInput value={lora.strengthClip} onCommit={v => updateSelectedLora(loraIdx, { strengthClip: v })} step={0.05} className={strengthCls} title={LORA.LABELS.CLIP_STRENGTH} />
                                                    </>
                                                ) : (
                                                    <LoraStrengthInput value={lora.strengthModel} onCommit={v => updateSelectedLora(loraIdx, { strengthModel: v, strengthClip: v })} step={0.05} className={strengthCls} title={LORA.LABELS.STRENGTH} />
                                                ))}
                                                {lora.name && (
                                                    <Button size="sm" variant="ghost" onClick={() => setLoraDetail(prev => ({ ...prev, [loraIdx]: !detail }))}>
                                                        {detail ? LORA.LABELS.SIMPLE_MODE : LORA.LABELS.DETAIL_MODE}
                                                    </Button>
                                                )}
                                                <IconButton size="sm" label={t(MATERIAL_I18N_KEYS.tagsRemoveLora)} onClick={() => updateSelected({ lora: withTrailingEmptyLora(selectedTag.lora.filter((_, i) => i !== loraIdx)) })}>
                                                    <Trash2 size={12} />
                                                </IconButton>
                                            </div>
                                            {loraPickerIdx === loraIdx && (
                                                <div className="rounded-ui border border-line bg-surface overflow-hidden">
                                                    <div className="p-2 border-b border-line">
                                                        <TextField value={loraQuery} onChange={e => setLoraQuery(e.target.value)} placeholder={LORA.PLACEHOLDERS.SEARCH_LORA} className="h-7 text-xs" autoFocus />
                                                    </div>
                                                    <div ref={loraListRef} className="relative max-h-40 overflow-y-auto">
                                                        {filteredLoras.length > 0 ? filteredLoras.map(name => (
                                                            <button
                                                                key={name}
                                                                type="button"
                                                                data-selected={lora.name === name}
                                                                onClick={() => { updateSelectedLora(loraIdx, { name }); setLoraPickerIdx(null); void fetchTriggerLines(name); }}
                                                                className={cn('w-full text-left px-3 py-1.5 text-xs hover:bg-surface-2', lora.name === name && 'bg-accent-soft')}
                                                            >
                                                                {name}
                                                            </button>
                                                        )) : comfyUnreachable ? (
                                                            <LoraUnreachableNotice visible compact onRetry={() => { void refreshLoras(); }} uiCatalog={uiCatalog} />
                                                        ) : (
                                                            <p className="text-xs text-fg-muted text-center py-3">{TAG_MAPPING.MESSAGES.NO_LORA_FOUND}</p>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                            {lora.name && (
                                                <div className="pl-1">
                                                    <span className="block text-xs text-fg-muted">{formatLabelValue(uiCatalog, t(MATERIAL_I18N_KEYS.tagsTriggerWords), t(MATERIAL_I18N_KEYS.tagsTriggerReadonly))}</span>
                                                    {triggerLoading[lora.name] ? (
                                                        <span className="text-xs text-fg-muted">{TRIGGER_WORDS.LABELS.FETCHING}</span>
                                                    ) : (triggerLines[lora.name]?.length ?? 0) > 0 ? triggerLines[lora.name].map((line, li) => {
                                                        const formatted = formatTriggerLine(line, triggerWordFormat);
                                                        return (
                                                            <button
                                                                key={li}
                                                                type="button"
                                                                onClick={() => { void navigator.clipboard?.writeText(formatted); }}
                                                                title={COMMON.MESSAGES.COPY_ROW_TOOLTIP}
                                                                className="mt-1 block w-full text-left rounded-ui border border-line bg-surface px-2 py-1 text-xs break-words hover:bg-surface-2"
                                                            >
                                                                {formatted}
                                                            </button>
                                                        );
                                                    }) : (
                                                        <span className="text-xs text-fg-muted">{TRIGGER_WORDS.MESSAGES.NONE}</span>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </>
                )}
            </aside>

            {toast && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 bg-fg text-[rgb(var(--c-bg-rgb))] text-sm px-4 py-2 rounded-ui shadow-lg pointer-events-none">
                    {toast}
                </div>
            )}

            <Modal
                open={addOpen}
                onClose={() => setAddOpen(false)}
                title={t(MATERIAL_I18N_KEYS.tagsAddCategory)}
                size="sm"
                closeLabel={t(MATERIAL_I18N_KEYS.bulkClose)}
                footer={(
                    <div className="flex justify-end gap-2">
                        <Button variant="ghost" onClick={() => setAddOpen(false)}>{t(MATERIAL_I18N_KEYS.bulkClose)}</Button>
                        <Button variant="primary" disabled={!newId.trim()} onClick={() => { void addCategory(); }}>{t(MATERIAL_I18N_KEYS.tagsCategoryAdd)}</Button>
                    </div>
                )}
            >
                <div className="p-5 space-y-3">
                    <div>
                        <label className={labelCls} htmlFor="new-category-id">{t(MATERIAL_I18N_KEYS.tagsCategoryId)}</label>
                        <TextField id="new-category-id" value={newId} onChange={e => { setNewId(e.target.value); setAddError(''); }} />
                    </div>
                    <div>
                        <label className={labelCls} htmlFor="new-category-label">{t(MATERIAL_I18N_KEYS.tagsCategoryLabel)}</label>
                        <TextField id="new-category-label" value={newLabel} onChange={e => setNewLabel(e.target.value)} />
                    </div>
                    {addError && <p className="text-xs text-danger">{addError}</p>}
                </div>
            </Modal>

            <Modal
                open={pendingCategory !== null}
                onClose={() => setPendingCategory(null)}
                title={t(MATERIAL_I18N_KEYS.leaveTitle)}
                size="sm"
                closeLabel={t(MATERIAL_I18N_KEYS.leaveBack)}
                footer={(
                    <div className="flex flex-wrap justify-end gap-2">
                        <Button variant="ghost" onClick={() => setPendingCategory(null)}>{t(MATERIAL_I18N_KEYS.leaveBack)}</Button>
                        <Button variant="secondary" onClick={() => { void leave(false); }}>{t(MATERIAL_I18N_KEYS.leaveDiscard)}</Button>
                        <Button variant="primary" onClick={() => { void leave(true); }}>{t(MATERIAL_I18N_KEYS.leaveSave)}</Button>
                    </div>
                )}
            >
                <p className="p-5 text-sm">{format(t(MATERIAL_I18N_KEYS.tagsLeaveMessage), { name: currentCategory ? categoryLabel(currentCategory) : '' })}</p>
            </Modal>
        </div>
    );
};

export default TagMappingTab;
