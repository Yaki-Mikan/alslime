import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    getAllTagMappings,
    getComfyUIConfig,
    saveComfyUIConfig,
    type ComfyUIConfig,
} from '../../api/comfyui';
import { DEFAULT_ANTIGRAVITY_THINKING } from '../../constants/antigravity';
import { ImageGenDrawerControls } from './ImageGenDrawerControls';

vi.mock('../../api/comfyui', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../api/comfyui')>()),
    getComfyUIConfig: vi.fn(),
    saveComfyUIConfig: vi.fn(),
    getAllTagMappings: vi.fn(),
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

const COMBINED_LABEL = '分析と生成をまとめて 1 ジョブ';
const SPLIT_LABEL = '分析と生成を分ける';

const modeButton = (label: string) => screen.getByRole('button', { name: label });

describe('左メニューの画像生成ジョブ単位とタグ有効/無効設定', () => {
    beforeEach(() => {
        vi.mocked(getComfyUIConfig).mockResolvedValue({ ...baseConfig, imageJobMode: 'split' });
        vi.mocked(saveComfyUIConfig).mockResolvedValue(undefined as never);
        vi.mocked(getAllTagMappings).mockResolvedValue({ categories: [], mappings: [] });
    });

    it('保存済みのジョブ単位を選択表示し、もう一方を押すと他のキーを保ったまま即時保存する', async () => {
        const user = userEvent.setup();
        render(<ImageGenDrawerControls backendUrl="http://backend.invalid" />);
        await waitFor(() => expect(modeButton(SPLIT_LABEL)).toHaveAttribute('aria-pressed', 'true'));
        expect(modeButton(COMBINED_LABEL)).toHaveAttribute('aria-pressed', 'false');
        // 読み込み直後に保存が走ってはならない。
        expect(saveComfyUIConfig).not.toHaveBeenCalled();

        await user.click(modeButton(COMBINED_LABEL));
        await waitFor(() => expect(saveComfyUIConfig).toHaveBeenCalled());
        expect(modeButton(COMBINED_LABEL)).toHaveAttribute('aria-pressed', 'true');
        const saved = vi.mocked(saveComfyUIConfig).mock.calls.at(-1)?.[1];
        expect(saved?.imageJobMode).toBe('combined');
        expect(saved?.directiveMode).toBe('danbooru_only');
        expect(saved?.defaultTemplateId).toBe('wf-a');
    });

    it('設定にジョブ単位が無ければ「まとめて 1 ジョブ」を選択表示する', async () => {
        vi.mocked(getComfyUIConfig).mockResolvedValue({ ...baseConfig });
        render(<ImageGenDrawerControls backendUrl="http://backend.invalid" />);
        await screen.findByText('画像生成ジョブの単位');
        await waitFor(() => expect(getComfyUIConfig).toHaveBeenCalled());
        expect(modeButton(COMBINED_LABEL)).toHaveAttribute('aria-pressed', 'true');
        expect(modeButton(SPLIT_LABEL)).toHaveAttribute('aria-pressed', 'false');
    });

    it('ドロワーが閉じている間は読まず、開くたびに設定を読み直して他画面での変更を拾う', async () => {
        const { rerender } = render(<ImageGenDrawerControls backendUrl="http://backend.invalid" active={false} />);
        expect(getComfyUIConfig).not.toHaveBeenCalled();

        rerender(<ImageGenDrawerControls backendUrl="http://backend.invalid" active />);
        await waitFor(() => expect(modeButton(SPLIT_LABEL)).toHaveAttribute('aria-pressed', 'true'));

        // 閉じている間に別画面で combined へ変更された想定
        vi.mocked(getComfyUIConfig).mockResolvedValue({ ...baseConfig, imageJobMode: 'combined' });
        rerender(<ImageGenDrawerControls backendUrl="http://backend.invalid" active={false} />);
        rerender(<ImageGenDrawerControls backendUrl="http://backend.invalid" active />);
        await waitFor(() => expect(modeButton(COMBINED_LABEL)).toHaveAttribute('aria-pressed', 'true'));
        expect(getComfyUIConfig).toHaveBeenCalledTimes(2);
        expect(saveComfyUIConfig).not.toHaveBeenCalled();
    });

    it('タグ有効/無効設定ボタンでモーダルが開く', async () => {
        const user = userEvent.setup();
        render(<ImageGenDrawerControls backendUrl="http://backend.invalid" />);
        await screen.findByText('画像生成ジョブの単位');
        expect(screen.queryByRole('heading', { name: 'タグ有効/無効設定' })).toBeNull();

        await user.click(screen.getByRole('button', { name: 'タグ有効/無効設定' }));
        await screen.findByRole('heading', { name: 'タグ有効/無効設定' });
        await waitFor(() => expect(getAllTagMappings).toHaveBeenCalled());
    });
});
