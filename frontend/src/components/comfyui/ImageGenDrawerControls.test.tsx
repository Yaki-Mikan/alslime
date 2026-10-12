import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    getAllTagMappings,
    getApiServiceCatalog,
    getComfyUIConfig,
    saveComfyUIConfig,
    setApiServiceAutoSoundEffects,
    setTagEnabled,
    type ComfyUIConfig,
    type NovelAICatalog,
    type TagMappingBundle,
} from '../../api/comfyui';
import { DEFAULT_ANTIGRAVITY_THINKING } from '../../constants/antigravity';
import { ImageGenDrawerControls } from './ImageGenDrawerControls';

vi.mock('../../api/comfyui', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../api/comfyui')>()),
    getComfyUIConfig: vi.fn(),
    getApiServiceCatalog: vi.fn(),
    saveComfyUIConfig: vi.fn(),
    setApiServiceAutoSoundEffects: vi.fn(),
    getAllTagMappings: vi.fn(),
    setTagEnabled: vi.fn(),
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

const HEADER_LABEL = '画像生成ジョブの単位';
const COMBINED_LABEL = '分析と生成をまとめて 1 ジョブ';
const SPLIT_LABEL = '分析と生成を分ける';

const modeButton = (label: string) => screen.getByRole('button', { name: label });
// パネルはデフォルト閉。ヘッダ全体が開閉ボタン。
const openPanel = (user: ReturnType<typeof userEvent.setup>) =>
    user.click(screen.getByRole('button', { name: HEADER_LABEL }));

describe('クイック設定の画像生成ジョブ単位とタグ有効/無効設定', () => {
    beforeEach(() => {
        vi.mocked(getApiServiceCatalog).mockResolvedValue({ models: [
            { id: 'nai-diffusion-5-full', supportsSoundEffects: true },
        ] } as NovelAICatalog);
        vi.mocked(getComfyUIConfig).mockResolvedValue({ ...baseConfig, imageJobMode: 'split' });
        vi.mocked(saveComfyUIConfig).mockResolvedValue(undefined as never);
    });

    it('デフォルト閉で、ヘッダを押すと開き、もう一度押すと閉じる', async () => {
        const user = userEvent.setup();
        render(<ImageGenDrawerControls backendUrl="http://backend.invalid" />);
        expect(screen.queryByRole('button', { name: SPLIT_LABEL })).toBeNull();
        // 閉じている間は設定を読まない。
        expect(getComfyUIConfig).not.toHaveBeenCalled();

        await openPanel(user);
        await waitFor(() => expect(modeButton(SPLIT_LABEL)).toHaveAttribute('aria-pressed', 'true'));

        await openPanel(user);
        expect(screen.queryByRole('button', { name: SPLIT_LABEL })).toBeNull();
    });

    it('保存済みのジョブ単位を選択表示し、もう一方を押すと他のキーを保ったまま即時保存する', async () => {
        const user = userEvent.setup();
        render(<ImageGenDrawerControls backendUrl="http://backend.invalid" />);
        await openPanel(user);
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
        const user = userEvent.setup();
        vi.mocked(getComfyUIConfig).mockResolvedValue({ ...baseConfig });
        render(<ImageGenDrawerControls backendUrl="http://backend.invalid" />);
        await openPanel(user);
        await waitFor(() => expect(getComfyUIConfig).toHaveBeenCalled());
        expect(modeButton(COMBINED_LABEL)).toHaveAttribute('aria-pressed', 'true');
        expect(modeButton(SPLIT_LABEL)).toHaveAttribute('aria-pressed', 'false');
    });

    it('クイック設定の欄が閉じている間は読まず、開くたびに設定を読み直して他画面での変更を拾う', async () => {
        const user = userEvent.setup();
        const { rerender } = render(<ImageGenDrawerControls backendUrl="http://backend.invalid" active={false} />);
        // パネルを開いても欄が閉じていれば読まない。
        await openPanel(user);
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

    const TAG_BUNDLE = {
        categories: [{ id: 'emotion', label: '表情' }, { id: 'pose', label: '体位・姿勢' }],
        mappings: [
            { categoryId: 'emotion', tags: [{ key: '笑顔', prompt: 'smile', lora: [] }, { key: '泣き顔', prompt: 'crying', lora: [], enabled: false }] },
            { categoryId: 'pose', tags: [{ key: '立ち姿', prompt: 'standing', lora: [{ name: 'pose-a' }] }] },
        ],
    } as unknown as TagMappingBundle;

    it('タグのボタンでその場の窓を開き、分類の定義順にタグを並べる', async () => {
        const user = userEvent.setup();
        vi.mocked(getAllTagMappings).mockResolvedValue(structuredClone(TAG_BUNDLE));
        render(<ImageGenDrawerControls backendUrl="http://backend.invalid" />);
        await openPanel(user);
        await user.click(screen.getByRole('button', { name: 'タグ有効/無効設定' }));
        await waitFor(() => expect(screen.getByText('笑顔')).toBeTruthy());
        const headings = screen.getAllByRole('heading', { level: 4 }).map(h => h.textContent);
        expect(headings).toEqual(['表情', '体位・姿勢']);
        expect(screen.getByText('1 / 2')).toBeTruthy();
        // 窓を開くたびに読み直す
        expect(getAllTagMappings).toHaveBeenCalledTimes(1);
    });

    it('窓のスイッチを切り替えた時点で保存し、失敗したら元に戻して知らせる', async () => {
        const user = userEvent.setup();
        vi.mocked(getAllTagMappings).mockResolvedValue(structuredClone(TAG_BUNDLE));
        vi.mocked(setTagEnabled).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('x'));
        render(<ImageGenDrawerControls backendUrl="http://backend.invalid" />);
        await openPanel(user);
        await user.click(screen.getByRole('button', { name: 'タグ有効/無効設定' }));
        const smile = await screen.findByRole('checkbox', { name: '笑顔 有効' });
        expect(smile).toBeChecked();

        await user.click(smile);
        await waitFor(() => expect(setTagEnabled).toHaveBeenCalledWith('http://backend.invalid', 'emotion', '笑顔', false));
        expect(smile).not.toBeChecked();

        await user.click(smile);
        await waitFor(() => expect(screen.getByText('更新に失敗しました')).toBeTruthy());
        expect(smile).not.toBeChecked();
    });

    it('「素材づくりで編集」は窓を閉じてから素材づくりを開く。入口が無ければ出さない', async () => {
        const user = userEvent.setup();
        vi.mocked(getAllTagMappings).mockResolvedValue(structuredClone(TAG_BUNDLE));
        const onOpenTags = vi.fn();
        const { rerender } = render(<ImageGenDrawerControls backendUrl="http://backend.invalid" />);
        await openPanel(user);
        await user.click(screen.getByRole('button', { name: 'タグ有効/無効設定' }));
        await screen.findByText('笑顔');
        expect(screen.queryByRole('button', { name: '素材づくりで編集' })).toBeNull();

        rerender(<ImageGenDrawerControls backendUrl="http://backend.invalid" onOpenTags={onOpenTags} />);
        await user.click(screen.getByRole('button', { name: '素材づくりで編集' }));
        expect(onOpenTags).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(screen.queryByText('笑顔')).toBeNull());
    });

    it('応答時の自動画像生成トグルは設定に無ければ OFF で表示し、ON にすると他のキーを保ったまま即時保存する', async () => {
        const user = userEvent.setup();
        render(<ImageGenDrawerControls backendUrl="http://backend.invalid" />);
        await openPanel(user);
        const toggle = await screen.findByRole('checkbox', { name: '応答時に自動で画像生成する' });
        await waitFor(() => expect(modeButton(SPLIT_LABEL)).toHaveAttribute('aria-pressed', 'true'));
        expect(toggle).not.toBeChecked();
        expect(saveComfyUIConfig).not.toHaveBeenCalled();

        await user.click(toggle);
        await waitFor(() => expect(saveComfyUIConfig).toHaveBeenCalled());
        expect(toggle).toBeChecked();
        const saved = vi.mocked(saveComfyUIConfig).mock.calls.at(-1)?.[1];
        expect(saved?.autoGenerateEnabled).toBe(true);
        expect(saved?.imageJobMode).toBe('split');
        expect(saved?.defaultTemplateId).toBe('wf-a');
    });

    it('自動効果音描画のトグルは API サービスを選んでいるときだけ出て、専用の保存の口で保存する', async () => {
        const user = userEvent.setup();
        const label = '自動効果音描画';
        // ComfyUI 連携のときは出さない。
        const comfy = render(<ImageGenDrawerControls backendUrl="http://backend.invalid" />);
        await openPanel(user);
        await waitFor(() => expect(modeButton(SPLIT_LABEL)).toHaveAttribute('aria-pressed', 'true'));
        expect(screen.queryByRole('checkbox', { name: label })).toBeNull();
        comfy.unmount();

        vi.mocked(getComfyUIConfig).mockResolvedValue({
            ...baseConfig,
            imageBackend: 'api',
            apiService: 'novelai',
            apiServiceSettings: { novelai: { autoSoundEffects: true } } as unknown as ComfyUIConfig['apiServiceSettings'],
        });
        vi.mocked(setApiServiceAutoSoundEffects).mockResolvedValue(false);
        render(<ImageGenDrawerControls backendUrl="http://backend.invalid" />);
        await openPanel(user);
        const toggle = await screen.findByRole('checkbox', { name: label });
        await waitFor(() => expect(toggle).toBeChecked());

        await user.click(toggle);
        await waitFor(() => expect(setApiServiceAutoSoundEffects).toHaveBeenCalledWith('http://backend.invalid', false, 'novelai'));
        expect(toggle).not.toBeChecked();
        // この値は設定全体の保存では書かない。
        expect(saveComfyUIConfig).not.toHaveBeenCalled();
    });

    it('保存済みの自動画像生成トグルを ON で表示する', async () => {
        const user = userEvent.setup();
        vi.mocked(getComfyUIConfig).mockResolvedValue({ ...baseConfig, autoGenerateEnabled: true });
        render(<ImageGenDrawerControls backendUrl="http://backend.invalid" />);
        await openPanel(user);
        const toggle = await screen.findByRole('checkbox', { name: '応答時に自動で画像生成する' });
        await waitFor(() => expect(toggle).toBeChecked());
        expect(saveComfyUIConfig).not.toHaveBeenCalled();
    });
});
