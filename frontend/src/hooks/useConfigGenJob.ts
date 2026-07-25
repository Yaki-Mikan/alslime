/**
 * useConfigGenJob - 設定ファイル自動作成ジョブの実行・ポーリング・経過管理フック
 *
 * 2秒間隔で status をポーリングし、進捗（progress）は since 差分で蓄積する。
 * 経過時間はローカルで1秒ごとにカウントアップし、ポーリング受信時に
 * サーバーの elapsedSeconds で補正する（設計 5.2）。
 *
 * 安定性（レビュー002対応 6.2）:
 * - status の 404 は「ジョブ消滅（サーバー再起動等）」として即終了する。
 * - ポーリングにはジョブのタイムアウト＋猶予5分の時間上限を設ける。
 *
 * 非同期運用（レビュー002対応 6.3 / 7.2）:
 * - Hub 層に置くことでモーダルを閉じてもポーリングが継続する。
 * - attach(jobId) で実行中ジョブへ再接続できる。最後の jobId は localStorage に記憶する。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
    submitConfigGen,
    getConfigGenStatus,
    cancelConfigGen,
    getConfigGenActive,
    type ConfigGenSubmitRequest,
    type ConfigGenProgressEntry,
    type ConfigGenResultFile,
} from '../api/config-gen';

const POLL_INTERVAL_MS = 2000;
const POLL_GRACE_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;
const LAST_JOB_STORAGE_KEY = 'alslime.configGen.lastJobId';

export interface ConfigGenJobState {
    jobId: string | null;
    running: boolean;
    progress: ConfigGenProgressEntry[];
    elapsedSeconds: number;
    result: ConfigGenResultFile | null;
    errorKey: string | null;
    /** 直近の完了状態（'completed' | 'error' | 'canceled' | null） */
    finishedStatus: string | null;
}

const INITIAL_STATE: ConfigGenJobState = {
    jobId: null,
    running: false,
    progress: [],
    elapsedSeconds: 0,
    result: null,
    errorKey: null,
    finishedStatus: null,
};

export const rememberLastConfigGenJob = (jobId: string) => {
    try { localStorage.setItem(LAST_JOB_STORAGE_KEY, jobId); } catch { /* 記憶できなくても機能に影響なし */ }
};

export const recallLastConfigGenJob = (): string | null => {
    try { return localStorage.getItem(LAST_JOB_STORAGE_KEY); } catch { return null; }
};

export const useConfigGenJob = (backendUrl: string) => {
    const [state, setState] = useState<ConfigGenJobState>(INITIAL_STATE);
    const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const tickTimer = useRef<ReturnType<typeof setInterval> | null>(null);
    const lastSeq = useRef(0);
    const activeJobId = useRef<string | null>(null);
    const pollDeadline = useRef(0);
    const onCompleteRef = useRef<((result: ConfigGenResultFile) => void) | null>(null);
    const onFinishedRef = useRef<((status: string) => void) | null>(null);

    const clearTimers = useCallback(() => {
        if (pollTimer.current) { clearTimeout(pollTimer.current); pollTimer.current = null; }
        if (tickTimer.current) { clearInterval(tickTimer.current); tickTimer.current = null; }
    }, []);

    useEffect(() => clearTimers, [clearTimers]);

    const finish = useCallback((status: string) => {
        clearTimers();
        activeJobId.current = null;
        onFinishedRef.current?.(status);
    }, [clearTimers]);

    const poll = useCallback(async (jobId: string) => {
        if (activeJobId.current !== jobId) return;
        if (Date.now() > pollDeadline.current) {
            setState(prev => ({ ...prev, running: false, errorKey: 'error.configgen.timeout', finishedStatus: 'error' }));
            finish('error');
            return;
        }
        try {
            const status = await getConfigGenStatus(backendUrl, jobId, lastSeq.current);
            if (activeJobId.current !== jobId) return;
            const fresh = status.progress ?? [];
            if (fresh.length > 0) {
                lastSeq.current = Math.max(lastSeq.current, ...fresh.map(p => p.seq));
            }
            const terminal = status.status === 'completed' || status.status === 'error' || status.status === 'canceled';
            setState(prev => ({
                ...prev,
                progress: fresh.length > 0 ? [...prev.progress, ...fresh] : prev.progress,
                elapsedSeconds: status.elapsedSeconds,
                running: !terminal,
                result: status.result ?? prev.result,
                errorKey: status.error || null,
                finishedStatus: terminal ? status.status : null,
            }));
            if (terminal) {
                if (status.status === 'completed' && status.result && onCompleteRef.current) {
                    onCompleteRef.current(status.result);
                }
                finish(status.status);
                return;
            }
        } catch (error: any) {
            // 404 = ジョブ消滅（サーバー再起動等）。ポーリング継続せず即終了する。
            if (error?.response?.status === 404) {
                setState(prev => ({ ...prev, running: false, errorKey: 'configGen.jobNotFound', finishedStatus: 'error' }));
                finish('error');
                return;
            }
            // それ以外の一時的な通信断はポーリング継続で吸収する（時間上限あり）。
        }
        pollTimer.current = setTimeout(() => poll(jobId), POLL_INTERVAL_MS);
    }, [backendUrl, finish]);

    // ジョブへの接続共通処理（新規実行・再接続の両方から使う）。
    const connect = useCallback((jobId: string, timeoutMinutes: number | undefined, baseElapsed: number) => {
        clearTimers();
        lastSeq.current = 0;
        activeJobId.current = jobId;
        const timeoutMs = timeoutMinutes && timeoutMinutes > 0 ? timeoutMinutes * 60 * 1000 : DEFAULT_TIMEOUT_MS;
        pollDeadline.current = Date.now() + timeoutMs + POLL_GRACE_MS - baseElapsed * 1000;
        rememberLastConfigGenJob(jobId);
        setState({ ...INITIAL_STATE, jobId, running: true, elapsedSeconds: baseElapsed });
        tickTimer.current = setInterval(() => {
            setState(prev => (prev.running ? { ...prev, elapsedSeconds: prev.elapsedSeconds + 1 } : prev));
        }, 1000);
        pollTimer.current = setTimeout(() => poll(jobId), POLL_INTERVAL_MS);
    }, [clearTimers, poll]);

    const start = useCallback(async (
        req: ConfigGenSubmitRequest,
        onComplete: (result: ConfigGenResultFile) => void,
        onFinished?: (status: string) => void
    ): Promise<{ ok: boolean; errorKey?: string }> => {
        onCompleteRef.current = onComplete;
        onFinishedRef.current = onFinished ?? null;
        try {
            const { jobId } = await submitConfigGen(backendUrl, req);
            connect(jobId, req.timeoutMinutes, 0);
            return { ok: true };
        } catch (error: any) {
            const key = error?.response?.data?.messageKey || error?.response?.data?.error || 'configGen.toast.submitFailed';
            return { ok: false, errorKey: key };
        }
    }, [backendUrl, connect]);

    // 実行中ジョブへの再接続（タブを開き直したとき等）。
    const attach = useCallback(async (
        onComplete: (result: ConfigGenResultFile) => void,
        onFinished?: (status: string) => void
    ): Promise<boolean> => {
        try {
            const active = await getConfigGenActive(backendUrl);
            if (!active.active || !active.jobId) return false;
            onCompleteRef.current = onComplete;
            onFinishedRef.current = onFinished ?? null;
            // 再接続時のポーリング上限は最大値（60分＋猶予）で張り直す（元のタイムアウト設定は不明のため安全側）。
            connect(active.jobId, 60, active.elapsedSeconds ?? 0);
            return true;
        } catch {
            return false;
        }
    }, [backendUrl, connect]);

    const cancel = useCallback(async () => {
        const jobId = activeJobId.current;
        if (!jobId) return;
        try {
            await cancelConfigGen(backendUrl, jobId);
        } catch {
            // キャンセル失敗（既に終端）は次のポーリングで状態が確定する。
        }
    }, [backendUrl]);

    const reset = useCallback(() => {
        clearTimers();
        activeJobId.current = null;
        lastSeq.current = 0;
        setState(INITIAL_STATE);
    }, [clearTimers]);

    return { state, start, attach, cancel, reset };
};
