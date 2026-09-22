/**
 * NovelAIPresetSection.tsx - NovelAI 生成プリセットの編集
 *
 * 名前付きプリセット（画像設定・プロンプト・高度な設定・画像出力形式）を選んで編集し、
 * 保存ボタンで 1 件ずつ保存する。使うモデルはここでは選ばない（API サービスの設定で選ぶ。
 * 生成プリセットを切り替えても変わらない）。モデルで働きが変わる項目（Quality Tags とその文、
 * UC Preset、透過背景、出力形式、Variety+）は、いま選んであるモデル用の値を編集する。
 * 未保存の編集値はモデル別に画面の中で保ち、モデルを切り替えても消さない。保存では、編集した
 * モデルの値だけを、どのモデル用かを明示して送る。
 * 無料枠（Opus）を超える設定は区分の先頭に常時警告を出す。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Sparkles, Plus, Copy, Trash2, Loader2, AlertTriangle, CheckCircle, Pencil, RotateCcw } from 'lucide-react';
import { ToggleSwitch } from '../../common/ToggleSwitch';
import { CollapsibleSection } from '../../settings/CollapsibleSection';
import {
    copyApiServicePreset,
    DEFAULT_NOVELAI_MODEL,
    deleteApiServicePreset,
    getApiServiceCatalog,
    saveApiServicePreset,
} from '../../../api/comfyui';
import type {
    ApiServiceId,
    NovelAICatalog,
    NovelAIFreeTier,
    NovelAIModelInfo,
    NovelAIModelValues,
    NovelAIPreset,
    NovelAIQualityTagsKind,
} from '../../../api/comfyui';
import type { I18NCatalog } from '../../../api/i18n';
import { createComfyUIText, formatComfyText } from '../i18n';

interface NovelAIPresetSectionProps {
    backendUrl: string;
    uiCatalog?: I18NCatalog | null;
    service: ApiServiceId;
    active: boolean;
    presets: NovelAIPreset[];
    /** いま選んであるモデル（API サービスの設定の値）。モデルごとの項目は、このモデル用の値を編集する */
    modelId?: string;
    /** 追加・削除・保存のあとに親へ一覧の再読み込みを依頼する */
    onPresetsChanged: () => Promise<void> | void;
    /** 接続テストで取れた無料枠。無ければ Opus の既定条件で警告する */
    freeTier?: NovelAIFreeTier | null;
    /** 見出しを出さない（統合設定の右ペインなど、外側に見出しがある場合） */
    hideHeading?: boolean;
    /** 選択中のプリセット名が変わるたびに親へ通知する（テスト生成で使うプリセットの連動用） */
    onSelectedChange?: (name: string) => void;
}

const UC_PRESET_KEYS: Record<number, 'HEAVY' | 'LIGHT' | 'FURRY_FOCUS' | 'HUMAN_FOCUS' | 'NONE'> = {
    0: 'HEAVY',
    1: 'LIGHT',
    2: 'FURRY_FOCUS',
    3: 'HUMAN_FOCUS',
    [-1]: 'NONE',
};
// 選択肢は常に全種類を並べ、いま選んであるモデルで選べないものは選べない表示にする。
const UC_PRESET_ORDER = [0, 1, 2, 3, -1];
const QUALITY_TAGS_ORDER: { kind: NovelAIQualityTagsKind; key: 'STANDARD' | 'LIGHT' | 'NONE' }[] = [
    { kind: 'standard', key: 'STANDARD' },
    { kind: 'light', key: 'LIGHT' },
    { kind: 'none', key: 'NONE' },
];

const AREA_COEFFICIENT = 2.951823174884865e-6;
const STEP_AREA_COEFFICIENT = 5.753298233447344e-7;

/** 1 枚あたりの Anlas 概算（NovelAI の画面から逆算された式。請求の正本ではない） */
export const estimateAnlasPerImage = (width: number, height: number, steps: number): number => {
    const area = width * height;
    return Math.max(Math.ceil(AREA_COEFFICIENT * area + STEP_AREA_COEFFICIENT * area * steps), 2);
};

export const exceedsFreeTier = (preset: Pick<NovelAIPreset, 'width' | 'height' | 'steps'>, tier: NovelAIFreeTier): boolean =>
    preset.width * preset.height > tier.maxPixels || preset.steps > tier.maxSteps;

/** モデルごとの値の既定（サーバーの既定と合わせる） */
export const defaultNovelAIModelValues = (model?: NovelAIModelInfo): NovelAIModelValues => ({
    qualityTags: model && !model.qualityTags.includes('standard') ? 'none' : 'standard',
    ucPreset: model && !model.ucPresets.includes(3) ? 0 : 3,
    transparentBackground: false,
    imageFormat: 'png',
    varietyBoost: false,
});

/**
 * いま選んであるモデル用の値を返す。まだ値が無ければ既定値から始める。そのモデルで選べない
 * 種類や働かない切替は、そのモデルの既定の表示にする（保存してあるほかのモデル用の値は変えない）。
 */
export const novelAIModelValuesFor = (preset: NovelAIPreset, modelId: string, model?: NovelAIModelInfo): NovelAIModelValues => {
    const base = defaultNovelAIModelValues(model);
    const saved = preset.modelValues?.[modelId];
    if (!saved) return base;
    const values: NovelAIModelValues = { ...base, ...saved };
    if (model) {
        if (!model.qualityTags.includes(values.qualityTags)) values.qualityTags = base.qualityTags;
        if (!model.ucPresets.includes(values.ucPreset)) values.ucPreset = base.ucPreset;
        if (!model.supportsTransparent) values.transparentBackground = false;
        if (model.varietyBoostSigma <= 0) values.varietyBoost = false;
    }
    if (values.transparentBackground) values.imageFormat = 'png';
    return values;
};

const clonePreset = (preset: NovelAIPreset): NovelAIPreset => ({
    ...preset,
    promptTemplate: { ...preset.promptTemplate },
    modelValues: Object.fromEntries(
        Object.entries(preset.modelValues ?? {}).map(([id, values]) => [
            id,
            { ...values, ...(values.qualityTagsText ? { qualityTagsText: { ...values.qualityTagsText } } : {}) },
        ])
    ),
});

const inputClass = 'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-green-500 transition-colors disabled:opacity-50';
const labelClass = 'text-xs text-gray-500';

export const NovelAIPresetSection: React.FC<NovelAIPresetSectionProps> = ({
    backendUrl,
    uiCatalog = null,
    service,
    active,
    presets,
    modelId: modelIdProp,
    onPresetsChanged,
    freeTier = null,
    hideHeading = false,
    onSelectedChange,
}) => {
    const { NOVELAI, COMMON, API_SERVICE } = createComfyUIText(uiCatalog);
    const modelId = modelIdProp || DEFAULT_NOVELAI_MODEL;
    const [catalog, setCatalog] = useState<NovelAICatalog | null>(null);
    const [selectedName, setSelectedName] = useState('');
    useEffect(() => {
        onSelectedChange?.(selectedName);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedName]);
    const [draft, setDraft] = useState<NovelAIPreset | null>(null);
    // 未保存の編集があるモデル。保存では、ここに入っているモデルの値だけを送る。
    const [editedModels, setEditedModels] = useState<string[]>([]);
    const [isSaving, setIsSaving] = useState(false);
    const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
    const [renaming, setRenaming] = useState<string | null>(null);

    useEffect(() => {
        if (!active || catalog) return;
        let cancelled = false;
        (async () => {
            try {
                const c = await getApiServiceCatalog(backendUrl, service);
                if (!cancelled) setCatalog(c);
            } catch (e) {
                console.error('[NovelAIPresetSection] catalog load failed:', e);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [active, backendUrl, service, catalog]);

    const loadDraft = (preset: NovelAIPreset) => {
        setDraft(clonePreset(preset));
        setEditedModels([]);
    };

    // 一覧が変わったら選択を保つ。無ければ先頭。
    useEffect(() => {
        if (presets.length === 0) {
            setSelectedName('');
            setDraft(null);
            setEditedModels([]);
            return;
        }
        const current = presets.find(p => p.name === selectedName) ?? presets[0];
        setSelectedName(current.name);
        loadDraft(current);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [presets]);

    const model: NovelAIModelInfo | undefined = useMemo(
        () => catalog?.models.find(m => m.id === modelId),
        [catalog, modelId]
    );
    const schedules = useMemo(
        () => (catalog && draft ? catalog.schedulesBySampler[draft.sampler] ?? [] : []),
        [catalog, draft]
    );
    const values: NovelAIModelValues | null = useMemo(
        () => (draft ? novelAIModelValuesFor(draft, modelId, model) : null),
        [draft, modelId, model]
    );

    const update = (patch: Partial<NovelAIPreset>) => {
        setDraft(prev => (prev ? { ...prev, ...patch } : prev));
        setNotice(null);
    };

    // いま選んであるモデル用の値だけを変える。ほかのモデル用の値（保存済み・未保存とも）は変えない。
    const updateValues = (patch: Partial<NovelAIModelValues>) => {
        setDraft(prev => {
            if (!prev) return prev;
            const next: NovelAIModelValues = { ...novelAIModelValuesFor(prev, modelId, model), ...patch };
            if (next.transparentBackground) next.imageFormat = 'png';
            return { ...prev, modelValues: { ...(prev.modelValues ?? {}), [modelId]: next } };
        });
        setEditedModels(prev => (prev.includes(modelId) ? prev : [...prev, modelId]));
        setNotice(null);
    };

    const selectPreset = (name: string) => {
        const found = presets.find(p => p.name === name);
        if (!found) return;
        setSelectedName(name);
        loadDraft(found);
        setNotice(null);
    };

    const handleSave = async () => {
        if (!draft) return;
        setIsSaving(true);
        setNotice(null);
        try {
            // 編集したモデルの値だけを、どのモデル用かをキーで明示して送る。送らなかったモデル用の
            // 値は、保存する側で保存済みのまま保たれる。
            const editedValues = Object.fromEntries(
                editedModels.filter(id => draft.modelValues?.[id]).map(id => [id, draft.modelValues![id]])
            );
            const saved = await saveApiServicePreset(backendUrl, { ...draft, modelValues: editedValues }, service);
            setSelectedName(saved.name);
            loadDraft(saved);
            await onPresetsChanged();
            setNotice({ ok: true, text: NOVELAI.MESSAGES.SAVED });
        } catch (e) {
            console.error('[NovelAIPresetSection] save failed:', e);
            setNotice({ ok: false, text: NOVELAI.MESSAGES.SAVE_FAILED });
        } finally {
            setIsSaving(false);
        }
    };

    const handleNew = async () => {
        const name = prompt(NOVELAI.MESSAGES.NEW_PRESET_NAME)?.trim();
        if (!name) return;
        setIsSaving(true);
        try {
            if (selectedName) {
                await copyApiServicePreset(backendUrl, selectedName, name, service);
            } else {
                await saveApiServicePreset(backendUrl, { ...(draft as NovelAIPreset), name }, service);
            }
            await onPresetsChanged();
            setSelectedName(name);
        } catch (e) {
            console.error('[NovelAIPresetSection] new failed:', e);
            setNotice({ ok: false, text: NOVELAI.MESSAGES.SAVE_FAILED });
        } finally {
            setIsSaving(false);
        }
    };

    const handleCopy = async () => {
        if (!selectedName) return;
        const name = prompt(NOVELAI.MESSAGES.NEW_PRESET_NAME, `${selectedName} copy`)?.trim();
        if (!name) return;
        setIsSaving(true);
        try {
            await copyApiServicePreset(backendUrl, selectedName, name, service);
            await onPresetsChanged();
            setSelectedName(name);
        } catch (e) {
            console.error('[NovelAIPresetSection] copy failed:', e);
            setNotice({ ok: false, text: NOVELAI.MESSAGES.SAVE_FAILED });
        } finally {
            setIsSaving(false);
        }
    };

    const handleRename = async () => {
        if (!selectedName || !draft) return;
        const name = (renaming ?? '').trim();
        if (!name || name === selectedName) {
            setRenaming(null);
            return;
        }
        setIsSaving(true);
        try {
            // 名前変更は、いま選んでいないモデル用の値も含めて全モデル分を新しい名前へ移す。
            await saveApiServicePreset(backendUrl, { ...draft, name }, service);
            await deleteApiServicePreset(backendUrl, selectedName, service);
            await onPresetsChanged();
            setSelectedName(name);
            setRenaming(null);
        } catch (e) {
            console.error('[NovelAIPresetSection] rename failed:', e);
            setNotice({ ok: false, text: NOVELAI.MESSAGES.SAVE_FAILED });
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!selectedName) return;
        if (!confirm(formatComfyText(NOVELAI.MESSAGES.DELETE_CONFIRM, { name: selectedName }))) return;
        setIsSaving(true);
        try {
            await deleteApiServicePreset(backendUrl, selectedName, service);
            setSelectedName('');
            await onPresetsChanged();
        } catch (e) {
            console.error('[NovelAIPresetSection] delete failed:', e);
        } finally {
            setIsSaving(false);
        }
    };

    const tier: NovelAIFreeTier = freeTier ?? catalog?.freeTier ?? { enabled: false, maxPixels: 1048576, maxSteps: 28, maxSamples: 1 };
    const showFreeTierWarning = draft ? exceedsFreeTier(draft, tier) : false;

    const changeSizePreset = useCallback((id: string) => {
        if (!draft) return;
        if (id === 'custom') {
            update({ sizePreset: 'custom' });
            return;
        }
        const found = catalog?.sizePresets.find(p => p.id === id);
        if (found) update({ sizePreset: id, width: found.width, height: found.height });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [draft, catalog]);

    // 送る品質タグの文。編集していなければ、モデルと種類に合った推奨の文を見せる。
    const qualityKind = values?.qualityTags ?? 'none';
    const qualityTextEdited = qualityKind !== 'none' && values?.qualityTagsText?.[qualityKind] !== undefined;
    const qualityText = qualityKind === 'none'
        ? ''
        : (values?.qualityTagsText?.[qualityKind] ?? model?.qualityTagsDefaults?.[qualityKind] ?? '');
    const changeQualityText = (text: string) => {
        if (!values || qualityKind === 'none') return;
        updateValues({ qualityTagsText: { ...(values.qualityTagsText ?? {}), [qualityKind]: text } });
    };
    const resetQualityText = () => {
        if (!values || qualityKind === 'none') return;
        const rest = { ...(values.qualityTagsText ?? {}) };
        delete rest[qualityKind];
        updateValues({ qualityTagsText: rest });
    };
    const hasUnavailableQuality = !!model && QUALITY_TAGS_ORDER.some(q => !model.qualityTags.includes(q.kind));
    const hasUnavailableUC = !!model && UC_PRESET_ORDER.some(n => !model.ucPresets.includes(n));

    return (
        <div className="space-y-3">
            {!hideHeading && (
                <h4 className="flex items-center gap-2 text-sm font-medium text-gray-400">
                    <Sparkles size={16} className="text-green-400" />
                    {NOVELAI.SECTIONS.PRESET}
                </h4>
            )}
            {/* プリセット選択と操作 */}
            <div className="flex items-center gap-2">
                <span className={`${labelClass} shrink-0`}>{NOVELAI.LABELS.PRESET}</span>
                {renaming !== null ? (
                    <input
                        type="text"
                        value={renaming}
                        onChange={(e) => setRenaming(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                                e.preventDefault();
                                void handleRename();
                            }
                            if (e.key === 'Escape') setRenaming(null);
                        }}
                        onBlur={() => void handleRename()}
                        autoFocus
                        className="flex-1 bg-gray-900 border border-green-600 rounded-lg px-3 py-1.5 text-sm text-gray-200 outline-none"
                    />
                ) : (
                    <select
                        value={selectedName}
                        onChange={(e) => selectPreset(e.target.value)}
                        disabled={presets.length === 0}
                        className="flex-1 bg-gray-800 border border-green-600 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:border-green-400 outline-none disabled:opacity-50"
                    >
                        {presets.length === 0 && <option value="">{API_SERVICE.MESSAGES.NO_PRESET}</option>}
                        {presets.map(p => (
                            <option key={p.name} value={p.name}>{p.name}</option>
                        ))}
                    </select>
                )}
                <button type="button" onClick={handleNew} disabled={isSaving} title={NOVELAI.BUTTONS.NEW} className="p-2 text-gray-500 hover:text-green-400 transition-colors disabled:opacity-30">
                    <Plus size={16} />
                </button>
                <button type="button" onClick={handleCopy} disabled={isSaving || !selectedName} title={NOVELAI.BUTTONS.COPY} className="p-2 text-gray-500 hover:text-blue-400 transition-colors disabled:opacity-30">
                    <Copy size={16} />
                </button>
                <button type="button" onClick={() => setRenaming(selectedName)} disabled={isSaving || !selectedName} title={NOVELAI.BUTTONS.RENAME} className="p-2 text-gray-500 hover:text-amber-400 transition-colors disabled:opacity-30">
                    <Pencil size={16} />
                </button>
                <button type="button" onClick={handleDelete} disabled={isSaving || !selectedName} title={NOVELAI.BUTTONS.DELETE} className="p-2 text-gray-500 hover:text-red-400 transition-colors disabled:opacity-30">
                    <Trash2 size={16} />
                </button>
            </div>

            {draft && catalog && values && (
                <div className="space-y-3">
                    {showFreeTierWarning && (
                        <div className="flex items-start gap-2 px-3 py-2 rounded-lg text-xs bg-amber-900/30 border border-amber-700/50 text-amber-200">
                            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                            <span>{formatComfyText(NOVELAI.HELP.FREE_TIER_WARNING, { anlas: estimateAnlasPerImage(draft.width, draft.height, draft.steps) })}</span>
                        </div>
                    )}

                    {/* 画像設定 */}
                    <CollapsibleSection title={NOVELAI.SECTIONS.IMAGE} defaultOpen>
                        <label className="space-y-1 block">
                            <span className={labelClass}>{NOVELAI.LABELS.SIZE_PRESET}</span>
                            <select value={draft.sizePreset} onChange={(e) => changeSizePreset(e.target.value)} className={inputClass}>
                                {catalog.sizePresets.map(p => (
                                    <option key={p.id} value={p.id}>{p.label}</option>
                                ))}
                                <option value="custom">{NOVELAI.MESSAGES.CUSTOM_SIZE}</option>
                            </select>
                        </label>
                        <div className="grid grid-cols-2 gap-3">
                            <label className="space-y-1">
                                <span className={labelClass}>{NOVELAI.LABELS.WIDTH}</span>
                                <input type="number" min={64} max={1920} step={64} value={draft.width} disabled={draft.sizePreset !== 'custom'} onChange={(e) => update({ width: Number(e.target.value) })} className={inputClass} />
                            </label>
                            <label className="space-y-1">
                                <span className={labelClass}>{NOVELAI.LABELS.HEIGHT}</span>
                                <input type="number" min={64} max={1920} step={64} value={draft.height} disabled={draft.sizePreset !== 'custom'} onChange={(e) => update({ height: Number(e.target.value) })} className={inputClass} />
                            </label>
                        </div>
                        {draft.sizePreset === 'custom' && <p className="text-xs text-gray-500">{NOVELAI.HELP.CUSTOM_SIZE}</p>}
                    </CollapsibleSection>

                    {/* プロンプト */}
                    <CollapsibleSection title={NOVELAI.SECTIONS.PROMPT}>
                        <div className="space-y-1">
                            <span className={labelClass}>{NOVELAI.LABELS.MODE}</span>
                            <div className="flex rounded-lg border border-gray-700 bg-gray-800 p-1" role="tablist" aria-label={NOVELAI.LABELS.MODE}>
                                {([
                                    { furry: false, label: NOVELAI.LABELS.MODE_ANIME },
                                    { furry: true, label: NOVELAI.LABELS.MODE_FURRY },
                                ]).map((option) => {
                                    const selected = draft.furryMode === option.furry;
                                    return (
                                        <button
                                            key={String(option.furry)}
                                            type="button"
                                            role="tab"
                                            aria-selected={selected}
                                            onClick={() => update({ furryMode: option.furry })}
                                            className={`flex-1 px-3 py-1.5 text-sm rounded transition-colors ${
                                                selected ? 'bg-green-700 text-white' : 'text-gray-300 hover:bg-gray-700'
                                            }`}
                                        >
                                            {option.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                        <p className="text-xs text-gray-500">{NOVELAI.HELP.FURRY_MODE}</p>

                        {/* ベースプロンプトと、その下の Quality Tags・透過背景 */}
                        <label className="space-y-1 block">
                            <span className={labelClass}>{NOVELAI.LABELS.FIXED_POSITIVE}</span>
                            <textarea rows={4} value={draft.fixedPositive} onChange={(e) => update({ fixedPositive: e.target.value })} className={`${inputClass} resize-y`} />
                        </label>
                        <div className="pl-3 border-l border-gray-700 space-y-2">
                            <label className="space-y-1 block">
                                <span className={labelClass}>{NOVELAI.LABELS.QUALITY_TAGS}</span>
                                <select
                                    value={values.qualityTags}
                                    onChange={(e) => updateValues({ qualityTags: e.target.value as NovelAIQualityTagsKind })}
                                    className={inputClass}
                                    aria-label={NOVELAI.LABELS.QUALITY_TAGS}
                                >
                                    {QUALITY_TAGS_ORDER.map(q => (
                                        <option key={q.kind} value={q.kind} disabled={!!model && !model.qualityTags.includes(q.kind)}>
                                            {NOVELAI.QUALITY_TAGS_KINDS[q.key]}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            {hasUnavailableQuality && <p className="text-xs text-gray-500">{NOVELAI.HELP.NOT_IN_MODEL}</p>}
                            {qualityKind !== 'none' && (
                                <div className="space-y-1">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className={labelClass}>{NOVELAI.LABELS.QUALITY_TAGS_TEXT}</span>
                                        <button
                                            type="button"
                                            onClick={resetQualityText}
                                            disabled={!qualityTextEdited}
                                            className="flex items-center gap-1 text-xs text-gray-400 hover:text-green-300 disabled:opacity-30 transition-colors"
                                        >
                                            <RotateCcw size={12} />
                                            {NOVELAI.BUTTONS.RESET_QUALITY_TAGS_TEXT}
                                        </button>
                                    </div>
                                    <textarea
                                        rows={2}
                                        value={qualityText}
                                        onChange={(e) => changeQualityText(e.target.value)}
                                        className={`${inputClass} resize-y`}
                                        aria-label={NOVELAI.LABELS.QUALITY_TAGS_TEXT}
                                    />
                                    <p className="text-xs text-amber-300/80">{NOVELAI.HELP.MODEL_VALUES_NOTE}</p>
                                </div>
                            )}
                            {/* 透過背景は V5 のときだけ表示する（V5 用に保存してある値は消えない） */}
                            {model?.supportsTransparent && (
                                <>
                                    <ToggleSwitch checked={values.transparentBackground} onChange={(v) => updateValues({ transparentBackground: v })} label={NOVELAI.LABELS.TRANSPARENT} labelPosition="right" accent="green" size="sm" />
                                    <p className="text-xs text-gray-500">{NOVELAI.HELP.TRANSPARENT}</p>
                                </>
                            )}
                        </div>

                        {/* 除外したい要素と、その下の UC Preset */}
                        <label className="space-y-1 block">
                            <span className={labelClass}>{NOVELAI.LABELS.FIXED_NEGATIVE}</span>
                            <textarea rows={4} value={draft.fixedNegative} onChange={(e) => update({ fixedNegative: e.target.value })} className={`${inputClass} resize-y`} />
                        </label>
                        <div className="pl-3 border-l border-gray-700 space-y-2">
                            <label className="space-y-1 block">
                                <span className={labelClass}>{NOVELAI.LABELS.UC_PRESET}</span>
                                <select
                                    value={values.ucPreset}
                                    onChange={(e) => updateValues({ ucPreset: Number(e.target.value) })}
                                    className={inputClass}
                                    aria-label={NOVELAI.LABELS.UC_PRESET}
                                >
                                    {UC_PRESET_ORDER.map(n => (
                                        <option key={n} value={n} disabled={!!model && !model.ucPresets.includes(n)}>
                                            {NOVELAI.UC_PRESETS[UC_PRESET_KEYS[n] ?? 'NONE']}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            {hasUnavailableUC && <p className="text-xs text-gray-500">{NOVELAI.HELP.NOT_IN_MODEL}</p>}
                        </div>
                        <p className="text-xs text-gray-500">{NOVELAI.HELP.FIXED_PROMPT}</p>

                        <label className="space-y-1 block">
                            <span className={labelClass}>{NOVELAI.LABELS.TEMPLATE_BASE}</span>
                            <textarea rows={2} value={draft.promptTemplate.base} onChange={(e) => update({ promptTemplate: { ...draft.promptTemplate, base: e.target.value } })} className={inputClass} />
                        </label>
                        <label className="space-y-1 block">
                            <span className={labelClass}>{NOVELAI.LABELS.TEMPLATE_CHARACTER}</span>
                            <textarea rows={2} value={draft.promptTemplate.character} onChange={(e) => update({ promptTemplate: { ...draft.promptTemplate, character: e.target.value } })} className={inputClass} />
                        </label>
                        <label className="space-y-1 block">
                            <span className={labelClass}>{NOVELAI.LABELS.TEMPLATE_NEGATIVE}</span>
                            <textarea rows={2} value={draft.promptTemplate.negative} onChange={(e) => update({ promptTemplate: { ...draft.promptTemplate, negative: e.target.value } })} className={inputClass} />
                        </label>
                        <p className="text-xs text-gray-500">{NOVELAI.HELP.TEMPLATE}</p>
                    </CollapsibleSection>

                    {/* 高度な設定 */}
                    <CollapsibleSection title={NOVELAI.SECTIONS.ADVANCED}>
                        <div className="grid grid-cols-2 gap-3">
                            <label className="space-y-1">
                                <span className={labelClass}>{NOVELAI.LABELS.STEPS}</span>
                                <input type="number" min={1} max={50} value={draft.steps} onChange={(e) => update({ steps: Number(e.target.value) })} className={inputClass} />
                            </label>
                            <label className="space-y-1">
                                <span className={labelClass}>{NOVELAI.LABELS.SCALE}</span>
                                <input type="number" min={0} max={10} step={0.1} value={draft.scale} onChange={(e) => update({ scale: Number(e.target.value) })} className={inputClass} />
                            </label>
                            <label className="space-y-1">
                                <span className={labelClass}>{NOVELAI.LABELS.CFG_RESCALE}</span>
                                <input type="number" min={0} max={1} step={0.02} value={draft.cfgRescale} onChange={(e) => update({ cfgRescale: Number(e.target.value) })} className={inputClass} />
                            </label>
                            <label className="space-y-1">
                                <span className={labelClass}>{NOVELAI.LABELS.SAMPLER}</span>
                                <select value={draft.sampler} onChange={(e) => {
                                    const nextSchedules = catalog.schedulesBySampler[e.target.value] ?? [];
                                    update({ sampler: e.target.value, noiseSchedule: nextSchedules.includes(draft.noiseSchedule) ? draft.noiseSchedule : (nextSchedules[0] ?? '') });
                                }} className={inputClass}>
                                    {catalog.samplers.map(s => (
                                        <option key={s.id} value={s.id}>{s.label}</option>
                                    ))}
                                </select>
                            </label>
                            <label className="space-y-1">
                                <span className={labelClass}>{NOVELAI.LABELS.NOISE_SCHEDULE}</span>
                                <select value={draft.noiseSchedule} disabled={schedules.length === 0} onChange={(e) => update({ noiseSchedule: e.target.value })} className={inputClass}>
                                    {schedules.map(id => (
                                        <option key={id} value={id}>{catalog.schedules.find(s => s.id === id)?.label ?? id}</option>
                                    ))}
                                </select>
                            </label>
                            <label className="space-y-1">
                                <span className={labelClass}>{NOVELAI.LABELS.SEED}</span>
                                <select value={draft.seedMode} onChange={(e) => update({ seedMode: e.target.value as NovelAIPreset['seedMode'] })} className={inputClass}>
                                    <option value="random">{NOVELAI.LABELS.SEED_RANDOM}</option>
                                    <option value="fixed">{NOVELAI.LABELS.SEED_FIXED}</option>
                                </select>
                            </label>
                            {draft.seedMode === 'fixed' && (
                                <label className="space-y-1">
                                    <span className={labelClass}>{NOVELAI.LABELS.FIXED_SEED}</span>
                                    <input type="number" min={0} max={4294967295} value={draft.fixedSeed} onChange={(e) => update({ fixedSeed: Number(e.target.value) })} className={inputClass} />
                                </label>
                            )}
                        </div>
                        <ToggleSwitch checked={values.varietyBoost} onChange={(v) => updateValues({ varietyBoost: v })} label={NOVELAI.LABELS.VARIETY_BOOST} labelPosition="right" accent="green" size="sm" disabled={!model || model.varietyBoostSigma <= 0} />
                        {model && model.varietyBoostSigma <= 0 && <p className="text-xs text-gray-500">{NOVELAI.HELP.VARIETY_UNAVAILABLE}</p>}
                    </CollapsibleSection>

                    {/* 画像出力形式（透過背景が ON のときは PNG のみ） */}
                    <CollapsibleSection title={NOVELAI.SECTIONS.OUTPUT}>
                        <label className="space-y-1 block">
                            <span className={labelClass}>{NOVELAI.LABELS.IMAGE_FORMAT}</span>
                            <select
                                value={values.imageFormat}
                                disabled={values.transparentBackground}
                                onChange={(e) => updateValues({ imageFormat: e.target.value as NovelAIModelValues['imageFormat'] })}
                                className={inputClass}
                                aria-label={NOVELAI.LABELS.IMAGE_FORMAT}
                            >
                                <option value="png">PNG</option>
                                <option value="webp">WebP</option>
                            </select>
                        </label>
                    </CollapsibleSection>

                    <div className="flex items-center justify-end gap-3">
                        {notice && (
                            <span className={`flex items-center gap-1 text-xs ${notice.ok ? 'text-green-300' : 'text-red-300'}`}>
                                {notice.ok ? <CheckCircle size={12} /> : <AlertTriangle size={12} />}
                                {notice.text}
                            </span>
                        )}
                        <button
                            type="button"
                            onClick={handleSave}
                            disabled={isSaving || !draft.name.trim()}
                            className="px-4 py-2 text-sm text-white bg-green-600 hover:bg-green-500 disabled:opacity-50 rounded-lg transition-colors flex items-center gap-1.5"
                        >
                            {isSaving && <Loader2 size={14} className="animate-spin" />}
                            {isSaving ? COMMON.BUTTONS.SAVING : COMMON.BUTTONS.SAVE}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
