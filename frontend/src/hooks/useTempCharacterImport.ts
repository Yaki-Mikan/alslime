/**
 * useTempCharacterImport - セッションからの一時キャラクター取り込みの順次投入・進捗管理フック
 *
 * チェックしたキャラを 1 キャラ 1 ジョブで順に投入する。同時に動く分析は常に 1 つ。
 * 1 キャラの分析が完了したら onRegistered（画面側で会話設定を読み直す）を呼び、
 * その完了を待たずに次のキャラを投入する。失敗したらそこで止め、やり直しは項目単位。
 * 状態は Chat 側（画面本体）で保持し、小窓を閉じても進行は続く。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
    submitConfigGenFromSession,
    getConfigGenStatus,
    cancelConfigGen,
    getConfigGenActive,
    type ConfigGenResultFile,
} from '../api/config-gen';
import type { SpeakerEntry } from '../lib/tempCharacterSpeakers';

const POLL_INTERVAL_MS = 2000;
const POLL_GRACE_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;

export type TempImportItemStatus = 'pending' | 'analyzing' | 'registered' | 'failed' | 'canceled';

export interface TempImportItem {
    speaker: SpeakerEntry;
    status: TempImportItemStatus;
    jobId?: string;
    errorKey?: string;
}

export interface TempImportOptions {
    model: string;
    claudeEffort?: string;
    antigravityThinking?: string;
    timeoutMinutes?: number;
    locale?: string;
    /** AI 用の設定ファイルテンプレート名（manualTemplate と排他） */
    settingTemplate?: string;
    /** 手動作成用の雛形名（settingTemplate と排他） */
    manualTemplate?: string;
}

export interface TempCharacterImportHandle {
    running: boolean;
    sessionId: string | null;
    items: TempImportItem[];
    start: (sessionId: string, speakers: SpeakerEntry[], options: TempImportOptions) => void;
    retry: (index: number) => void;
    cancel: () => void;
    reset: () => void;
    /**
     * 画面を読み込み直した後などに、サーバーで走っている分析ジョブの完了を拾う監視。
     * 話者一覧は失われているため進捗には載せず、完了時に会話設定を読み直すだけ行う。
     */
    watchActive: (sessionId: string) => void;
}

/** 通信エラーから状態コードと応答本文の要点を取り出す */
const errorInfo = (error: unknown): { status?: number; messageKey?: string; existingJobId?: string } => {
    const e = error as { response?: { status?: number; data?: { messageKey?: string; error?: string; existingJobId?: string } } } | undefined;
    return {
        status: e?.response?.status,
        messageKey: e?.response?.data?.messageKey || e?.response?.data?.error,
        existingJobId: e?.response?.data?.existingJobId,
    };
};

export function useTempCharacterImport(
    backendUrl: string,
    onRegistered: (sessionId: string, result: ConfigGenResultFile) => void
): TempCharacterImportHandle {
    const [items, setItems] = useState<TempImportItem[]>([]);
    const [running, setRunning] = useState(false);
    const [sessionId, setSessionId] = useState<string | null>(null);
    const itemsRef = useRef<TempImportItem[]>([]);
    const sessionRef = useRef<string | null>(null);
    const optionsRef = useRef<TempImportOptions | null>(null);
    const activeJobRef = useRef<{ jobId: string; index: number } | null>(null);
    const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pollDeadline = useRef(0);
    const onRegisteredRef = useRef(onRegistered);
    useEffect(() => {
        onRegisteredRef.current = onRegistered;
    });
    // poll と runNext は互いに呼び合うため ref 経由で参照する（描画後に最新の関数へ差し替える）。
    const pollRef = useRef<(jobId: string, index: number) => void>(() => {});
    const runNextRef = useRef<() => void>(() => {});

    const commit = useCallback((next: TempImportItem[]) => {
        itemsRef.current = next;
        setItems(next);
    }, []);

    const patch = useCallback((index: number, update: Partial<TempImportItem>) => {
        commit(itemsRef.current.map((item, i) => (i === index ? { ...item, ...update } : item)));
    }, [commit]);

    const clearPoll = useCallback(() => {
        if (pollTimer.current) {
            clearTimeout(pollTimer.current);
            pollTimer.current = null;
        }
    }, []);

    useEffect(() => clearPoll, [clearPoll]);

    const stop = useCallback(() => {
        clearPoll();
        activeJobRef.current = null;
        setRunning(false);
    }, [clearPoll]);

    const schedulePoll = useCallback((jobId: string, index: number) => {
        pollTimer.current = setTimeout(() => pollRef.current(jobId, index), POLL_INTERVAL_MS);
    }, []);

    const poll = useCallback(async (jobId: string, index: number) => {
        const active = activeJobRef.current;
        if (!active || active.jobId !== jobId) return;
        if (Date.now() > pollDeadline.current) {
            patch(index, { status: 'failed', errorKey: 'error.configgen.timeout' });
            stop();
            return;
        }
        try {
            const status = await getConfigGenStatus(backendUrl, jobId, 0);
            if (!activeJobRef.current || activeJobRef.current.jobId !== jobId) return;
            if (status.status === 'completed') {
                patch(index, { status: 'registered' });
                activeJobRef.current = null;
                const sid = sessionRef.current;
                if (sid && status.result) {
                    onRegisteredRef.current(sid, status.result);
                }
                runNextRef.current();
                return;
            }
            if (status.status === 'error' || status.status === 'canceled') {
                patch(index, { status: status.status === 'canceled' ? 'canceled' : 'failed', errorKey: status.error || undefined });
                stop();
                return;
            }
        } catch (error) {
            if (errorInfo(error).status === 404) {
                patch(index, { status: 'failed', errorKey: 'error.jobNotFound' });
                stop();
                return;
            }
        }
        schedulePoll(jobId, index);
    }, [backendUrl, patch, stop, schedulePoll]);

    const runNext = useCallback(async () => {
        const index = itemsRef.current.findIndex(item => item.status === 'pending');
        const sid = sessionRef.current;
        const options = optionsRef.current;
        if (index < 0 || !sid || !options) {
            stop();
            return;
        }
        patch(index, { status: 'analyzing', jobId: undefined, errorKey: undefined });
        setRunning(true);
        try {
            const { jobId } = await submitConfigGenFromSession(backendUrl, {
                sessionId: sid,
                targetCharacter: itemsRef.current[index].speaker.displayName,
                settingTemplate: options.settingTemplate,
                manualTemplate: options.manualTemplate,
                model: options.model,
                claudeEffort: options.claudeEffort,
                antigravityThinking: options.antigravityThinking,
                timeoutMinutes: options.timeoutMinutes,
                locale: options.locale,
            });
            patch(index, { jobId });
            const timeoutMs = options.timeoutMinutes && options.timeoutMinutes > 0 ? options.timeoutMinutes * 60 * 1000 : DEFAULT_TIMEOUT_MS;
            pollDeadline.current = Date.now() + timeoutMs + POLL_GRACE_MS;
            activeJobRef.current = { jobId, index };
            schedulePoll(jobId, index);
        } catch (error) {
            const info = errorInfo(error);
            // 409（同じ話者の二重投入）は既存ジョブへ接続する。
            if (info.status === 409 && info.existingJobId) {
                patch(index, { jobId: info.existingJobId });
                pollDeadline.current = Date.now() + DEFAULT_TIMEOUT_MS + POLL_GRACE_MS;
                activeJobRef.current = { jobId: info.existingJobId, index };
                schedulePoll(info.existingJobId, index);
                return;
            }
            patch(index, { status: 'failed', errorKey: info.messageKey || 'ssrp.tempImport.submitFailed' });
            stop();
        }
    }, [backendUrl, patch, stop, schedulePoll]);
    useEffect(() => {
        pollRef.current = poll;
        runNextRef.current = runNext;
    }, [poll, runNext]);

    const start = useCallback((sid: string, speakers: SpeakerEntry[], options: TempImportOptions) => {
        if (activeJobRef.current) return;
        sessionRef.current = sid;
        optionsRef.current = options;
        setSessionId(sid);
        commit(speakers.map(speaker => ({ speaker, status: 'pending' as const })));
        void runNextRef.current();
    }, [commit]);

    const retry = useCallback((index: number) => {
        if (activeJobRef.current) return;
        const item = itemsRef.current[index];
        if (!item || (item.status !== 'failed' && item.status !== 'canceled')) return;
        patch(index, { status: 'pending', errorKey: undefined, jobId: undefined });
        void runNextRef.current();
    }, [patch]);

    const cancel = useCallback(() => {
        const active = activeJobRef.current;
        if (active) {
            cancelConfigGen(backendUrl, active.jobId).catch(() => {});
        }
        commit(itemsRef.current.map(item => (item.status === 'pending' ? { ...item, status: 'canceled' as const } : item)));
        // 実行中の項目はサーバー側の中止結果をポーリングで受けて確定する。
    }, [backendUrl, commit]);

    const reset = useCallback(() => {
        if (activeJobRef.current) return;
        commit([]);
        sessionRef.current = null;
        optionsRef.current = null;
        setSessionId(null);
        setRunning(false);
    }, [commit]);

    const watchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => {
        if (watchTimer.current) clearTimeout(watchTimer.current);
    }, []);
    const watchActive = useCallback((sid: string) => {
        if (activeJobRef.current) return;
        if (watchTimer.current) {
            clearTimeout(watchTimer.current);
            watchTimer.current = null;
        }
        void (async () => {
            let active;
            try {
                active = await getConfigGenActive(backendUrl);
            } catch {
                return;
            }
            if (!active.active || !active.jobId) return;
            const jobId = active.jobId;
            const deadline = Date.now() + 60 * 60 * 1000 + POLL_GRACE_MS;
            const tick = async () => {
                // 通常の投入が始まったら監視は不要（そちらのポーリングが拾う）。
                if (activeJobRef.current || Date.now() > deadline) return;
                try {
                    const status = await getConfigGenStatus(backendUrl, jobId, 0);
                    if (status.status === 'completed') {
                        if (status.result?.kind === 'tempCharacter') {
                            onRegisteredRef.current(sid, status.result);
                        }
                        return;
                    }
                    if (status.status === 'error' || status.status === 'canceled') return;
                } catch (error) {
                    if (errorInfo(error).status === 404) return;
                }
                watchTimer.current = setTimeout(tick, POLL_INTERVAL_MS);
            };
            watchTimer.current = setTimeout(tick, POLL_INTERVAL_MS);
        })();
    }, [backendUrl]);

    return { running, sessionId, items, start, retry, cancel, reset, watchActive };
}
