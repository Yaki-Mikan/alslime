import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MODULE_COMFY, MODULE_TTS, fetchModulesStatus, type ModuleStatusEntry } from '../api/sponsor';
import { TTS_MODULE_STATUS_POLL_INTERVAL_MS, useTTSModuleActive } from './useTTSModuleActive';

vi.mock('../api/sponsor', async importOriginal => ({
    ...(await importOriginal<typeof import('../api/sponsor')>()),
    fetchModulesStatus: vi.fn(),
}));

const ttsStatus = (active: boolean) => [{ id: MODULE_TTS, active } as ModuleStatusEntry];

// 保留中の取得（Promise）を解決させる。
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
const nextPoll = () => act(async () => { await vi.advanceTimersByTimeAsync(TTS_MODULE_STATUS_POLL_INTERVAL_MS); });

describe('TTS モジュール稼働状態の追随', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('初回が停止中でも次の確認で稼働中になれば稼働中を返す', async () => {
        vi.mocked(fetchModulesStatus)
            .mockResolvedValueOnce(ttsStatus(false))
            .mockResolvedValueOnce(ttsStatus(true));
        const { result } = renderHook(() => useTTSModuleActive('', true));
        await flush();
        expect(result.current[0]).toBe(false);
        await nextPoll();
        expect(result.current[0]).toBe(true);
    });

    it('初回が稼働中でも次の確認で停止していれば停止を返す', async () => {
        vi.mocked(fetchModulesStatus)
            .mockResolvedValueOnce(ttsStatus(true))
            .mockResolvedValueOnce(ttsStatus(false));
        const { result } = renderHook(() => useTTSModuleActive('', true));
        await flush();
        expect(result.current[0]).toBe(true);
        await nextPoll();
        expect(result.current[0]).toBe(false);
    });

    it('ComfyUI モジュールだけが稼働中なら TTS は停止として扱う', async () => {
        vi.mocked(fetchModulesStatus).mockResolvedValue([{ id: MODULE_COMFY, active: true } as ModuleStatusEntry]);
        const { result } = renderHook(() => useTTSModuleActive('', true));
        await flush();
        expect(result.current[0]).toBe(false);
    });

    it('状態取得に失敗したら停止を返す', async () => {
        vi.mocked(fetchModulesStatus)
            .mockResolvedValueOnce(ttsStatus(true))
            .mockRejectedValueOnce(new Error('network'));
        const { result } = renderHook(() => useTTSModuleActive('', true));
        await flush();
        expect(result.current[0]).toBe(true);
        await nextPoll();
        expect(result.current[0]).toBe(false);
    });

    it('TTS 機能が無効なら状態を確認せず、無効になった後は確認を止める', async () => {
        vi.mocked(fetchModulesStatus).mockResolvedValue(ttsStatus(true));
        const { result, rerender } = renderHook(({ enabled }) => useTTSModuleActive('', enabled), {
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
        vi.mocked(fetchModulesStatus).mockResolvedValue(ttsStatus(true));
        const { unmount } = renderHook(() => useTTSModuleActive('', true));
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
            .mockResolvedValueOnce(ttsStatus(true));
        const { result } = renderHook(() => useTTSModuleActive('', true));
        // 取得 A（初回）は保留したまま、画面の再表示で取得 B を始めて active:true で完了させる。
        document.dispatchEvent(new Event('visibilitychange'));
        await flush();
        expect(result.current[0]).toBe(true);
        // 取得 A が active:false で遅れて完了しても true のまま。
        await act(async () => { resolveFirst(ttsStatus(false)); });
        await flush();
        expect(result.current[0]).toBe(true);
    });

    it('画面が再び表示されたら間隔を待たずに取り直す', async () => {
        vi.mocked(fetchModulesStatus)
            .mockResolvedValueOnce(ttsStatus(false))
            .mockResolvedValueOnce(ttsStatus(true));
        const { result } = renderHook(() => useTTSModuleActive('', true));
        await flush();
        expect(result.current[0]).toBe(false);
        document.dispatchEvent(new Event('visibilitychange'));
        await flush();
        expect(result.current[0]).toBe(true);
    });
});
