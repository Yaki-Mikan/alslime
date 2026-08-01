import { resolveMessage, type I18NCatalog } from '../../api/i18n';
import {
    CHAT_VIEW_I18N_KEYS,
    CHAT_VIEW_TEXT_FALLBACK_JA,
} from '../../constants/i18n';
import type { Message } from '../../hooks/useChat';

export const resolvePersistedChatMessage = (
    message: Pick<Message, 'content' | 'errorType'>,
    uiCatalog: I18NCatalog | null
): string => {
    if (!message.errorType) return message.content;
    const localizedError = resolveMessage(uiCatalog, message.content, message.content);
    const prefix = resolveMessage(
        uiCatalog,
        CHAT_VIEW_I18N_KEYS.errorPrefix,
        CHAT_VIEW_TEXT_FALLBACK_JA[CHAT_VIEW_I18N_KEYS.errorPrefix]
    );
    const jaPrefix = CHAT_VIEW_TEXT_FALLBACK_JA[CHAT_VIEW_I18N_KEYS.errorPrefix];
    if (localizedError.startsWith(prefix) || localizedError.startsWith(jaPrefix)) {
        return localizedError;
    }
    return `${prefix} ${localizedError}`;
};
