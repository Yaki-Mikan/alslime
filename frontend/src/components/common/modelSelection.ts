/**
 * modelSelection.ts - モデル選択の共通規則（ModelSelector 部品と、実行時に値を求める親の両方が使う）
 *
 * 選択中のモデルがプロバイダの一覧に無いときは先頭を派生値として使う（state は変えない）。
 * CLI 未検出のプロバイダ、モデルが 1 つも無いプロバイダは選べない。OpenAI 互換は接続先が
 * 無いと CLI 状態が warning になるので同じ規則で弾ける。
 */

import type { CLIStatusEntry } from '../../api/config-gen';
import { antigravityThinkingLevelsOf, normalizeAntigravityThinking, type AntigravityThinking } from '../../constants/antigravity';
import type { Model, ModelProvider } from '../../hooks/useChat';
import { modelProviderOf } from '../../hooks/useChat';

export const ALL_MODEL_PROVIDERS: ModelProvider[] = ['antigravity', 'claude', 'gemini', 'openai_compat'];

/** CLI 検出状態。状態が取れないときは絞らない（既存 2 モーダルと同じ規則） */
export const cliFound = (cliStatus: CLIStatusEntry[], p: ModelProvider): boolean => {
    const entry = cliStatus.find(c => c.id === p);
    return entry ? entry.status === 'ok' : true;
};

/** プロバイダを選べるか（CLI 検出済み かつ そのプロバイダのモデルが 1 つ以上ある） */
export const providerAvailable = (p: ModelProvider, models: Model[], cliStatus: CLIStatusEntry[]): boolean =>
    cliFound(cliStatus, p) && models.some(m => modelProviderOf(m) === p);

export interface ResolvedModelSelection {
    providerModels: Model[];
    effectiveModel: string;
    thinkingLevels: AntigravityThinking[];
    effectiveThinking: AntigravityThinking;
}

export const resolveModelSelection = (
    models: Model[],
    provider: ModelProvider,
    model: string,
    thinking: AntigravityThinking,
): ResolvedModelSelection => {
    const providerModels = models.filter(m => modelProviderOf(m) === provider);
    const effectiveModel = providerModels.some(m => m.id === model) ? model : (providerModels[0]?.id || '');
    const thinkingLevels = provider === 'antigravity' ? antigravityThinkingLevelsOf(providerModels.find(m => m.id === effectiveModel)) : [];
    const effectiveThinking = thinkingLevels.length > 0 && !thinkingLevels.includes(thinking)
        ? normalizeAntigravityThinking(thinking, thinkingLevels)
        : thinking;
    return { providerModels, effectiveModel, thinkingLevels, effectiveThinking };
};
