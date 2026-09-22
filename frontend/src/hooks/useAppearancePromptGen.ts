/**
 * useAppearancePromptGen - キャラクター容姿プロンプト作成の状態・投入・進捗管理フック
 *
 * 1 キャラ 1 ジョブ。対象（フォルダ名・設定ファイル名）と小窓の開閉、モデル選択の現在値、
 * 実行中のジョブ、結果（タグ行）を持つ。状態は設定ファイルエディタと画像生成統合設定の
 * 両方の親（ConfigEditorHub）で保持し、区画の開閉やタブ切替、小窓を閉じても失われない。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
    submitAppearancePrompt,
    getAppearancePromptStatus,
    cancelAppearancePrompt,
    type AppearancePromptResult,
} from '../api/appearance-prompt';
import type { ModelProvider } from './useChat';

const POLL_INTERVAL_MS = 2000;
const POLL_GRACE_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export interface AppearanceTarget {
    dirName: string;
    fileName: string;
    displayName: string;
}

export interface AppearanceCurrent {
    characterPrompt: string;
    physicalFeatures: string;
}

export type AppearancePromptRunStatus = 'idle' | 'running' | 'completed' | 'failed' | 'canceled';

export interface AppearancePromptOptions {
    provider: ModelProvider;
    model: string;
    claudeEffort?: string;
    antigravityThinking?: string;
    timeoutMinutes?: number;
    locale?: string;
}

export interface AppearancePromptHandle {
    isOpen: boolean;
    target: AppearanceTarget | null;
    current: AppearanceCurrent;
    status: AppearancePromptRunStatus;
    errorKey?: string;
    result: AppearancePromptResult | null;
    running: boolean;
    /** 小窓を開く。対象が前回と違えば結果を捨てる */
    open: (target: AppearanceTarget, current: AppearanceCurrent) => void;
    close: () => void;
    /** 分析を投入してポーリングを始める */
    start: (options: AppearancePromptOptions) => void;
    cancel: () => void;
    /** 結果と状態を捨てる（実行中は何もしない） */
    reset: () => void;
}

const sameTarget = (a: AppearanceTarget | null, b: AppearanceTarget | null): boolean =>
    !!a && !!b && a.dirName === b.dirName && a.fileName === b.fileName;

/** 通信エラーから状態コードと応答本文の要点を取り出す */
const errorInfo = (error: unknown): { status?: number; messageKey?: string; existingJobId?: string } => {
    const e = error as { response?: { status?: number; data?: { messageKey?: string; error?: string; existingJobId?: string } } } | undefined;
    return {
        status: e?.response?.status,
        messageKey: e?.response?.data?.messageKey || e?.response?.data?.error,
        existingJobId: e?.response?.data?.existingJobId,
    };
};

export function useAppearancePromptGen(backendUrl: string): AppearancePromptHandle {
    const [isOpen, setIsOpen] = useState(false);
    const [target, setTarget] = useState<AppearanceTarget | null>(null);
    const [current, setCurrent] = useState<AppearanceCurrent>({ characterPrompt: '', physicalFeatures: '' });
    const [status, setStatus] = useState<AppearancePromptRunStatus>('idle');
    const [errorKey, setErrorKey] = useState<string | undefined>(undefined);
    const [result, setResult] = useState<AppearancePromptResult | null>(null);
    const targetRef = useRef<AppearanceTarget | null>(null);
    const activeJobRef = useRef<string | null>(null);
    const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pollDeadline = useRef(0);
    const pollRef = useRef<(jobId: string) => void>(() => {});

    const clearPoll = useCallback(() => {
        if (pollTimer.current) {
            clearTimeout(pollTimer.current);
            pollTimer.current = null;
        }
    }, []);

    useEffect(() => clearPoll, [clearPoll]);

    const finish = useCallback((next: AppearancePromptRunStatus, key?: string) => {
        clearPoll();
        activeJobRef.current = null;
        setStatus(next);
        setErrorKey(key);
    }, [clearPoll]);

    const schedulePoll = useCallback((jobId: string) => {
        pollTimer.current = setTimeout(() => pollRef.current(jobId), POLL_INTERVAL_MS);
    }, []);

    const poll = useCallback(async (jobId: string) => {
        if (activeJobRef.current !== jobId) return;
        if (Date.now() > pollDeadline.current) {
            finish('failed', 'comfyui.appearancePrompt.timeoutError');
            return;
        }
        try {
            const st = await getAppearancePromptStatus(backendUrl, jobId);
            if (activeJobRef.current !== jobId) return;
            if (st.status === 'completed') {
                // 実行中に対象を切り替えていたら、その結果は捨てる（別キャラの結果を混ぜない）。
                const cur = targetRef.current;
                if (st.result && cur && st.result.dirName === cur.dirName && st.result.fileName === cur.fileName) {
                    setResult(st.result);
                    finish('completed');
                } else {
                    setResult(null);
                    finish('idle');
                }
                return;
            }
            if (st.status === 'error' || st.status === 'canceled') {
                finish(st.status === 'canceled' ? 'canceled' : 'failed', st.error || undefined);
                return;
            }
        } catch (error) {
            if (errorInfo(error).status === 404) {
                finish('failed', 'error.jobNotFound');
                return;
            }
        }
        schedulePoll(jobId);
    }, [backendUrl, finish, schedulePoll]);
    useEffect(() => {
        pollRef.current = poll;
    }, [poll]);

    const open = useCallback((next: AppearanceTarget, cur: AppearanceCurrent) => {
        if (!sameTarget(targetRef.current, next)) {
            // 実行中のジョブは続ける。完了時に対象が違えば結果は捨てられる。
            setResult(null);
            if (!activeJobRef.current) {
                setStatus('idle');
                setErrorKey(undefined);
            }
        }
        targetRef.current = next;
        setTarget(next);
        setCurrent(cur);
        setIsOpen(true);
    }, []);

    const close = useCallback(() => setIsOpen(false), []);

    const start = useCallback((options: AppearancePromptOptions) => {
        const tgt = targetRef.current;
        if (activeJobRef.current || !tgt || !options.model) return;
        setStatus('running');
        setErrorKey(undefined);
        setResult(null);
        // 投入前に仮の ID を置き、二重投入を防ぐ。
        activeJobRef.current = 'pending';
        void (async () => {
            const attach = (jobId: string, timeoutMs: number) => {
                pollDeadline.current = Date.now() + timeoutMs + POLL_GRACE_MS;
                activeJobRef.current = jobId;
                schedulePoll(jobId);
            };
            try {
                const { jobId } = await submitAppearancePrompt(backendUrl, {
                    dirName: tgt.dirName,
                    fileName: tgt.fileName,
                    provider: options.provider,
                    model: options.model,
                    claudeEffort: options.claudeEffort,
                    antigravityThinking: options.antigravityThinking,
                    timeoutMinutes: options.timeoutMinutes,
                    locale: options.locale,
                    currentCharacterPrompt: current.characterPrompt,
                    currentPhysicalFeatures: current.physicalFeatures,
                });
                const timeoutMs = options.timeoutMinutes && options.timeoutMinutes > 0 ? options.timeoutMinutes * 60 * 1000 : DEFAULT_TIMEOUT_MS;
                attach(jobId, timeoutMs);
            } catch (error) {
                const info = errorInfo(error);
                // 409（同じ対象の二重投入）は既存ジョブへ接続する。
                if (info.status === 409 && info.existingJobId) {
                    attach(info.existingJobId, DEFAULT_TIMEOUT_MS);
                    return;
                }
                finish('failed', info.messageKey || 'comfyui.appearancePrompt.submitFailed');
            }
        })();
    }, [backendUrl, current, finish, schedulePoll]);

    const cancel = useCallback(() => {
        const jobId = activeJobRef.current;
        if (!jobId || jobId === 'pending') return;
        cancelAppearancePrompt(backendUrl, jobId).catch(() => {});
        // 中止の確定はポーリングで受ける。
    }, [backendUrl]);

    const reset = useCallback(() => {
        if (activeJobRef.current) return;
        setResult(null);
        setStatus('idle');
        setErrorKey(undefined);
    }, []);

    return {
        isOpen,
        target,
        current,
        status,
        errorKey,
        result,
        running: status === 'running',
        open,
        close,
        start,
        cancel,
        reset,
    };
}
