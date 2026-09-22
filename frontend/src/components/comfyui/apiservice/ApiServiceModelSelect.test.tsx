import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    getApiServiceCatalog,
    getComfyUIConfig,
    setApiServiceModel,
    type ComfyUIConfig,
    type NovelAICatalog,
} from '../../../api/comfyui';
import { NOVELAI } from '../constants';
import { ApiServiceModelSelect } from './ApiServiceModelSelect';

vi.mock('../../../api/comfyui', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../api/comfyui')>()),
    getApiServiceCatalog: vi.fn(),
    getComfyUIConfig: vi.fn(),
    setApiServiceModel: vi.fn(),
}));

const V5 = 'nai-diffusion-5-full';
const V45 = 'nai-diffusion-4-5-full';

const catalog = {
    models: [
        { id: V5, label: 'V5 Full', supportsJapanese: true, supportsReference: true },
        { id: V45, label: 'V4.5 Full', supportsJapanese: true, supportsReference: true },
    ],
} as unknown as NovelAICatalog;

const configWithModel = (model: string) =>
    ({ apiServiceSettings: { novelai: { model } } }) as unknown as ComfyUIConfig;

const modelSelect = () => screen.getByLabelText(NOVELAI.LABELS.MODEL, { selector: 'select' }) as HTMLSelectElement;

describe('ApiServiceModelSelect の保存', () => {
    let onModelChange: ReturnType<typeof vi.fn<(modelId: string) => void>>;
    let onSavingChange: ReturnType<typeof vi.fn<(saving: boolean) => void>>;

    const renderSelect = async () => {
        render(
            <ApiServiceModelSelect
                backendUrl="http://backend"
                service="novelai"
                active
                onModelChange={onModelChange}
                onSavingChange={onSavingChange}
            />,
        );
        await waitFor(() => expect(modelSelect().value).toBe(V5));
    };

    beforeEach(() => {
        vi.clearAllMocks();
        onModelChange = vi.fn<(modelId: string) => void>();
        onSavingChange = vi.fn<(saving: boolean) => void>();
        vi.mocked(getApiServiceCatalog).mockResolvedValue(catalog);
        vi.mocked(getComfyUIConfig).mockResolvedValue(configWithModel(V5));
    });

    it('保存の応答が返るまで保存中を親へ知らせ、返ったら新しいモデルを知らせる', async () => {
        let finish!: (model: string) => void;
        vi.mocked(setApiServiceModel).mockImplementation(() => new Promise<string>((resolve) => { finish = resolve; }));
        await renderSelect();
        expect(onModelChange).toHaveBeenLastCalledWith(V5);

        fireEvent.change(modelSelect(), { target: { value: V45 } });
        await waitFor(() => expect(onSavingChange).toHaveBeenLastCalledWith(true));
        expect(modelSelect().disabled).toBe(true);
        expect(onModelChange).not.toHaveBeenCalledWith(V45);

        finish(V45);
        await waitFor(() => expect(onSavingChange).toHaveBeenLastCalledWith(false));
        expect(onModelChange).toHaveBeenLastCalledWith(V45);
        expect(modelSelect().value).toBe(V45);
        expect(modelSelect().disabled).toBe(false);
    });

    it('保存に失敗したら選択が元のモデルへ戻り、失敗を表示する', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.mocked(setApiServiceModel).mockRejectedValue(new Error('save failed'));
        await renderSelect();

        fireEvent.change(modelSelect(), { target: { value: V45 } });
        await waitFor(() => expect(screen.getByText(NOVELAI.MESSAGES.MODEL_SAVE_FAILED)).toBeTruthy());
        expect(modelSelect().value).toBe(V5);
        expect(onModelChange).not.toHaveBeenCalledWith(V45);
        expect(onSavingChange).toHaveBeenLastCalledWith(false);
    });
});
