import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MODULE_COMFY, fetchModulesStatus, type ModuleStatusEntry } from '../api/sponsor';
import { FEATURE_COMFYUI, isImageGenAvailable } from '../constants/features';
import { COMFY_MODULE_STATUS_POLL_INTERVAL_MS, useComfyModuleActive } from './useComfyModuleActive';

vi.mock('../api/sponsor', async importOriginal => ({
    ...(await importOriginal<typeof import('../api/sponsor')>()),
    fetchModulesStatus: vi.fn(),
}));

const comfyStatus = (active: boolean) => [{ id: MODULE_COMFY, active } as ModuleStatusEntry];

// 画像生成設定（容姿プロンプト作成を含む）の表示条件へフックの値を通して確かめる。
const imageGenVisible = (active: boolean) => isImageGenAvailable({ [FEATURE_COMFYUI]: true }, active);

// 保留中の取得（Promise）を解決させる。
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
const nextPoll = () => act(async () => { await vi.advanceTimersByTimeAsync(COMFY_MODULE_STATUS_POLL_INTERVAL_MS); });

describe('ComfyUI モジュール稼働状態の追随', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('初回が停止中でも次の確認で稼働中になれば画像生成設定を表示する', async () => {
        vi.mocked(fetchModulesStatus)
            .mockResolvedValueOnce(comfyStatus(false))
            .mockResolvedValueOnce(comfyStatus(true));
        const { result } = renderHook(() => useComfyModuleActive('', true));
        await flush();
        expect(imageGenVisible(result.current[0])).toBe(false);
        await nextPoll();
        expect(imageGenVisible(result.current[0])).toBe(true);
    });

    it('初回が稼働中でも次の確認で停止していれば画像生成設定を隠す', async () => {
        vi.mocked(fetchModulesStatus)
            .mockResolvedValueOnce(comfyStatus(true))
            .mockResolvedValueOnce(comfyStatus(false));
        const { result } = renderHook(() => useComfyModuleActive('', true));
        await flush();
        expect(imageGenVisible(result.current[0])).toBe(true);
        await nextPoll();
        expect(imageGenVisible(result.current[0])).toBe(false);
    });

    it('状態取得に失敗したら画像生成設定を隠す', async () => {
        vi.mocked(fetchModulesStatus)
            .mockResolvedValueOnce(comfyStatus(true))
            .mockRejectedValueOnce(new Error('network'));
        const { result } = renderHook(() => useComfyModuleActive('', true));
        await flush();
        expect(result.current[0]).toBe(true);
        await nextPoll();
        expect(imageGenVisible(result.current[0])).toBe(false);
    });

    it('ComfyUI 機能が無効なら状態を確認せず、無効になった後は確認を止める', async () => {
        vi.mocked(fetchModulesStatus).mockResolvedValue(comfyStatus(true));
        const { result, rerender } = renderHook(({ enabled }) => useComfyModuleActive('', enabled), {
            initialProps: { enabled: false },
        });
        await nextPoll();
        expect(fetchModulesStatus).not.toHaveBeenCalled();
        expect(result.current[0]).toBe(false);

        rerender({ enabled: true });
        await flush();
        expect(result.current[0]).toBe(true);
        rerender({ enabled: false });
        const calls = vi.mocked(fetchModulesStatus).mock.calls.length;
        await nextPoll();
        await nextPoll();
        expect(fetchModulesStatus).toHaveBeenCalledTimes(calls);
        expect(result.current[0]).toBe(false);
    });

    it('破棄後は状態を確認しない', async () => {
        vi.mocked(fetchModulesStatus).mockResolvedValue(comfyStatus(true));
        const { unmount } = renderHook(() => useComfyModuleActive('', true));
        await flush();
        unmount();
        const calls = vi.mocked(fetchModulesStatus).mock.calls.length;
        await nextPoll();
        document.dispatchEvent(new Event('visibilitychange'));
        await flush();
        expect(fetchModulesStatus).toHaveBeenCalledTimes(calls);
    });

    it('先に始めた取得の応答が遅れて届いても新しい状態を上書きしない', async () => {
        let resolveFirst: (modules: ModuleStatusEntry[]) => void = () => {};
        vi.mocked(fetchModulesStatus)
            .mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }))
            .mockResolvedValueOnce(comfyStatus(true));
        const { result } = renderHook(() => useComfyModuleActive('', true));
        // 取得 A（初回）は保留したまま、画面の再表示で取得 B を始めて active:true で完了させる。
        document.dispatchEvent(new Event('visibilitychange'));
        await flush();
        expect(result.current[0]).toBe(true);
        // 取得 A が active:false で遅れて完了しても true のまま。
        await act(async () => { resolveFirst(comfyStatus(false)); });
        await flush();
        expect(result.current[0]).toBe(true);
    });

    it('画面が再び表示されたら間隔を待たずに取り直す', async () => {
        vi.mocked(fetchModulesStatus)
            .mockResolvedValueOnce(comfyStatus(false))
            .mockResolvedValueOnce(comfyStatus(true));
        const { result } = renderHook(() => useComfyModuleActive('', true));
        await flush();
        expect(result.current[0]).toBe(false);
        document.dispatchEvent(new Event('visibilitychange'));
        await flush();
        expect(result.current[0]).toBe(true);
    });
});
