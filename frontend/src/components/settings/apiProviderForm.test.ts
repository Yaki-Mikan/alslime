import { describe, expect, it } from 'vitest';
import {
    apiKeyPayload,
    apiKeyStateAfterInput,
    buildExtraParams,
    mergeApiProviderModels,
} from './apiProviderForm';

describe('API接続先フォーム契約', () => {
    it('APIキー3状態と送信フィールドを排他的に対応させる', () => {
        expect(apiKeyStateAfterInput('')).toBe('unchanged');
        expect(apiKeyStateAfterInput('new-key')).toBe('entering');
        expect(apiKeyPayload('unchanged', '')).toEqual({});
        expect(apiKeyPayload('entering', 'new-key')).toEqual({ apiKey: 'new-key' });
        expect(apiKeyPayload('clearPending', '')).toEqual({ clearApiKey: true });
        expect(apiKeyPayload('clearPending', 'discarded-key')).not.toHaveProperty('apiKey');
    });

    it('ExtraParamsのJSON値型を保持して組み立てる', () => {
        const result = buildExtraParams([
            { key: 'stringValue', value: '"high"' },
            { key: 'numberValue', value: '0.7' },
            { key: 'booleanValue', value: 'true' },
            { key: 'nullValue', value: 'null' },
            { key: 'arrayValue', value: '[1,"two"]' },
            { key: 'objectValue', value: '{"depth":2}' },
        ]);

        expect(result).toEqual({
            params: {
                stringValue: 'high',
                numberValue: 0.7,
                booleanValue: true,
                nullValue: null,
                arrayValue: [1, 'two'],
                objectValue: { depth: 2 },
            },
        });
    });

    it.each([
        [[{ key: '', value: '1' }], 'apiProviders.error.extraParamsEmptyKey', 0],
        [[{ key: 'same', value: '1' }, { key: 'same', value: '2' }], 'apiProviders.error.extraParamsDuplicateKey', 1],
        [[{ key: 'broken', value: '{' }], 'apiProviders.error.extraParamsInvalidJson', 0],
        [[{ key: 'Stream_Options', value: '{}' }], 'apiProviders.error.extraParamsReservedKey', 0],
        [[{ key: 'Authorization', value: '"secret"' }], 'apiProviders.error.extraParamsSecretKey', 0],
    ] as const)('ExtraParamsの不正行を特定する', (rows, errorKey, errorRow) => {
        expect(buildExtraParams([...rows])).toMatchObject({ errorKey, errorRow });
    });

    it('モデル保存で対象接続だけを差し替え、他接続・他provider・hiddenを保持する', () => {
        const result = mergeApiProviderModels({
            builtin: [],
            added: [
                { id: 'openai_compat:target:keep', provider: 'openai_compat', connectionId: 'target', remoteModelId: 'keep' },
                { id: 'openai_compat:target:remove', provider: 'openai_compat', connectionId: 'target', remoteModelId: 'remove' },
                { id: 'openai_compat:other:model', provider: 'openai_compat', connectionId: 'other', remoteModelId: 'model' },
                { id: 'custom-gemini', provider: 'gemini' },
            ],
            hidden: ['builtin-hidden'],
        }, 'target', new Set(['keep', 'new/model']));

        expect(result.hidden).toEqual(['builtin-hidden']);
        expect(result.added).toEqual(expect.arrayContaining([
            expect.objectContaining({ connectionId: 'other', remoteModelId: 'model' }),
            expect.objectContaining({ id: 'custom-gemini', provider: 'gemini' }),
            expect.objectContaining({ connectionId: 'target', remoteModelId: 'keep' }),
            expect.objectContaining({ connectionId: 'target', remoteModelId: 'new/model' }),
        ]));
        expect(result.added).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ connectionId: 'target', remoteModelId: 'remove' }),
        ]));
    });

    it('現在の内蔵モデルと重複する旧added行を全置換payloadへ再混入させない', () => {
        const result = mergeApiProviderModels({
            builtin: [{ id: 'gemini-new-builtin', name: 'Built-in', description: 'Built-in', provider: 'gemini' }],
            added: [
                { id: 'gemini-new-builtin', provider: 'gemini' },
                { id: 'custom-model', provider: 'gemini' },
            ],
            hidden: [],
        }, 'target', new Set(['remote/model']));

        expect(result.added).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'gemini-new-builtin' }),
        ]));
        expect(result.added).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'custom-model' }),
            expect.objectContaining({ connectionId: 'target', remoteModelId: 'remote/model' }),
        ]));
    });
});
