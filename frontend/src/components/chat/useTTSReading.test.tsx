import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../../api/tts';
import type { TTSAudioIndex, TTSConfig, TTSReadResponse, TTSStatusResponse } from '../../api/tts';
import { fetchJobs } from '../../api/jobs';
import type { JobsResponse } from '../../api/jobs';
import { useTTSReading } from './useTTSReading';
import type { TTSPlaylistEntry } from './useTTSReading';

vi.mock('../../api/tts', async importOriginal => ({
    ...await importOriginal<typeof api>(),
    getTTSConfig: vi.fn(),
    startTTSRead: vi.fn(),
    fetchTTSAudioIndex: vi.fn(),
    fetchTTSStatus: vi.fn(),
    resolveAuthedAudioUrl: vi.fn(async (url: string) => url),
    releaseAuthedAudioUrl: vi.fn(),
    cancelTTSJob: vi.fn(async () => {}),
}));
vi.mock('../../api/jobs', () => ({ fetchJobs: vi.fn() }));

// 音声の実時間に依存せず、発言ごとに再生終了を指示する。
class TestAudio {
    static instances: TestAudio[] = [];
    static played: string[] = [];
    onended?: () => void;
    onpause?: () => void;
    onerror?: () => void;
    volume = 1;
    readonly src: string;
    constructor(src: string) { this.src = src; TestAudio.instances.push(this); }
    play = vi.fn(async () => { TestAudio.played.push(this.src); });
    pause = vi.fn(() => this.onpause?.());
}

const SESSION = 'tts-test-session';
const FIRST = 'response-first';
const SECOND = 'response-second';
const THIRD = 'response-third';
const A = 'turn-a';
const B = 'turn-b';
const C = 'turn-c';
const D = 'turn-d';
let playlist: TTSPlaylistEntry[];
let audioIndex: TTSAudioIndex;
let config: TTSConfig;
let statuses: Map<string, TTSStatusResponse>;
const jobId = (messageId: string, turnId?: string) => `${messageId}/${turnId ?? 'all'}`;
const path = (messageId: string, turnId = A) => api.ttsFinalAudioPath('', SESSION, messageId, turnId);
const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};
const addAudio = (messageId: string, turnId = A) => {
    audioIndex.entries[api.ttsTurnKey(messageId, turnId)] = {
        messageId, turnId, file: path(messageId, turnId), format: 'wav',
        voiceId: 'test-voice', createdAt: '', durationSeconds: 1,
    };
};
const renderReading = () => renderHook(({ sessionId }) =>
    useTTSReading('', sessionId, true, undefined, () => playlist),
{ initialProps: { sessionId: SESSION } });
const flush = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(0); }); };
const tick = async () => { await act(async () => { await vi.advanceTimersToNextTimerAsync(); }); };
const endAudio = async () => {
    await act(async () => { TestAudio.instances.at(-1)?.onended?.(); });
    await flush();
};

describe('TTS通し再生の生成待ちと予約引き継ぎ', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal('Audio', TestAudio);
        TestAudio.instances = [];
        TestAudio.played = [];
        playlist = [FIRST, SECOND, THIRD].map(messageId => ({ messageId, turnIds: [A] }));
        audioIndex = { version: 1, entries: {} };
        statuses = new Map();
        config = {
            autoReadEnabled: true, autoReadPlaybackEnabled: true, autoAdvanceEnabled: true,
            sequentialPlayback: false, volume: 1, turnGapSeconds: 0,
        } as TTSConfig;
        vi.mocked(api.getTTSConfig).mockImplementation(async () => config);
        vi.mocked(api.fetchTTSAudioIndex).mockImplementation(async () => ({
            ...audioIndex, entries: { ...audioIndex.entries },
        }));
        vi.mocked(api.startTTSRead).mockImplementation(async (_url, body) => ({ jobId: jobId(body.messageId, body.turnId) }));
        vi.mocked(api.fetchTTSStatus).mockImplementation(async (_url, id) =>
            statuses.get(id) ?? { jobId: id, status: 'processing', progress: [] });
        vi.mocked(fetchJobs).mockResolvedValue({ jobs: [] } as unknown as JobsResponse);
    });
    afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

    it('自動継続で読み終えた応答を待機中の全体再生予約から繰り返さない', async () => {
        [FIRST, SECOND, THIRD].forEach(m => addAudio(m));
        const { result } = renderReading();
        await act(async () => { await result.current.readMessage(FIRST); });
        await act(async () => { await result.current.readMessage(SECOND); });
        await act(async () => { await result.current.readMessage(THIRD, true); });
        await endAudio();
        await endAudio();
        await endAudio();
        expect(TestAudio.played).toEqual([path(FIRST), path(SECOND), path(THIRD)]);
        expect(result.current.sequenceActive).toBe(false);
    });

    it('応答境界を越えて歯抜けを飛ばし、後ろの完成音声より前の生成を待つ', async () => {
        playlist[1].turnIds = [A, B, C, D];
        addAudio(FIRST); addAudio(SECOND); addAudio(SECOND, D);
        const { result } = renderReading();
        await act(async () => { await result.current.start(SECOND, C, { playback: false }); });
        act(() => result.current.startSequence(FIRST, playlist, { autoAdvance: true, mode: 'queue' }));
        await flush();
        await endAudio();
        await endAudio();
        expect(TestAudio.played).toEqual([path(FIRST), path(SECOND)]);
        expect(result.current.sequenceActive).toBe(true);
        act(() => result.current.startSequence(SECOND, playlist, { autoAdvance: true, mode: 'queue' }));
        addAudio(SECOND, C);
        await tick();
        expect(TestAudio.played.at(-1)).toBe(path(SECOND, C));
        await endAudio();
        expect(TestAudio.played.at(-1)).toBe(path(SECOND, D));
        await endAudio();
        expect(result.current.sequenceActive).toBe(false);
        expect(TestAudio.played).toEqual([path(FIRST), path(SECOND), path(SECOND, C), path(SECOND, D)]);
    });

    it('後ろに完成音声がなくても生成予定があれば待つ', async () => {
        playlist[1].turnIds = [A, B];
        addAudio(FIRST);
        const { result } = renderReading();
        await act(async () => { await result.current.start(SECOND, B, { playback: false }); });
        act(() => result.current.startSequence(FIRST, playlist, { autoAdvance: true, mode: 'queue' }));
        await flush(); await endAudio();
        expect(result.current.sequenceActive).toBe(true);
        addAudio(SECOND, B);
        await tick();
        expect(TestAudio.played).toEqual([path(FIRST), path(SECOND, B)]);
    });

    it('自動継続OFFでは同じ応答の穴を飛ばし、別の応答は独立した予約として再生する', async () => {
        config.autoAdvanceEnabled = false;
        playlist[0].turnIds = [A, B, C];
        addAudio(FIRST); addAudio(FIRST, C); addAudio(SECOND); addAudio(THIRD);
        const { result } = renderReading();
        act(() => result.current.startSequence(FIRST, playlist, { autoAdvance: false, mode: 'queue' }));
        await flush();
        await act(async () => { await result.current.readMessage(THIRD, true); });
        await act(async () => { await result.current.readMessage(SECOND); });
        await endAudio(); await endAudio(); await endAudio(); await endAudio();
        expect(TestAudio.played).toEqual([path(FIRST), path(FIRST, C), path(THIRD), path(SECOND)]);
        expect(result.current.sequenceActive).toBe(false);
    });

    it('自動継続OFFで後続予約がなければ応答末尾で終了する', async () => {
        addAudio(FIRST); addAudio(SECOND);
        const { result } = renderReading();
        act(() => result.current.startSequence(FIRST, playlist, { autoAdvance: false, mode: 'queue' }));
        await flush(); await endAudio();
        expect(TestAudio.played).toEqual([path(FIRST)]);
        expect(result.current.sequenceActive).toBe(false);
    });

    it('生成要求の通信中は追い越さず、予約への引き継ぎでも巻き戻らない', async () => {
        const response = deferred<TTSReadResponse>();
        vi.mocked(api.startTTSRead).mockReturnValueOnce(response.promise);
        addAudio(FIRST); addAudio(THIRD);
        const { result } = renderReading();
        act(() => result.current.startSequence(FIRST, playlist, { autoAdvance: true, mode: 'queue' }));
        await flush();
        act(() => { void result.current.readMessage(SECOND, true); });
        await flush(); await endAudio();
        expect(TestAudio.played).toEqual([path(FIRST)]);
        addAudio(SECOND);
        await act(async () => { response.resolve({ empty: true }); });
        await tick(); await endAudio(); await endAudio();
        expect(TestAudio.played).toEqual([path(FIRST), path(SECOND), path(THIRD)]);
    });

    it('設定取得が遅れている間に再生が進んでも同じ予約で再生し直さない', async () => {
        addAudio(FIRST); addAudio(SECOND);
        const { result } = renderReading();
        act(() => result.current.startSequence(FIRST, playlist, { autoAdvance: true, mode: 'queue' }));
        await flush();
        const response = deferred<TTSConfig>();
        vi.mocked(api.getTTSConfig).mockReturnValueOnce(response.promise);
        vi.mocked(api.startTTSRead).mockResolvedValue({ empty: true });
        act(() => { void result.current.readMessage(SECOND, true); });
        await endAudio(); await endAudio();
        await act(async () => { response.resolve(config); });
        await flush();
        expect(TestAudio.played).toEqual([path(FIRST), path(SECOND)]);
        expect(result.current.sequenceActive).toBe(false);
    });

    it('一部再生済みの応答の予約を未再生の発言へ引き継ぐ', async () => {
        playlist[1].turnIds = [A, B];
        addAudio(SECOND); addAudio(SECOND, B);
        const { result } = renderReading();
        act(() => result.current.startSequence(SECOND, playlist, {
            autoAdvance: false, mode: 'queue', startTurnId: B,
        }));
        await flush();
        act(() => result.current.startSequence(SECOND, playlist, { autoAdvance: false, mode: 'queue' }));
        await endAudio(); await endAudio();
        expect(TestAudio.played).toEqual([path(SECOND, B), path(SECOND)]);
    });

    it.each(['completed', 'error', 'canceled'] as const)('生成の終端 %s で未完成の発言の待機を解消する', async status => {
        addAudio(FIRST); addAudio(THIRD);
        const { result } = renderReading();
        await act(async () => { await result.current.start(SECOND, A, { playback: false }); });
        act(() => result.current.startSequence(FIRST, playlist, { autoAdvance: true, mode: 'queue' }));
        await flush(); await endAudio();
        const id = jobId(SECOND, A);
        statuses.set(id, { jobId: id, status });
        await tick();
        expect(TestAudio.played).toEqual([path(FIRST), path(THIRD)]);
    });

    it('全体生成中でも対象外通知の発言では待たず、次の生成を待つ', async () => {
        playlist[1].turnIds = [A, B];
        addAudio(FIRST);
        const { result } = renderReading();
        await act(async () => { await result.current.start(SECOND, undefined, { playback: false }); });
        const id = jobId(SECOND);
        statuses.set(id, { jobId: id, status: 'processing', progress: [
            { seq: 1, kind: 'text', textKey: 'tts.skipped', args: [A, 'voiceUnresolved'] },
        ] });
        act(() => result.current.startSequence(FIRST, playlist, { autoAdvance: true, mode: 'queue' }));
        await flush(); await endAudio();
        addAudio(SECOND, B);
        await tick();
        expect(TestAudio.played).toEqual([path(FIRST), path(SECOND, B)]);
    });

    it('再生開始後に追加された応答と自動再生予約を一度ずつ再生する', async () => {
        playlist = [{ messageId: FIRST, turnIds: [A] }];
        addAudio(FIRST);
        const { result, rerender } = renderReading();
        act(() => result.current.startSequence(FIRST, playlist, { autoAdvance: true, mode: 'queue' }));
        await flush();
        playlist = [...playlist, { messageId: SECOND, turnIds: [A] }];
        rerender({ sessionId: SESSION });
        await act(async () => { await result.current.readMessage(SECOND, true); });
        await endAudio();
        expect(TestAudio.played).toEqual([path(FIRST)]);
        addAudio(SECOND);
        await tick(); await endAudio();
        expect(TestAudio.played).toEqual([path(FIRST), path(SECOND)]);
        expect(result.current.sequenceActive).toBe(false);
    });

    it('完了後に改めて指定した全体再生は先頭から再生する', async () => {
        addAudio(FIRST);
        const { result } = renderReading();
        const play = () => result.current.startSequence(FIRST, playlist, { autoAdvance: false, mode: 'queue' });
        act(play); await flush(); await endAudio();
        act(play); await flush();
        expect(TestAudio.played).toEqual([path(FIRST), path(FIRST)]);
    });

    it('後続応答を再生中でも、読み終えた応答の手動再生は新しい要求として扱う', async () => {
        addAudio(FIRST); addAudio(SECOND);
        const { result } = renderReading();
        act(() => result.current.startSequence(FIRST, playlist, { autoAdvance: true, mode: 'queue' }));
        await flush(); await endAudio();
        act(() => result.current.startSequence(FIRST, playlist, { autoAdvance: false, mode: 'queue' }));
        await endAudio();
        expect(TestAudio.played).toEqual([path(FIRST), path(SECOND), path(FIRST)]);
    });

    it('設定取得中の未完成発言も生成予定として待つ', async () => {
        addAudio(FIRST); addAudio(THIRD);
        const { result } = renderReading();
        act(() => result.current.startSequence(FIRST, playlist, { autoAdvance: true, mode: 'queue' }));
        await flush();
        const response = deferred<TTSConfig>();
        vi.mocked(api.getTTSConfig).mockReturnValueOnce(response.promise);
        act(() => { void result.current.readMessage(SECOND, true); });
        await endAudio();
        expect(TestAudio.played).toEqual([path(FIRST)]);
        await act(async () => { response.resolve(config); });
        await tick();
        expect(TestAudio.played).toEqual([path(FIRST)]);
        addAudio(SECOND);
        await tick();
        expect(TestAudio.played.at(-1)).toBe(path(SECOND));
    });

    it('生成開始前のキャンセルでは生成要求を送らず待機を残さない', async () => {
        const response = deferred<TTSConfig>();
        vi.mocked(api.getTTSConfig).mockReturnValueOnce(response.promise);
        const { result } = renderReading();
        act(() => { void result.current.readMessage(FIRST); });
        act(() => result.current.cancel(`msg:${FIRST}`));
        await act(async () => { response.resolve(config); });
        expect(api.startTTSRead).not.toHaveBeenCalled();
        expect(result.current.activeMessageIds.size).toBe(0);
        expect(TestAudio.played).toEqual([]);
    });

    it('生成要求の通信中のキャンセルは返却されたジョブにも伝える', async () => {
        const response = deferred<TTSReadResponse>();
        vi.mocked(api.startTTSRead).mockReturnValueOnce(response.promise);
        const { result } = renderReading();
        act(() => { void result.current.readMessage(FIRST); });
        await flush();
        act(() => result.current.cancel(`msg:${FIRST}`));
        await act(async () => { response.resolve({ jobId: jobId(FIRST) }); });
        expect(api.cancelTTSJob).toHaveBeenCalledWith('', jobId(FIRST));
        await flush();
        await tick();
        expect(TestAudio.played).toEqual([]);
        expect(result.current.sequenceActive).toBe(false);
    });

    it('同じ応答の生成開始を通信中に二重送信しない', async () => {
        const response = deferred<TTSConfig>();
        vi.mocked(api.getTTSConfig).mockReturnValueOnce(response.promise);
        const { result } = renderReading();
        act(() => { void result.current.readMessage(FIRST); });
        await act(async () => { await result.current.readMessage(FIRST); });
        await act(async () => { response.resolve(config); });
        expect(api.startTTSRead).toHaveBeenCalledTimes(1);
    });

    it('重複応答で既存ジョブを引き取り、生成完了を待つ', async () => {
        vi.mocked(api.startTTSRead).mockResolvedValueOnce({ duplicate: true, existingJobId: jobId(FIRST) });
        const { result } = renderReading();
        await act(async () => { await result.current.readMessage(FIRST); });
        await flush();
        expect(result.current.activeMessageIds.has(FIRST)).toBe(true);
        expect(TestAudio.played).toEqual([]);
        addAudio(FIRST);
        await tick();
        expect(TestAudio.played).toEqual([path(FIRST)]);
    });

    it('音声取得中の停止後に再生を開始しない', async () => {
        addAudio(FIRST);
        const response = deferred<string>();
        vi.mocked(api.resolveAuthedAudioUrl).mockReturnValueOnce(response.promise);
        const { result } = renderReading();
        act(() => result.current.startSequence(FIRST, playlist, { autoAdvance: true, mode: 'queue' }));
        await flush();
        act(() => result.current.stopPlayback());
        await act(async () => { response.resolve(path(FIRST)); });
        expect(TestAudio.played).toEqual([]);
    });

    it.each(['stop', 'session'] as const)('設定通信中の %s 後に音声が再開しない', async action => {
        addAudio(FIRST);
        const response = deferred<TTSConfig>();
        vi.mocked(api.getTTSConfig).mockReturnValueOnce(response.promise);
        const { result, rerender } = renderReading();
        act(() => { void result.current.readMessage(FIRST); });
        if (action === 'stop') act(() => result.current.stopPlayback());
        else rerender({ sessionId: 'other-session' });
        await act(async () => { response.resolve(config); });
        await flush();
        expect(TestAudio.played).toEqual([]);
        expect(result.current.sequenceActive).toBe(false);
        if (action === 'stop') expect(api.startTTSRead).toHaveBeenCalled();
        else expect(api.startTTSRead).not.toHaveBeenCalled();
    });

    it('生成要求の通信中に停止しても生成は継続し、後から再生しない', async () => {
        const response = deferred<TTSReadResponse>();
        vi.mocked(api.startTTSRead).mockReturnValueOnce(response.promise);
        const { result } = renderReading();
        act(() => { void result.current.readMessage(FIRST); });
        await flush();
        act(() => result.current.stopPlayback());
        addAudio(FIRST);
        await act(async () => { response.resolve({ jobId: jobId(FIRST) }); });
        await tick();
        expect(TestAudio.played).toEqual([]);
        expect(result.current.activeMessageIds.has(FIRST)).toBe(true);
    });

    it('生成要求失敗で待機を解消する', async () => {
        const response = deferred<TTSReadResponse>();
        vi.mocked(api.startTTSRead).mockReturnValueOnce(response.promise);
        vi.spyOn(console, 'error').mockImplementation(() => {});
        addAudio(SECOND);
        const { result } = renderReading();
        act(() => { void result.current.readMessage(FIRST); });
        await flush();
        await act(async () => { response.reject(new Error('request failed')); });
        await tick();
        expect(TestAudio.played).toEqual([path(SECOND)]);
        expect(result.current.activeMessageIds.size).toBe(0);
    });

    it('自動読み上げOFFでは生成せず、自動再生OFFでは生成だけ行う', async () => {
        addAudio(FIRST);
        config.autoReadEnabled = false;
        const { result } = renderReading();
        await act(async () => { await result.current.readMessage(FIRST, true); });
        expect(api.startTTSRead).not.toHaveBeenCalled();
        config.autoReadEnabled = true;
        config.autoReadPlaybackEnabled = false;
        await act(async () => { await result.current.readMessage(FIRST, true); });
        expect(api.startTTSRead).toHaveBeenCalled();
        expect(TestAudio.played).toEqual([]);
    });
});
