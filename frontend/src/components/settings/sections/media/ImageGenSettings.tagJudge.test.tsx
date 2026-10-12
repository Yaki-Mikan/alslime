import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from '../../../../lib/axios';
import { getComfyUIConfig, getLoraDirConfig, getLoraDirDefaults, patchComfyUIConfig, type ComfyUIConfig } from '../../../../api/comfyui';
import { DEFAULT_ANTIGRAVITY_THINKING } from '../../../../constants/antigravity';
import type { SectionHandle } from '../sectionTypes';
import { ImageGenSettings } from './ImageGenSettings';

vi.mock('../../../../lib/axios', () => ({
    default: { get: vi.fn() },
}));
vi.mock('../../../../api/comfyui', async importOriginal => ({
    ...(await importOriginal<typeof import('../../../../api/comfyui')>()),
    getComfyUIConfig: vi.fn(),
    getLoraDirConfig: vi.fn(),
    getLoraDirDefaults: vi.fn(),
    patchComfyUIConfig: vi.fn(),
}));
// 場面を読み取る AI の欄だけを確かめるため、接続・API サービスまわりの部品は差し替える
vi.mock('../../../comfyui/BackendTabs', () => ({ BackendTabs: () => null }));
vi.mock('../../../comfyui/apiservice/ApiServiceConnectionSection', () => ({ ApiServiceConnectionSection: () => null }));
vi.mock('../../../comfyui/apiservice/ApiServiceBalancePanel', () => ({ ApiServiceBalancePanel: () => null }));
vi.mock('../../../comfyui/apiservice/ApiServiceModelSelect', () => ({ ApiServiceModelSelect: () => null }));
vi.mock('../../../comfyui/apiservice/AutoSoundEffectsToggle', () => ({ AutoSoundEffectsToggle: () => null }));
vi.mock('../../../comfyui/apiservice/UserAppearanceSection', () => ({ UserAppearanceSection: () => null }));

const baseConfig: ComfyUIConfig = {
    version: 1,
    connectionUrl: 'http://127.0.0.1:8188',
    defaultTemplateId: '',
    directiveMode: 'danbooru_only',
    danbooruTagFormat: 'underscore',
    triggerWordFormat: 'raw',
    tagJudgeProvider: 'gemini',
    tagJudgeGeminiModel: 'gemini-3-flash-preview',
    tagJudgeClaudeModel: 'claude-sonnet-4-6',
    tagJudgeClaudeEffort: '',
    tagJudgeAntigravityModel: 'antigravity',
    tagJudgeAntigravityThinking: DEFAULT_ANTIGRAVITY_THINKING,
    tagJudgeOpenAICompatModel: '',
    tagJudgeTimeoutSeconds: 180,
    lightweightImageSave: { enabled: false, format: 'avif', quality: 92, lossless: false, effort: 4 },
};

const geminiModel = { id: 'gemini-3-flash-preview', name: 'Gemini', description: 'Gemini 3 Flash', provider: 'gemini' };
const apiModel = {
    id: 'openai_compat:conn-a/vendor/model',
    name: 'vendor/model',
    description: 'vendor/model',
    provider: 'openai_compat',
    connectionId: 'conn-a',
    connectionLabel: 'メイン',
    remoteModelId: 'vendor/model',
};

const mockModels = (models: unknown[]) => {
    vi.mocked(axios.get).mockImplementation(async (url: string) => (url.includes('/api/models') ? { data: { models } } : { data: {} }));
};

// 見出しの span から親の label を辿って select を取る（label の文字列には option も含まれるため）
const selectUnderLabel = (labelText: string): HTMLSelectElement => {
    const label = screen.getByText(labelText).closest('label');
    if (!label) throw new Error(`label not found for ${labelText}`);
    const select = label.querySelector('select');
    if (!select) throw new Error(`select not found under ${labelText}`);
    return select;
};

const setup = async () => {
    const ref = React.createRef<SectionHandle>();
    render(<ImageGenSettings ref={ref} uiCatalog={null} active onDirtyChange={() => {}} onOpenMaterial={() => {}} />);
    await screen.findByText('分析AI');
    return ref;
};

describe('設定画面の画像生成：場面を読み取る AI', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getComfyUIConfig).mockResolvedValue({ ...baseConfig });
        vi.mocked(getLoraDirConfig).mockResolvedValue({ categories: [] });
        vi.mocked(getLoraDirDefaults).mockResolvedValue({ categories: [] });
        vi.mocked(patchComfyUIConfig).mockResolvedValue({ ...baseConfig });
        mockModels([geminiModel]);
    });

    it('分析AIの選択肢に API（OpenAI互換）がある', async () => {
        await setup();
        expect(screen.getByRole('option', { name: 'API（OpenAI互換）' })).toBeInTheDocument();
    });

    it('API モデルが未登録なら分析モデルを無効化して案内する', async () => {
        const user = userEvent.setup();
        await setup();
        await user.selectOptions(selectUnderLabel('分析AI'), 'openai_compat');
        expect(selectUnderLabel('分析モデル')).toBeDisabled();
        expect(screen.getByText(/選べるモデルがありません/)).toBeInTheDocument();
    });

    it('API モデルがあれば「接続表示名 / モデル」で選べ、先頭が自動選択されて保存される', async () => {
        const user = userEvent.setup();
        mockModels([geminiModel, apiModel]);
        const ref = await setup();
        await user.selectOptions(selectUnderLabel('分析AI'), 'openai_compat');

        const modelSelect = selectUnderLabel('分析モデル');
        await waitFor(() => expect(modelSelect).toHaveValue(apiModel.id));
        expect(screen.getByRole('option', { name: 'メイン / vendor/model' })).toBeInTheDocument();
        expect(modelSelect).not.toBeDisabled();

        // 保存は設定全体を読み直して編集した項目だけ差し替える（ほかの画面の項目を落とさない）
        await act(async () => { await ref.current!.save(); });
        expect(patchComfyUIConfig).toHaveBeenCalled();
        const saved = vi.mocked(patchComfyUIConfig).mock.calls[0][1];
        expect(saved.tagJudgeProvider).toBe('openai_compat');
        expect(saved.tagJudgeOpenAICompatModel).toBe(apiModel.id);
    });

    it('保存済みの API モデルを復元する', async () => {
        mockModels([geminiModel, apiModel]);
        vi.mocked(getComfyUIConfig).mockResolvedValue({ ...baseConfig, tagJudgeProvider: 'openai_compat', tagJudgeOpenAICompatModel: apiModel.id });
        await setup();
        expect(selectUnderLabel('分析AI')).toHaveValue('openai_compat');
        await waitFor(() => expect(selectUnderLabel('分析モデル')).toHaveValue(apiModel.id));
    });
});
