import type { ModelProvider } from '../../hooks/useChat';

const MODEL_PROVIDERS: ReadonlySet<string> = new Set([
    'gemini',
    'claude',
    'antigravity',
    'openai_compat',
]);

interface ResumeModelData {
    modelType?: string | null;
    lastModel?: string | null;
    config?: { lastModel?: string | null } | null;
}

export interface RestoredModelSelection {
    provider: ModelProvider | null;
    model: string | null;
}

export const modelTypeForNewSession = (selectedProvider: ModelProvider): ModelProvider => selectedProvider;

export const resolveRestoredModelSelection = (result: ResumeModelData): RestoredModelSelection => ({
    provider: result.modelType && MODEL_PROVIDERS.has(result.modelType)
        ? result.modelType as ModelProvider
        : null,
    model: result.lastModel || result.config?.lastModel || null,
});
