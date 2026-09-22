import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from '../../lib/axios';
import {
    getComfyUIConfig,
    listComfyUITemplates,
    saveComfyUIConfig,
    patchComfyUIConfig,
    type ComfyUIConfig,
} from '../../api/comfyui';
import { DEFAULT_ANTIGRAVITY_THINKING } from '../../constants/antigravity';
import { ComfyUISettingsModal } from './ComfyUISettingsModal';

vi.mock('../../lib/axios', () => ({
    default: { get: vi.fn() },
}));

vi.mock('../../api/comfyui', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../api/comfyui')>()),
    getComfyUIConfig: vi.fn(),
    listComfyUITemplates: vi.fn(),
    saveComfyUIConfig: vi.fn(),
    patchComfyUIConfig: vi.fn(),
}));

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
    vi.mocked(axios.get).mockImplementation(async (url: string) => {
        if (url.includes('/api/models')) {
            return { data: { models } };
        }
        return { data: {} };
    });
};

const renderModal = () => render(
    <ComfyUISettingsModal isOpen onClose={vi.fn()} backendUrl="http://backend.invalid" />
);

// label 要素は「見出し span ＋ select」の構造で、label の文字列には option も含まれるため
// getByLabelText の完全一致が使えない。見出し span から親 label を辿って select を取る。
const selectUnderLabel = (labelText: string): HTMLSelectElement => {
    const label = screen.getByText(labelText).closest('label');
    if (!label) throw new Error(`label not found for ${labelText}`);
    const select = label.querySelector('select');
    if (!select) throw new Error(`select not found under ${labelText}`);
    return select;
};

const openTagJudgeSection = async (user: ReturnType<typeof userEvent.setup>) => {
    await screen.findByDisplayValue(baseConfig.connectionUrl);
    await user.click(screen.getByRole('button', { name: 'タグ判定・ワークフロー設定' }));
    await screen.findByText('分析AI');
};

describe('ComfyUI 設定モーダルのタグ判定 API 対応', () => {
    beforeEach(() => {
        vi.mocked(getComfyUIConfig).mockResolvedValue({ ...baseConfig });
        vi.mocked(listComfyUITemplates).mockResolvedValue([]);
        vi.mocked(saveComfyUIConfig).mockResolvedValue(undefined as never);
        vi.mocked(patchComfyUIConfig).mockResolvedValue({ ...baseConfig });
        mockModels([geminiModel]);
    });

    it('分析AIの選択肢に API（OpenAI互換）がある', async () => {
        const user = userEvent.setup();
        renderModal();
        await openTagJudgeSection(user);
        expect(screen.getByRole('option', { name: 'API（OpenAI互換）' })).toBeInTheDocument();
    });

    it('API モデルが未登録なら分析モデルを無効化して案内する', async () => {
        const user = userEvent.setup();
        renderModal();
        await openTagJudgeSection(user);
        await user.selectOptions(selectUnderLabel('分析AI'), 'openai_compat');

        expect(selectUnderLabel('分析モデル')).toBeDisabled();
        expect(screen.getByText(/選べるモデルがありません/)).toBeInTheDocument();
    });

    it('API モデルがあれば「接続表示名 / モデル」で選べ、先頭が自動選択されて保存される', async () => {
        const user = userEvent.setup();
        mockModels([geminiModel, apiModel]);
        renderModal();
        await openTagJudgeSection(user);
        await user.selectOptions(selectUnderLabel('分析AI'), 'openai_compat');

        const modelSelect = selectUnderLabel('分析モデル');
        await waitFor(() => expect(modelSelect).toHaveValue(apiModel.id));
        expect(screen.getByRole('option', { name: 'メイン / vendor/model' })).toBeInTheDocument();
        expect(modelSelect).not.toBeDisabled();

        const saveButtons = screen.getAllByRole('button', { name: '保存' });
        await user.click(saveButtons[saveButtons.length - 1]);
        // 保存は設定全体を読み直して編集した項目だけ差し替える（他画面の項目を落とさない）。
        await waitFor(() => expect(patchComfyUIConfig).toHaveBeenCalled());
        const saved = vi.mocked(patchComfyUIConfig).mock.calls[0][1];
        expect(saved.tagJudgeProvider).toBe('openai_compat');
        expect(saved.tagJudgeOpenAICompatModel).toBe(apiModel.id);
    });

    it('保存済みの API モデルを復元する', async () => {
        const user = userEvent.setup();
        mockModels([geminiModel, apiModel]);
        vi.mocked(getComfyUIConfig).mockResolvedValue({
            ...baseConfig,
            tagJudgeProvider: 'openai_compat',
            tagJudgeOpenAICompatModel: apiModel.id,
        });
        renderModal();
        await openTagJudgeSection(user);

        expect(selectUnderLabel('分析AI')).toHaveValue('openai_compat');
        await waitFor(() => expect(selectUnderLabel('分析モデル')).toHaveValue(apiModel.id));
    });
});
