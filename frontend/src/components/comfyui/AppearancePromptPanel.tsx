/**
 * AppearancePromptPanel - キャラクター容姿プロンプトを AI に作らせる小窓
 *
 * 画像生成設定フォームのキャラクタープロンプト欄のボタンから開く。対象キャラの設定ファイル本文を
 * AI に読ませ、容姿を表す Danbooru タグをグループごとの行で受け取る。行クリックでコピー、
 * 「追加」でキャラクタープロンプト欄へ追記する（LoRA のトリガーワード取得と同じ動き）。
 * 状態は親（ConfigEditorHub）のフックが持つため、小窓を閉じても分析は続く。
 * 統合設定モーダル（z-[80]）の上に出すため z-[90]。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Square, Save, Plus, Loader2 } from 'lucide-react';
import axios from '../../lib/axios';
import { DraggablePanel } from '../common/DraggablePanel';
import { ModelSelector } from '../common/ModelSelector';
import { ALL_MODEL_PROVIDERS, resolveModelSelection } from '../common/modelSelection';
import { getGlobalSettings, updateGlobalSettings } from '../../api/global-settings';
import { getCLIStatus, type CLIStatusEntry } from '../../api/config-gen';
import { resolveMessage, type I18NCatalog } from '../../api/i18n';
import { APPEARANCE_PROMPT_I18N_KEYS, APPEARANCE_PROMPT_TEXT_FALLBACK_JA } from '../../constants/i18n';
import { DEFAULT_ANTIGRAVITY_THINKING, type AntigravityThinking } from '../../constants/antigravity';
import type { Model, ModelProvider } from '../../hooks/useChat';
import type { AppearancePromptHandle } from '../../hooks/useAppearancePromptGen';
import type { TriggerWordFormat } from '../../api/comfyui';
import { formatTriggerLine } from './danbooru-format';

const DEFAULT_TIMEOUT_MINUTES = 5;
const POSITION_STORAGE_KEY = 'alslime.appearancePrompt.pos';
const GLOBAL_SETTINGS_KEY = 'appearancePromptGen';

interface SavedGenDefaults {
    provider?: string;
    model?: string;
    effort?: string;
    thinking?: string;
    timeoutMinutes?: number;
}

interface Props {
    backendUrl: string;
    handle: AppearancePromptHandle;
    /** フォームに未保存の編集があるか（分析は保存済み本文を使う旨の注記を出す） */
    isDirty: boolean;
    triggerWordFormat: TriggerWordFormat;
    /** 1 行分のタグ列（表記形式適用済み）をキャラクタープロンプト欄へ追記する */
    onAppendLine: (line: string) => void;
    uiCatalog: I18NCatalog | null;
}

const GROUP_LABEL_KEYS: Record<string, string> = {
    hair: APPEARANCE_PROMPT_I18N_KEYS.groupHair,
    eyes: APPEARANCE_PROMPT_I18N_KEYS.groupEyes,
    body: APPEARANCE_PROMPT_I18N_KEYS.groupBody,
    skin: APPEARANCE_PROMPT_I18N_KEYS.groupSkin,
    outfit: APPEARANCE_PROMPT_I18N_KEYS.groupOutfit,
    other: APPEARANCE_PROMPT_I18N_KEYS.groupOther,
};

export const AppearancePromptPanel: React.FC<Props> = ({ backendUrl, handle, isDirty, triggerWordFormat, onAppendLine, uiCatalog }) => {
    const t = (key: string) => resolveMessage(uiCatalog, key, APPEARANCE_PROMPT_TEXT_FALLBACK_JA[key] || key);
    const locale = uiCatalog?.lang || 'ja';

    const [models, setModels] = useState<Model[]>([]);
    const [cliStatus, setCliStatus] = useState<CLIStatusEntry[]>([]);
    const [provider, setProvider] = useState<ModelProvider>('antigravity');
    const [model, setModel] = useState('');
    const [effort, setEffort] = useState('');
    const [thinking, setThinking] = useState<AntigravityThinking>(DEFAULT_ANTIGRAVITY_THINKING);
    const [timeoutMinutes, setTimeoutMinutes] = useState(DEFAULT_TIMEOUT_MINUTES);
    const [toast, setToast] = useState('');
    const [copiedLine, setCopiedLine] = useState<string | null>(null);
    const settingsLoaded = useRef(false);

    const showToast = (msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(''), 2500);
    };

    // 初期データは小窓を初めて開いたとき 1 回だけ取得する。
    useEffect(() => {
        if (!handle.isOpen || settingsLoaded.current) return;
        settingsLoaded.current = true;
        axios.get(`${backendUrl}/api/models`).then(res => setModels(res.data?.models || [])).catch(() => {});
        getCLIStatus(backendUrl).then(setCliStatus).catch(() => {});
        getGlobalSettings(backendUrl).then(settings => {
            // この機能専用の規定 → セッション取り込みの規定 → 設定自動生成の規定の順に初期値にする（保存はしない）。
            const candidates = [settings[GLOBAL_SETTINGS_KEY], settings.tempCharacterGen, settings.configGen];
            const saved: SavedGenDefaults | undefined = candidates.find(v => v && typeof v === 'object');
            if (saved && typeof saved === 'object') {
                if (saved.provider && (ALL_MODEL_PROVIDERS as string[]).includes(saved.provider)) setProvider(saved.provider as ModelProvider);
                if (typeof saved.model === 'string') setModel(saved.model);
                if (typeof saved.effort === 'string') setEffort(saved.effort);
                if (typeof saved.thinking === 'string') setThinking(saved.thinking as AntigravityThinking);
                if (typeof saved.timeoutMinutes === 'number') setTimeoutMinutes(saved.timeoutMinutes);
            }
        }).catch(() => {});
    }, [handle.isOpen, backendUrl]);

    const resolved = useMemo(() => resolveModelSelection(models, provider, model, thinking), [models, provider, model, thinking]);
    const running = handle.running;
    const canRun = !!handle.target && !!resolved.effectiveModel && !running;

    const handleRun = () => {
        if (!canRun) return;
        handle.start({
            provider,
            model: resolved.effectiveModel,
            claudeEffort: provider === 'claude' ? effort : undefined,
            antigravityThinking: provider === 'antigravity' ? resolved.effectiveThinking : undefined,
            timeoutMinutes,
            locale,
        });
    };

    const handleSetDefault = async () => {
        const ok = await updateGlobalSettings(backendUrl, {
            [GLOBAL_SETTINGS_KEY]: { provider, model: resolved.effectiveModel, effort, thinking: resolved.effectiveThinking, timeoutMinutes },
        });
        if (ok) showToast(t(APPEARANCE_PROMPT_I18N_KEYS.setDefaultDone));
    };

    const copyLine = async (formatted: string) => {
        try {
            await navigator.clipboard.writeText(formatted);
            setCopiedLine(formatted);
            setTimeout(() => setCopiedLine(null), 1500);
        } catch {
            setCopiedLine(null);
        }
    };

    const appendLine = (formatted: string) => {
        onAppendLine(formatted);
        showToast(t(APPEARANCE_PROMPT_I18N_KEYS.added));
    };

    // 結果の行：先頭に全タグ、続いてグループごと。
    const lines = useMemo(() => {
        const result = handle.result;
        if (!result) return [] as { key: string; label: string; formatted: string }[];
        const rows = [{ key: 'all', label: t(APPEARANCE_PROMPT_I18N_KEYS.groupAll), tags: result.all }];
        for (const g of result.groups) {
            rows.push({ key: g.key, label: t(GROUP_LABEL_KEYS[g.key] || g.key), tags: g.tags });
        }
        return rows.map(r => ({ key: r.key, label: r.label, formatted: formatTriggerLine(r.tags.join(', '), triggerWordFormat) }));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [handle.result, triggerWordFormat, uiCatalog]);

    const statusText = (): React.ReactNode => {
        switch (handle.status) {
            case 'running':
                return <span className="flex items-center gap-1 text-xs text-orange-300"><Loader2 size={12} className="animate-spin" />{t(APPEARANCE_PROMPT_I18N_KEYS.statusRunning)}</span>;
            case 'completed':
                return <span className="text-xs text-green-400">{t(APPEARANCE_PROMPT_I18N_KEYS.statusCompleted)}</span>;
            case 'failed':
                return (
                    <span className="text-xs text-red-400">
                        {t(APPEARANCE_PROMPT_I18N_KEYS.statusFailed)}
                        {handle.errorKey && <span className="ml-1 text-gray-500">{resolveMessage(uiCatalog, handle.errorKey, APPEARANCE_PROMPT_TEXT_FALLBACK_JA[handle.errorKey] || handle.errorKey)}</span>}
                    </span>
                );
            case 'canceled':
                return <span className="text-xs text-gray-400">{t(APPEARANCE_PROMPT_I18N_KEYS.statusCanceled)}</span>;
            default:
                return null;
        }
    };

    const labelCls = 'block text-xs text-gray-400 mb-1';

    return (
        <DraggablePanel
            isOpen={handle.isOpen}
            onClose={handle.close}
            title={t(APPEARANCE_PROMPT_I18N_KEYS.title)}
            storageKey={POSITION_STORAGE_KEY}
            accent="pink"
            zIndexClass="z-[90]"
            widthClass="w-[36rem]"
            closeTitle={t(APPEARANCE_PROMPT_I18N_KEYS.close)}
            footer={(
                <>
                    {toast && <span className="text-xs text-green-400 mr-auto">{toast}</span>}
                    {!toast && <span className="mr-auto">{statusText()}</span>}
                    {running ? (
                        <button onClick={handle.cancel} className="flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-red-800 hover:bg-red-700 text-white">
                            <Square size={14} />
                            {t(APPEARANCE_PROMPT_I18N_KEYS.cancel)}
                        </button>
                    ) : (
                        <button
                            onClick={handleRun}
                            disabled={!canRun}
                            className="flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-pink-700 hover:bg-pink-600 text-white disabled:opacity-40"
                        >
                            <Play size={14} />
                            {t(APPEARANCE_PROMPT_I18N_KEYS.run)}
                        </button>
                    )}
                </>
            )}
        >
            {/* 対象 */}
            <div className="text-sm text-gray-200">
                <span className="text-xs text-gray-400 mr-2">{t(APPEARANCE_PROMPT_I18N_KEYS.target)}</span>
                <span className="font-medium">{handle.target?.displayName || '-'}</span>
                {handle.target && handle.target.fileName !== handle.target.displayName && (
                    <span className="ml-2 text-xs text-gray-500">{t(APPEARANCE_PROMPT_I18N_KEYS.settingFile)}: {handle.target.fileName}</span>
                )}
            </div>
            {isDirty && <p className="text-xs text-yellow-500/90">{t(APPEARANCE_PROMPT_I18N_KEYS.unsavedNote)}</p>}

            {/* モデル選択 */}
            <ModelSelector
                models={models}
                cliStatus={cliStatus}
                provider={provider}
                onProviderChange={setProvider}
                model={model}
                onModelChange={setModel}
                effort={effort}
                onEffortChange={setEffort}
                thinking={thinking}
                onThinkingChange={setThinking}
                timeoutMinutes={timeoutMinutes}
                onTimeoutChange={setTimeoutMinutes}
                defaultTimeoutMinutes={DEFAULT_TIMEOUT_MINUTES}
                disabled={running}
                uiCatalog={uiCatalog}
                labels={{
                    provider: t(APPEARANCE_PROMPT_I18N_KEYS.provider),
                    model: t(APPEARANCE_PROMPT_I18N_KEYS.model),
                    effort: t(APPEARANCE_PROMPT_I18N_KEYS.effort),
                    thinking: t(APPEARANCE_PROMPT_I18N_KEYS.thinking),
                    timeout: t(APPEARANCE_PROMPT_I18N_KEYS.timeout),
                    providerUnavailable: t(APPEARANCE_PROMPT_I18N_KEYS.providerUnavailable),
                    openaiCompatNotConfigured: t(APPEARANCE_PROMPT_I18N_KEYS.openaiCompatNotConfigured),
                }}
            />
            <button
                onClick={handleSetDefault}
                disabled={!resolved.effectiveModel}
                className="flex items-center gap-1 text-xs text-pink-300 hover:text-pink-200 underline decoration-dotted disabled:opacity-40"
            >
                <Save size={12} />
                {t(APPEARANCE_PROMPT_I18N_KEYS.setDefault)}
            </button>

            {/* 結果 */}
            <div>
                <label className={labelCls}>{t(APPEARANCE_PROMPT_I18N_KEYS.result)}</label>
                {lines.length === 0 ? (
                    <p className="text-xs text-gray-500">{t(APPEARANCE_PROMPT_I18N_KEYS.noResult)}</p>
                ) : (
                    <ul className="space-y-1">
                        {lines.map(line => (
                            <li key={line.key} className="flex items-start gap-2 bg-gray-800/70 border border-gray-700 rounded px-2 py-1.5">
                                <span className={`shrink-0 text-xs px-1.5 py-0.5 rounded ${line.key === 'all' ? 'bg-pink-900/60 text-pink-200 border border-pink-700/60' : 'bg-gray-700 text-gray-300'}`}>{line.label}</span>
                                <span
                                    onClick={() => copyLine(line.formatted)}
                                    title={t(APPEARANCE_PROMPT_I18N_KEYS.copyTooltip)}
                                    className={`flex-1 min-w-0 text-xs break-words cursor-pointer transition-colors ${copiedLine === line.formatted ? 'text-green-300' : 'text-gray-200 hover:text-white'}`}
                                >
                                    {copiedLine === line.formatted ? t(APPEARANCE_PROMPT_I18N_KEYS.copied) : line.formatted}
                                </span>
                                <button
                                    onClick={() => appendLine(line.formatted)}
                                    title={t(APPEARANCE_PROMPT_I18N_KEYS.addTooltip)}
                                    className="shrink-0 flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-pink-800 hover:bg-pink-700 text-white"
                                >
                                    <Plus size={12} />
                                    {t(APPEARANCE_PROMPT_I18N_KEYS.add)}
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </DraggablePanel>
    );
};
