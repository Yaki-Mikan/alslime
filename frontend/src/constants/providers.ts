import type { ModelProvider } from '../hooks/useChat';
import { resolveMessage, type I18NCatalog } from '../api/i18n';
import { CHAT_INPUT_I18N_KEYS, CHAT_INPUT_TEXT_FALLBACK_JA } from './i18n';

// CLI で動かす AI の表示名。会話の入力欄の「使う AI」と同じ表記にする（値は識別名のまま）
export const CLI_PROVIDER_LABELS: Partial<Record<ModelProvider, string>> = {
    antigravity: 'Antigravity',
    claude: 'Claude',
    gemini: 'Gemini',
};

/** 表示名が無い識別名は、そのまま返す */
export const cliProviderLabel = (provider: ModelProvider): string => CLI_PROVIDER_LABELS[provider] ?? provider;

/** API（OpenAI互換）の表示名。製品名ではないので、表示言語の文言表から引く */
export const openAICompatLabel = (catalog: I18NCatalog | null): string => resolveMessage(
    catalog,
    CHAT_INPUT_I18N_KEYS.providerOpenAICompat,
    CHAT_INPUT_TEXT_FALLBACK_JA[CHAT_INPUT_I18N_KEYS.providerOpenAICompat],
);
