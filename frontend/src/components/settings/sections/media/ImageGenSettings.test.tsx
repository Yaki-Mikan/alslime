import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getComfyUIConfig, getLoraDirConfig, getLoraDirDefaults, patchComfyUIConfig, saveLoraDirConfig } from '../../../../api/comfyui';
import type { SectionHandle } from '../sectionTypes';
import { ImageGenSettings } from './ImageGenSettings';

vi.mock('../../../../api/comfyui', async importOriginal => {
    const actual = await importOriginal<typeof import('../../../../api/comfyui')>();
    return {
        ...actual,
        getComfyUIConfig: vi.fn(),
        getLoraDirConfig: vi.fn(),
        getLoraDirDefaults: vi.fn(),
        patchComfyUIConfig: vi.fn(),
        saveLoraDirConfig: vi.fn(),
        testComfyUIConnection: vi.fn(),
    };
});
vi.mock('../../../comfyui/BackendTabs', () => ({ BackendTabs: () => null }));
vi.mock('../../../comfyui/TagJudgeProviderFields', () => ({ TagJudgeProviderFields: () => null }));
vi.mock('../../../comfyui/apiservice/ApiServiceConnectionSection', () => ({ ApiServiceConnectionSection: () => null }));
vi.mock('../../../comfyui/apiservice/ApiServiceBalancePanel', () => ({ ApiServiceBalancePanel: () => null }));
vi.mock('../../../comfyui/apiservice/ApiServiceModelSelect', () => ({ ApiServiceModelSelect: () => null }));
vi.mock('../../../comfyui/apiservice/AutoSoundEffectsToggle', () => ({ AutoSoundEffectsToggle: () => null }));
vi.mock('../../../comfyui/apiservice/UserAppearanceSection', () => ({ UserAppearanceSection: () => null }));

const LORA_DIRS = { categories: [{ id: 'character', label: 'キャラクター', directory: 'chara/' }] };

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getComfyUIConfig).mockResolvedValue({ connectionUrl: 'http://127.0.0.1:8188', imageBackend: 'comfyui', directiveMode: 'danbooru_only' } as never);
    vi.mocked(getLoraDirConfig).mockResolvedValue(structuredClone(LORA_DIRS));
    vi.mocked(getLoraDirDefaults).mockResolvedValue(structuredClone(LORA_DIRS));
    vi.mocked(patchComfyUIConfig).mockResolvedValue({} as never);
    vi.mocked(saveLoraDirConfig).mockResolvedValue(undefined);
});

const setup = async () => {
    const ref = React.createRef<SectionHandle>();
    const onDirtyChange = vi.fn();
    render(<ImageGenSettings ref={ref} uiCatalog={null} active onDirtyChange={onDirtyChange} onOpenMaterial={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('ComfyUI の接続先')).toBeTruthy());
    return { ref, onDirtyChange };
};

describe('設定画面の画像生成', () => {
    it('接続先を変えると変更ありを知らせ、保存で画像生成の設定へ送る（LoRA の置き場所は変えていないので送らない）', async () => {
        const user = userEvent.setup();
        const { ref, onDirtyChange } = await setup();
        const input = screen.getByLabelText('ComfyUI の接続先');
        await user.clear(input);
        await user.type(input, 'http://pc:8188');
        expect(onDirtyChange).toHaveBeenLastCalledWith(true);

        let failed: string[] = [];
        await act(async () => { failed = await ref.current!.save(); });
        expect(failed).toEqual([]);
        expect(patchComfyUIConfig).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ connectionUrl: 'http://pc:8188', directiveMode: 'danbooru_only' }));
        expect(saveLoraDirConfig).not.toHaveBeenCalled();
        await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
    });

    it('LoRA の置き場所を変えたときだけ保存し、元に戻すで下書きを戻す', async () => {
        const user = userEvent.setup();
        const { ref } = await setup();
        const dir = screen.getByLabelText('LoRA の置き場所 キャラクター');
        await user.type(dir, 'x');
        await act(async () => { ref.current!.revert(); });
        expect((screen.getByLabelText('LoRA の置き場所 キャラクター') as HTMLInputElement).value).toBe('chara/');

        await user.type(screen.getByLabelText('LoRA の置き場所 キャラクター'), 'y');
        await act(async () => { await ref.current!.save(); });
        expect(saveLoraDirConfig).toHaveBeenCalledWith(expect.any(String), { categories: [{ id: 'character', label: 'キャラクター', directory: 'chara/y' }] });
        expect(patchComfyUIConfig).not.toHaveBeenCalled();
    });
});
