import { describe, expect, it } from 'vitest';
import type { Model } from '../../hooks/useChat';
import { apiModelsForConnection, apiRemoteModelLabel, buildAPIConnectionChoices } from './modelSelection';

const apiModels: Model[] = [
    {
        id: 'openai_compat:conn-a/model-a',
        name: 'model-a',
        description: 'model-a',
        provider: 'openai_compat',
        connectionId: 'conn-a',
        connectionLabel: 'DeepSeek',
        remoteModelId: 'model-a',
    },
    {
        id: 'openai_compat:conn-a/model-b',
        name: 'model-b',
        description: 'model-b',
        provider: 'openai_compat',
        connectionId: 'conn-a',
        connectionLabel: 'DeepSeek',
        remoteModelId: 'model-b',
    },
    {
        id: 'openai_compat:conn-b/model-c',
        name: 'model-c',
        description: 'model-c',
        provider: 'openai_compat',
        connectionId: 'conn-b',
        connectionLabel: 'OpenRouter',
        remoteModelId: 'provider/model-c',
    },
];

describe('APIモデルの3段選択', () => {
    it('Connection IDではなく接続先表示名で接続選択肢を作る', () => {
        expect(buildAPIConnectionChoices(apiModels)).toEqual([
            { id: 'conn-a', label: 'DeepSeek' },
            { id: 'conn-b', label: 'OpenRouter' },
        ]);
    });

    it('選択接続のモデルだけを出し、モデル欄にはRemote Model IDだけを表示する', () => {
        const selected = apiModelsForConnection(apiModels, 'conn-b');
        expect(selected.map(model => model.id)).toEqual(['openai_compat:conn-b/model-c']);
        expect(apiRemoteModelLabel(selected[0])).toBe('provider/model-c');
    });
});
