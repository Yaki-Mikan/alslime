import React, { useCallback, useEffect, useImperativeHandle, useState } from 'react';
import axios from '../../../lib/axios';
import { formatLabelValue, resolveMessage } from '../../../api/i18n';
import { BACKEND_URL } from '../../../api/base-url';
import { listSSRPAllPresets } from '../../../api/datetime-presets';
import { getGlobalSettings, updateGlobalSettings } from '../../../api/global-settings';
import { fetchProcessLimits, updateProcessLimits, type ProcessLimits } from '../../../api/jobs';
import type { ApiProviderInstructionTarget } from '../../../api/api-providers';
import { modelDisplayLabel, modelProviderOf, type Model, type ModelProvider } from '../../../hooks/useChat';
import { openAICompatLabel } from '../../../constants/providers';
import {
    COMMON_TEXT_FALLBACK_JA,
    JOBS_I18N_KEYS,
    JOBS_TEXT_FALLBACK_JA,
    SETTINGS_I18N_KEYS,
    SETTINGS_TEXT_FALLBACK_JA,
    SETTINGS_VIEW_I18N_KEYS,
    SETTINGS_VIEW_TEXT_FALLBACK_JA,
} from '../../../constants/i18n';
import { Button, Select, SettingRow, TextField } from '../../ui';
import { ModelListEditorModal } from '../ModelListEditorModal';
import { ApiProvidersModal } from '../ApiProvidersModal';
import { SettingsGroup } from './parts';
import { changed, type SectionCommonProps, type SectionHandle } from './sectionTypes';

interface AiSectionProps extends SectionCommonProps {
    /** モデル一覧・API 接続先を変えたあと、会話側のモデル一覧を読み直させる */
    onModelsChanged?: () => void;
    /** API 接続先の「指示ファイルを開く」（設定ファイルの窓で開く） */
    onOpenApiProviderInstruction?: (target: ApiProviderInstructionTarget) => void;
}

type DefaultModels = Record<ModelProvider, string>;

interface AiDraft {
    defaultPresetName: string;
    defaultProvider: string;
    defaultModels: DefaultModels;
    limits: ProcessLimits;
}

const EMPTY_MODELS: DefaultModels = { gemini: '', claude: '', antigravity: '', openai_compat: '' };
const EMPTY_LIMITS: ProcessLimits = { global: 1, gemini: 1, claude: 1, antigravity: 1, openai_compat: 1, tts: 1, comfyui: 1 };
// 画像生成の枠の上限（本体の丸めと同じ値）
const COMFYUI_LIMIT_MAX = 4;

const LIMIT_KINDS: { key: 'gemini' | 'claude' | 'antigravity' | 'openai_compat'; label: string }[] = [
    { key: 'gemini', label: 'Gemini' },
    { key: 'claude', label: 'Claude' },
    { key: 'antigravity', label: 'Antigravity' },
    // API の名前は製品名ではないので、表示時に表示言語の文言表から引く（label はその予備）
    { key: 'openai_compat', label: 'API (OpenAI-compatible)' },
];

const toInt = (value: string) => parseInt(value, 10) || 1;

export const AiSection = React.forwardRef<SectionHandle, AiSectionProps>(
    ({ onDirtyChange, uiCatalog, onModelsChanged, onOpenApiProviderInstruction }, ref) => {
        const t = (key: string) => resolveMessage(
            uiCatalog,
            key,
            SETTINGS_VIEW_TEXT_FALLBACK_JA[key]
                || SETTINGS_TEXT_FALLBACK_JA[key]
                || JOBS_TEXT_FALLBACK_JA[key]
                || COMMON_TEXT_FALLBACK_JA[key]
                || key,
        );
        const [presets, setPresets] = useState<string[]>([]);
        const [models, setModels] = useState<Model[]>([]);
        const [saved, setSaved] = useState<AiDraft | null>(null);
        const [draft, setDraft] = useState<AiDraft | null>(null);
        const [loadError, setLoadError] = useState<string | null>(null);
        const [openWindow, setOpenWindow] = useState<'models' | 'providers' | null>(null);

        const refreshModels = useCallback(async () => {
            try {
                const res = await axios.get(`${BACKEND_URL}/api/models`);
                setModels(res.data.models || []);
            } catch (error) {
                console.error('Failed to refresh models:', error);
            }
        }, []);

        useEffect(() => {
            (async () => {
                let limits = EMPTY_LIMITS;
                try {
                    limits = await fetchProcessLimits(BACKEND_URL);
                } catch {
                    setLoadError(t(JOBS_I18N_KEYS.loadError));
                }
                const [presetNames, global] = await Promise.all([
                    listSSRPAllPresets(BACKEND_URL).catch(() => [] as string[]),
                    getGlobalSettings(BACKEND_URL),
                ]);
                const savedModels = (global.defaultModels || {}) as Record<string, string>;
                const initial: AiDraft = {
                    defaultPresetName: global.defaultSSRPPresetName || '',
                    defaultProvider: global.defaultProvider || '',
                    defaultModels: { ...EMPTY_MODELS, ...savedModels },
                    limits,
                };
                setPresets(presetNames);
                setSaved(initial);
                setDraft(initial);
            })();
            void refreshModels();
            // 開いたときに一度だけ読む
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, []);

        const isDirty = !!saved && !!draft && changed(saved, draft);
        useEffect(() => { onDirtyChange(isDirty); }, [isDirty, onDirtyChange]);

        useImperativeHandle(ref, () => ({
            save: async () => {
                if (!saved || !draft) return [];
                const failed: string[] = [];
                let next = saved;
                // 全体設定は変わった項目だけを送る
                const updates: Record<string, unknown> = {};
                if (draft.defaultPresetName !== saved.defaultPresetName) updates.defaultSSRPPresetName = draft.defaultPresetName || undefined;
                if (draft.defaultProvider !== saved.defaultProvider) updates.defaultProvider = draft.defaultProvider;
                if (changed(draft.defaultModels, saved.defaultModels)) updates.defaultModels = draft.defaultModels;
                if (Object.keys(updates).length > 0) {
                    try {
                        await updateGlobalSettings(BACKEND_URL, updates);
                        next = { ...next, defaultPresetName: draft.defaultPresetName, defaultProvider: draft.defaultProvider, defaultModels: draft.defaultModels };
                    } catch {
                        failed.push(t(SETTINGS_I18N_KEYS.aiModelLabel));
                    }
                }
                if (changed(draft.limits, saved.limits)) {
                    try {
                        const limits = await updateProcessLimits(BACKEND_URL, draft.limits);
                        next = { ...next, limits };
                        setDraft(current => (current ? { ...current, limits } : current));
                    } catch {
                        failed.push(t(JOBS_I18N_KEYS.limitsTitle));
                    }
                }
                setSaved(next);
                return failed;
            },
            revert: () => setDraft(saved),
        }));

        if (!draft) return null;

        const setLimits = (updater: (limits: ProcessLimits) => ProcessLimits) =>
            setDraft(current => (current ? { ...current, limits: updater(current.limits) } : current));
        const handleGlobalLimit = (value: number) => {
            const g = Math.max(1, value);
            // 種別ごとの上限は全体を超えられない（画像生成と読み上げの枠は全体と別）
            setLimits(prev => ({
                ...prev,
                global: g,
                gemini: Math.min(prev.gemini, g),
                claude: Math.min(prev.claude, g),
                antigravity: Math.min(prev.antigravity, g),
                openai_compat: Math.min(prev.openai_compat, g),
            }));
        };

        const providerLabels: [ModelProvider, string][] = [
            ['gemini', t(SETTINGS_I18N_KEYS.defaultModelsGeminiLabel)],
            ['claude', t(SETTINGS_I18N_KEYS.defaultModelsClaudeLabel)],
            ['antigravity', t(SETTINGS_I18N_KEYS.defaultModelsAntigravityLabel)],
            ['openai_compat', resolveMessage(uiCatalog, 'chatInput.providerOpenAICompat', 'API（OpenAI互換）')],
        ];

        return (
            <>
                {loadError && <p className="mb-4 text-sm text-danger">{loadError}</p>}

                <SettingsGroup title={t(SETTINGS_I18N_KEYS.aiModelLabel)}>
                    <SettingRow title={t(SETTINGS_I18N_KEYS.defaultPresetTitle)} description={t(SETTINGS_I18N_KEYS.defaultPresetDescription)}>
                        <Select
                            value={draft.defaultPresetName}
                            onChange={(value) => setDraft({ ...draft, defaultPresetName: value })}
                            options={[
                                { value: '', label: t(SETTINGS_I18N_KEYS.defaultPresetNone) },
                                ...presets.map(name => ({ value: name, label: name })),
                            ]}
                        />
                    </SettingRow>
                    <SettingRow title={t(SETTINGS_I18N_KEYS.defaultProviderTitle)} description={t(SETTINGS_I18N_KEYS.defaultProviderDescription)}>
                        <Select
                            value={draft.defaultProvider}
                            onChange={(value) => setDraft({ ...draft, defaultProvider: value })}
                            options={[
                                { value: '', label: t(SETTINGS_I18N_KEYS.defaultProviderNone) },
                                { value: 'antigravity', label: 'Antigravity' },
                                { value: 'claude', label: 'Claude' },
                                { value: 'gemini', label: 'Gemini' },
                                { value: 'openai_compat', label: t('chatInput.providerOpenAICompat') },
                            ]}
                        />
                    </SettingRow>
                    {providerLabels.map(([provider, label]) => (
                        <SettingRow
                            key={provider}
                            title={formatLabelValue(uiCatalog ?? null, t(SETTINGS_I18N_KEYS.defaultModelsTitle), label)}
                            description={provider === 'gemini' ? t(SETTINGS_I18N_KEYS.defaultModelsDescription) : undefined}
                        >
                            <Select
                                value={draft.defaultModels[provider]}
                                onChange={(value) => setDraft({ ...draft, defaultModels: { ...draft.defaultModels, [provider]: value } })}
                                options={[
                                    { value: '', label: t(SETTINGS_I18N_KEYS.defaultModelsNone) },
                                    ...models
                                        .filter(m => m.id !== '' && modelProviderOf(m) === provider)
                                        .map(m => ({ value: m.id, label: modelDisplayLabel(m, uiCatalog ?? null) })),
                                ]}
                            />
                        </SettingRow>
                    ))}
                </SettingsGroup>

                <SettingsGroup title={t(SETTINGS_VIEW_I18N_KEYS.groupModels)}>
                    <SettingRow title={t(SETTINGS_I18N_KEYS.modelEditorLabel)} description={t(SETTINGS_I18N_KEYS.modelEditorDescription)} compactControl>
                        <Button size="sm" onClick={() => setOpenWindow('models')}>{t(SETTINGS_VIEW_I18N_KEYS.manage)}</Button>
                    </SettingRow>
                    <SettingRow title={resolveMessage(uiCatalog, 'apiProviders.menuLabel', 'API接続先管理')} compactControl>
                        <Button size="sm" onClick={() => setOpenWindow('providers')}>{t(SETTINGS_VIEW_I18N_KEYS.manage)}</Button>
                    </SettingRow>
                </SettingsGroup>

                <SettingsGroup title={t(JOBS_I18N_KEYS.limitsTitle)}>
                    <SettingRow title={t(JOBS_I18N_KEYS.globalLimit)} description={t(JOBS_I18N_KEYS.globalLimitDescription)}>
                        <TextField type="number" min={1} value={draft.limits.global} onChange={(e) => handleGlobalLimit(toInt(e.target.value))} />
                    </SettingRow>
                    {LIMIT_KINDS.map(({ key, label }) => (
                        <SettingRow key={key} title={formatLabelValue(uiCatalog ?? null, t(JOBS_I18N_KEYS.perKindLimit), key === 'openai_compat' ? openAICompatLabel(uiCatalog) : label)} description={key === 'gemini' ? t(JOBS_I18N_KEYS.clampDescription) : undefined}>
                            <TextField
                                type="number"
                                min={1}
                                max={draft.limits.global}
                                value={draft.limits[key]}
                                onChange={(e) => {
                                    const value = toInt(e.target.value);
                                    setLimits(prev => ({ ...prev, [key]: Math.min(Math.max(1, value), prev.global) }));
                                }}
                            />
                        </SettingRow>
                    ))}
                    <SettingRow title={t(JOBS_I18N_KEYS.comfyuiLimit)} description={t(JOBS_I18N_KEYS.comfyuiLimitDescription)}>
                        <TextField
                            type="number"
                            min={1}
                            max={COMFYUI_LIMIT_MAX}
                            value={draft.limits.comfyui}
                            onChange={(e) => {
                                const value = toInt(e.target.value);
                                setLimits(prev => ({ ...prev, comfyui: Math.min(Math.max(1, value), COMFYUI_LIMIT_MAX) }));
                            }}
                        />
                    </SettingRow>
                </SettingsGroup>

                <ModelListEditorModal
                    isOpen={openWindow === 'models'}
                    onClose={() => setOpenWindow(null)}
                    uiCatalog={uiCatalog}
                    onSaved={() => {
                        void refreshModels();
                        onModelsChanged?.();
                    }}
                />
                <ApiProvidersModal
                    isOpen={openWindow === 'providers'}
                    onClose={() => setOpenWindow(null)}
                    uiCatalog={uiCatalog}
                    onModelsChanged={() => {
                        void refreshModels();
                        onModelsChanged?.();
                    }}
                    onOpenInstruction={target => {
                        setOpenWindow(null);
                        onOpenApiProviderInstruction?.(target);
                    }}
                />
            </>
        );
    },
);
AiSection.displayName = 'AiSection';
