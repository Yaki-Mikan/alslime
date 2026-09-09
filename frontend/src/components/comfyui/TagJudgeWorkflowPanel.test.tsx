import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from '../../lib/axios';
import {
    getComfyUIConfig,
    listComfyUITemplates,
    saveComfyUIConfig,
    type ComfyUIConfig,
} from '../../api/comfyui';
import { DEFAULT_ANTIGRAVITY_THINKING } from '../../constants/antigravity';
import { TagJudgeWorkflowPanel } from './TagJudgeWorkflowPanel';

vi.mock('../../lib/axios', () => ({
    default: { get: vi.fn() },
}));

vi.mock('../../api/comfyui', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../api/comfyui')>()),
    getComfyUIConfig: vi.fn(),
    listComfyUITemplates: vi.fn(),
    saveComfyUIConfig: vi.fn(),
}));

const baseConfig: ComfyUIConfig = {
    version: 1,
    connectionUrl: 'http://127.0.0.1:8188',
    defaultTemplateId: 'wf-a',
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

const selectUnderLabel = (labelText: string): HTMLSelectElement => {
    const label = screen.getByText(labelText).closest('label');
    if (!label) throw new Error(`label not found for ${labelText}`);
    const select = label.querySelector('select');
    if (!select) throw new Error(`select not found under ${labelText}`);
    return select;
};

describe('タグ判定・ワークフロー設定パネルの分析AI', () => {
    beforeEach(() => {
        vi.mocked(getComfyUIConfig).mockResolvedValue({ ...baseConfig });
        vi.mocked(listComfyUITemplates).mockResolvedValue([{ name: 'wf-a', hasWorkflow: true, hasMeta: false }]);
        vi.mocked(saveComfyUIConfig).mockResolvedValue(undefined as never);
        vi.mocked(axios.get).mockImplementation(async (url: string) => (
            url.includes('/api/models') ? { data: { models: [geminiModel, apiModel] } } : { data: {} }
        ));
    });

    it('保存済みの分析AIを表示し、変更すると即時保存する', async () => {
        const user = userEvent.setup();
        render(<TagJudgeWorkflowPanel backendUrl="http://backend.invalid" showHeading={false} stacked />);
        await screen.findByText('分析AI');
        await waitFor(() => expect(selectUnderLabel('分析AI')).toHaveValue('gemini'));
        // 読み込み直後の自動補正で保存が走ってはならない。
        expect(saveComfyUIConfig).not.toHaveBeenCalled();

        await user.selectOptions(selectUnderLabel('分析AI'), 'claude');
        await waitFor(() => expect(saveComfyUIConfig).toHaveBeenCalled());
        const saved = vi.mocked(saveComfyUIConfig).mock.calls.at(-1)?.[1];
        expect(saved?.tagJudgeProvider).toBe('claude');
        // 他のキー（directiveMode 等）は読み直した値を保つ。
        expect(saved?.directiveMode).toBe('danbooru_only');
        expect(saved?.defaultTemplateId).toBe('wf-a');
    });

    it('API を選ぶと先頭モデルが自動選択され、最終的な保存に provider とモデルの両方が入る', async () => {
        const user = userEvent.setup();
        render(<TagJudgeWorkflowPanel backendUrl="http://backend.invalid" showHeading={false} stacked />);
        await screen.findByText('分析AI');
        await waitFor(() => expect(selectUnderLabel('分析AI')).toHaveValue('gemini'));

        await user.selectOptions(selectUnderLabel('分析AI'), 'openai_compat');
        await waitFor(() => expect(selectUnderLabel('分析モデル')).toHaveValue(apiModel.id));
        await waitFor(() => {
            const saved = vi.mocked(saveComfyUIConfig).mock.calls.at(-1)?.[1];
            expect(saved?.tagJudgeProvider).toBe('openai_compat');
            expect(saved?.tagJudgeOpenAICompatModel).toBe(apiModel.id);
        });
    });
});
