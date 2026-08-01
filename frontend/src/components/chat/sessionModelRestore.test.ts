import { describe, expect, it } from 'vitest';
import { modelTypeForNewSession, resolveRestoredModelSelection } from './sessionModelRestore';

describe('セッションのprovider・モデル復元', () => {
    it('新規セッションのmodelTypeはモデルID推測を使わず選択providerをそのまま使う', () => {
        expect(modelTypeForNewSession('openai_compat')).toBe('openai_compat');
    });

    it.each([
        ['openai_compat', 'openai_compat:conn:model'],
        ['antigravity', 'antigravity-model'],
        ['claude', 'claude-model'],
        ['gemini', 'gemini-model'],
    ] as const)('%sのproviderとモデルを同時に復元する', (provider, model) => {
        expect(resolveRestoredModelSelection({ modelType: provider, lastModel: model })).toEqual({
            provider,
            model,
        });
    });

    it('レスポンスのlastModelを設定内の値より優先する', () => {
        expect(resolveRestoredModelSelection({
            modelType: 'openai_compat',
            lastModel: 'response-model',
            config: { lastModel: 'config-model' },
        }).model).toBe('response-model');
    });

    it('未知providerを既定値へ誤変換しない', () => {
        expect(resolveRestoredModelSelection({ modelType: 'unknown', lastModel: 'model' })).toEqual({
            provider: null,
            model: 'model',
        });
    });
});
