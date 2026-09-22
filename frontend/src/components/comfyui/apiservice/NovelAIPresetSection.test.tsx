import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    getApiServiceCatalog,
    saveApiServicePreset,
    type NovelAICatalog,
    type NovelAIModelInfo,
    type NovelAIPreset,
} from '../../../api/comfyui';
import { COMMON, NOVELAI } from '../constants';
import { NovelAIPresetSection } from './NovelAIPresetSection';

vi.mock('../../../api/comfyui', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../api/comfyui')>()),
    getApiServiceCatalog: vi.fn(),
    saveApiServicePreset: vi.fn(),
}));

const V5 = 'nai-diffusion-5-full';
const V45 = 'nai-diffusion-4-5-full';
const V5_LIGHT_TEXT = 'very aesthetic, amazing quality, no text';

const modelInfo = (patch: Partial<NovelAIModelInfo> & { id: string }): NovelAIModelInfo => ({
    label: patch.id,
    generation: 'v5',
    maxPersons: 22,
    promptTokenLimit: 1471,
    textRenderLimit: 750,
    supportsSoundEffects: true,
    supportsReference: false,
    supportsTransparent: true,
    supportsJapanese: true,
    supportsFurryMode: true,
    varietyBoostSigma: 0,
    ucPresets: [0, 1, 2, 3, -1],
    ucPresetTexts: {},
    qualityTags: ['standard', 'light', 'none'],
    qualityTagsDefaults: { standard: 'very aesthetic, masterpiece, no text', light: V5_LIGHT_TEXT },
    ...patch,
});

const catalog: NovelAICatalog = {
    models: [
        modelInfo({ id: V5 }),
        modelInfo({
            id: V45,
            generation: 'v45',
            supportsSoundEffects: false,
            supportsReference: true,
            supportsTransparent: false,
            supportsJapanese: false,
            varietyBoostSigma: 58,
            qualityTags: ['standard', 'none'],
            qualityTagsDefaults: { standard: 'location, very aesthetic, masterpiece, no text' },
        }),
    ],
    samplers: [{ id: 'k_euler_ancestral', label: 'Euler Ancestral' }],
    schedules: [{ id: 'karras', label: 'Karras' }],
    sizePresets: [{ id: 'normal_portrait', label: 'Normal Portrait', width: 832, height: 1216 }],
    schedulesBySampler: { k_euler_ancestral: ['karras'] },
    freeTier: { enabled: true, maxPixels: 1048576, maxSteps: 28, maxSamples: 1 },
};

const basePreset = (): NovelAIPreset => ({
    name: 'default',
    sizePreset: 'normal_portrait',
    width: 832,
    height: 1216,
    steps: 28,
    scale: 5,
    cfgRescale: 0,
    sampler: 'k_euler_ancestral',
    noiseSchedule: 'karras',
    seedMode: 'random',
    fixedSeed: 0,
    fixedPositive: '',
    fixedNegative: '',
    promptTemplate: { base: '', character: '', negative: '' },
    furryMode: false,
    modelValues: {
        [V5]: { qualityTags: 'light', ucPreset: 2, transparentBackground: true, imageFormat: 'png', varietyBoost: false },
        [V45]: { qualityTags: 'standard', ucPreset: 1, transparentBackground: false, imageFormat: 'webp', varietyBoost: true },
    },
});

// 一覧の参照が変わると編集中の内容が読み直されるため、テストの間は同じ配列を渡し続ける。
let presets: NovelAIPreset[];

const renderSection = async (modelId: string) => {
    const props = { backendUrl: 'http://backend', service: 'novelai' as const, active: true, onPresetsChanged: vi.fn() };
    const view = render(<NovelAIPresetSection {...props} presets={presets} modelId={modelId} />);
    await screen.findByRole('button', { name: NOVELAI.SECTIONS.PROMPT });
    expect(screen.queryByRole('button', { name: NOVELAI.SECTIONS.MODEL })).toBeNull();
    expect(screen.queryByTestId('novelai-current-model')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: NOVELAI.SECTIONS.PROMPT }));
    await userEvent.click(screen.getByRole('button', { name: NOVELAI.SECTIONS.OUTPUT }));
    const switchModel = (next: string) => view.rerender(<NovelAIPresetSection {...props} presets={presets} modelId={next} />);
    return { ...view, switchModel };
};

const qualitySelect = () => screen.getByLabelText(NOVELAI.LABELS.QUALITY_TAGS, { selector: 'select' }) as HTMLSelectElement;
const ucSelect = () => screen.getByLabelText(NOVELAI.LABELS.UC_PRESET, { selector: 'select' }) as HTMLSelectElement;
const formatSelect = () => screen.getByLabelText(NOVELAI.LABELS.IMAGE_FORMAT, { selector: 'select' }) as HTMLSelectElement;
const qualityTextBox = () => screen.queryByLabelText(NOVELAI.LABELS.QUALITY_TAGS_TEXT, { selector: 'textarea' }) as HTMLTextAreaElement | null;

describe('NovelAIPresetSection のモデルごとの値', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        presets = [basePreset()];
        vi.mocked(getApiServiceCatalog).mockResolvedValue(structuredClone(catalog));
        vi.mocked(saveApiServicePreset).mockImplementation(async (_url, preset) => structuredClone(preset));
    });

    it('モデルを切り替えると、そのモデル用の値の表示へ切り替わる', async () => {
        const { switchModel } = await renderSection(V5);
        expect(qualitySelect().value).toBe('light');
        expect(ucSelect().value).toBe('2');
        expect(formatSelect().value).toBe('png');
        expect(formatSelect().disabled).toBe(true);
        expect(screen.queryByText(NOVELAI.LABELS.TRANSPARENT)).not.toBeNull();

        switchModel(V45);
        expect(qualitySelect().value).toBe('standard');
        expect(ucSelect().value).toBe('1');
        expect(formatSelect().value).toBe('webp');
        // 透過背景は V5 のときだけ表示する。4.5 では「軽い」を選べない表示にする。
        expect(screen.queryByText(NOVELAI.LABELS.TRANSPARENT)).toBeNull();
        const light = Array.from(qualitySelect().options).find(o => o.value === 'light');
        expect(light?.disabled).toBe(true);
        expect(screen.getByText(NOVELAI.HELP.NOT_IN_MODEL)).toBeTruthy();

        switchModel(V5);
        expect(qualitySelect().value).toBe('light');
        expect(formatSelect().value).toBe('png');
    });

    it('未保存の編集はモデルを切り替えても残り、保存では編集したモデルの値だけを送る', async () => {
        const { switchModel } = await renderSection(V5);
        fireEvent.change(ucSelect(), { target: { value: '0' } });

        switchModel(V45);
        expect(ucSelect().value).toBe('1');
        switchModel(V5);
        expect(ucSelect().value).toBe('0');

        await userEvent.click(screen.getByRole('button', { name: COMMON.BUTTONS.SAVE }));
        await waitFor(() => expect(saveApiServicePreset).toHaveBeenCalledTimes(1));
        const sent = vi.mocked(saveApiServicePreset).mock.calls[0][1];
        expect(Object.keys(sent.modelValues ?? {})).toEqual([V5]);
        expect(sent.modelValues?.[V5].ucPreset).toBe(0);
    });

    it('別々のモデルで編集した値は、それぞれのモデル用として送る', async () => {
        const { switchModel } = await renderSection(V5);
        fireEvent.change(ucSelect(), { target: { value: '0' } });
        switchModel(V45);
        fireEvent.change(ucSelect(), { target: { value: '3' } });

        await userEvent.click(screen.getByRole('button', { name: COMMON.BUTTONS.SAVE }));
        await waitFor(() => expect(saveApiServicePreset).toHaveBeenCalledTimes(1));
        const sent = vi.mocked(saveApiServicePreset).mock.calls[0][1];
        expect(Object.keys(sent.modelValues ?? {}).sort()).toEqual([V45, V5].sort());
        expect(sent.modelValues?.[V5].ucPreset).toBe(0);
        expect(sent.modelValues?.[V45].ucPreset).toBe(3);
    });

    it('送る品質タグの文は推奨の文から始まり、編集と「推奨の文へ戻す」ができる', async () => {
        await renderSection(V5);
        expect(qualityTextBox()?.value).toBe(V5_LIGHT_TEXT);
        expect(screen.getByText(NOVELAI.HELP.MODEL_VALUES_NOTE)).toBeTruthy();

        fireEvent.change(qualityTextBox()!, { target: { value: 'very aesthetic, amazing quality' } });
        expect(qualityTextBox()?.value).toBe('very aesthetic, amazing quality');

        // 種類を切り替えて戻しても、編集した文は残る。
        fireEvent.change(qualitySelect(), { target: { value: 'standard' } });
        expect(qualityTextBox()?.value).toBe('very aesthetic, masterpiece, no text');
        fireEvent.change(qualitySelect(), { target: { value: 'light' } });
        expect(qualityTextBox()?.value).toBe('very aesthetic, amazing quality');

        await userEvent.click(screen.getByRole('button', { name: NOVELAI.BUTTONS.RESET_QUALITY_TAGS_TEXT }));
        expect(qualityTextBox()?.value).toBe(V5_LIGHT_TEXT);

        // 「指定なし」ではテキストボックスを出さない。
        fireEvent.change(qualitySelect(), { target: { value: 'none' } });
        expect(qualityTextBox()).toBeNull();
    });
});
