import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    generateApiServiceTest,
    getComfyUIConfig,
    getTagCategories,
    listApiServicePresets,
    listPlaceholderPresets,
    type ComfyUIConfig,
    type NovelAIPreset,
} from '../../../api/comfyui';
import { COMMON, GENERATE_TEST } from '../constants';
import { IntegratedGenerateTestSection } from './IntegratedGenerateTestSection';

vi.mock('../../../api/comfyui', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../api/comfyui')>()),
    getComfyUIConfig: vi.fn(),
    getTagCategories: vi.fn(),
    listPlaceholderPresets: vi.fn(),
    listApiServicePresets: vi.fn(),
    generateApiServiceTest: vi.fn(),
}));

const renderSection = (generateDisabled = false) => render(
    <IntegratedGenerateTestSection
        backendUrl="http://backend"
        selectedTemplate="wf-a"
        selectedPreset="default"
        useLeftCharacter
        onToggleUseLeftCharacter={() => undefined}
        leftCharacterName="Alice"
        leftCharConfig={{} as never}
        characters={[]}
        generateDisabled={generateDisabled}
    />,
);

const mockBackend = (imageBackend: 'api' | 'comfyui') => {
    vi.mocked(getComfyUIConfig).mockResolvedValue({ imageBackend, apiService: 'novelai' } as unknown as ComfyUIConfig);
};

const extraPromptBox = () => screen.queryByLabelText(GENERATE_TEST.LABELS.EXTRA_PROMPT) as HTMLTextAreaElement | null;

describe('IntegratedGenerateTestSection の追加プロンプト（自由入力）', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getTagCategories).mockResolvedValue({ categories: [] } as never);
        vi.mocked(listPlaceholderPresets).mockResolvedValue([]);
        vi.mocked(listApiServicePresets).mockResolvedValue([{ name: 'default' } as NovelAIPreset]);
        vi.mocked(generateApiServiceTest).mockResolvedValue({ success: true });
    });

    it('ComfyUI 用のテスト生成には出さない', async () => {
        mockBackend('comfyui');
        renderSection();
        await waitFor(() => expect(getComfyUIConfig).toHaveBeenCalled());
        await waitFor(() => expect(listPlaceholderPresets).toHaveBeenCalled());
        expect(extraPromptBox()).toBeNull();
    });

    it('API サービス用のテスト生成に出し、書いた内容をその回の要求にだけ載せる', async () => {
        mockBackend('api');
        renderSection();
        await waitFor(() => expect(extraPromptBox()).not.toBeNull());
        expect(screen.getByText(GENERATE_TEST.MESSAGES.EXTRA_PROMPT_DESC)).toBeTruthy();

        // 空のままなら要求に載せない。
        await userEvent.click(screen.getByRole('button', { name: COMMON.BUTTONS.GENERATE }));
        await waitFor(() => expect(generateApiServiceTest).toHaveBeenCalledTimes(1));
        expect(vi.mocked(generateApiServiceTest).mock.calls[0][1]).not.toHaveProperty('extraPrompt');

        fireEvent.change(extraPromptBox()!, { target: { value: 'bold text "どんっ"' } });
        await userEvent.click(screen.getByRole('button', { name: COMMON.BUTTONS.GENERATE }));
        await waitFor(() => expect(generateApiServiceTest).toHaveBeenCalledTimes(2));
        expect(vi.mocked(generateApiServiceTest).mock.calls[1][1]).toMatchObject({ extraPrompt: 'bold text "どんっ"', backend: 'api', presetName: 'default' });
    });

    it('親から生成を押せないと伝えられている間は、生成ボタンを押せない', async () => {
        mockBackend('api');
        renderSection(true);
        await waitFor(() => expect(extraPromptBox()).not.toBeNull());
        expect((screen.getByRole('button', { name: COMMON.BUTTONS.GENERATE }) as HTMLButtonElement).disabled).toBe(true);
    });
});
