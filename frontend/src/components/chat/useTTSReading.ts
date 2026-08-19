/**
 * useTTSReading.ts - 読み上げ実行の状態管理フック
 *
 * 読み上げ開始（TURN単位／1応答全体）→ ステータスポーリング（2秒間隔）→
 * tts.chunk / tts.merged の解釈 → 逐次再生（ttsPlayer）→ 終端処理、を担う。
 * 画面更新後は実行中ジョブを検出してボタン状態を復元する
 * （要件により再生は自動で再開しない。ポーリングと表示のみ）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
    cancelTTSJob,
    deleteTTSMessageAudio,
    fetchAudioObjectUrlOnce,
    fetchTTSAudioIndex,
    fetchTTSStatus,
    getTTSConfig,
    resolveAuthedAudioUrl,
    releaseAuthedAudioUrl,
    startTTSRead,
    ttsChunkAudioPath,
    ttsFinalAudioPath,
    ttsTurnKey,
} from '../../api/tts';
import type { TTSAudioIndex, TTSConfig, TTSPresetVoiceDesign } from '../../api/tts';
import { fetchJobs } from '../../api/jobs';
import { TTSPlaybackController } from '../../lib/ttsPlayer';

// 実行対象キー（ボタン状態の判定に使う）。
export const ttsTurnActiveKey = (messageId: string, turnId: string) => `turn:${messageId}:${turnId}`;
export const ttsMessageActiveKey = (messageId: string) => `msg:${messageId}`;

export interface TTSNotice {
    targetKey: string;
    reason: string;
}

// TTSPlaylistEntry は通し再生の対象（agent メッセージ順の TURN 列）。
export interface TTSPlaylistEntry {
    messageId: string;
    turnIds: string[];
}

export interface TTSReadingState {
    index: TTSAudioIndex | null;
    activeKey: string | null;
    cancelling: boolean;
    notice: TTSNotice | null;
    playingFinalKey: string | null;
    // sequenceActive は通し再生（応答ひと塊の先頭からの再生）の実行中フラグ。
    sequenceActive: boolean;
    // sequenceCurrentKey は通し再生で今鳴っている TURN のキー（turn:...）。待機中は null。
    sequenceCurrentKey: string | null;
    // start は生成ジョブの開始確定（サーバー応答とジョブ参照のセット）まで待てる。
    // 通し再生（startSequence）を続けて呼ぶ場合は await しないと、ジョブ参照が
    // 空のままの先頭TURN判定が「音声なし確定」へ誤って倒れる。
    start: (messageId: string, turnId?: string, opts?: { playback?: boolean }) => Promise<void>;
    cancel: () => void;
    playFinal: (messageId: string, turnId: string) => void;
    stopFinal: () => void;
    // startSequence は startMessageId の応答ひと塊を先頭TURN（startTurnId 指定時はそのTURN）
    // から通しで再生する。autoAdvance が真なら応答の区切りを超えて、生成済みの次の音声も
    // 続けて再生する。
    startSequence: (startMessageId: string, playlist: TTSPlaylistEntry[], autoAdvance: boolean, startTurnId?: string) => void;
    // stopPlayback は全ての再生を止める（生成ジョブは止めない）。
    stopPlayback: () => void;
    // deleteMessageAudio は1応答（メッセージ）分の生成音声を削除する（要件10章）。
    // 失敗時は false を返す（呼び出し側が通知を出す）。
    deleteMessageAudio: (messageId: string) => Promise<boolean>;
}

const POLL_INTERVAL_MS = 2000;
const NOTICE_MS = 2500;

export function useTTSReading(
    backendUrl: string,
    sessionId: string | null,
    enabled: boolean,
    // 読み上げ開始時に同梱する会話設定側VoiceDesign（キーはキャラクター名。要件6.5）。
    getPresetVoiceDesign?: () => Record<string, TTSPresetVoiceDesign> | undefined,
): TTSReadingState {
    const [index, setIndex] = useState<TTSAudioIndex | null>(null);
    const [activeKey, setActiveKey] = useState<string | null>(null);
    const [cancelling, setCancelling] = useState(false);
    const [notice, setNotice] = useState<TTSNotice | null>(null);
    const [playingFinalKey, setPlayingFinalKey] = useState<string | null>(null);
    // 通し再生（P3拡張: 応答ひと塊の先頭からのプレイリスト再生）。
    const [sequenceActive, setSequenceActive] = useState(false);
    const [sequenceCurrentKey, setSequenceCurrentKey] = useState<string | null>(null);
    const sequenceTokenRef = useRef(0);
    const sequenceAudioRef = useRef<HTMLAudioElement | null>(null);

    const disposedRef = useRef(false);
    // ポーリングの連続失敗回数。一時的な取得失敗で即終了すると未再生キューが
    // 破棄され再生が途切れるため、しきい値までは再試行する。
    const pollFailuresRef = useRef(0);
    const jobRef = useRef<{ jobId: string; messageId: string; turnId: string; format: string; restored: boolean } | null>(null);
    const playerRef = useRef<TTSPlaybackController | null>(null);
    const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const seenSeqRef = useRef<Set<number>>(new Set());
    const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const finalAudioRef = useRef<HTMLAudioElement | null>(null);
    const configRef = useRef<TTSConfig | null>(null);

    const showNotice = useCallback((targetKey: string, reason: string) => {
        if (noticeTimerRef.current !== null) clearTimeout(noticeTimerRef.current);
        setNotice({ targetKey, reason });
        noticeTimerRef.current = setTimeout(() => setNotice(null), NOTICE_MS);
    }, []);

    const refreshIndex = useCallback(async () => {
        if (!enabled || !sessionId) return;
        try {
            const idx = await fetchTTSAudioIndex(backendUrl, sessionId);
            if (!disposedRef.current) setIndex(idx);
        } catch (error) {
            console.error('[useTTSReading] index load failed:', error);
        }
    }, [backendUrl, sessionId, enabled]);

    const stopPolling = useCallback(() => {
        if (pollTimerRef.current !== null) {
            clearTimeout(pollTimerRef.current);
            pollTimerRef.current = null;
        }
    }, []);

    const finishJob = useCallback((status: 'completed' | 'error' | 'canceled') => {
        stopPolling();
        const player = playerRef.current;
        if (player) {
            if (status === 'completed') {
                player.finish();
            } else {
                player.stop();
            }
        }
        playerRef.current = null;
        jobRef.current = null;
        seenSeqRef.current = new Set();
        setActiveKey(null);
        setCancelling(false);
        void refreshIndex();
    }, [refreshIndex, stopPolling]);

    const pollOnce = useCallback(async () => {
        const job = jobRef.current;
        if (!job || disposedRef.current || !sessionId) return;
        try {
            const status = await fetchTTSStatus(backendUrl, job.jobId);
            pollFailuresRef.current = 0;
            for (const entry of status.progress ?? []) {
                if (seenSeqRef.current.has(entry.seq)) continue;
                seenSeqRef.current.add(entry.seq);
                const args = entry.args ?? [];
                if (entry.textKey === 'tts.chunk' && args.length >= 4 && playerRef.current) {
                    const [messageId, turnId, chunkIndex, format] = args;
                    const url = ttsChunkAudioPath(backendUrl, sessionId, messageId, turnId, Number(chunkIndex), format);
                    try {
                        // チャンクは再作成のたびに中身が変わる使い捨てのため共有キャッシュへ載せない
                        //（旧チャンクの再生を防ぐ）。解放はプレイヤーが再生終了・停止時に行う。
                        const objectUrl = await fetchAudioObjectUrlOnce(url);
                        if (playerRef.current) {
                            playerRef.current.enqueue(objectUrl);
                        } else {
                            URL.revokeObjectURL(objectUrl);
                        }
                    } catch (error) {
                        console.error('[useTTSReading] chunk fetch failed:', error);
                    }
                } else if (entry.textKey === 'tts.merged') {
                    // TURN の最終音声が確定（差し替え）した。古い objectURL を必ず捨ててから
                    // 索引を読み直す（全体読み上げでの再生成でも旧音声が残らないようにする）。
                    if (args.length >= 2) {
                        releaseAuthedAudioUrl(ttsFinalAudioPath(backendUrl, sessionId, args[0], args[1]));
                    }
                    void refreshIndex();
                }
            }
            if (status.status === 'completed' || status.status === 'error' || status.status === 'canceled') {
                finishJob(status.status);
                return;
            }
        } catch (error) {
            console.error('[useTTSReading] status poll failed:', error);
            // 一時的な取得失敗で即終了せず、連続3回まではポーリングを続ける
            // （即 stop すると未再生キューが破棄され再生が途切れるため）。
            pollFailuresRef.current += 1;
            if (pollFailuresRef.current >= 3) {
                pollFailuresRef.current = 0;
                finishJob('error');
                return;
            }
        }
        pollTimerRef.current = setTimeout(() => void pollOnce(), POLL_INTERVAL_MS);
    }, [backendUrl, sessionId, finishJob, refreshIndex]);

    const beginPolling = useCallback(() => {
        stopPolling();
        pollTimerRef.current = setTimeout(() => void pollOnce(), 0);
    }, [pollOnce, stopPolling]);

    // opts.playback=false は自動読み上げ（要件4章: 生成のみ・自動再生なし）用に
    // 逐次再生を行わず生成だけ走らせる。省略時は従来どおり設定に従い逐次再生する。
    // 返す Promise はジョブ開始の確定（またはスキップ・失敗の確定）で解決する。
    const start = useCallback(async (messageId: string, turnId?: string, opts?: { playback?: boolean }) => {
        if (!enabled || !sessionId || jobRef.current) return;
        const targetKey = turnId ? ttsTurnActiveKey(messageId, turnId) : ttsMessageActiveKey(messageId);
        try {
            // 設定（無音秒・音量・形式）は他画面で随時変わるため、開始ごとに読み直す。
            const config = await getTTSConfig(backendUrl);
            configRef.current = config;
            const res = await startTTSRead(backendUrl, {
                sessionId,
                messageId,
                turnId,
                presetVoiceDesign: getPresetVoiceDesign?.(),
            });
            if (disposedRef.current) return;
            if (res.empty) {
                showNotice(targetKey, res.reason || 'empty');
                return;
            }
            if (res.duplicate) {
                // 同一対象の実行中あり（自動読み上げの開始要求と競合した直後など）。
                // ジョブ参照を持たずに戻ると、続く通し再生が「生成中でない＝音声なし」と
                // 誤読して先頭TURNを飛ばすため、既存ジョブを引き取ってポーリングする。
                if (!res.existingJobId || jobRef.current) return;
                jobRef.current = {
                    jobId: res.existingJobId,
                    messageId,
                    turnId: turnId ?? '',
                    format: config.responseFormat,
                    restored: true,
                };
                seenSeqRef.current = new Set();
                playerRef.current = null;
                setActiveKey(targetKey);
                setCancelling(false);
                beginPolling();
                return;
            }
            if (!res.jobId) return;
            // 再作成時に旧 objectURL キャッシュを破棄する（最終音声の差し替え）。
            if (turnId) {
                releaseAuthedAudioUrl(ttsFinalAudioPath(backendUrl, sessionId, messageId, turnId));
            }
            jobRef.current = {
                jobId: res.jobId,
                messageId,
                turnId: turnId ?? '',
                format: config.responseFormat,
                restored: false,
            };
            seenSeqRef.current = new Set();
            playerRef.current = (opts?.playback ?? true) && config.sequentialPlayback
                ? new TTSPlaybackController({
                    silenceSeconds: config.chunkSilenceSeconds,
                    startCount: config.playbackStartChunkCount,
                    volume: config.volume,
                    ownsUrls: true,
                    onError: error => console.error('[useTTSReading] playback error:', error),
                })
                : null;
            setActiveKey(targetKey);
            setCancelling(false);
            beginPolling();
        } catch (error) {
            console.error('[useTTSReading] start failed:', error);
            showNotice(targetKey, 'requestFailed');
        }
    }, [backendUrl, sessionId, enabled, beginPolling, showNotice, getPresetVoiceDesign]);

    const cancel = useCallback(() => {
        const job = jobRef.current;
        if (!job) return;
        setCancelling(true);
        // 再生は即時停止し、未再生分を破棄する（要件9.3）。終端確定はポーリングが検知する。
        playerRef.current?.stop();
        playerRef.current = null;
        void cancelTTSJob(backendUrl, job.jobId).catch(error => {
            console.error('[useTTSReading] cancel failed:', error);
        });
    }, [backendUrl]);

    const stopFinal = useCallback(() => {
        if (finalAudioRef.current) {
            finalAudioRef.current.pause();
            finalAudioRef.current = null;
        }
        setPlayingFinalKey(null);
    }, []);

    const playFinal = useCallback((messageId: string, turnId: string) => {
        if (!enabled || !sessionId) return;
        stopFinal();
        const key = ttsTurnActiveKey(messageId, turnId);
        void (async () => {
            try {
                const config = await getTTSConfig(backendUrl);
                configRef.current = config;
                const url = await resolveAuthedAudioUrl(ttsFinalAudioPath(backendUrl, sessionId, messageId, turnId));
                if (disposedRef.current) return;
                const audio = new Audio(url);
                audio.volume = Math.min(1, Math.max(0, config.volume));
                audio.onended = () => {
                    if (finalAudioRef.current === audio) {
                        finalAudioRef.current = null;
                        setPlayingFinalKey(null);
                    }
                };
                finalAudioRef.current = audio;
                setPlayingFinalKey(key);
                await audio.play();
            } catch (error) {
                console.error('[useTTSReading] final playback failed:', error);
                if (!disposedRef.current) setPlayingFinalKey(null);
            }
        })();
    }, [backendUrl, sessionId, enabled, stopFinal]);

    // stopPlayback は全ての再生（通し再生・チャンク逐次再生・単発再生）を止める。
    // 生成ジョブには触れない（要件: 生成は止めずに再生のみを止める）。
    const stopPlayback = useCallback(() => {
        sequenceTokenRef.current += 1;
        if (sequenceAudioRef.current) {
            sequenceAudioRef.current.pause();
            sequenceAudioRef.current = null;
        }
        setSequenceActive(false);
        setSequenceCurrentKey(null);
        playerRef.current?.stop();
        playerRef.current = null;
        stopFinal();
    }, [stopFinal]);

    // deleteMessageAudio は1応答（メッセージ）分の生成音声を削除する。
    // 再生を止めてから削除し、objectURL キャッシュを解放して索引を読み直す。
    // 削除要求が失敗したら false（呼び出し側が通知する。無音で流さない）。
    const deleteMessageAudio = useCallback(async (messageId: string): Promise<boolean> => {
        if (!sessionId) return false;
        stopPlayback();
        let ok = true;
        try {
            await deleteTTSMessageAudio(backendUrl, sessionId, messageId);
        } catch (error) {
            console.error('[useTTSReading] delete message audio failed:', error);
            ok = false;
        }
        if (index) {
            for (const entry of Object.values(index.entries)) {
                if (entry.messageId === messageId) {
                    releaseAuthedAudioUrl(ttsFinalAudioPath(backendUrl, sessionId, messageId, entry.turnId));
                }
            }
        }
        await refreshIndex();
        return ok;
    }, [backendUrl, sessionId, index, stopPlayback, refreshIndex]);

    // waitTurnAudio は TURN の最終音声 URL を返す。waitForGeneration が真のときは
    // 対象メッセージの実行中ジョブの完成を待つ（音声未紐づけ等のスキップや
    // 未生成が確定したら null）。
    const waitTurnAudio = useCallback(async (
        messageId: string,
        turnId: string,
        waitForGeneration: boolean,
        token: number,
    ): Promise<string | null> => {
        for (;;) {
            if (sequenceTokenRef.current !== token || disposedRef.current || !sessionId) return null;
            try {
                const idx = await fetchTTSAudioIndex(backendUrl, sessionId);
                if (sequenceTokenRef.current !== token) return null;
                setIndex(idx);
                if (idx.entries[ttsTurnKey(messageId, turnId)]) {
                    return await resolveAuthedAudioUrl(ttsFinalAudioPath(backendUrl, sessionId, messageId, turnId));
                }
            } catch {
                // 索引の取得失敗は次の周回で再試行（生成待ちと同じ扱い）。
            }
            // 対象メッセージの生成ジョブが動いていなければ、これ以上は現れない（スキップ確定）。
            const job = jobRef.current;
            const generating = waitForGeneration && job !== null && job.messageId === messageId;
            if (!generating) return null;
            await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
        }
    }, [backendUrl, sessionId]);

    // playSequenceAudio は1本の最終音声を再生して終了まで待つ（停止されたら false）。
    const playSequenceAudio = useCallback(async (url: string, token: number): Promise<boolean> => {
        let config = configRef.current;
        if (!config) {
            try {
                config = await getTTSConfig(backendUrl);
                configRef.current = config;
            } catch {
                config = null;
            }
        }
        if (sequenceTokenRef.current !== token) return false;
        return await new Promise<boolean>(resolve => {
            const audio = new Audio(url);
            audio.volume = Math.min(1, Math.max(0, config?.volume ?? 1));
            sequenceAudioRef.current = audio;
            audio.onended = () => resolve(sequenceTokenRef.current === token);
            audio.onerror = () => resolve(sequenceTokenRef.current === token);
            // stopPlayback の pause で終了検知する（停止時は false）。
            audio.onpause = () => {
                if (sequenceTokenRef.current !== token) resolve(false);
            };
            audio.play().catch(() => resolve(sequenceTokenRef.current === token));
        });
    }, [backendUrl]);

    // startSequence は startMessageId の応答ひと塊を先頭TURN（startTurnId 指定時はそのTURN）
    // から通しで再生する。生成済みTURNは最終音声を再生し、開始メッセージの未生成TURNは
    // 実行中ジョブの完成を待って再生する。autoAdvance が真なら応答の区切りを超えて、
    // 生成済みの次の音声を続けて再生し、未生成へ当たった時点で終わる。
    const startSequence = useCallback((startMessageId: string, playlist: TTSPlaylistEntry[], autoAdvance: boolean, startTurnId?: string) => {
        stopPlayback();
        if (!enabled || !sessionId) return;
        const token = ++sequenceTokenRef.current;
        setSequenceActive(true);
        void (async () => {
            const startIdx = playlist.findIndex(entry => entry.messageId === startMessageId);
            let skipUntilStartTurn = Boolean(startTurnId);
            // TURN 同士・応答同士の切れ目に空ける間（設定 turnGapSeconds。結合ではなく再生側で待つ）。
            // 設定は他画面で随時変わるため、通し再生の開始ごとに読み直す（音量も同じ値を使う）。
            let gapSeconds = 0;
            try {
                const config = await getTTSConfig(backendUrl);
                configRef.current = config;
                gapSeconds = Math.max(0, config.turnGapSeconds || 0);
            } catch {
                gapSeconds = Math.max(0, configRef.current?.turnGapSeconds || 0);
            }
            if (sequenceTokenRef.current !== token) return;
            let playedAny = false;
            outer: for (let mi = Math.max(0, startIdx); mi < playlist.length; mi++) {
                const entry = playlist[mi];
                const isStartMessage = entry.messageId === startMessageId;
                for (const turnId of entry.turnIds) {
                    if (sequenceTokenRef.current !== token) return;
                    // 途中TURNからの開始（個別再生ボタンの自動継続）: 開始TURNまで飛ばす。
                    if (skipUntilStartTurn) {
                        if (!isStartMessage || turnId !== startTurnId) continue;
                        skipUntilStartTurn = false;
                    }
                    const url = await waitTurnAudio(entry.messageId, turnId, isStartMessage, token);
                    if (sequenceTokenRef.current !== token) return;
                    if (url === null) {
                        if (isStartMessage) continue; // スキップTURN（音声なし確定）は飛ばす
                        break outer; // 先読み中に未生成へ当たったら終了
                    }
                    if (playedAny && gapSeconds > 0) {
                        // 前の音声の直後に始めず、切れ目の間を空ける（停止されたら抜ける）。
                        await new Promise(resolve => setTimeout(resolve, gapSeconds * 1000));
                        if (sequenceTokenRef.current !== token) return;
                    }
                    setSequenceCurrentKey(ttsTurnActiveKey(entry.messageId, turnId));
                    const ok = await playSequenceAudio(url, token);
                    if (sequenceTokenRef.current === token) setSequenceCurrentKey(null);
                    if (!ok) return;
                    playedAny = true;
                }
                if (!autoAdvance) break;
            }
            if (sequenceTokenRef.current === token) {
                sequenceAudioRef.current = null;
                setSequenceActive(false);
                setSequenceCurrentKey(null);
            }
        })();
    }, [enabled, sessionId, backendUrl, stopPlayback, waitTurnAudio, playSequenceAudio]);

    // セッション切替時: 索引の再取得と、実行中ジョブのボタン状態復元（再生は再開しない）。
    useEffect(() => {
        disposedRef.current = false;
        setIndex(null);
        setActiveKey(null);
        setCancelling(false);
        setNotice(null);
        stopFinal();
        // 通し再生も破棄する（トークンを進めてループを無効化）。
        sequenceTokenRef.current += 1;
        sequenceAudioRef.current?.pause();
        sequenceAudioRef.current = null;
        setSequenceActive(false);
        setSequenceCurrentKey(null);
        playerRef.current?.stop();
        playerRef.current = null;
        jobRef.current = null;
        seenSeqRef.current = new Set();
        stopPolling();
        if (!enabled || !sessionId) return;
        void refreshIndex();
        void (async () => {
            try {
                const jobs = await fetchJobs(backendUrl);
                const running = jobs.jobs.find(j => j.type === 'tts' && j.sessionId === sessionId
                    && (j.status === 'pending' || j.status === 'processing'));
                if (!running || disposedRef.current) return;
                const status = await fetchTTSStatus(backendUrl, running.jobId);
                if (disposedRef.current || !status.messageId) return;
                jobRef.current = {
                    jobId: running.jobId,
                    messageId: status.messageId,
                    turnId: status.turnId ?? '',
                    format: 'wav',
                    restored: true,
                };
                // 進捗の既出分は再生しない（復元では表示状態のみ戻す）。
                seenSeqRef.current = new Set((status.progress ?? []).map(entry => entry.seq));
                setActiveKey(status.turnId
                    ? ttsTurnActiveKey(status.messageId, status.turnId)
                    : ttsMessageActiveKey(status.messageId));
                beginPolling();
            } catch {
                // 復元は任意動作のため失敗は握りつぶす（通常操作には影響しない）。
            }
        })();
        return () => {
            disposedRef.current = true;
            stopPolling();
            sequenceTokenRef.current += 1;
            sequenceAudioRef.current?.pause();
            sequenceAudioRef.current = null;
            playerRef.current?.stop();
            playerRef.current = null;
            if (noticeTimerRef.current !== null) clearTimeout(noticeTimerRef.current);
            stopFinal();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [backendUrl, sessionId, enabled]);

    return { index, activeKey, cancelling, notice, playingFinalKey, sequenceActive, sequenceCurrentKey, start, cancel, playFinal, stopFinal, startSequence, stopPlayback, deleteMessageAudio };
}

// ttsHasFinalAudio は作成済み判定（読み上げ→再作成ボタン切替・再生ボタン表示）。
export function ttsHasFinalAudio(index: TTSAudioIndex | null, messageId: string, turnId: string): boolean {
    if (!index) return false;
    return Boolean(index.entries[ttsTurnKey(messageId, turnId)]);
}

// ttsFinalAudioDuration は作成済み音声の長さの表示文字列（分:秒）。
// 連結mp3は audio.duration が取得できないため、index.json の durationSeconds を正本とする。
export function ttsFinalAudioDuration(index: TTSAudioIndex | null, messageId: string, turnId: string): string | null {
    const entry = index?.entries[ttsTurnKey(messageId, turnId)];
    if (!entry || !Number.isFinite(entry.durationSeconds) || entry.durationSeconds <= 0) return null;
    const total = Math.round(entry.durationSeconds);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
