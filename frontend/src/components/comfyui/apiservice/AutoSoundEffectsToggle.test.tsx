import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getApiServiceCatalog, getComfyUIConfig, setApiServiceAutoSoundEffects, type ComfyUIConfig, type NovelAICatalog } from '../../../api/comfyui';
import { API_SERVICE } from '../constants';
import { AutoSoundEffectsToggle } from './AutoSoundEffectsToggle';

vi.mock('../../../api/comfyui', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../api/comfyui')>()),
    getComfyUIConfig: vi.fn(),
    getApiServiceCatalog: vi.fn(),
    setApiServiceAutoSoundEffects: vi.fn(),
}));

// 保存済みの値（専用の保存の口だけが書き換える）。
let stored: boolean;
let backend: 'api' | 'comfyui';

const config = () => ({
    imageBackend: backend,
    apiService: 'novelai',
    apiServiceSettings: { novelai: { autoSoundEffects: stored } },
}) as unknown as ComfyUIConfig;

const toggle = () => screen.getByRole('checkbox') as HTMLInputElement;

describe('AutoSoundEffectsToggle', () => {
    it.each([false, true])('保存中の連続操作を防ぎ、応答後に保存値と表示が一致する（成功=%s）', async (success) => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        let resolveSave!: (value: boolean) => void;
        let rejectSave!: (error: Error) => void;
        vi.mocked(setApiServiceAutoSoundEffects).mockImplementationOnce(() => new Promise<boolean>((resolve, reject) => {
            resolveSave = resolve;
            rejectSave = reject;
        }));
        render(<AutoSoundEffectsToggle backendUrl="http://backend" service="novelai" active source={config()} />);
        await screen.findByRole('checkbox');
        await userEvent.click(toggle());
        expect(toggle()).toBeDisabled();
        await userEvent.click(toggle());
        expect(setApiServiceAutoSoundEffects).toHaveBeenCalledTimes(1);
        await act(async () => {
            if (success) {
                stored = true;
                resolveSave(stored);
            } else {
                rejectSave(new Error('save failed'));
            }
        });
        expect(toggle()).toBeEnabled();
        expect(toggle().checked).toBe(stored);
        if (!success) {
            expect(screen.getByText(API_SERVICE.MESSAGES.AUTO_SOUND_EFFECTS_SAVE_FAILED)).toBeTruthy();
        }
        // 保存が完了した後は、失敗後の再操作も受け付ける。
        await userEvent.click(toggle());
        await waitFor(() => expect(setApiServiceAutoSoundEffects).toHaveBeenCalledTimes(2));
        expect(toggle().checked).toBe(stored);
    });

    beforeEach(() => {
        vi.clearAllMocks();
        stored = false;
        backend = 'api';
        vi.mocked(getApiServiceCatalog).mockResolvedValue({ models: [
            { id: 'nai-diffusion-5-full', supportsSoundEffects: true },
            { id: 'nai-diffusion-5-curated', supportsSoundEffects: true },
            { id: 'nai-diffusion-4-5-full', supportsSoundEffects: false },
            { id: 'nai-diffusion-4-5-curated', supportsSoundEffects: false },
        ] } as NovelAICatalog);
        vi.mocked(getComfyUIConfig).mockImplementation(async () => config());
        vi.mocked(setApiServiceAutoSoundEffects).mockImplementation(async (_url, enabled) => {
            stored = enabled;
            return enabled;
        });
    });

    it('切り替えると専用の保存の口で保存し、別の画面のトグルは開き直したときに同じ値を読む', async () => {
        const first = render(<AutoSoundEffectsToggle backendUrl="http://backend" service="novelai" active />);
        await waitFor(() => expect(getComfyUIConfig).toHaveBeenCalledTimes(1));
        await screen.findByRole('checkbox');
        expect(toggle().checked).toBe(false);

        await userEvent.click(toggle());
        await waitFor(() => expect(setApiServiceAutoSoundEffects).toHaveBeenCalledWith('http://backend', true, 'novelai'));
        expect(toggle().checked).toBe(true);
        first.unmount();

        // 別の画面のトグル（同じ値を読む）。閉じている間は読まず、開くたびに読み直す。
        const second = render(<AutoSoundEffectsToggle backendUrl="http://backend" active={false} onlyWhenApiBackend />);
        expect(getComfyUIConfig).toHaveBeenCalledTimes(1);
        second.rerender(<AutoSoundEffectsToggle backendUrl="http://backend" active onlyWhenApiBackend />);
        await waitFor(() => expect(toggle().checked).toBe(true));
        stored = false;
        second.rerender(<AutoSoundEffectsToggle backendUrl="http://backend" active={false} onlyWhenApiBackend />);
        second.rerender(<AutoSoundEffectsToggle backendUrl="http://backend" active onlyWhenApiBackend />);
        await waitFor(() => expect(toggle().checked).toBe(false));
    });

    it('保存に失敗したらトグルが元の位置へ戻り、失敗が表示される', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.mocked(setApiServiceAutoSoundEffects).mockRejectedValueOnce(new Error('save failed'));
        render(<AutoSoundEffectsToggle backendUrl="http://backend" service="novelai" active />);
        await waitFor(() => expect(getComfyUIConfig).toHaveBeenCalled());

        await userEvent.click(await screen.findByRole('checkbox'));
        await waitFor(() => expect(screen.getByText(API_SERVICE.MESSAGES.AUTO_SOUND_EFFECTS_SAVE_FAILED)).toBeTruthy());
        expect(toggle().checked).toBe(false);
        expect(stored).toBe(false);
    });

    it('API サービスを選んでいるときだけ出す指定では、ComfyUI 連携のときに出さない', async () => {
        backend = 'comfyui';
        render(<AutoSoundEffectsToggle backendUrl="http://backend" active onlyWhenApiBackend />);
        await waitFor(() => expect(getComfyUIConfig).toHaveBeenCalled());
        expect(screen.queryByTestId('auto-sound-effects-toggle')).toBeNull();
    });

    it('説明文と注意書きは、添える指定のときだけ出す', async () => {
        const view = render(<AutoSoundEffectsToggle backendUrl="http://backend" service="novelai" active showHelp />);
        await screen.findByRole('checkbox');
        await waitFor(() => expect(getComfyUIConfig).toHaveBeenCalled());
        expect(screen.getByText(API_SERVICE.HELP.AUTO_SOUND_EFFECTS)).toBeTruthy();
        expect(screen.getByText(API_SERVICE.HELP.AUTO_SOUND_EFFECTS_NOTE)).toBeTruthy();
        view.unmount();

        render(<AutoSoundEffectsToggle backendUrl="http://backend" service="novelai" active />);
        await waitFor(() => expect(getComfyUIConfig).toHaveBeenCalledTimes(2));
        expect(screen.queryByText(API_SERVICE.HELP.AUTO_SOUND_EFFECTS)).toBeNull();
    });

    it('V5 の Full と Curated だけに表示し、非表示の間も保存値を保つ', async () => {
        stored = true;
        const props = { backendUrl: 'http://backend', active: true, source: config() };
        const view = render(<AutoSoundEffectsToggle {...props} modelId="nai-diffusion-5-full" />);
        expect(await screen.findByRole('checkbox')).toBeChecked();
        for (const modelId of ['nai-diffusion-4-5-full', 'nai-diffusion-4-5-curated', 'unknown', '']) {
            view.rerender(<AutoSoundEffectsToggle {...props} modelId={modelId} />);
            expect(screen.queryByRole('checkbox')).toBeNull();
        }
        view.rerender(<AutoSoundEffectsToggle {...props} modelId="nai-diffusion-5-curated" />);
        expect(await screen.findByRole('checkbox')).toBeChecked();
        expect(setApiServiceAutoSoundEffects).not.toHaveBeenCalled();
    });

    it('左メニュー用の保存済み設定でも V4.5 では表示しない', async () => {
        const source = config();
        source.apiServiceSettings!.novelai!.model = 'nai-diffusion-4-5-full';
        const view = render(<AutoSoundEffectsToggle backendUrl="http://backend" active source={source} onlyWhenApiBackend />);
        await act(async () => {});
        expect(screen.queryByRole('checkbox')).toBeNull();
        view.rerender(<AutoSoundEffectsToggle backendUrl="http://backend" active source={config()} onlyWhenApiBackend />);
        expect(await screen.findByRole('checkbox')).toBeTruthy();
    });
});
