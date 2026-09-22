/**
 * EmotionImageGenModal - 表情画像生成モーダル（設定ファイルエディタの表情画像エリアから開く）。
 *
 * 左：Danbooru タグ検索／キャラクター選択／キャラクター画像生成設定（既定閉）／表情設定（既定開）
 * 右：ワークフロー選択／生成画像／生成数・実行／選択した画像を表情画像に設定
 *
 * 生成は既存 POST /api/comfyui/generate を枚数ぶん逐次呼ぶ（表情プロンプトは directTags.emotion）。
 * 採用した画像は既存のアップロード API へ渡し、続けて切り抜きモーダルを開く。
 * 生成画像はモーダルの state にだけ保持し、閉じたら破棄する。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, ChevronDown, ChevronRight, Palette, Smile, Users, Search, Play, Check, Loader2 } from 'lucide-react';
import { useIsWideScreen } from '../../hooks/useIsWideScreen';
import { GridSelectionModal } from '../common/GridSelectionModal';
import { ConfirmDialog } from '../ConfirmDialog';
import { ImageCropModal } from '../SSRP/ImageCropModal';
import { IntegratedDanbooruSearch } from './integrated/IntegratedDanbooruSearch';
import { IntegratedWorkflowSection } from './integrated/IntegratedWorkflowSection';
import { IntegratedCharacterSection } from './integrated/IntegratedCharacterSection';
import { useCharacterImageGenEditor } from './useCharacterImageGenEditor';
import { EmotionPromptSection } from './EmotionPromptSection';
import { GeneratedImageGrid, type GeneratedImageResult } from './GeneratedImageGrid';
import { generateImage, getComfyUIConfig, listComfyUITemplates, listApiServicePresets } from '../../api/comfyui';
import type { DanbooruTagFormat, ImageBackend, NovelAIPreset, TemplateInfo } from '../../api/comfyui';
import { normalizeApiService, normalizeImageBackend } from './apiservice/services';
import { getCharacterTags } from '../../api/files';
import type { CharacterTagInfo } from '../../api/files';
import { getEmotionCatalog } from '../../api/emotion-catalog';
import type { EmotionCatalogEntry } from '../../api/emotion-catalog';
import { getEmotionPrompts, saveEmotionPrompts, createEmptyEmotionPrompts, type EmotionPrompts } from '../../api/characters';
import { resolveBackendError, resolveMessage, type I18NCatalog } from '../../api/i18n';
import { notifyCharacterImagesUpdated } from '../../lib/characterImageEvents';
import {
    fetchCharacterImages,
    uploadCharacterImage,
    cropCharacterImage,
    base64ToFile,
    imageExtensionForMime,
    type CharacterImageCropData,
} from '../SSRP/characterImageApi';
import {
    EMOTION_IMAGE_GEN_I18N_KEYS,
    EMOTION_IMAGE_GEN_TEXT_FALLBACK_JA,
    CONFIG_EDITOR_I18N_KEYS,
    CONFIG_EDITOR_TEXT_FALLBACK_JA,
    COMMON_TEXT_FALLBACK_JA,
    SSRP_I18N_KEYS,
    SSRP_TEXT_FALLBACK_JA,
} from '../../constants/i18n';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    backendUrl: string;
    uiCatalog?: I18NCatalog | null;
    /** 開いた時点の対象キャラクター（ディレクトリ名） */
    initialCharacterDirName: string;
    /** 開いた時点の対象表情 */
    initialEmotion: string;
    /** 表情画像として登録（切り抜きまで）が終わった通知 */
    onRegistered?: (dirName: string, emotion: string) => void;
}

const MAX_COUNT = 8;

let resultSeq = 0;

export const EmotionImageGenModal: React.FC<Props> = ({
    isOpen,
    onClose,
    backendUrl,
    uiCatalog = null,
    initialCharacterDirName,
    initialEmotion,
    onRegistered,
}) => {
    const t = (key: string) => resolveMessage(
        uiCatalog,
        key,
        EMOTION_IMAGE_GEN_TEXT_FALLBACK_JA[key] || CONFIG_EDITOR_TEXT_FALLBACK_JA[key] || SSRP_TEXT_FALLBACK_JA[key] || COMMON_TEXT_FALLBACK_JA[key] || key,
    );
    const formatText = (template: string, values: Record<string, string | number>) =>
        Object.entries(values).reduce((text, [k, v]) => text.split(`{{${k}}}`).join(String(v)), template);
    const isWideScreen = useIsWideScreen();

    // ===== キャラクター =====
    const [characters, setCharacters] = useState<CharacterTagInfo[]>([]);
    const [selectedDirName, setSelectedDirName] = useState(initialCharacterDirName);
    const [isCharacterPickerOpen, setIsCharacterPickerOpen] = useState(false);
    const characterOptions = useMemo(() => characters.map(c => ({
        label: c.name,
        value: c.dirName,
        imageUrl: c.iconUrl ? `${backendUrl}${c.iconUrl}` : undefined,
    })), [characters, backendUrl]);
    const selectedCharacterLabel = characters.find(c => c.dirName === selectedDirName)?.name || selectedDirName;

    // ===== ワークフロー =====
    const [templates, setTemplates] = useState<TemplateInfo[]>([]);
    const [selectedTemplate, setSelectedTemplate] = useState('');
    const [danbooruTagFormat, setDanbooruTagFormat] = useState<DanbooruTagFormat>('underscore');
    // 表情画像生成として保持しているワークフロー（emotion_prompts.json の workflow）。
    // 画像生成統合設定の既定（defaultTemplateId）は、こちらが未設定のときの初期値にだけ使う。
    const preferredWorkflowRef = useRef('');
    // 画像生成バックエンド（全画面共用の選択）。API サービスではワークフローの代わりに
    // 生成プリセット（emotion_prompts.json の apiPreset）を選ぶ。
    const [imageBackend, setImageBackend] = useState<ImageBackend>('comfyui');
    const [apiPresets, setApiPresets] = useState<NovelAIPreset[]>([]);
    const [selectedPreset, setSelectedPreset] = useState('');
    const preferredPresetRef = useRef('');
    const isApi = imageBackend === 'api';
    const reloadTemplates = useCallback(async () => {
        try {
            const [templateList, config] = await Promise.all([listComfyUITemplates(backendUrl), getComfyUIConfig(backendUrl)]);
            setTemplates(templateList);
            setDanbooruTagFormat(config.danbooruTagFormat || 'underscore');
            setSelectedTemplate(prev => {
                if (prev && templateList.some(x => x.name === prev)) return prev;
                const preferred = preferredWorkflowRef.current;
                if (preferred && templateList.some(x => x.name === preferred)) return preferred;
                const savedDefault = config.defaultTemplateId || '';
                if (savedDefault && templateList.some(x => x.name === savedDefault)) return savedDefault;
                return templateList.length > 0 ? templateList[0].name : '';
            });
            const backend = normalizeImageBackend(config.imageBackend);
            setImageBackend(backend);
            if (backend === 'api') {
                const presets = await listApiServicePresets(backendUrl, normalizeApiService(config.apiService));
                setApiPresets(presets);
                setSelectedPreset(prev => {
                    if (prev && presets.some(p => p.name === prev)) return prev;
                    const preferred = preferredPresetRef.current;
                    if (preferred && presets.some(p => p.name === preferred)) return preferred;
                    const savedDefault = config.apiPresetDefault || '';
                    if (savedDefault && presets.some(p => p.name === savedDefault)) return savedDefault;
                    return presets.length > 0 ? presets[0].name : '';
                });
            }
        } catch (error) {
            console.error('[EmotionImageGenModal] template reload failed:', error);
        }
    }, [backendUrl]);

    // ===== 表情・プロンプト =====
    const [emotions, setEmotions] = useState<EmotionCatalogEntry[]>([]);
    const [selectedEmotion, setSelectedEmotion] = useState(initialEmotion);
    const [prompts, setPrompts] = useState<EmotionPrompts>(createEmptyEmotionPrompts());
    const [expressionText, setExpressionText] = useState('');

    // ワークフロー選択を表情画像生成の設定として保存する（統合設定の既定には書かない）
    const persistWorkflow = useCallback(async (name: string) => {
        preferredWorkflowRef.current = name;
        try {
            const saved = await saveEmotionPrompts(backendUrl, { ...prompts, workflow: name });
            setPrompts(saved);
        } catch (error) {
            console.error('[EmotionImageGenModal] workflow save failed:', error);
        }
    }, [backendUrl, prompts]);
    const handleTemplateChange = useCallback((name: string) => {
        setSelectedTemplate(name);
        void persistWorkflow(name);
    }, [persistWorkflow]);

    // 生成プリセットの選択も表情画像生成の設定として保存する（API サービスのとき）
    const persistPreset = useCallback(async (name: string) => {
        preferredPresetRef.current = name;
        try {
            const saved = await saveEmotionPrompts(backendUrl, { ...prompts, apiPreset: name });
            setPrompts(saved);
        } catch (error) {
            console.error('[EmotionImageGenModal] preset save failed:', error);
        }
    }, [backendUrl, prompts]);
    const handlePresetChange = useCallback((name: string) => {
        setSelectedPreset(name);
        void persistPreset(name);
    }, [persistPreset]);

    // ===== キャラクター画像生成設定 =====
    const editor = useCharacterImageGenEditor(backendUrl, selectedDirName || null, isOpen);
    const [isCharConfigOpen, setIsCharConfigOpen] = useState(false);
    const [isEmotionOpen, setIsEmotionOpen] = useState(true);

    // ===== 生成 =====
    const [count, setCount] = useState(4);
    const [results, setResults] = useState<GeneratedImageResult[]>([]);
    const [selectedResultId, setSelectedResultId] = useState<string | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [progress, setProgress] = useState({ done: 0, total: 0 });
    const cancelledRef = useRef(false);

    // 生成画像はキャラクターか表情が変わったときだけ捨てる（実行のたびには捨てず追記する。閉じたら捨てる）
    const resultsKeyRef = useRef('');
    useEffect(() => {
        const key = `${selectedDirName} ${selectedEmotion}`;
        if (resultsKeyRef.current === key) return;
        resultsKeyRef.current = key;
        setResults([]);
        setSelectedResultId(null);
    }, [selectedDirName, selectedEmotion]);

    // ===== 登録 =====
    const [isApplying, setIsApplying] = useState(false);
    const [isOverwriteConfirmOpen, setIsOverwriteConfirmOpen] = useState(false);
    const [cropSrc, setCropSrc] = useState<string | null>(null);
    const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

    // 開くたびに初期値へ戻し、一覧を取得する。閉じたら生成結果を捨てる
    useEffect(() => {
        if (!isOpen) {
            setResults([]);
            setSelectedResultId(null);
            setNotice(null);
            cancelledRef.current = true;
            return;
        }
        cancelledRef.current = false;
        setSelectedDirName(initialCharacterDirName);
        setSelectedEmotion(initialEmotion);
        setSelectedTemplate('');
        (async () => {
            try {
                const [tags, catalog, loadedPrompts] = await Promise.all([
                    getCharacterTags(),
                    getEmotionCatalog(backendUrl),
                    getEmotionPrompts(backendUrl).catch(() => createEmptyEmotionPrompts()),
                ]);
                setCharacters(tags.characters);
                setEmotions(catalog.emotions || []);
                setPrompts(loadedPrompts);
                // 表情画像生成として保持しているワークフロー・プリセットを初期選択にするため、一覧の取得はこの後に行う
                preferredWorkflowRef.current = loadedPrompts.workflow || '';
                preferredPresetRef.current = loadedPrompts.apiPreset || '';
            } catch (error) {
                console.error('[EmotionImageGenModal] initial load failed:', error);
            }
            await reloadTemplates();
        })();
    }, [isOpen, backendUrl, initialCharacterDirName, initialEmotion, reloadTemplates]);

    // API サービスではワークフローは不要（プリセットが空でも共通プリセットへ落ちる）
    const canRun = (isApi || !!selectedTemplate) && !!selectedDirName && !editor.isDirty && !isGenerating && !isApplying;

    const handleRun = useCallback(async () => {
        if (!canRun) return;
        const total = Math.min(MAX_COUNT, Math.max(1, Math.floor(count)));
        setIsGenerating(true);
        // 前回の生成画像は残す（キャラ・表情が変わったときだけ捨てる）
        setNotice(null);
        setProgress({ done: 0, total });
        const expression = expressionText.trim();
        for (let i = 0; i < total; i++) {
            if (cancelledRef.current) break;
            const id = `gen-${++resultSeq}`;
            try {
                const res = await generateImage(backendUrl, {
                    templateName: isApi ? '' : selectedTemplate,
                    characterName: selectedDirName,
                    tagSelections: {},
                    ...(expression ? { directTags: { emotion: expression } } : {}),
                    ...(isApi ? { presetName: selectedPreset, backend: 'api' as ImageBackend } : {}),
                });
                if (cancelledRef.current) break;
                // 生成側からの注意（無料枠超過・日本語・参照画像無視・人数超過など）は文言に解決して結果へ添える。
                const warnings = (res.warnings ?? []).map(key => resolveMessage(uiCatalog, key, key));
                setResults(prev => [...prev, res.success && res.imageBase64
                    ? { id, base64: res.imageBase64, mimeType: res.mimeType || 'image/png', positivePrompt: res.resolvedPrompt?.positive, ...(warnings.length > 0 ? { warnings } : {}) }
                    : { id, error: resolveBackendError(uiCatalog, res.error) || t(EMOTION_IMAGE_GEN_I18N_KEYS.failed) }]);
            } catch (error) {
                console.error('[EmotionImageGenModal] generate failed:', error);
                setResults(prev => [...prev, { id, error: t(EMOTION_IMAGE_GEN_I18N_KEYS.failed) }]);
            }
            setProgress({ done: i + 1, total });
        }
        setIsGenerating(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [canRun, count, expressionText, backendUrl, selectedTemplate, selectedDirName, isApi, selectedPreset]);

    const selectedResult = results.find(r => r.id === selectedResultId && r.base64);

    // 登録：元画像があれば確認 → アップロード → 切り抜きへ
    const handleApply = useCallback(async () => {
        if (!selectedResult) return;
        try {
            const images = await fetchCharacterImages(backendUrl, selectedDirName);
            if (images[selectedEmotion]?.hasOriginal) {
                setIsOverwriteConfirmOpen(true);
                return;
            }
        } catch {
            // 取得できなくても登録は続ける（上書き確認だけ省略される）
        }
        await doUpload();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedResult, backendUrl, selectedDirName, selectedEmotion]);

    const doUpload = async () => {
        if (!selectedResult || !selectedResult.base64) return;
        setIsApplying(true);
        setNotice(null);
        try {
            const mime = selectedResult.mimeType || 'image/png';
            const file = base64ToFile(selectedResult.base64, mime, `${selectedEmotion}.${imageExtensionForMime(mime)}`);
            await uploadCharacterImage(backendUrl, selectedDirName, selectedEmotion, file);
            notifyCharacterImagesUpdated();
            setNotice({ ok: true, text: t(EMOTION_IMAGE_GEN_I18N_KEYS.applied) });
            setCropSrc(`data:${mime};base64,${selectedResult.base64}`);
        } catch (error) {
            console.error('[EmotionImageGenModal] upload failed:', error);
            setNotice({ ok: false, text: t(EMOTION_IMAGE_GEN_I18N_KEYS.failed) });
        } finally {
            setIsApplying(false);
        }
    };

    const handleCropSave = async (cropData: CharacterImageCropData) => {
        try {
            await cropCharacterImage(backendUrl, selectedDirName, selectedEmotion, cropData);
            notifyCharacterImagesUpdated();
            onRegistered?.(selectedDirName, selectedEmotion);
        } catch (error) {
            console.error('[EmotionImageGenModal] crop failed:', error);
            setNotice({ ok: false, text: t(EMOTION_IMAGE_GEN_I18N_KEYS.failed) });
        } finally {
            setCropSrc(null);
        }
    };

    if (!isOpen) return null;

    const sectionHeader = (icon: React.ReactNode, label: string, open: boolean, onToggle: () => void, extra?: React.ReactNode) => (
        <button
            type="button"
            onClick={onToggle}
            className="w-full flex items-center justify-between p-3 bg-gray-800/80 hover:bg-gray-800 transition-colors"
        >
            <div className="flex items-center gap-2 text-sm font-medium text-gray-200">
                {icon}
                {label}
                {extra}
            </div>
            {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </button>
    );

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="bg-gray-900 rounded-xl shadow-2xl border border-purple-800 overflow-hidden flex flex-col" style={{ width: '90vw', height: '90vh' }}>
                {/* ヘッダー */}
                <div className="flex items-center justify-between px-6 py-3 border-b border-purple-900 bg-purple-950/60 shrink-0">
                    <h2 className="text-base font-semibold text-purple-100 flex items-center gap-2">
                        <Smile size={18} />
                        {t(EMOTION_IMAGE_GEN_I18N_KEYS.title)}
                    </h2>
                    <button onClick={onClose} className="text-purple-300 hover:text-white transition-colors">
                        <X size={18} />
                    </button>
                </div>

                {/* ボディ */}
                <div className={isWideScreen ? 'flex flex-1 min-h-0' : 'flex flex-col flex-1 overflow-y-auto'}>
                    {/* 左：設定 */}
                    <div className={`${isWideScreen ? 'flex-1 min-w-0 border-r border-gray-700 overflow-y-auto' : 'shrink-0'} p-4 space-y-4 custom-scrollbar`} style={{ scrollbarGutter: 'stable' }}>
                        <IntegratedDanbooruSearch backendUrl={backendUrl} danbooruTagFormat={danbooruTagFormat} uiCatalog={uiCatalog} />

                        {/* キャラクター選択 */}
                        <div>
                            <label className="flex items-center gap-2 text-sm font-medium text-gray-400 mb-1">
                                <Users size={16} className="text-pink-400" />
                                {t(EMOTION_IMAGE_GEN_I18N_KEYS.sectionCharacter)}
                            </label>
                            <div
                                onClick={() => setIsCharacterPickerOpen(true)}
                                className="w-full bg-gray-800 border border-pink-700 rounded-lg px-3 py-2 text-sm text-gray-200 cursor-pointer hover:border-pink-400 transition-colors flex items-center justify-between"
                            >
                                <span className="truncate">{selectedCharacterLabel || t(SSRP_I18N_KEYS.characterSelect)}</span>
                                <Search size={14} className="text-gray-500 shrink-0 ml-1" />
                            </div>
                        </div>

                        {/* キャラクター画像生成設定（既定閉） */}
                        <div className="border border-gray-700 rounded-lg overflow-hidden">
                            {sectionHeader(
                                <Palette size={16} className="text-pink-300" />,
                                t(EMOTION_IMAGE_GEN_I18N_KEYS.sectionCharacterConfig),
                                isCharConfigOpen,
                                () => setIsCharConfigOpen(v => !v),
                                editor.isDirty ? <span className="text-yellow-300 text-xs" title={t(CONFIG_EDITOR_I18N_KEYS.characterUnsaved)}>●</span> : undefined,
                            )}
                            <div className={isCharConfigOpen ? 'p-4 bg-gray-900' : 'hidden'}>
                                <IntegratedCharacterSection
                                    hideCharacterSelector
                                    selectedCharacter={selectedDirName}
                                    workNameHint={t(CONFIG_EDITOR_I18N_KEYS.characterImageGenWorkNameHint)}
                                    config={editor.config}
                                    onUpdateConfig={editor.updateConfig}
                                    isLoading={editor.isLoading}
                                    isDirty={editor.isDirty}
                                    onSave={editor.save}
                                    availableLoras={editor.availableLoras}
                                    availableOutfitLoras={editor.availableOutfitLoras}
                                    comfyUnreachable={editor.comfyUnreachable}
                                    onRefreshLoras={editor.refreshLoras}
                                    onFetchTriggerWords={editor.fetchTriggerWords}
                                    triggerWordFormat={editor.triggerWordFormat}
                                    uiCatalog={uiCatalog}
                                    characterDirName={selectedDirName}
                                    onReloadConfig={editor.reload}
                                    referenceRefreshKey={apiPresets}
                                />
                            </div>
                        </div>

                        {/* 表情設定（既定開） */}
                        <div className="border border-gray-700 rounded-lg overflow-hidden">
                            {sectionHeader(
                                <Smile size={16} className="text-purple-300" />,
                                t(EMOTION_IMAGE_GEN_I18N_KEYS.sectionEmotion),
                                isEmotionOpen,
                                () => setIsEmotionOpen(v => !v),
                            )}
                            <div className={isEmotionOpen ? 'p-4 bg-gray-900' : 'hidden'}>
                                <EmotionPromptSection
                                    backendUrl={backendUrl}
                                    emotions={emotions}
                                    selectedEmotion={selectedEmotion}
                                    onEmotionChange={setSelectedEmotion}
                                    prompts={prompts}
                                    onPromptsChange={setPrompts}
                                    expressionText={expressionText}
                                    onExpressionTextChange={setExpressionText}
                                    uiCatalog={uiCatalog}
                                    backend={imageBackend}
                                />
                            </div>
                        </div>
                    </div>

                    {/* 右：生成 */}
                    <div className={`${isWideScreen ? 'flex-1 min-w-0 overflow-y-auto' : 'shrink-0'} p-4 space-y-4 custom-scrollbar`} style={{ scrollbarGutter: 'stable' }}>
                        {isApi ? (
                            <div className="space-y-2">
                                <label className="flex items-center gap-2 text-sm font-medium text-gray-400">
                                    <Palette size={16} className="text-green-400" />
                                    {t(EMOTION_IMAGE_GEN_I18N_KEYS.sectionPreset)}
                                </label>
                                <select
                                    value={selectedPreset}
                                    onChange={e => handlePresetChange(e.target.value)}
                                    className="w-full bg-gray-800 border border-green-600 rounded-lg px-3 py-2 text-sm text-gray-200 focus:border-green-400 outline-none"
                                >
                                    {selectedPreset && !apiPresets.some(p => p.name === selectedPreset) && (
                                        <option value={selectedPreset}>{selectedPreset}</option>
                                    )}
                                    {apiPresets.map(p => (
                                        <option key={p.name} value={p.name}>{p.name}</option>
                                    ))}
                                </select>
                            </div>
                        ) : (
                            <IntegratedWorkflowSection
                                backendUrl={backendUrl}
                                templates={templates}
                                selectedTemplate={selectedTemplate}
                                onTemplateChange={handleTemplateChange}
                                onTemplatesReload={reloadTemplates}
                                uiCatalog={uiCatalog}
                                title={t(EMOTION_IMAGE_GEN_I18N_KEYS.sectionWorkflow)}
                                onSaveDefault={() => persistWorkflow(selectedTemplate)}
                            />
                        )}

                        <div>
                            <div className="text-sm font-medium text-gray-400 mb-2">{t(EMOTION_IMAGE_GEN_I18N_KEYS.sectionResults)}</div>
                            <GeneratedImageGrid
                                results={results}
                                selectedId={selectedResultId}
                                onSelect={setSelectedResultId}
                                emptyLabel={t(EMOTION_IMAGE_GEN_I18N_KEYS.noResults)}
                                hintLabel={t(EMOTION_IMAGE_GEN_I18N_KEYS.selectHint)}
                                warningsLabel={t(EMOTION_IMAGE_GEN_I18N_KEYS.warnings)}
                            />
                        </div>

                        {/* 生成数・実行 */}
                        <div className="flex flex-wrap items-center gap-3 border-t border-gray-700/60 pt-3">
                            <label className="flex items-center gap-2 text-sm text-gray-300">
                                {t(EMOTION_IMAGE_GEN_I18N_KEYS.count)}
                                <input
                                    type="number"
                                    min={1}
                                    max={MAX_COUNT}
                                    value={count}
                                    onChange={e => setCount(Math.min(MAX_COUNT, Math.max(1, Number(e.target.value) || 1)))}
                                    className="w-16 bg-gray-800 border border-gray-700 text-gray-200 rounded px-2 py-1 text-sm outline-none focus:border-purple-500"
                                />
                            </label>
                            <button
                                type="button"
                                onClick={handleRun}
                                disabled={!canRun}
                                className="px-4 py-2 text-sm text-white bg-purple-600 hover:bg-purple-500 disabled:opacity-40 rounded-lg transition-colors flex items-center gap-1.5"
                            >
                                {isGenerating ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                                {isGenerating
                                    ? formatText(t(EMOTION_IMAGE_GEN_I18N_KEYS.running), { done: progress.done, total: progress.total })
                                    : t(EMOTION_IMAGE_GEN_I18N_KEYS.run)}
                            </button>
                            {editor.isDirty && <span className="text-xs text-yellow-300">{t(EMOTION_IMAGE_GEN_I18N_KEYS.saveFirst)}</span>}
                        </div>

                        {/* 表情画像に設定 */}
                        <div className="flex flex-wrap items-center gap-3">
                            <button
                                type="button"
                                onClick={handleApply}
                                disabled={!selectedResult || isGenerating || isApplying}
                                className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded-lg transition-colors flex items-center gap-1.5"
                            >
                                {isApplying ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                                {t(EMOTION_IMAGE_GEN_I18N_KEYS.apply)}
                            </button>
                            {notice && <span className={`text-xs ${notice.ok ? 'text-green-400' : 'text-red-400'}`}>{notice.text}</span>}
                        </div>
                    </div>
                </div>
            </div>

            {/* キャラクター選択モーダル（キャラカード付き） */}
            <GridSelectionModal
                isOpen={isCharacterPickerOpen}
                onClose={() => setIsCharacterPickerOpen(false)}
                title={t(SSRP_I18N_KEYS.characterSelect)}
                searchPlaceholder={t(SSRP_I18N_KEYS.characterSearch)}
                noMatchTemplate={t(SSRP_I18N_KEYS.noMatch)}
                searchable
                wide
                selectedValue={selectedDirName || undefined}
                options={characterOptions}
                onSelect={value => {
                    if (value) setSelectedDirName(value);
                    setIsCharacterPickerOpen(false);
                }}
            />

            {/* 上書き確認 */}
            {isOverwriteConfirmOpen && (
                <ConfirmDialog
                    isOpen={true}
                    title={t(EMOTION_IMAGE_GEN_I18N_KEYS.overwriteTitle)}
                    message={formatText(t(EMOTION_IMAGE_GEN_I18N_KEYS.overwriteMessage), { emotion: selectedEmotion })}
                    onYes={() => { setIsOverwriteConfirmOpen(false); void doUpload(); }}
                    onNo={() => setIsOverwriteConfirmOpen(false)}
                    onCancel={() => setIsOverwriteConfirmOpen(false)}
                    uiCatalog={uiCatalog}
                />
            )}

            {/* 切り抜き */}
            {cropSrc && (
                <ImageCropModal
                    isOpen={true}
                    onClose={() => setCropSrc(null)}
                    onSave={handleCropSave}
                    imageSrc={cropSrc}
                    emotion={selectedEmotion}
                    uiCatalog={uiCatalog}
                />
            )}
        </div>
    );
};
