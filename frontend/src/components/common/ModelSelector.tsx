/**
 * ModelSelector - AI のプロバイダ → モデル → 補助項目（Claude の effort / Antigravity の thinking）
 * → タイムアウト（分）を選ぶ部品。
 *
 * 選択中のモデルがプロバイダの一覧に無いときは先頭を派生値として使う（state は変えない）。
 * 親が実行時に送る値は resolveModelSelection で同じ規則で求める。
 * CLI 未検出のプロバイダ、モデルが 1 つも無いプロバイダは選べない。OpenAI 互換は接続先が
 * 無いと CLI 状態が warning になるので同じ規則で弾ける。
 */

import React, { useMemo } from 'react';
import type { CLIStatusEntry } from '../../api/config-gen';
import { resolveMessage, type I18NCatalog } from '../../api/i18n';
import { CLAUDE_EFFORT_I18N_KEY_BY_VALUE, ANTIGRAVITY_THINKING_I18N_KEY_BY_VALUE } from '../../constants/i18n';
import { CLAUDE_EFFORT_VALUES } from '../../constants/claude';
import type { AntigravityThinking } from '../../constants/antigravity';
import type { Model, ModelProvider } from '../../hooks/useChat';
import { ALL_MODEL_PROVIDERS, providerAvailable, resolveModelSelection } from './modelSelection';

export interface ModelSelectorLabels {
    provider: string;
    model: string;
    effort: string;
    thinking: string;
    timeout: string;
    /** 選べないプロバイダの option に添える注記 */
    providerUnavailable?: string;
    /** OpenAI 互換が接続先未設定で選べないときの注記（providerUnavailable より優先） */
    openaiCompatNotConfigured?: string;
}

interface Props {
    providers?: ModelProvider[];
    models: Model[];
    cliStatus: CLIStatusEntry[];
    provider: ModelProvider;
    onProviderChange: (p: ModelProvider) => void;
    model: string;
    onModelChange: (id: string) => void;
    effort: string;
    onEffortChange: (v: string) => void;
    thinking: AntigravityThinking;
    onThinkingChange: (v: AntigravityThinking) => void;
    timeoutMinutes: number;
    onTimeoutChange: (minutes: number) => void;
    defaultTimeoutMinutes?: number;
    minTimeoutMinutes?: number;
    maxTimeoutMinutes?: number;
    disabled?: boolean;
    uiCatalog: I18NCatalog | null;
    labels: ModelSelectorLabels;
    inputClassName?: string;
    labelClassName?: string;
}

const DEFAULT_INPUT_CLS = 'w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 disabled:opacity-50';
const DEFAULT_LABEL_CLS = 'block text-xs text-gray-400 mb-1';

export const ModelSelector: React.FC<Props> = ({
    providers = ALL_MODEL_PROVIDERS,
    models,
    cliStatus,
    provider,
    onProviderChange,
    model,
    onModelChange,
    effort,
    onEffortChange,
    thinking,
    onThinkingChange,
    timeoutMinutes,
    onTimeoutChange,
    defaultTimeoutMinutes = 5,
    minTimeoutMinutes = 1,
    maxTimeoutMinutes = 60,
    disabled = false,
    uiCatalog,
    labels,
    inputClassName = DEFAULT_INPUT_CLS,
    labelClassName = DEFAULT_LABEL_CLS,
}) => {
    const resolved = useMemo(() => resolveModelSelection(models, provider, model, thinking), [models, provider, model, thinking]);

    const providerNote = (p: ModelProvider): string => {
        if (providerAvailable(p, models, cliStatus)) return '';
        if (p === 'openai_compat' && labels.openaiCompatNotConfigured) return labels.openaiCompatNotConfigured;
        return labels.providerUnavailable || '';
    };

    return (
        <div className="grid grid-cols-2 gap-2">
            <div>
                <label className={labelClassName}>{labels.provider}</label>
                <select value={provider} disabled={disabled} onChange={e => onProviderChange(e.target.value as ModelProvider)} className={inputClassName}>
                    {providers.map(p => (
                        <option key={p} value={p} disabled={!providerAvailable(p, models, cliStatus)}>
                            {p}{providerNote(p)}
                        </option>
                    ))}
                </select>
            </div>
            <div>
                <label className={labelClassName}>{labels.model}</label>
                <select value={resolved.effectiveModel} disabled={disabled} onChange={e => onModelChange(e.target.value)} className={inputClassName}>
                    {resolved.providerModels.map(m => (
                        <option key={m.id} value={m.id}>{m.name || m.id}</option>
                    ))}
                </select>
            </div>
            {provider === 'claude' && (
                <div>
                    <label className={labelClassName}>{labels.effort}</label>
                    <select value={effort} disabled={disabled} onChange={e => onEffortChange(e.target.value)} className={inputClassName}>
                        {CLAUDE_EFFORT_VALUES.map(v => (
                            <option key={v} value={v}>{resolveMessage(uiCatalog, CLAUDE_EFFORT_I18N_KEY_BY_VALUE[v] || '', v || 'CLI default')}</option>
                        ))}
                    </select>
                </div>
            )}
            {provider === 'antigravity' && resolved.thinkingLevels.length > 0 && (
                <div>
                    <label className={labelClassName}>{labels.thinking}</label>
                    <select value={resolved.effectiveThinking} disabled={disabled} onChange={e => onThinkingChange(e.target.value as AntigravityThinking)} className={inputClassName}>
                        {resolved.thinkingLevels.map(v => (
                            <option key={v} value={v}>{resolveMessage(uiCatalog, ANTIGRAVITY_THINKING_I18N_KEY_BY_VALUE[v], v)}</option>
                        ))}
                    </select>
                </div>
            )}
            <div>
                <label className={labelClassName}>{labels.timeout}</label>
                <input
                    type="number" min={minTimeoutMinutes} max={maxTimeoutMinutes} value={timeoutMinutes} disabled={disabled}
                    onChange={e => onTimeoutChange(Math.max(minTimeoutMinutes, Math.min(maxTimeoutMinutes, Number(e.target.value) || defaultTimeoutMinutes)))}
                    className={inputClassName}
                />
            </div>
        </div>
    );
};
