/**
 * WorkflowTab.tsx - 素材づくりの「画像生成」
 *
 * 上の切り替えで ComfyUI と APIサービスを分ける。使う仕組みの設定に関係なく、どちらも開いて編集できる
 *（最初は今使っている仕組みの側を開く）。
 * ComfyUI：左に保存したワークフローの一覧（使っている用途の札・取り込み）、右に選んだワークフローの操作と、
 * 指示文の形式ごとのワークフロー・置き換え。
 * APIサービス：生成プリセットの編集、共通・表情画像に使うプリセット、指示文の形式ごとのプリセット。
 * 設定は変えたらすぐ、読み出して該当の項目だけ差し替えて保存する（ほかの画面の項目を落とさない）。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Download, Trash2, Upload } from 'lucide-react';
import {
    addComfyUITemplate,
    deleteComfyUITemplate,
    downloadComfyUITemplate,
    getApiServiceBalance,
    getComfyUIConfig,
    listApiServicePresets,
    listComfyUITemplates,
    listPlaceholderPresets,
    patchComfyUIConfig,
} from '../../../api/comfyui';
import type { ComfyUIConfig, DirectiveMode, NovelAIFreeTier, NovelAIPreset, PlaceholderPreset, TemplateInfo } from '../../../api/comfyui';
import { getEmotionPrompts, saveEmotionPrompts, type EmotionPrompts } from '../../../api/characters';
import { formatLabelValue, resolveMessage, type I18NCatalog } from '../../../api/i18n';
import { MATERIAL_I18N_KEYS, MATERIAL_TEXT_FALLBACK_JA } from '../../../constants/i18n';
import { normalizeApiService, normalizeImageBackend } from '../../comfyui/apiservice/services';
import { NovelAIPresetSection } from '../../comfyui/apiservice/NovelAIPresetSection';
import { createComfyUIText } from '../../comfyui/i18n';
import { PlaceholderPresetModal } from '../../comfyui/PlaceholderPresetModal';
import { Badge, Button, Modal, Segmented, TextField, cn } from '../../ui';

interface WorkflowTabProps {
    backendUrl: string;
    uiCatalog: I18NCatalog | null;
    active: boolean;
}

export const WorkflowTab: React.FC<WorkflowTabProps> = ({ backendUrl, uiCatalog, active }) => {
    const { API_SERVICE, BACKEND, COMMON, DIRECTIVE_MODE_OPTIONS, DIRECTIVE_MODE_OPTIONS_API } = createComfyUIText(uiCatalog);
    const t = (key: string) => resolveMessage(uiCatalog, key, MATERIAL_TEXT_FALLBACK_JA[key] || key);
    const format = (template: string, values: Record<string, string | number>) =>
        Object.entries(values).reduce((text, [k, v]) => text.split(`{{${k}}}`).join(String(v)), template);

    const [templates, setTemplates] = useState<TemplateInfo[]>([]);
    const [config, setConfig] = useState<ComfyUIConfig | null>(null);
    const [emotion, setEmotion] = useState<EmotionPrompts | null>(null);
    const [placeholders, setPlaceholders] = useState<PlaceholderPreset[]>([]);
    const [apiPresets, setApiPresets] = useState<NovelAIPreset[]>([]);
    // 契約の無料枠（生成プリセットで、無料枠を超える設定に警告を出すため）。読めないときは既定の条件で判断する
    const [freeTier, setFreeTier] = useState<NovelAIFreeTier | null>(null);
    const [selected, setSelected] = useState('');
    const [toast, setToast] = useState('');
    const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
    const [placeholderOpen, setPlaceholderOpen] = useState(false);
    // 取り込み
    const [pending, setPending] = useState<unknown>(null);
    const [pendingName, setPendingName] = useState('');
    const [importError, setImportError] = useState('');
    const [isDragOver, setIsDragOver] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);

    // 見ている側（ComfyUI／APIサービス）。選ぶまでは今使っている仕組みの側
    const [view, setView] = useState<'comfyui' | 'api' | null>(null);
    const isApi = (view ?? (normalizeImageBackend(config?.imageBackend) === 'api' ? 'api' : 'comfyui')) === 'api';
    const apiService = normalizeApiService(config?.apiService);

    const showToast = (message: string) => {
        setToast(message);
        setTimeout(() => setToast(''), 2500);
    };

    const reloadTemplates = useCallback(async (): Promise<TemplateInfo[]> => {
        const list = await listComfyUITemplates(backendUrl).catch(() => [] as TemplateInfo[]);
        setTemplates(list);
        setSelected(prev => (prev && list.some(x => x.name === prev) ? prev : list[0]?.name ?? ''));
        return list;
    }, [backendUrl]);

    const reloadPlaceholders = useCallback(() => {
        listPlaceholderPresets(backendUrl).then(setPlaceholders).catch(() => {});
    }, [backendUrl]);

    const reloadApiPresets = useCallback(async () => {
        setApiPresets(await listApiServicePresets(backendUrl, apiService).catch(() => [] as NovelAIPreset[]));
    }, [backendUrl, apiService]);

    useEffect(() => {
        if (!active) return;
        let alive = true;
        Promise.all([
            getComfyUIConfig(backendUrl).catch(() => null),
            getEmotionPrompts(backendUrl).catch(() => null),
            listComfyUITemplates(backendUrl).catch(() => [] as TemplateInfo[]),
            listPlaceholderPresets(backendUrl).catch(() => [] as PlaceholderPreset[]),
        ]).then(([cfg, ep, list, presets]) => {
            if (!alive) return;
            setConfig(cfg);
            setEmotion(ep);
            setTemplates(list);
            setSelected(prev => (prev && list.some(x => x.name === prev) ? prev : list[0]?.name ?? ''));
            setPlaceholders(presets);
        });
        return () => { alive = false; };
    }, [active, backendUrl]);

    useEffect(() => {
        if (!active || !isApi) return;
        let alive = true;
        listApiServicePresets(backendUrl, apiService).then(list => { if (alive) setApiPresets(list); }).catch(() => {});
        getApiServiceBalance(backendUrl, apiService)
            .then(result => { if (alive) setFreeTier(result.success && result.subscription ? result.subscription.freeTier : null); })
            .catch(() => {});
        return () => { alive = false; };
    }, [active, isApi, backendUrl, apiService]);

    // 画像生成の設定の一部だけを保存する
    const patchConfig = async (patch: Partial<ComfyUIConfig>) => {
        try {
            setConfig(await patchComfyUIConfig(backendUrl, patch));
            showToast(t(MATERIAL_I18N_KEYS.workflowSaved));
        } catch {
            showToast(t(MATERIAL_I18N_KEYS.workflowSaveFailed));
        }
    };

    // 表情画像の設定の一部だけを保存する（表情ごとのプロンプトは読み出した最新のものを使う）
    const patchEmotion = async (patch: Partial<EmotionPrompts>) => {
        try {
            const current = await getEmotionPrompts(backendUrl);
            setEmotion(await saveEmotionPrompts(backendUrl, { ...current, ...patch }));
            showToast(t(MATERIAL_I18N_KEYS.workflowSaved));
        } catch {
            showToast(t(MATERIAL_I18N_KEYS.workflowSaveFailed));
        }
    };

    const modeLabels = isApi ? DIRECTIVE_MODE_OPTIONS_API : DIRECTIVE_MODE_OPTIONS;
    const modes: { value: DirectiveMode; label: string }[] = [
        { value: 'natural_language', label: modeLabels.NATURAL_LANGUAGE },
        { value: 'natural_language_short', label: modeLabels.NATURAL_SHORT },
        { value: 'natural_language_third_person', label: modeLabels.NATURAL_THIRD },
        { value: 'natural_language_third_person_short', label: modeLabels.NATURAL_THIRD_SHORT },
        { value: 'danbooru_only', label: modeLabels.DANBOORU_ONLY },
        { value: 'danbooru_third_person', label: modeLabels.DANBOORU_THIRD },
    ];

    /** ワークフローを使っている用途（札に出す） */
    const usesOf = (name: string): string[] => {
        const uses: string[] = [];
        if (config?.defaultTemplateId === name) uses.push(t(MATERIAL_I18N_KEYS.workflowUseChat));
        if (emotion?.workflow === name) uses.push(t(MATERIAL_I18N_KEYS.workflowUseFaces));
        const byMode = config?.workflowByDirectiveMode ?? {};
        for (const m of modes) if (byMode[m.value] === name) uses.push(m.label);
        return uses;
    };

    // 取り込み
    const readFile = async (file: File) => {
        if (!file.name.toLowerCase().endsWith('.json')) { setImportError(COMMON.MESSAGES.JSON_ONLY); return; }
        try {
            setPending(JSON.parse(await file.text()));
            setPendingName(file.name.replace(/\.json$/i, ''));
            setImportError('');
        } catch {
            setImportError(COMMON.MESSAGES.JSON_READ_FAILED);
        }
    };
    const confirmImport = async () => {
        const name = pendingName.trim();
        if (!pending || !name) return;
        try {
            const result = await addComfyUITemplate(backendUrl, name, pending);
            if (!result.success) { setImportError(result.error || COMMON.MESSAGES.ADD_FAILED); return; }
            setPending(null);
            setPendingName('');
            const list = await reloadTemplates();
            setSelected(name);
            // 会話の画像の既定が無いときは、先頭を既定にする（刷新前と同じ）
            if (config && !config.defaultTemplateId && list.length > 0) await patchConfig({ defaultTemplateId: list[0].name });
        } catch (error) {
            const err = error as { response?: { data?: { error?: string } }; message?: string };
            setImportError(err.response?.data?.error || err.message || COMMON.MESSAGES.ADD_FAILED);
        }
    };

    const doDelete = async (name: string) => {
        try {
            await deleteComfyUITemplate(backendUrl, name);
            const list = await reloadTemplates();
            // 会話の画像の既定だったワークフローを消したときは、残りの先頭を既定にする（刷新前と同じ）
            if (config?.defaultTemplateId === name) await patchConfig({ defaultTemplateId: list[0]?.name ?? '' });
        } catch {
            showToast(t(MATERIAL_I18N_KEYS.workflowSaveFailed));
        }
    };

    if (!active) return null;

    const templateNames = templates.filter(x => x.hasWorkflow).map(x => x.name);
    const presetNames = apiPresets.map(p => p.name);
    const withCurrent = (names: string[], current: string | undefined) => (current && !names.includes(current) ? [...names, current] : names);
    const selectCls = 'h-8 px-2 rounded-ui bg-surface border border-line-strong text-fg text-sm outline-none focus:border-accent min-w-0';
    const selectedUses = selected ? usesOf(selected) : [];
    const sectionCls = 'rounded-ui-lg border border-line bg-surface p-4 space-y-3';

    return (
        <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="shrink-0 px-4 sm:px-5 py-2.5 border-b border-line">
            <Segmented<'comfyui' | 'api'>
                label={t(MATERIAL_I18N_KEYS.tabWorkflow)}
                value={isApi ? 'api' : 'comfyui'}
                onChange={setView}
                options={[
                    { value: 'comfyui', label: BACKEND.TABS.COMFYUI },
                    { value: 'api', label: BACKEND.TABS.API_SERVICE },
                ]}
            />
        </div>
        <div className={cn('flex-1 min-h-0 grid grid-cols-1 overflow-hidden', !isApi && 'lg:grid-cols-[280px_minmax(0,1fr)]')}>
            {/* 一覧と取り込み（ComfyUI） */}
            {!isApi && (
            <aside className="flex flex-col min-h-0 border-b lg:border-b-0 lg:border-r border-line max-h-[40vh] lg:max-h-none">
                <h2 className="shrink-0 px-3 py-2.5 border-b border-line text-xs font-bold text-fg-muted">{t(MATERIAL_I18N_KEYS.workflowList)}</h2>
                <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-0.5">
                    {templates.length === 0 && <p className="px-2 py-2 text-xs text-fg-muted">{t(MATERIAL_I18N_KEYS.workflowEmpty)}</p>}
                    {templates.map(x => {
                        const uses = usesOf(x.name);
                        return (
                            <button
                                key={x.name}
                                type="button"
                                onClick={() => setSelected(x.name)}
                                aria-current={x.name === selected ? 'true' : undefined}
                                className={cn('w-full text-left px-2.5 py-1.5 rounded-ui', x.name === selected ? 'bg-accent-soft' : 'hover:bg-surface-2')}
                            >
                                <span className="block text-sm truncate">{x.name}</span>
                                {uses.length > 0 && (
                                    <span className="mt-1 flex flex-wrap gap-1">
                                        {uses.map(u => <Badge key={u} tone="ok" className="text-xs">{u}</Badge>)}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>
                <div className="shrink-0 border-t border-line p-3 space-y-2">
                    <span className="block text-xs font-bold text-fg-muted">{t(MATERIAL_I18N_KEYS.workflowImport)}</span>
                    {pending ? (
                        <div className="space-y-2">
                            <label className="block text-xs text-fg-muted" htmlFor="workflow-import-name">{t(MATERIAL_I18N_KEYS.workflowImportName)}</label>
                            <TextField
                                id="workflow-import-name"
                                value={pendingName}
                                onChange={e => setPendingName(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void confirmImport(); } }}
                                className="h-8"
                                autoFocus
                            />
                            <div className="flex justify-end gap-2">
                                <Button size="sm" variant="ghost" onClick={() => { setPending(null); setImportError(''); }}>{t(MATERIAL_I18N_KEYS.workflowImportCancel)}</Button>
                                <Button size="sm" variant="primary" disabled={!pendingName.trim()} onClick={() => { void confirmImport(); }}>{t(MATERIAL_I18N_KEYS.workflowImportAdd)}</Button>
                            </div>
                        </div>
                    ) : (
                        <button
                            type="button"
                            onClick={() => fileRef.current?.click()}
                            onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
                            onDragLeave={() => setIsDragOver(false)}
                            onDrop={e => { e.preventDefault(); setIsDragOver(false); const f = e.dataTransfer.files[0]; if (f) void readFile(f); }}
                            className={cn('w-full rounded-ui border-2 border-dashed px-3 py-4 text-xs text-fg-muted text-center', isDragOver ? 'border-accent bg-accent-soft' : 'border-line hover:border-accent')}
                        >
                            <Upload size={18} className="mx-auto mb-1" />
                            {t(MATERIAL_I18N_KEYS.workflowImportHint)}
                            <span className="block mt-1">{COMMON.MESSAGES.WORKFLOW_DROP_HINT}</span>
                        </button>
                    )}
                    {importError && <p className="text-xs text-danger">{importError}</p>}
                    <input
                        ref={fileRef}
                        type="file"
                        accept=".json"
                        className="hidden"
                        onChange={e => { const f = e.target.files?.[0]; if (f) void readFile(f); e.target.value = ''; }}
                    />
                </div>
            </aside>
            )}

            <section className="min-h-0 overflow-y-auto p-4 sm:p-5 space-y-4">
                {/* 選んだワークフロー（ComfyUI） */}
                {!isApi && (
                <div className={sectionCls}>
                    {!selected ? (
                        <p className="text-sm text-fg-muted">{t(MATERIAL_I18N_KEYS.workflowPick)}</p>
                    ) : (
                        <>
                            <div className="flex flex-wrap items-center gap-2">
                                <h2 className="font-head text-base font-bold mr-auto truncate">{selected}</h2>
                                <Button size="sm" variant="ghost" disabled={!templateNames.includes(selected)} onClick={() => { void downloadComfyUITemplate(backendUrl, selected).catch(() => showToast(COMMON.MESSAGES.DOWNLOAD_WORKFLOW_FAILED)); }}>
                                    <Download size={14} />
                                    {t(MATERIAL_I18N_KEYS.workflowExport)}
                                </Button>
                                <Button size="sm" variant="danger" onClick={() => setDeleteTarget(selected)}>
                                    <Trash2 size={14} />
                                    {t(MATERIAL_I18N_KEYS.workflowDelete)}
                                </Button>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {config?.defaultTemplateId === selected ? (
                                    <Badge tone="ok"><Check size={12} />{formatLabelValue(uiCatalog, t(MATERIAL_I18N_KEYS.workflowUseChat), t(MATERIAL_I18N_KEYS.workflowInUse))}</Badge>
                                ) : (
                                    <Button size="sm" variant="secondary" onClick={() => { void patchConfig({ defaultTemplateId: selected }); }}>{t(MATERIAL_I18N_KEYS.workflowSetChat)}</Button>
                                )}
                                {emotion?.workflow === selected ? (
                                    <Badge tone="ok"><Check size={12} />{formatLabelValue(uiCatalog, t(MATERIAL_I18N_KEYS.workflowUseFaces), t(MATERIAL_I18N_KEYS.workflowInUse))}</Badge>
                                ) : (
                                    <Button size="sm" variant="secondary" disabled={!emotion} onClick={() => { void patchEmotion({ workflow: selected }); }}>{t(MATERIAL_I18N_KEYS.workflowSetFaces)}</Button>
                                )}
                            </div>
                        </>
                    )}
                </div>
                )}

                {/* 指示文の形式ごとの割り当て */}
                <div className={sectionCls}>
                    <h3 className="text-sm font-bold">{isApi ? t(MATERIAL_I18N_KEYS.workflowModesApi) : t(MATERIAL_I18N_KEYS.workflowModes)}</h3>
                    <p className="text-xs text-fg-muted">{isApi ? API_SERVICE.HELP.FORMAT_PRESET_DESC : t(MATERIAL_I18N_KEYS.workflowModesHint)}</p>
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_14rem] items-center">
                        {modes.map(m => {
                            const map = (isApi ? config?.apiPresetByDirectiveMode : config?.workflowByDirectiveMode) ?? {};
                            const current = map[m.value] ?? '';
                            return (
                                <React.Fragment key={m.value}>
                                    <span className="text-sm">{m.label}</span>
                                    <select
                                        aria-label={m.label}
                                        value={current}
                                        disabled={!config}
                                        onChange={e => {
                                            const next = { ...map, [m.value]: e.target.value };
                                            if (!e.target.value) delete next[m.value];
                                            void patchConfig(isApi ? { apiPresetByDirectiveMode: next } : { workflowByDirectiveMode: next });
                                        }}
                                        className={selectCls}
                                    >
                                        <option value="">{COMMON.MESSAGES.COMMON_WORKFLOW_OPTION}</option>
                                        {withCurrent(isApi ? presetNames : templateNames, current).map(n => <option key={n} value={n}>{n}</option>)}
                                    </select>
                                </React.Fragment>
                            );
                        })}
                    </div>
                </div>

                {/* 置き換え（ComfyUI のワークフローに差し込む値） */}
                {!isApi && (
                    <div className={sectionCls}>
                        <h3 className="text-sm font-bold">{t(MATERIAL_I18N_KEYS.workflowPlaceholder)}</h3>
                        <div className="flex flex-wrap items-center gap-2">
                            <select
                                aria-label={t(MATERIAL_I18N_KEYS.workflowPlaceholder)}
                                value={config?.placeholderPresetName ?? ''}
                                disabled={!config}
                                onChange={e => { void patchConfig({ placeholderPresetName: e.target.value }); }}
                                className={cn(selectCls, 'w-56')}
                            >
                                <option value="">{t(MATERIAL_I18N_KEYS.workflowPlaceholderNone)}</option>
                                {withCurrent(placeholders.map(p => p.name), config?.placeholderPresetName).map(n => <option key={n} value={n}>{n}</option>)}
                            </select>
                            <Button size="sm" variant="ghost" onClick={() => setPlaceholderOpen(true)}>{t(MATERIAL_I18N_KEYS.workflowPlaceholderEdit)}</Button>
                        </div>
                    </div>
                )}

                {/* API サービスの生成プリセット */}
                {isApi && (
                    <div className={sectionCls}>
                        <h3 className="text-sm font-bold">{t(MATERIAL_I18N_KEYS.workflowApiPresets)}</h3>
                        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_14rem] items-center">
                            <span className="text-sm">{t(MATERIAL_I18N_KEYS.workflowApiCommon)}</span>
                            <select
                                aria-label={t(MATERIAL_I18N_KEYS.workflowApiCommon)}
                                value={config?.apiPresetDefault ?? ''}
                                disabled={!config || presetNames.length === 0}
                                onChange={e => { void patchConfig({ apiPresetDefault: e.target.value }); }}
                                className={selectCls}
                            >
                                {/* 生成プリセットが無いときは、無いことを出して選べなくする（刷新前と同じ） */}
                                {presetNames.length === 0 ? <option value="">{API_SERVICE.MESSAGES.NO_PRESET}</option> : <option value="" />}
                                {withCurrent(presetNames, config?.apiPresetDefault).map(n => <option key={n} value={n}>{n}</option>)}
                            </select>
                            <span className="text-sm">{t(MATERIAL_I18N_KEYS.workflowApiFaces)}</span>
                            <select
                                aria-label={t(MATERIAL_I18N_KEYS.workflowApiFaces)}
                                value={emotion?.apiPreset ?? ''}
                                disabled={!emotion}
                                onChange={e => { void patchEmotion({ apiPreset: e.target.value }); }}
                                className={selectCls}
                            >
                                <option value="" />
                                {withCurrent(presetNames, emotion?.apiPreset).map(n => <option key={n} value={n}>{n}</option>)}
                            </select>
                        </div>
                        <NovelAIPresetSection
                            backendUrl={backendUrl}
                            uiCatalog={uiCatalog}
                            service={apiService}
                            active={active}
                            presets={apiPresets}
                            modelId={config?.apiServiceSettings?.[apiService]?.model}
                            onPresetsChanged={reloadApiPresets}
                            freeTier={freeTier}
                            hideHeading
                        />
                    </div>
                )}
            </section>
        </div>

            {toast && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 bg-fg text-[rgb(var(--c-bg-rgb))] text-sm px-4 py-2 rounded-ui shadow-lg pointer-events-none">
                    {toast}
                </div>
            )}

            <PlaceholderPresetModal
                isOpen={placeholderOpen}
                onClose={() => setPlaceholderOpen(false)}
                backendUrl={backendUrl}
                uiCatalog={uiCatalog}
                onPresetsChanged={reloadPlaceholders}
            />

            <Modal
                open={deleteTarget !== null}
                onClose={() => setDeleteTarget(null)}
                title={t(MATERIAL_I18N_KEYS.workflowDeleteTitle)}
                size="sm"
                closeLabel={t(MATERIAL_I18N_KEYS.workflowImportCancel)}
                footer={(
                    <div className="flex justify-end gap-2">
                        <Button variant="ghost" onClick={() => setDeleteTarget(null)}>{t(MATERIAL_I18N_KEYS.workflowImportCancel)}</Button>
                        <Button variant="dangerSolid" onClick={() => { const n = deleteTarget; setDeleteTarget(null); if (n) void doDelete(n); }}>{t(MATERIAL_I18N_KEYS.workflowDelete)}</Button>
                    </div>
                )}
            >
                <div className="p-5 space-y-2 text-sm">
                    <p>{format(t(MATERIAL_I18N_KEYS.workflowDeleteMessage), { name: deleteTarget ?? '' })}</p>
                    {deleteTarget && selectedUses.length > 0 && deleteTarget === selected && (
                        <p className="text-warn">{format(t(MATERIAL_I18N_KEYS.workflowDeleteInUse), { uses: selectedUses.join('、') })}</p>
                    )}
                </div>
            </Modal>
        </div>
    );
};

export default WorkflowTab;
