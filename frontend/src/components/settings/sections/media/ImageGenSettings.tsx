/**
 * ImageGenSettings.tsx - 設定画面「画像生成・読み上げ」の画像生成
 *
 * 接続・会話から画像を作るとき・タグとワークフロー・あなたの見た目・画像の保存。
 * 接続先や場面を読み取る AI などは下書きを持ち、上の「保存」で変わった項目だけを差し替えて保存する。
 * 使う仕組みの切り替え・API サービスの接続とモデル・自動効果音・あなたの見た目は、部品がその場で保存する。
 */
import React, { useEffect, useImperativeHandle, useState } from 'react';
import { CheckCircle, Loader2, WifiOff } from 'lucide-react';
import {
    getComfyUIConfig,
    getLoraDirConfig,
    getLoraDirDefaults,
    patchComfyUIConfig,
    saveLoraDirConfig,
    testComfyUIConnection,
} from '../../../../api/comfyui';
import type {
    ApiServiceId,
    ComfyUIConfig,
    ConnectionTestResult,
    DanbooruTagFormat,
    DirectiveMode,
    ImageBackend,
    ImageJobMode,
    LightweightImageFormat,
    LightweightImageSaveConfig,
    LoraDirConfig,
    TriggerWordFormat,
} from '../../../../api/comfyui';
import { BACKEND_URL } from '../../../../api/base-url';
import { resolveMessage, type I18NCatalog } from '../../../../api/i18n';
import { SETTINGS_VIEW_I18N_KEYS, SETTINGS_VIEW_TEXT_FALLBACK_JA } from '../../../../constants/i18n';
import { normalizeClaudeEffort } from '../../../../constants/claude';
import { normalizeAntigravityThinking } from '../../../../constants/antigravity';
import { BackendTabs, type BackendSelection } from '../../../comfyui/BackendTabs';
import { TagJudgeProviderFields, type TagJudgeProviderValues } from '../../../comfyui/TagJudgeProviderFields';
import { ApiServiceConnectionSection } from '../../../comfyui/apiservice/ApiServiceConnectionSection';
import { ApiServiceBalancePanel } from '../../../comfyui/apiservice/ApiServiceBalancePanel';
import { ApiServiceModelSelect } from '../../../comfyui/apiservice/ApiServiceModelSelect';
import { AutoSoundEffectsToggle } from '../../../comfyui/apiservice/AutoSoundEffectsToggle';
import { UserAppearanceSection } from '../../../comfyui/apiservice/UserAppearanceSection';
import { normalizeApiService, normalizeImageBackend } from '../../../comfyui/apiservice/services';
import { createComfyUIText } from '../../../comfyui/i18n';
import { Button, Segmented, SettingRow, TextField, Toggle } from '../../../ui';
import { SettingsGroup, RangeControl } from '../parts';
import { changed, type SectionHandle } from '../sectionTypes';

interface Draft {
    connectionUrl: string;
    tagJudge: TagJudgeProviderValues;
    tagJudgeTimeoutSeconds: number;
    directiveMode: DirectiveMode;
    apiDirectiveMode: DirectiveMode;
    imageJobMode: ImageJobMode;
    danbooruTagFormat: DanbooruTagFormat;
    triggerWordFormat: TriggerWordFormat;
    lightweightImageSave: LightweightImageSaveConfig;
}

const draftFromConfig = (config: ComfyUIConfig): Draft => ({
    connectionUrl: config.connectionUrl || 'http://127.0.0.1:8188',
    tagJudge: {
        provider: config.tagJudgeProvider || 'antigravity',
        geminiModel: config.tagJudgeGeminiModel || 'gemini-3-flash-preview',
        claudeModel: config.tagJudgeClaudeModel || 'claude-sonnet-4-6',
        claudeEffort: normalizeClaudeEffort(config.tagJudgeClaudeEffort),
        antigravityModel: config.tagJudgeAntigravityModel || 'antigravity',
        antigravityThinking: normalizeAntigravityThinking(config.tagJudgeAntigravityThinking),
        openAICompatModel: config.tagJudgeOpenAICompatModel || '',
    },
    tagJudgeTimeoutSeconds: config.tagJudgeTimeoutSeconds ?? 180,
    directiveMode: config.directiveMode || 'danbooru_only',
    apiDirectiveMode: config.apiDirectiveMode || 'danbooru_only',
    imageJobMode: config.imageJobMode ?? 'combined',
    danbooruTagFormat: config.danbooruTagFormat || 'underscore',
    triggerWordFormat: config.triggerWordFormat || 'raw',
    lightweightImageSave: {
        enabled: config.lightweightImageSave?.enabled || false,
        format: config.lightweightImageSave?.format || 'avif',
        quality: config.lightweightImageSave?.quality || 92,
        lossless: config.lightweightImageSave?.lossless || false,
        effort: config.lightweightImageSave?.effort ?? 4,
    },
});

const patchFromDraft = (draft: Draft): Partial<ComfyUIConfig> => ({
    connectionUrl: draft.connectionUrl,
    tagJudgeProvider: draft.tagJudge.provider,
    tagJudgeGeminiModel: draft.tagJudge.geminiModel,
    tagJudgeClaudeModel: draft.tagJudge.claudeModel,
    tagJudgeClaudeEffort: draft.tagJudge.claudeEffort,
    tagJudgeAntigravityModel: draft.tagJudge.antigravityModel,
    tagJudgeAntigravityThinking: draft.tagJudge.antigravityThinking,
    tagJudgeOpenAICompatModel: draft.tagJudge.openAICompatModel,
    tagJudgeTimeoutSeconds: draft.tagJudgeTimeoutSeconds,
    directiveMode: draft.directiveMode,
    apiDirectiveMode: draft.apiDirectiveMode,
    imageJobMode: draft.imageJobMode,
    danbooruTagFormat: draft.danbooruTagFormat,
    triggerWordFormat: draft.triggerWordFormat,
    lightweightImageSave: draft.lightweightImageSave,
});

interface ImageGenSettingsProps {
    uiCatalog: I18NCatalog | null;
    active: boolean;
    onDirtyChange: (dirty: boolean) => void;
    /** 素材づくりのタグ・ワークフローを開く */
    onOpenMaterial: (tab: 'tags' | 'workflow') => void;
}

export const ImageGenSettings = React.forwardRef<SectionHandle, ImageGenSettingsProps>(({ uiCatalog, active, onDirtyChange, onOpenMaterial }, ref) => {
    const { COMMON, SECTION_NAMES, DIRECTIVE_MODE_OPTIONS, DIRECTIVE_MODE_OPTIONS_API } = createComfyUIText(uiCatalog);
    const t = (key: string) => resolveMessage(uiCatalog, key, SETTINGS_VIEW_TEXT_FALLBACK_JA[key] || key);

    const [saved, setSaved] = useState<Draft | null>(null);
    const [draft, setDraft] = useState<Draft | null>(null);
    const [savedLoraDirs, setSavedLoraDirs] = useState<LoraDirConfig | null>(null);
    const [loraDirs, setLoraDirs] = useState<LoraDirConfig | null>(null);
    const [loraDefaults, setLoraDefaults] = useState<LoraDirConfig | null>(null);
    const [imageBackend, setImageBackend] = useState<ImageBackend>('comfyui');
    const [apiService, setApiService] = useState<ApiServiceId>('novelai');
    const [apiModelId, setApiModelId] = useState('');
    const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
    const [testing, setTesting] = useState(false);
    const isApi = imageBackend === 'api';

    useEffect(() => {
        if (!active) return;
        let alive = true;
        Promise.all([
            getComfyUIConfig(BACKEND_URL),
            getLoraDirConfig(BACKEND_URL).catch(() => null),
            getLoraDirDefaults(BACKEND_URL).catch(() => null),
        ]).then(([config, dirs, defaults]) => {
            if (!alive) return;
            const loaded = draftFromConfig(config);
            setSaved(loaded);
            setDraft(loaded);
            setImageBackend(normalizeImageBackend(config.imageBackend));
            setApiService(normalizeApiService(config.apiService));
            setSavedLoraDirs(dirs);
            setLoraDirs(dirs);
            setLoraDefaults(defaults);
        }).catch(() => {});
        return () => { alive = false; };
    }, [active]);

    const dirty = (!!draft && !!saved && changed(draft, saved)) || (!!loraDirs && changed(loraDirs, savedLoraDirs));
    useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);

    useImperativeHandle(ref, () => ({
        save: async () => {
            const failed: string[] = [];
            if (draft && saved && changed(draft, saved)) {
                try {
                    await patchComfyUIConfig(BACKEND_URL, patchFromDraft(draft));
                    setSaved(draft);
                } catch {
                    failed.push(t(SETTINGS_VIEW_I18N_KEYS.mediaImageGen));
                }
            }
            if (loraDirs && changed(loraDirs, savedLoraDirs)) {
                try {
                    await saveLoraDirConfig(BACKEND_URL, loraDirs);
                    setSavedLoraDirs(loraDirs);
                } catch {
                    failed.push(t(SETTINGS_VIEW_I18N_KEYS.mediaLoraDirs));
                }
            }
            return failed;
        },
        revert: () => {
            setDraft(saved);
            setLoraDirs(savedLoraDirs);
        },
    }));

    const update = (patch: Partial<Draft>) => setDraft(current => (current ? { ...current, ...patch } : current));

    const handleBackendChange = (selection: BackendSelection) => {
        setImageBackend(selection.imageBackend);
        setApiService(selection.apiService);
    };

    const runTest = async () => {
        if (!draft) return;
        setTesting(true);
        setTestResult(null);
        try {
            setTestResult(await testComfyUIConnection(BACKEND_URL, draft.connectionUrl));
        } catch (error) {
            setTestResult({ success: false, message: (error as Error).message || COMMON.MESSAGES.CONNECTION_TEST_FAILED });
        } finally {
            setTesting(false);
        }
    };

    if (!draft) return null;

    const modeLabels = isApi ? DIRECTIVE_MODE_OPTIONS_API : DIRECTIVE_MODE_OPTIONS;
    const modes: { value: DirectiveMode; label: string }[] = [
        { value: 'natural_language', label: modeLabels.NATURAL_LANGUAGE },
        { value: 'natural_language_short', label: modeLabels.NATURAL_SHORT },
        { value: 'natural_language_third_person', label: modeLabels.NATURAL_THIRD },
        { value: 'natural_language_third_person_short', label: modeLabels.NATURAL_THIRD_SHORT },
        { value: 'danbooru_only', label: modeLabels.DANBOORU_ONLY },
        { value: 'danbooru_third_person', label: modeLabels.DANBOORU_THIRD },
    ];
    const selectCls = 'w-full h-9 px-2.5 rounded-ui bg-surface border border-line-strong text-fg text-sm outline-none focus:border-accent';
    const lw = draft.lightweightImageSave;

    return (
        <>
            <SettingsGroup title={t(SETTINGS_VIEW_I18N_KEYS.mediaGroupConnection)}>
                <div className="px-4 py-3 border-b border-line">
                    <BackendTabs backendUrl={BACKEND_URL} uiCatalog={uiCatalog} active={active} onChange={handleBackendChange} initial={{ imageBackend, apiService }} />
                </div>
                {isApi ? (
                    <>
                        <div className="px-4 py-3 border-b border-line">
                            <ApiServiceConnectionSection backendUrl={BACKEND_URL} uiCatalog={uiCatalog} service={apiService} active={active} />
                        </div>
                        <div className="px-4 py-3 border-b border-line">
                            <ApiServiceModelSelect backendUrl={BACKEND_URL} uiCatalog={uiCatalog} service={apiService} active={active} onModelChange={setApiModelId} />
                        </div>
                        {/* 自動効果音描画は使用モデルの下（刷新前と同じ並び。モデルごとに使えるかが変わるため） */}
                        <div className="px-4 py-3 border-b border-line">
                            <AutoSoundEffectsToggle modelId={apiModelId} backendUrl={BACKEND_URL} uiCatalog={uiCatalog} service={apiService} active={active} showHelp size="sm" />
                        </div>
                        <div className="px-4 py-3">
                            <ApiServiceBalancePanel backendUrl={BACKEND_URL} uiCatalog={uiCatalog} active={active} selection={{ imageBackend, apiService }} />
                        </div>
                    </>
                ) : (
                    <>
                        <SettingRow title={t(SETTINGS_VIEW_I18N_KEYS.mediaConnectionUrl)} description={COMMON.MESSAGES.DEFAULT_PORT_DESC}>
                            <div className="w-full space-y-1.5">
                                <div className="flex gap-2">
                                    <TextField
                                        aria-label={t(SETTINGS_VIEW_I18N_KEYS.mediaConnectionUrl)}
                                        value={draft.connectionUrl}
                                        onChange={e => { update({ connectionUrl: e.target.value }); setTestResult(null); }}
                                        placeholder="http://127.0.0.1:8188"
                                    />
                                    <Button size="sm" variant="secondary" disabled={testing || !draft.connectionUrl.trim()} onClick={() => { void runTest(); }}>
                                        {testing && <Loader2 size={14} className="animate-spin" />}
                                        {COMMON.BUTTONS.TEST}
                                    </Button>
                                </div>
                                {testResult && (
                                    <p className={`flex items-center gap-1.5 text-xs ${testResult.success ? 'text-ok' : 'text-danger'}`}>
                                        {testResult.success ? <CheckCircle size={12} /> : <WifiOff size={12} />}
                                        {resolveMessage(uiCatalog, testResult.message, testResult.message)}
                                    </p>
                                )}
                            </div>
                        </SettingRow>
                        {loraDirs && (
                            <div className="px-4 py-3 space-y-2">
                                <div className="text-sm font-semibold">{t(SETTINGS_VIEW_I18N_KEYS.mediaLoraDirs)}</div>
                                <p className="text-xs text-fg-muted">{COMMON.MESSAGES.LORA_DIR_DESCRIPTION}</p>
                                {loraDirs.categories.map(cat => {
                                    const defaultDir = loraDefaults?.categories.find(d => d.id === cat.id)?.directory ?? '';
                                    // 分類はタグの分類と同じ ID なので、その訳を引く
                                    const categoryLabel = resolveMessage(uiCatalog, `comfyui.tagCategory.${cat.id}`, cat.label);
                                    return (
                                        <div key={cat.id} className="flex flex-wrap items-center gap-2">
                                            <span className="text-sm w-28 shrink-0">{categoryLabel}</span>
                                            <TextField
                                                aria-label={`${t(SETTINGS_VIEW_I18N_KEYS.mediaLoraDirs)} ${categoryLabel}`}
                                                value={cat.directory}
                                                onChange={e => setLoraDirs({ ...loraDirs, categories: loraDirs.categories.map(c => (c.id === cat.id ? { ...c, directory: e.target.value } : c)) })}
                                                className="flex-1 min-w-0 h-8 text-sm"
                                            />
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                disabled={cat.directory === defaultDir}
                                                onClick={() => setLoraDirs({ ...loraDirs, categories: loraDirs.categories.map(c => (c.id === cat.id ? { ...c, directory: defaultDir } : c)) })}
                                            >
                                                {COMMON.BUTTONS.RESET}
                                            </Button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </>
                )}
            </SettingsGroup>

            {/* タグ・トリガーワードの形式は接続の次（刷新前の画像生成設定と同じ並び） */}
            <SettingsGroup title={t(SETTINGS_VIEW_I18N_KEYS.mediaGroupTags)}>
                {!isApi && (
                    <>
                        <SettingRow title={SECTION_NAMES.DANBOORU_FORMAT} description={COMMON.MESSAGES.DANBOORU_FORMAT_DESC} compactControl>
                            <Segmented<DanbooruTagFormat>
                                label={SECTION_NAMES.DANBOORU_FORMAT}
                                value={draft.danbooruTagFormat}
                                onChange={v => update({ danbooruTagFormat: v })}
                                options={[
                                    { value: 'underscore', label: COMMON.MESSAGES.UNDERSCORE },
                                    { value: 'space', label: COMMON.MESSAGES.SPACE },
                                    { value: 'anima', label: COMMON.MESSAGES.ANIMA },
                                ]}
                            />
                        </SettingRow>
                        <SettingRow title={SECTION_NAMES.TRIGGER_FORMAT} description={COMMON.MESSAGES.TRIGGER_FORMAT_DESC} compactControl>
                            <Segmented<TriggerWordFormat>
                                label={SECTION_NAMES.TRIGGER_FORMAT}
                                value={draft.triggerWordFormat}
                                onChange={v => update({ triggerWordFormat: v })}
                                options={[
                                    { value: 'raw', label: COMMON.MESSAGES.RAW },
                                    { value: 'underscore', label: COMMON.MESSAGES.UNDERSCORE },
                                    { value: 'space', label: COMMON.MESSAGES.SPACE },
                                    { value: 'anima', label: COMMON.MESSAGES.ANIMA },
                                ]}
                            />
                        </SettingRow>
                    </>
                )}
                <div className="flex flex-wrap gap-2 px-4 py-3">
                    <Button size="sm" variant="secondary" onClick={() => onOpenMaterial('tags')}>{t(SETTINGS_VIEW_I18N_KEYS.mediaOpenTags)}</Button>
                    <Button size="sm" variant="secondary" onClick={() => onOpenMaterial('workflow')}>{t(SETTINGS_VIEW_I18N_KEYS.mediaOpenWorkflow)}</Button>
                </div>
            </SettingsGroup>

            <SettingsGroup title={t(SETTINGS_VIEW_I18N_KEYS.mediaGroupChat)}>
                <div className="px-4 py-3 border-b border-line space-y-2">
                    <div className="text-sm font-semibold">{t(SETTINGS_VIEW_I18N_KEYS.mediaTagJudge)}</div>
                    <TagJudgeProviderFields
                        backendUrl={BACKEND_URL}
                        uiCatalog={uiCatalog}
                        active={active}
                        values={draft.tagJudge}
                        onChange={patch => setDraft(current => (current ? { ...current, tagJudge: { ...current.tagJudge, ...patch } } : current))}
                        showDescription
                    />
                </div>
                <SettingRow title={COMMON.BUTTONS.TAG_JUDGE_TIMEOUT_SECONDS}>
                    <TextField
                        aria-label={COMMON.BUTTONS.TAG_JUDGE_TIMEOUT_SECONDS}
                        type="number"
                        min={30}
                        max={1800}
                        step={10}
                        value={draft.tagJudgeTimeoutSeconds}
                        onChange={e => { const v = Number(e.target.value); update({ tagJudgeTimeoutSeconds: Number.isFinite(v) ? v : 180 }); }}
                    />
                </SettingRow>
                <SettingRow title={t(SETTINGS_VIEW_I18N_KEYS.mediaDirectiveMode)} description={COMMON.MESSAGES.DIRECTIVE_MODE_DESC}>
                    <select
                        aria-label={t(SETTINGS_VIEW_I18N_KEYS.mediaDirectiveMode)}
                        value={isApi ? draft.apiDirectiveMode : draft.directiveMode}
                        onChange={e => update(isApi ? { apiDirectiveMode: e.target.value as DirectiveMode } : { directiveMode: e.target.value as DirectiveMode })}
                        className={selectCls}
                    >
                        {modes.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                </SettingRow>
                <SettingRow
                    title={COMMON.BUTTONS.IMAGE_JOB_MODE}
                    description={`${draft.imageJobMode === 'split' ? COMMON.BUTTONS.IMAGE_JOB_MODE_SPLIT_DESCRIPTION : COMMON.BUTTONS.IMAGE_JOB_MODE_COMBINED_DESCRIPTION} ${COMMON.BUTTONS.IMAGE_JOB_MODE_NOTE}`}
                    compactControl
                >
                    <Segmented<ImageJobMode>
                        label={COMMON.BUTTONS.IMAGE_JOB_MODE}
                        value={draft.imageJobMode}
                        onChange={v => update({ imageJobMode: v })}
                        options={[
                            { value: 'combined', label: COMMON.BUTTONS.IMAGE_JOB_MODE_COMBINED },
                            { value: 'split', label: COMMON.BUTTONS.IMAGE_JOB_MODE_SPLIT },
                        ]}
                    />
                </SettingRow>
            </SettingsGroup>

            {isApi && (
                <SettingsGroup title={t(SETTINGS_VIEW_I18N_KEYS.mediaGroupAppearance)}>
                    <div className="px-4 py-3">
                        <UserAppearanceSection backendUrl={BACKEND_URL} uiCatalog={uiCatalog} service={apiService} active={active} hideHeading referenceRefreshKey={apiModelId} />
                    </div>
                </SettingsGroup>
            )}

            {!isApi && (
                <SettingsGroup title={t(SETTINGS_VIEW_I18N_KEYS.mediaGroupSave)} note={COMMON.MESSAGES.LIGHTWEIGHT_SAVE_DESC}>
                    <SettingRow title={COMMON.MESSAGES.LIGHTWEIGHT_SAVE_LABEL} compactControl>
                        <Toggle checked={lw.enabled} onChange={v => update({ lightweightImageSave: { ...lw, enabled: v } })} />
                    </SettingRow>
                    <SettingRow title={COMMON.BUTTONS.FORMAT}>
                        <select
                            aria-label={COMMON.BUTTONS.FORMAT}
                            value={lw.format}
                            disabled={!lw.enabled}
                            onChange={e => update({ lightweightImageSave: { ...lw, format: e.target.value as LightweightImageFormat } })}
                            className={selectCls}
                        >
                            <option value="avif">AVIF</option>
                            <option value="webp">WebP</option>
                            <option value="png">PNG</option>
                        </select>
                    </SettingRow>
                    {/* 形式 → effort → quality の順（刷新前と同じ並び） */}
                    <SettingRow title="effort">
                        <TextField
                            aria-label="effort"
                            type="number"
                            min={0}
                            max={10}
                            value={lw.effort}
                            disabled={!lw.enabled}
                            onChange={e => update({ lightweightImageSave: { ...lw, effort: Number(e.target.value) } })}
                        />
                    </SettingRow>
                    <SettingRow title="quality">
                        <RangeControl
                            label="quality"
                            value={lw.quality}
                            min={1}
                            max={100}
                            step={1}
                            display={String(lw.quality)}
                            disabled={!lw.enabled}
                            onChange={v => update({ lightweightImageSave: { ...lw, quality: v } })}
                        />
                    </SettingRow>
                    <SettingRow title="lossless" compactControl>
                        <Toggle checked={lw.lossless} disabled={!lw.enabled} onChange={v => update({ lightweightImageSave: { ...lw, lossless: v } })} />
                    </SettingRow>
                </SettingsGroup>
            )}
        </>
    );
});
ImageGenSettings.displayName = 'ImageGenSettings';

export default ImageGenSettings;
