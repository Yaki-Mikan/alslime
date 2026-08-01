import { describe, expect, it } from 'vitest';
import { modelDisplayLabel } from './useChat';

describe('モデル選択の表示名', () => {
    it('APIモデルは内部IDではなく接続表示名とRemote Model IDを表示する', () => {
        expect(modelDisplayLabel({
            id: 'openai_compat:conn-display/deepseek-v4-flash',
            name: 'deepseek-v4-flash',
            description: 'deepseek-v4-flash',
            provider: 'openai_compat',
            connectionId: 'conn-display',
            connectionLabel: 'DeepSeek',
            remoteModelId: 'deepseek-v4-flash',
        })).toBe('DeepSeek ＞ deepseek-v4-flash');
    });

    it('既存プロバイダの表示は従来のdescriptionを維持する', () => {
        expect(modelDisplayLabel({
            id: 'gemini-model',
            name: 'Gemini Model',
            description: '従来表示',
            provider: 'gemini',
        })).toBe('従来表示');
    });
});
