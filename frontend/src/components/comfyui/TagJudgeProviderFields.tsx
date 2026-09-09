/**
 * TagJudgeProviderFields.tsx - タグ判定に使う分析AI・モデルの選択部品
 *
 * 分析AI（Gemini CLI / Claude Code CLI / Antigravity CLI / API（OpenAI互換））と、
 * その AI ごとのモデル・付随設定（Claude effort・Antigravity thinking）を選ぶ。
 * モデル一覧は /api/models（サーバ正本）から取得し、openai_compat は provider
 * フィールドで判定する。値の保持と保存は親が担う（画像生成設定モーダルは保存ボタン、
 * タグ判定・ワークフロー設定パネルは変更即保存）。
 */

import React, { useEffect, useMemo, useState } from 'react';
import axios from '../../lib/axios';
import { CLAUDE_EFFORT_VALUES, type ClaudeEffort } from '../../constants/claude';
import {
    antigravityThinkingLevelsOf,
    normalizeAntigravityThinking,
    type AntigravityThinking,
} from '../../constants/antigravity';
import type {
    AntigravityTagJudgeModel,
    ClaudeTagJudgeModel,
    GeminiTagJudgeModel,
    OpenAICompatTagJudgeModel,
    TagJudgeProvider,
} from '../../api/comfyui';
import { createComfyUIText } from './i18n';
import type { I18NCatalog } from '../../api/i18n';

/** 分析AI に関わる設定値の組（ComfyUIConfig の tagJudge* 欄と 1 対 1）。 */
export interface TagJudgeProviderValues {
    provider: TagJudgeProvider;
    geminiModel: GeminiTagJudgeModel;
    claudeModel: ClaudeTagJudgeModel;
    claudeEffort: ClaudeEffort;
    antigravityModel: AntigravityTagJudgeModel;
    antigravityThinking: AntigravityThinking;
    openAICompatModel: OpenAICompatTagJudgeModel;
}

interface Props {
    backendUrl: string;
    uiCatalog?: I18NCatalog | null;
    values: TagJudgeProviderValues;
    // 変更差分を返す。自動補正（thinking の丸め・openai_compat の先頭自動選択）でも呼ぶ。
    onChange: (patch: Partial<TagJudgeProviderValues>) => void;
    // false の間はモデル一覧を取りに行かない（モーダルが閉じているとき等）。true になるたび再取得する。
    active?: boolean;
    // 幅の狭い場所向けに effort / thinking を横並びにしない
    stacked?: boolean;
    // 説明文（TAG_JUDGE_DESC）を出すか
    showDescription?: boolean;
}

type ModelOption = { value: string; label: string; thinkingLevels?: string[] };

const selectClass = 'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-green-500 transition-colors disabled:opacity-50';

export const TagJudgeProviderFields: React.FC<Props> = ({
    backendUrl,
    uiCatalog = null,
    values,
    onChange,
    active = true,
    stacked = false,
    showDescription = false,
}) => {
    const { COMMON } = createComfyUIText(uiCatalog);
    const claudeEffortLabels: Record<ClaudeEffort, string> = {
        '': COMMON.BUTTONS.CLAUDE_EFFORT_DEFAULT,
        low: COMMON.BUTTONS.CLAUDE_EFFORT_LOW,
        medium: COMMON.BUTTONS.CLAUDE_EFFORT_MEDIUM,
        high: COMMON.BUTTONS.CLAUDE_EFFORT_HIGH,
        xhigh: COMMON.BUTTONS.CLAUDE_EFFORT_XHIGH,
        max: COMMON.BUTTONS.CLAUDE_EFFORT_MAX,
    };
    const antigravityThinkingLabels: Record<AntigravityThinking, string> = {
        low: COMMON.BUTTONS.ANTIGRAVITY_THINKING_LOW,
        medium: COMMON.BUTTONS.ANTIGRAVITY_THINKING_MEDIUM,
        high: COMMON.BUTTONS.ANTIGRAVITY_THINKING_HIGH,
    };

    const [geminiModelOptions, setGeminiModelOptions] = useState<ModelOption[]>([]);
    const [claudeModelOptions, setClaudeModelOptions] = useState<ModelOption[]>([]);
    const [antigravityModelOptions, setAntigravityModelOptions] = useState<ModelOption[]>([]);
    const [openAICompatModelOptions, setOpenAICompatModelOptions] = useState<ModelOption[]>([]);

    // /api/models からモデル一覧を取得（active になるたび再取得）
    useEffect(() => {
        if (!active) return;
        let cancelled = false;
        const fetchModels = async () => {
            try {
                const res = await axios.get(`${backendUrl}/api/models`);
                if (cancelled) return;
                const models: {
                    id: string;
                    name: string;
                    description: string;
                    thinkingLevels?: string[];
                    provider?: string;
                    connectionId?: string;
                    connectionLabel?: string;
                    remoteModelId?: string;
                }[] = res.data.models ?? [];
                setGeminiModelOptions(
                    models
                        .filter(m => m.id.startsWith('gemini-') || m.id.startsWith('flash-thinking-'))
                        .map(m => ({ value: m.id, label: m.description }))
                );
                setClaudeModelOptions(
                    models
                        .filter(m => m.id.startsWith('claude-'))
                        .map(m => ({ value: m.id, label: m.description }))
                );
                setAntigravityModelOptions(
                    models
                        .filter(m => m.id === 'antigravity' || m.id.startsWith('antigravity:'))
                        .map(m => ({ value: m.id, label: m.description, thinkingLevels: m.thinkingLevels }))
                );
                // openai_compat はサーバの provider フィールドで判定する（ID の前方一致ではなく正本に寄せる）。
                // 表示は「接続表示名 / リモートモデル ID」。
                setOpenAICompatModelOptions(
                    models
                        .filter(m => m.provider === 'openai_compat')
                        .map(m => ({
                            value: m.id,
                            label: `${m.connectionLabel || m.connectionId || ''} / ${m.remoteModelId || m.id}`,
                        }))
                );
            } catch (e) {
                if (cancelled) return;
                // モデルリストの正本はサーバの /api/models。取得失敗時はベタ書きフォールバックを
                // 持たず、選択肢を空のままにする。
                console.error('[TagJudgeProviderFields] /api/models fetch failed; model options stay empty:', e);
                setGeminiModelOptions([]);
                setClaudeModelOptions([]);
                setAntigravityModelOptions([]);
                setOpenAICompatModelOptions([]);
            }
        };
        void fetchModels();
        return () => { cancelled = true; };
    }, [backendUrl, active]);

    // Antigravity の Thinking 選択肢は選択中モデルの thinkingLevels（サーバ正本）から出し、
    // 選べないレベルは Low へ落とす。
    const antigravityThinkingLevels = useMemo(
        () => (values.provider === 'antigravity'
            ? antigravityThinkingLevelsOf(antigravityModelOptions.find(o => o.value === values.antigravityModel))
            : []),
        [values.provider, antigravityModelOptions, values.antigravityModel]
    );
    useEffect(() => {
        if (antigravityThinkingLevels.length > 0 && !antigravityThinkingLevels.includes(values.antigravityThinking)) {
            onChange({ antigravityThinking: normalizeAntigravityThinking(values.antigravityThinking, antigravityThinkingLevels) });
        }
    }, [antigravityThinkingLevels, values.antigravityThinking, onChange]);

    // openai_compat は既定モデルが無いので、選択肢があるのに未選択（または削除済みモデルを指している）なら先頭を選ぶ。
    // 選択肢が空の間は触らない（保存値を消さない）。
    useEffect(() => {
        if (values.provider !== 'openai_compat' || openAICompatModelOptions.length === 0) return;
        if (!openAICompatModelOptions.some(o => o.value === values.openAICompatModel)) {
            onChange({ openAICompatModel: openAICompatModelOptions[0].value });
        }
    }, [values.provider, openAICompatModelOptions, values.openAICompatModel, onChange]);

    const currentModelValue =
        values.provider === 'claude' ? values.claudeModel
            : values.provider === 'antigravity' ? values.antigravityModel
                : values.provider === 'openai_compat' ? values.openAICompatModel
                    : values.geminiModel;
    const currentModelOptions =
        values.provider === 'claude' ? claudeModelOptions
            : values.provider === 'antigravity' ? antigravityModelOptions
                : values.provider === 'openai_compat' ? openAICompatModelOptions
                    : geminiModelOptions;
    const handleChangeModel = (value: string) => {
        if (values.provider === 'claude') {
            onChange({ claudeModel: value });
        } else if (values.provider === 'antigravity') {
            onChange({ antigravityModel: value });
        } else if (values.provider === 'openai_compat') {
            onChange({ openAICompatModel: value });
        } else {
            onChange({ geminiModel: value });
        }
    };
    const openAICompatEmpty = values.provider === 'openai_compat' && openAICompatModelOptions.length === 0;
    const twoColumns = !stacked && (values.provider === 'claude' || antigravityThinkingLevels.length > 0);

    return (
        <>
            <label className="space-y-1 block">
                <span className="text-xs text-gray-500">{COMMON.BUTTONS.ANALYSIS_AI}</span>
                <select
                    value={values.provider}
                    onChange={(e) => onChange({ provider: e.target.value as TagJudgeProvider })}
                    className={selectClass}
                >
                    <option value="gemini">Gemini CLI</option>
                    <option value="claude">Claude Code CLI</option>
                    <option value="antigravity">Antigravity CLI</option>
                    <option value="openai_compat">{COMMON.BUTTONS.TAG_JUDGE_PROVIDER_OPENAI_COMPAT}</option>
                </select>
            </label>
            <div className={`grid grid-cols-1 gap-3 ${twoColumns ? 'sm:grid-cols-2' : ''}`}>
                <label className="space-y-1 block">
                    <span className="text-xs text-gray-500">{COMMON.BUTTONS.ANALYSIS_MODEL}</span>
                    <select
                        value={currentModelValue}
                        onChange={(e) => handleChangeModel(e.target.value)}
                        disabled={openAICompatEmpty}
                        className={selectClass}
                    >
                        {currentModelOptions.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </select>
                </label>
                {values.provider === 'claude' && (
                    <label className="space-y-1 block">
                        <span className="text-xs text-gray-500">{COMMON.BUTTONS.CLAUDE_EFFORT}</span>
                        <select
                            value={values.claudeEffort}
                            onChange={(e) => onChange({ claudeEffort: e.target.value as ClaudeEffort })}
                            className={selectClass}
                        >
                            {CLAUDE_EFFORT_VALUES.map((effort) => (
                                <option key={effort || 'default'} value={effort}>{claudeEffortLabels[effort]}</option>
                            ))}
                        </select>
                    </label>
                )}
                {values.provider === 'antigravity' && antigravityThinkingLevels.length > 0 && (
                    <label className="space-y-1 block">
                        <span className="text-xs text-gray-500">{COMMON.BUTTONS.ANTIGRAVITY_THINKING}</span>
                        <select
                            value={values.antigravityThinking}
                            onChange={(e) => onChange({ antigravityThinking: e.target.value as AntigravityThinking })}
                            className={selectClass}
                        >
                            {antigravityThinkingLevels.map((level) => (
                                <option key={level} value={level}>{antigravityThinkingLabels[level]}</option>
                            ))}
                        </select>
                    </label>
                )}
            </div>
            {showDescription && (
                <p className="text-xs text-gray-500">
                    {COMMON.MESSAGES.TAG_JUDGE_DESC}
                </p>
            )}
            {values.provider === 'openai_compat' && (
                <p className={`text-xs ${openAICompatEmpty ? 'text-amber-400' : 'text-gray-500'}`}>
                    {openAICompatEmpty
                        ? COMMON.MESSAGES.TAG_JUDGE_OPENAI_COMPAT_EMPTY
                        : COMMON.MESSAGES.TAG_JUDGE_OPENAI_COMPAT_HINT}
                </p>
            )}
        </>
    );
};
