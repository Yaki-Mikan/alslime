import { describe, expect, it } from 'vitest';
import { CHAT_VIEW_I18N_KEYS } from '../../constants/i18n';
import { resolvePersistedChatMessage } from './messageError';

describe('保存済みチャットエラーの辞書解決', () => {
    const catalog = {
        lang: 'en',
        defaultLang: 'ja',
        fallbackLang: 'ja',
        messages: {
            [CHAT_VIEW_I18N_KEYS.errorPrefix]: 'Error:',
            'chat.error.apiConnectionUnavailable': 'The API connection is unavailable.',
        },
    };

    it('保存されたi18nキーを現在の表示言語で解決する', () => {
        expect(resolvePersistedChatMessage({
            content: 'chat.error.apiConnectionUnavailable',
            errorType: 'api_connection_unavailable',
        }, catalog)).toBe('Error: The API connection is unavailable.');
    });

    it('通常メッセージはキーらしい文字列でも翻訳しない', () => {
        expect(resolvePersistedChatMessage({
            content: 'chat.error.apiConnectionUnavailable',
        }, catalog)).toBe('chat.error.apiConnectionUnavailable');
    });
});
