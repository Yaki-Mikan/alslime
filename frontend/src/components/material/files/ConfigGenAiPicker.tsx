/**
 * ConfigGenAiPicker.tsx - 使う AI を選ぶ欄
 *
 * 「AI で作る」と設定ファイルの「対話で編集」で共通に使う。値と処理は useConfigGenAi が持つ。
 * ふだんは使う AI の名前だけを出し、その名前を押したときだけ選ぶ欄を開く。
 */
import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { formatPair, formatWithNote, resolveMessage, type I18NCatalog } from '../../../api/i18n';
import {
    ANTIGRAVITY_THINKING_I18N_KEY_BY_VALUE,
    CLAUDE_EFFORT_I18N_KEY_BY_VALUE,
    COMMON_TEXT_FALLBACK_JA,
    CONFIG_GEN_I18N_KEYS,
    CONFIG_GEN_TEXT_FALLBACK_JA,
    MATERIAL_I18N_KEYS,
    MATERIAL_TEXT_FALLBACK_JA,
} from '../../../constants/i18n';
import { CLAUDE_EFFORT_VALUES } from '../../../constants/claude';
import { cliProviderLabel } from '../../../constants/providers';
import type { AntigravityThinking } from '../../../constants/antigravity';
import type { ModelProvider } from '../../../hooks/useChat';
import { Button, Select, TextField } from '../../ui';
import { CONFIG_GEN_PROVIDERS, DEFAULT_CONFIG_GEN_TIMEOUT_MINUTES, type ConfigGenAi } from './useConfigGenAi';

interface Props {
    ai: ConfigGenAi;
    uiCatalog: I18NCatalog | null;
    /** 実行中など、選び直せないとき */
    disabled?: boolean;
    /** つながるかの確認が終わったとき（呼び出し側で結果を知らせる） */
    onPinged?: (ok: boolean) => void;
}

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div>
        <span className="block text-xs text-fg-muted mb-1">{label}</span>
        {children}
    </div>
);

export const ConfigGenAiPicker: React.FC<Props> = ({ ai, uiCatalog, disabled = false, onPinged }) => {
    const t = (key: string) => resolveMessage(uiCatalog, key, CONFIG_GEN_TEXT_FALLBACK_JA[key] || MATERIAL_TEXT_FALLBACK_JA[key] || COMMON_TEXT_FALLBACK_JA[key] || key);
    const [open, setOpen] = useState(false);

    const handlePing = async () => {
        const ok = await ai.ping();
        if (ok !== null) onPinged?.(ok);
    };

    return (
        <div>
            {/* 使う AI の表示そのものを押すと、選ぶ欄を開け閉めする */}
            <button
                type="button"
                onClick={() => setOpen(v => !v)}
                disabled={disabled}
                aria-expanded={open}
                title={open ? t(MATERIAL_I18N_KEYS.genHide) : t(MATERIAL_I18N_KEYS.genAiChange)}
                className="inline-flex items-center gap-1.5 max-w-full h-7 px-2.5 rounded-ui border border-line-strong bg-surface text-xs text-fg hover:border-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
                <span className="truncate">{t(MATERIAL_I18N_KEYS.genAi).split('{{name}}').join(formatPair(uiCatalog, cliProviderLabel(ai.provider), ai.modelLabel))}</span>
                {open ? <ChevronUp size={12} className="shrink-0" /> : <ChevronDown size={12} className="shrink-0" />}
            </button>
            {open && (
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    <Field label={t(CONFIG_GEN_I18N_KEYS.provider)}>
                        <select
                            value={ai.provider}
                            disabled={disabled}
                            onChange={e => ai.setProvider(e.target.value as ModelProvider)}
                            className="w-full h-9 px-2.5 rounded-ui bg-surface border border-line-strong text-fg text-sm outline-none focus:border-accent disabled:opacity-50"
                        >
                            {CONFIG_GEN_PROVIDERS.map(p => {
                                const found = ai.cliFound(p);
                                const ping = ai.pingRecords[p];
                                const note = !found
                                    ? t(CONFIG_GEN_I18N_KEYS.providerNotFound)
                                    : ping
                                        ? (ping.ok ? '' : t(CONFIG_GEN_I18N_KEYS.pingFailed))
                                        : t(CONFIG_GEN_I18N_KEYS.pingUnchecked);
                                return (
                                    <option key={p} value={p} disabled={!found || (ping ? !ping.ok : false)}>
                                        {note ? formatWithNote(uiCatalog, cliProviderLabel(p), note) : cliProviderLabel(p)}
                                    </option>
                                );
                            })}
                        </select>
                        <Button size="sm" variant="ghost" className="mt-1" onClick={() => { void handlePing(); }} disabled={disabled || ai.pingRunning || !ai.model}>
                            {ai.pingRunning ? t(CONFIG_GEN_I18N_KEYS.pingChecking) : t(CONFIG_GEN_I18N_KEYS.pingCheck)}
                        </Button>
                    </Field>
                    <Field label={t(CONFIG_GEN_I18N_KEYS.model)}>
                        <Select
                            value={ai.model}
                            disabled={disabled}
                            onChange={ai.setModel}
                            options={ai.providerModels.map(m => ({ value: m.id, label: m.name || m.id }))}
                        />
                        <p className="text-xs text-fg-muted mt-1 leading-relaxed">{t(CONFIG_GEN_I18N_KEYS.modelRecommend)}</p>
                    </Field>
                    {ai.provider === 'claude' && (
                        <Field label={t(CONFIG_GEN_I18N_KEYS.effort)}>
                            <Select
                                value={ai.effort}
                                disabled={disabled}
                                onChange={ai.setEffort}
                                options={CLAUDE_EFFORT_VALUES.map(v => ({ value: v, label: resolveMessage(uiCatalog, CLAUDE_EFFORT_I18N_KEY_BY_VALUE[v] || '', v || 'CLI default') }))}
                            />
                        </Field>
                    )}
                    {ai.provider === 'antigravity' && ai.antigravityThinkingLevels.length > 0 && (
                        <Field label={t(CONFIG_GEN_I18N_KEYS.antigravityThinking)}>
                            <Select
                                value={ai.antigravityThinking}
                                disabled={disabled}
                                onChange={v => ai.setAntigravityThinking(v as AntigravityThinking)}
                                options={ai.antigravityThinkingLevels.map(v => ({ value: v, label: resolveMessage(uiCatalog, ANTIGRAVITY_THINKING_I18N_KEY_BY_VALUE[v], v) }))}
                            />
                        </Field>
                    )}
                    <Field label={t(CONFIG_GEN_I18N_KEYS.timeout)}>
                        <TextField
                            type="number" min={1} max={60} value={ai.timeoutMinutes} disabled={disabled}
                            onChange={e => ai.setTimeoutMinutes(Math.max(1, Math.min(60, Number(e.target.value) || DEFAULT_CONFIG_GEN_TIMEOUT_MINUTES)))}
                        />
                    </Field>
                </div>
            )}
        </div>
    );
};
