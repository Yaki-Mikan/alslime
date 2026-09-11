/**
 * useTTSReading.ts - 読み上げ実行の状態管理フック
 *
 * 読み上げ開始（TURN単位／1応答全体）→ ステータスポーリング（2秒間隔）→
 * tts.chunk / tts.merged の解釈 → 逐次再生（ttsPlayer）→ 終端処理、を担う。
 * 生成ジョブは応答ごとに複数を同時に追跡する（前の応答の生成中に次の応答が
 * 届いても開始要求を捨てない）。同じ応答を対象とする二重の開始要求は弾く。
 * 画面更新後は実行中ジョブを検出してボタン状態を復元する
 * （要件により再生は自動で再開しない。ポーリングと表示のみ）。
 *
 * 再生の割り込み規則:
 * - 自動読み上げ・全体読み上げの通し再生は、既に何かが鳴っていれば待ち行列へ積み、
 *   鳴り終わってから始める（前の再生を途中で打ち切らない）。
 * - 個別TURNの読み上げ（逐次再生）と個別の再生は、人の明示操作なので
 *   鳴っているものを全て止めてから始める（待ち行列も捨てる）。
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

// TTSSequenceOptions は通し再生の開始指定。
// mode='queue' は再生中なら待ち行列へ積んで鳴り終わってから始める（自動読み上げ・全体読み上げ）。
// mode='interrupt' は鳴っているものを全て止めてから始める（個別再生の続き自動再生）。
export interface TTSSequenceOptions {
    autoAdvance: boolean;
    startTurnId?: string;
    mode: 'queue' | 'interrupt';
}

export interface TTSReadingState {
    index: TTSAudioIndex | null;
    // activeKeys は実行中（生成中）の対象キー集合（turn:... / msg:...）。
    activeKeys: ReadonlySet<string>;
    // cancellingKeys はキャンセル要求済みで終端待ちの対象キー集合。
    cancellingKeys: ReadonlySet<string>;
    // activeMessageIds は実行中ジョブが対象とする応答IDの集合（同一応答内の排他判定用）。
    activeMessageIds: ReadonlySet<string>;
    notice: TTSNotice | null;
    playingFinalKey: string | null;
    // sequenceActive は通し再生（応答ひと塊の先頭からの再生）の実行中フラグ。
    sequenceActive: boolean;
    // sequenceCurrentKey は通し再生で今鳴っている TURN のキー（turn:...）。待機中は null。
    sequenceCurrentKey: string | null;
    // start は通信前から生成予定を登録し、ジョブ開始の確定まで待てる。
    start: (messageId: string, turnId?: string, opts?: { playback?: boolean }) => Promise<void>;
    // 設定取得前から生成予定を登録し、全体生成と通し再生を一緒に開始する。
    readMessage: (messageId: string, automatic?: boolean) => Promise<void>;
    // cancel は targetKey（turn:... / msg:...）が対象の生成ジョブをキャンセルする。
    cancel: (targetKey: string) => void;
    playFinal: (messageId: string, turnId: string) => void;
    stopFinal: () => void;
    // startSequence は startMessageId の応答ひと塊を先頭TURN（startTurnId 指定時はそのTURN）
    // から通しで再生する。autoAdvance が真なら応答の区切りを超えて生成待ち・探索を続ける。
    startSequence: (startMessageId: string, playlist: TTSPlaylistEntry[], opts: TTSSequenceOptions) => void;
    // stopPlayback は全ての再生を止め、待ち行列も捨てる（生成ジョブは止めない）。
    stopPlayback: () => void;
    // deleteMessageAudio は1応答（メッセージ）分の生成音声を削除する（要件10章）。
    // 失敗時は false を返す（呼び出し側が通知を出す）。
    deleteMessageAudio: (messageId: string) => Promise<boolean>;
}

const POLL_INTERVAL_MS = 2000;
const NOTICE_MS = 2500;

// TrackedJob は追跡中の生成ジョブ1件（ポーリング・既読進捗・逐次再生器をジョブごとに持つ）。
interface TrackedJob {
    jobId: string;
    messageId: string;
    turnId: string;
    targetKey: string;
    player: TTSPlaybackController | null;
    seenSeq: Set<number>;
    pollTimer: ReturnType<typeof setTimeout> | null;
    pollFailures: number;
    cancelling: boolean;
    settledTurns: Set<string>;
}

interface StartingRead {
    messageId: string;
    turnId?: string;
    targetKey: string;
    cancelling: boolean;
}

interface SequenceProgress {
    playedTurns: Set<string>;
    completedMessages: Set<string>;
}

const newSequenceProgress = (): SequenceProgress => ({ playedTurns: new Set(), completedMessages: new Set() });

// SequenceRequest は通し再生の待ち行列の1件。
interface SequenceRequest {
    startMessageId: string;
    playlist: TTSPlaylistEntry[];
    autoAdvance: boolean;
    startTurnId?: string;
    // 重なった予約だけで共有する。後から改めて開始した再生には持ち越さない。
    progress: SequenceProgress;
}

export function useTTSReading(
    backendUrl: string,
    sessionId: string | null,
    enabled: boolean,
    // 読み上げ開始時に同梱する会話設定側VoiceDesign（キーはキャラクター名。要件6.5）。
    getPresetVoiceDesign?: () => Record<string, TTSPresetVoiceDesign> | undefined,
    getPlaylist?: () => TTSPlaylistEntry[],
): TTSReadingState {
    const [index, setIndex] = useState<TTSAudioIndex | null>(null);
    const [activeKeys, setActiveKeys] = useState<ReadonlySet<string>>(() => new Set());
    const [cancellingKeys, setCancellingKeys] = useState<ReadonlySet<string>>(() => new Set());
    const [activeMessageIds, setActiveMessageIds] = useState<ReadonlySet<string>>(() => new Set());
    const [notice, setNotice] = useState<TTSNotice | null>(null);
    const [playingFinalKey, setPlayingFinalKey] = useState<string | null>(null);
    // 通し再生（P3拡張: 応答ひと塊の先頭からのプレイリスト再生）。
    const [sequenceActive, setSequenceActive] = useState(false);
    const [sequenceCurrentKey, setSequenceCurrentKey] = useState<string | null>(null);
    const sequenceTokenRef = useRef(0);
    const sequenceRunningRef = useRef(false);
    const sequenceAudioRef = useRef<HTMLAudioElement | null>(null);
    // 通し再生の待ち行列（mode='queue' で再生中に積まれた分。鳴り終わりで順に始める）。
    const pendingSequencesRef = useRef<SequenceRequest[]>([]);
    const sequenceProgressRef = useRef(newSequenceProgress());
    const playlistGetterRef = useRef(getPlaylist);
    useEffect(() => { playlistGetterRef.current = getPlaylist; }, [getPlaylist]);
    // 停止とセッション切替を別々に識別する。再生停止では生成を継続する。
    const playbackEpochRef = useRef(0);
    const sessionEpochRef = useRef(0);
    // drainRef は「鳴り終わったら待ち行列の先頭を始める」処理。通し再生本体と相互参照するため ref 経由で呼ぶ。
    const drainRef = useRef<() => void>(() => { /* 初期化前は何もしない */ });

    const disposedRef = useRef(false);
    const jobsRef = useRef<Map<string, TrackedJob>>(new Map());
    const startingReadsRef = useRef(new Map<string, StartingRead>());
    // 鳴っている（または生成待ちで鳴る予定の）逐次再生器の集合。
    // ジョブ終端後も onEnded まではここに残し「再生中」として扱う。
    const playersRef = useRef<Set<TTSPlaybackController>>(new Set());
    const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const finalAudioRef = useRef<HTMLAudioElement | null>(null);
    const configRef = useRef<TTSConfig | null>(null);

    const showNotice = useCallback((targetKey: string, reason: string) => {
        if (noticeTimerRef.current !== null) clearTimeout(noticeTimerRef.current);
        setNotice({ targetKey, reason });
        noticeTimerRef.current = setTimeout(() => setNotice(null), NOTICE_MS);
    }, []);

    // syncJobState は追跡中ジョブの集合から表示用の状態を作り直す。
    const syncJobState = useCallback(() => {
        const active = new Set<string>();
        const cancelling = new Set<string>();
        const messageIds = new Set<string>();
        for (const pending of startingReadsRef.current.values()) {
            active.add(pending.targetKey);
            messageIds.add(pending.messageId);
            if (pending.cancelling) cancelling.add(pending.targetKey);
        }
        for (const job of jobsRef.current.values()) {
            active.add(job.targetKey);
            messageIds.add(job.messageId);
            if (job.cancelling) cancelling.add(job.targetKey);
        }
        setActiveKeys(active);
        setCancellingKeys(cancelling);
        setActiveMessageIds(messageIds);
    }, []);

    // isMessageGenerating は応答 messageId を対象とするジョブを追跡中か。
    const isMessageGenerating = useCallback((messageId: string): boolean => {
        if (startingReadsRef.current.has(messageId)) return true;
        for (const job of jobsRef.current.values()) {
            if (job.messageId === messageId) return true;
        }
        return false;
    }, []);

    const isTurnGenerating = useCallback((messageId: string, turnId: string): boolean => {
        const pending = startingReadsRef.current.get(messageId);
        if (pending && !pending.cancelling && (!pending.turnId || pending.turnId === turnId)) return true;
        for (const job of jobsRef.current.values()) {
            if (job.messageId === messageId && !job.cancelling
                && (!job.turnId || job.turnId === turnId) && !job.settledTurns.has(turnId)) return true;
        }
        return false;
    }, []);

    // isPlayingNow は何かが鳴っている（通し再生・単発再生・逐次再生のいずれか）か。
    const isPlayingNow = useCallback((): boolean =>
        sequenceRunningRef.current || finalAudioRef.current !== null || playersRef.current.size > 0, []);

    // stopPlayers は逐次再生器を全て止める（生成ジョブには触れない）。
    const stopPlayers = useCallback(() => {
        for (const player of playersRef.current) player.stop();
        playersRef.current.clear();
        for (const job of jobsRef.current.values()) job.player = null;
    }, []);

    const refreshIndex = useCallback(async () => {
        if (!enabled || !sessionId) return;
        const epoch = sessionEpochRef.current;
        try {
            const idx = await fetchTTSAudioIndex(backendUrl, sessionId);
            if (!disposedRef.current && sessionEpochRef.current === epoch) setIndex(idx);
        } catch (error) {
            console.error('[useTTSReading] index load failed:', error);
        }
    }, [backendUrl, sessionId, enabled]);

    const stopJobPolling = useCallback((job: TrackedJob) => {
        if (job.pollTimer !== null) {
            clearTimeout(job.pollTimer);
            job.pollTimer = null;
        }
    }, []);

    const finishJob = useCallback((jobId: string, status: 'completed' | 'error' | 'canceled') => {
        const job = jobsRef.current.get(jobId);
        if (!job) return;
        stopJobPolling(job);
        const player = job.player;
        if (player) {
            if (status === 'completed') {
                // 未再生分を鳴らし切る。鳴り終わりは onEnded で playersRef から外れる。
                player.finish();
            } else {
                player.stop();
                playersRef.current.delete(player);
            }
        }
        job.player = null;
        jobsRef.current.delete(jobId);
        syncJobState();
        void refreshIndex();
        // 逐次再生器が鳴らずに消えた場合は、待ち行列の通し再生を動かす契機がここしかない。
        if (player && status !== 'completed') drainRef.current();
    }, [refreshIndex, stopJobPolling, syncJobState]);

    const pollOnce = useCallback(async (jobId: string) => {
        const job = jobsRef.current.get(jobId);
        if (!job || disposedRef.current || !sessionId) return;
        try {
            const status = await fetchTTSStatus(backendUrl, job.jobId);
            if (disposedRef.current || jobsRef.current.get(jobId) !== job) return;
            job.pollFailures = 0;
            for (const entry of status.progress ?? []) {
                if (job.seenSeq.has(entry.seq)) continue;
                job.seenSeq.add(entry.seq);
                const args = entry.args ?? [];
                if (entry.textKey === 'tts.chunk' && args.length >= 4 && job.player) {
                    const [messageId, turnId, chunkIndex, format] = args;
                    const url = ttsChunkAudioPath(backendUrl, sessionId, messageId, turnId, Number(chunkIndex), format);
                    try {
                        // チャンクは再作成のたびに中身が変わる使い捨てのため共有キャッシュへ載せない
                        //（旧チャンクの再生を防ぐ）。解放はプレイヤーが再生終了・停止時に行う。
                        const objectUrl = await fetchAudioObjectUrlOnce(url);
                        if (job.player) {
                            job.player.enqueue(objectUrl);
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
                        job.settledTurns.add(args[1]);
                        releaseAuthedAudioUrl(ttsFinalAudioPath(backendUrl, sessionId, args[0], args[1]));
                    }
                    void refreshIndex();
                } else if (entry.textKey === 'tts.skipped' && args.length > 0) {
                    job.settledTurns.add(args[0]);
                }
            }
            if (status.status === 'completed' || status.status === 'error' || status.status === 'canceled') {
                finishJob(jobId, status.status);
                return;
            }
        } catch (error) {
            if (disposedRef.current || jobsRef.current.get(jobId) !== job) return;
            console.error('[useTTSReading] status poll failed:', error);
            // 一時的な取得失敗で即終了せず、連続3回まではポーリングを続ける
            // （即 stop すると未再生キューが破棄され再生が途切れるため）。
            job.pollFailures += 1;
            if (job.pollFailures >= 3) {
                finishJob(jobId, 'error');
                return;
            }
        }
        if (!jobsRef.current.has(jobId)) return;
        job.pollTimer = setTimeout(() => void pollOnce(jobId), POLL_INTERVAL_MS);
    }, [backendUrl, sessionId, finishJob, refreshIndex]);

    // trackJob は生成ジョブを追跡対象に登録してポーリングを始める。
    const trackJob = useCallback((job: TrackedJob) => {
        jobsRef.current.set(job.jobId, job);
        if (job.player) playersRef.current.add(job.player);
        syncJobState();
        job.pollTimer = setTimeout(() => void pollOnce(job.jobId), 0);
    }, [pollOnce, syncJobState]);

    const stopFinal = useCallback(() => {
        if (finalAudioRef.current) {
            finalAudioRef.current.pause();
            finalAudioRef.current = null;
        }
        setPlayingFinalKey(null);
    }, []);

    // stopPlayback は全ての再生（通し再生・チャンク逐次再生・単発再生）を止め、
    // 待ち行列に積まれた通し再生も捨てる。生成ジョブには触れない
    // （要件: 生成は止めずに再生のみを止める）。
    const stopPlayback = useCallback(() => {
        playbackEpochRef.current += 1;
        sequenceProgressRef.current = newSequenceProgress();
        pendingSequencesRef.current = [];
        sequenceTokenRef.current += 1;
        sequenceRunningRef.current = false;
        if (sequenceAudioRef.current) {
            sequenceAudioRef.current.pause();
            sequenceAudioRef.current = null;
        }
        setSequenceActive(false);
        setSequenceCurrentKey(null);
        stopPlayers();
        stopFinal();
    }, [stopFinal, stopPlayers]);

    // opts.playback=false は自動読み上げ（要件4章: 生成のみ・自動再生なし）用に
    // 逐次再生を行わず生成だけ走らせる。省略時は従来どおり設定に従い逐次再生する。
    // 同じ応答を対象とするジョブを追跡中なら何もしない（同一応答内の相互排他。要件9.7）。
    // 別応答のジョブは並行して追跡する。
    // 返す Promise はジョブ開始の確定（またはスキップ・失敗の確定）で解決する。
    const start = useCallback(async (messageId: string, turnId?: string, opts?: {
        playback?: boolean;
        onConfig?: (config: TTSConfig) => boolean;
    }) => {
        if (!enabled || !sessionId || isMessageGenerating(messageId)) return;
        const targetKey = turnId ? ttsTurnActiveKey(messageId, turnId) : ttsMessageActiveKey(messageId);
        const pending: StartingRead = { messageId, turnId, targetKey, cancelling: false };
        const sessionEpoch = sessionEpochRef.current;
        const playbackEpoch = playbackEpochRef.current;
        startingReadsRef.current.set(messageId, pending);
        syncJobState();
        try {
            // 設定（無音秒・音量・形式）は他画面で随時変わるため、開始ごとに読み直す。
            const config = await getTTSConfig(backendUrl);
            if (disposedRef.current || sessionEpochRef.current !== sessionEpoch || pending.cancelling) return;
            configRef.current = config;
            if (opts?.onConfig && !opts.onConfig(config)) return;
            const res = await startTTSRead(backendUrl, {
                sessionId,
                messageId,
                turnId,
                presetVoiceDesign: getPresetVoiceDesign?.(),
            });
            if (disposedRef.current || sessionEpochRef.current !== sessionEpoch) return;
            if (res.empty) {
                showNotice(targetKey, res.reason || 'empty');
                return;
            }
            if (res.duplicate) {
                // 同一対象の実行中あり（自動読み上げの開始要求と競合した直後など）。
                // ジョブ参照を持たずに戻ると、続く通し再生が「生成中でない＝音声なし」と
                // 誤読して先頭TURNを飛ばすため、既存ジョブを引き取ってポーリングする。
                if (!res.existingJobId || jobsRef.current.has(res.existingJobId)) return;
                trackJob({
                    jobId: res.existingJobId,
                    messageId,
                    turnId: turnId ?? '',
                    targetKey,
                    player: null,
                    seenSeq: new Set(),
                    pollTimer: null,
                    pollFailures: 0,
                    cancelling: pending.cancelling,
                    settledTurns: new Set(),
                });
                if (pending.cancelling) void cancelTTSJob(backendUrl, res.existingJobId).catch(console.error);
                return;
            }
            if (!res.jobId) return;
            // 再作成時に旧 objectURL キャッシュを破棄する（最終音声の差し替え）。
            if (turnId) {
                releaseAuthedAudioUrl(ttsFinalAudioPath(backendUrl, sessionId, messageId, turnId));
            }
            let player: TTSPlaybackController | null = null;
            if ((opts?.playback ?? true) && config.sequentialPlayback && !pending.cancelling
                && playbackEpochRef.current === playbackEpoch) {
                // 個別TURNの読み上げは人の明示操作。鳴っているものを全て止めてから逐次再生に入る
                //（通し再生の後続TURNや待ち行列も一緒に止める）。
                stopPlayback();
                const created: TTSPlaybackController = new TTSPlaybackController({
                    silenceSeconds: config.chunkSilenceSeconds,
                    startCount: config.playbackStartChunkCount,
                    volume: config.volume,
                    ownsUrls: true,
                    onError: error => console.error('[useTTSReading] playback error:', error),
                    onEnded: () => {
                        playersRef.current.delete(created);
                        drainRef.current();
                    },
                });
                player = created;
            }
            trackJob({
                jobId: res.jobId,
                messageId,
                turnId: turnId ?? '',
                targetKey,
                player,
                seenSeq: new Set(),
                pollTimer: null,
                pollFailures: 0,
                cancelling: pending.cancelling,
                settledTurns: new Set(),
            });
            if (pending.cancelling) void cancelTTSJob(backendUrl, res.jobId).catch(console.error);
        } catch (error) {
            if (disposedRef.current || sessionEpochRef.current !== sessionEpoch) return;
            console.error('[useTTSReading] start failed:', error);
            showNotice(targetKey, 'requestFailed');
        } finally {
            if (startingReadsRef.current.get(messageId) === pending) {
                startingReadsRef.current.delete(messageId);
                syncJobState();
            }
        }
    }, [backendUrl, sessionId, enabled, isMessageGenerating, trackJob, stopPlayback, showNotice, getPresetVoiceDesign, syncJobState]);

    const cancel = useCallback((targetKey: string) => {
        for (const pending of startingReadsRef.current.values()) {
            if (pending.targetKey === targetKey) pending.cancelling = true;
        }
        syncJobState();
        let target: TrackedJob | null = null;
        for (const job of jobsRef.current.values()) {
            if (job.targetKey === targetKey) {
                target = job;
                break;
            }
        }
        if (!target) return;
        target.cancelling = true;
        // 再生は即時停止し、未再生分を破棄する（要件9.3）。終端確定はポーリングが検知する。
        if (target.player) {
            target.player.stop();
            playersRef.current.delete(target.player);
            target.player = null;
            drainRef.current();
        }
        syncJobState();
        void cancelTTSJob(backendUrl, target.jobId).catch(error => {
            console.error('[useTTSReading] cancel failed:', error);
        });
    }, [backendUrl, syncJobState]);

    // playFinal は1本の最終音声を単発で再生する。人の明示操作なので、鳴っているものを
    // 全て止めてから始める。
    const playFinal = useCallback((messageId: string, turnId: string) => {
        if (!enabled || !sessionId) return;
        stopPlayback();
        const epoch = playbackEpochRef.current;
        const key = ttsTurnActiveKey(messageId, turnId);
        void (async () => {
            try {
                const config = await getTTSConfig(backendUrl);
                configRef.current = config;
                const url = await resolveAuthedAudioUrl(ttsFinalAudioPath(backendUrl, sessionId, messageId, turnId));
                if (disposedRef.current || playbackEpochRef.current !== epoch) return;
                const audio = new Audio(url);
                audio.volume = Math.min(1, Math.max(0, config.volume));
                const settle = () => {
                    if (finalAudioRef.current === audio) {
                        finalAudioRef.current = null;
                        setPlayingFinalKey(null);
                        drainRef.current();
                    }
                };
                audio.onended = settle;
                audio.onerror = settle;
                finalAudioRef.current = audio;
                setPlayingFinalKey(key);
                try {
                    await audio.play();
                } catch (error) {
                    // 再生に入れなかった audio を「鳴っている」扱いのまま残さない。
                    settle();
                    throw error;
                }
            } catch (error) {
                console.error('[useTTSReading] final playback failed:', error);
                if (!disposedRef.current) setPlayingFinalKey(null);
            }
        })();
    }, [backendUrl, sessionId, enabled, stopPlayback]);

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

    // 応答境界によらず、対象TURNの生成予定があれば待つ。予定がなければ次を探す。
    const waitTurnAudio = useCallback(async (
        messageId: string,
        turnId: string,
        token: number,
    ): Promise<string | null> => {
        for (;;) {
            if (sequenceTokenRef.current !== token || disposedRef.current || !sessionId) return null;
            const wasGenerating = isTurnGenerating(messageId, turnId);
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
            const generating = isTurnGenerating(messageId, turnId);
            // 索引取得中にジョブが完了した場合は、完了後の索引をもう一度確認する。
            if (!generating) {
                if (wasGenerating) continue;
                return null;
            }
            await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
        }
    }, [backendUrl, sessionId, isTurnGenerating]);

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

    // 通し再生と予約で再生済みTURNを共有する。生成予定のない穴は飛ばし、生成中は待つ。
    const runSequence = useCallback((req: SequenceRequest) => {
        if (!enabled || !sessionId) return;
        const { startMessageId, autoAdvance, startTurnId, progress } = req;
        const { playedTurns } = progress;
        const currentPlaylist = () => playlistGetterRef.current?.() ?? req.playlist;
        sequenceProgressRef.current = progress;
        const token = ++sequenceTokenRef.current;
        sequenceRunningRef.current = true;
        setSequenceActive(true);
        void (async () => {
            const startIdx = currentPlaylist().findIndex(entry => entry.messageId === startMessageId);
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
            for (let mi = startIdx; startIdx >= 0 && mi < currentPlaylist().length; mi++) {
                const entry = currentPlaylist()[mi];
                if (!entry) break;
                const isStartMessage = entry.messageId === startMessageId;
                for (let ti = 0; ; ti++) {
                    const turnId = currentPlaylist().find(item => item.messageId === entry.messageId)?.turnIds[ti];
                    if (!turnId) break;
                    if (sequenceTokenRef.current !== token) return;
                    // 途中TURNからの開始（個別再生ボタンの自動継続）: 開始TURNまで飛ばす。
                    if (skipUntilStartTurn) {
                        if (!isStartMessage || turnId !== startTurnId) continue;
                        skipUntilStartTurn = false;
                    }
                    const key = ttsTurnActiveKey(entry.messageId, turnId);
                    if (playedTurns.has(key)) continue;
                    const url = await waitTurnAudio(entry.messageId, turnId, token);
                    if (sequenceTokenRef.current !== token) return;
                    if (url === null) continue;
                    if (playedAny && gapSeconds > 0) {
                        // 前の音声の直後に始めず、切れ目の間を空ける（停止されたら抜ける）。
                        await new Promise(resolve => setTimeout(resolve, gapSeconds * 1000));
                        if (sequenceTokenRef.current !== token) return;
                    }
                    setSequenceCurrentKey(key);
                    const ok = await playSequenceAudio(url, token);
                    if (sequenceTokenRef.current === token) setSequenceCurrentKey(null);
                    if (!ok) return;
                    playedTurns.add(key);
                    playedAny = true;
                }
                progress.completedMessages.add(entry.messageId);
                if (!autoAdvance) break;
            }
            if (sequenceTokenRef.current === token) {
                sequenceAudioRef.current = null;
                sequenceRunningRef.current = false;
                setSequenceActive(false);
                setSequenceCurrentKey(null);
                drainRef.current();
            }
        })();
    }, [enabled, sessionId, backendUrl, waitTurnAudio, playSequenceAudio]);

    // drainPending は何も鳴っていなければ待ち行列の先頭の通し再生を始める。
    const drainPending = useCallback(() => {
        if (disposedRef.current || isPlayingNow()) return;
        const next = pendingSequencesRef.current.shift();
        if (!next) return;
        runSequence(next);
    }, [isPlayingNow, runSequence]);
    useEffect(() => {
        drainRef.current = drainPending;
    }, [drainPending]);

    const enqueueSequence = useCallback((req: SequenceRequest, mode: TTSSequenceOptions['mode']) => {
        if (!enabled || !sessionId) return;
        if (mode === 'interrupt') {
            stopPlayback();
            runSequence(req);
            return;
        }
        if (isPlayingNow()) {
            // 鳴っている最中は割り込まず、鳴り終わってから始める。
            pendingSequencesRef.current.push(req);
            return;
        }
        runSequence(req);
    }, [enabled, sessionId, stopPlayback, runSequence, isPlayingNow]);

    const startSequence = useCallback((startMessageId: string, playlist: TTSPlaylistEntry[], opts: TTSSequenceOptions) => {
        enqueueSequence({
            startMessageId, playlist, autoAdvance: opts.autoAdvance, startTurnId: opts.startTurnId,
            progress: opts.mode === 'queue' && isPlayingNow()
                && !sequenceProgressRef.current.completedMessages.has(startMessageId)
                ? sequenceProgressRef.current : newSequenceProgress(),
        }, opts.mode);
    }, [enqueueSequence, isPlayingNow]);

    const readMessage = useCallback(async (messageId: string, automatic = false) => {
        const epoch = playbackEpochRef.current;
        // 設定通信中に自動継続が進んでも、開始時に重なっていた再生済み範囲を引き継ぐ。
        const progress = (isPlayingNow() || startingReadsRef.current.size > 0)
            && (automatic || !sequenceProgressRef.current.completedMessages.has(messageId))
            ? sequenceProgressRef.current : newSequenceProgress();
        if (!isPlayingNow()) sequenceProgressRef.current = progress;
        await start(messageId, undefined, {
            playback: false,
            onConfig: config => {
                if (automatic && !config.autoReadEnabled) return false;
                if ((!automatic || config.autoReadPlaybackEnabled) && playbackEpochRef.current === epoch) {
                    enqueueSequence({
                        startMessageId: messageId,
                        playlist: playlistGetterRef.current?.() ?? [],
                        autoAdvance: config.autoAdvanceEnabled,
                        progress,
                    }, 'queue');
                }
                return true;
            },
        });
    }, [start, enqueueSequence, isPlayingNow]);

    // セッション切替時: 索引の再取得と、実行中ジョブのボタン状態復元（再生は再開しない）。
    useEffect(() => {
        disposedRef.current = false;
        sessionEpochRef.current += 1;
        playbackEpochRef.current += 1;
        const sessionEpoch = sessionEpochRef.current;
        const startingReads = startingReadsRef.current;
        startingReads.clear();
        sequenceProgressRef.current = newSequenceProgress();
        setIndex(null);
        setNotice(null);
        stopFinal();
        // 通し再生と待ち行列も破棄する（トークンを進めてループを無効化）。
        pendingSequencesRef.current = [];
        sequenceTokenRef.current += 1;
        sequenceRunningRef.current = false;
        sequenceAudioRef.current?.pause();
        sequenceAudioRef.current = null;
        setSequenceActive(false);
        setSequenceCurrentKey(null);
        stopPlayers();
        for (const job of jobsRef.current.values()) stopJobPolling(job);
        jobsRef.current = new Map();
        syncJobState();
        if (!enabled || !sessionId) return;
        void refreshIndex();
        void (async () => {
            try {
                const jobs = await fetchJobs(backendUrl);
                const running = jobs.jobs.filter(j => j.type === 'tts' && j.sessionId === sessionId
                    && (j.status === 'pending' || j.status === 'processing'));
                if (running.length === 0 || disposedRef.current || sessionEpochRef.current !== sessionEpoch) return;
                for (const entry of running) {
                    const status = await fetchTTSStatus(backendUrl, entry.jobId);
                    if (disposedRef.current || sessionEpochRef.current !== sessionEpoch) return;
                    if (!status.messageId || jobsRef.current.has(entry.jobId)) continue;
                    // 進捗の既出分は再生しない（復元では表示状態のみ戻す）。
                    trackJob({
                        jobId: entry.jobId,
                        messageId: status.messageId,
                        turnId: status.turnId ?? '',
                        targetKey: status.turnId
                            ? ttsTurnActiveKey(status.messageId, status.turnId)
                            : ttsMessageActiveKey(status.messageId),
                        player: null,
                        seenSeq: new Set((status.progress ?? []).map(p => p.seq)),
                        pollTimer: null,
                        pollFailures: 0,
                        cancelling: false,
                        settledTurns: new Set((status.progress ?? []).flatMap(p =>
                            p.textKey === 'tts.skipped' ? p.args?.slice(0, 1) ?? []
                                : p.textKey === 'tts.merged' ? p.args?.slice(1, 2) ?? [] : [])),
                    });
                }
            } catch {
                // 復元は任意動作のため失敗は握りつぶす（通常操作には影響しない）。
            }
        })();
        return () => {
            disposedRef.current = true;
            sessionEpochRef.current += 1;
            playbackEpochRef.current += 1;
            startingReads.clear();
            for (const job of jobsRef.current.values()) stopJobPolling(job);
            pendingSequencesRef.current = [];
            sequenceTokenRef.current += 1;
            sequenceRunningRef.current = false;
            sequenceAudioRef.current?.pause();
            sequenceAudioRef.current = null;
            stopPlayers();
            if (noticeTimerRef.current !== null) clearTimeout(noticeTimerRef.current);
            stopFinal();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [backendUrl, sessionId, enabled]);

    return {
        index,
        activeKeys,
        cancellingKeys,
        activeMessageIds,
        notice,
        playingFinalKey,
        sequenceActive,
        sequenceCurrentKey,
        start,
        readMessage,
        cancel,
        playFinal,
        stopFinal,
        startSequence,
        stopPlayback,
        deleteMessageAudio,
    };
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
