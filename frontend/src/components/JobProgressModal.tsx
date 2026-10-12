/**
 * JobProgressModal.tsx - ジョブ進行状況モーダル
 *
 * 実行中・待機中のジョブ一覧を表示し、待機中ジョブをキャンセルできる。
 */

import React, { useState, useEffect, useCallback } from 'react';
import { X, Loader2, Clock, AlertCircle, XCircle } from 'lucide-react';
import { fetchJobs, cancelJob, type Job, type JobsResponse } from '../api/jobs';
import { BACKEND_URL } from '../api/base-url';
import { resolveBackendError, resolveMessage, type I18NCatalog } from '../api/i18n';
import { COMMON_I18N_KEYS, COMMON_TEXT_FALLBACK_JA, JOBS_I18N_KEYS, JOBS_TEXT_FALLBACK_JA } from '../constants/i18n';
import { openAICompatLabel } from '../constants/providers';

const KIND_LABEL: Record<string, string> = {
    gemini: 'Gemini',
    claude: 'Claude',
    antigravity: 'Antigravity',
    comfyui: 'ComfyUI',
};

const KIND_COLOR: Record<string, string> = {
    gemini: 'text-accent bg-accent-soft border-line-strong',
    claude: 'text-accent bg-accent-soft border-line-strong',
    antigravity: 'text-accent bg-accent-soft border-line-strong',
    openai_compat: 'text-ok bg-ok/10 border-line-strong',
    comfyui: 'text-accent bg-accent-soft border-line-strong',
};

function elapsed(job: Job): string {
    const start = job.startedAt ?? job.createdAt;
    const sec = Math.floor((Date.now() - start) / 1000);
    if (sec < 60) return `${sec}s`;
    return `${Math.floor(sec / 60)}m${sec % 60}s`;
}

function KindBadge({ kind, uiCatalog }: { kind: string; uiCatalog: I18NCatalog | null }) {
    // API は製品名ではないので、表示言語の文言表から名前を引く
    const label = kind === 'openai_compat' ? openAICompatLabel(uiCatalog) : (KIND_LABEL[kind] || kind);
    return (
        <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${KIND_COLOR[kind] || 'text-fg-muted bg-surface border-line-strong'}`}>
            {label}
        </span>
    );
}

interface Props {
    isOpen: boolean;
    onClose: () => void;
    uiCatalog?: I18NCatalog | null;
}

export const JobProgressModal: React.FC<Props> = ({ isOpen, onClose, uiCatalog = null }) => {
    const t = (key: string) => resolveMessage(
        uiCatalog,
        key,
        JOBS_TEXT_FALLBACK_JA[key] || COMMON_TEXT_FALLBACK_JA[key] || key
    );
    // ジョブの表示名は辞書キー（画像生成など）か会話の題で届く。キーなら表示言語の文にする
    const jobLabel = (job: Job) => resolveMessage(uiCatalog, job.label, job.label);
    const formatText = (template: string, values: Record<string, string | number>) => {
        return Object.entries(values).reduce((text, [key, value]) => {
            return text.split(`{{${key}}}`).join(String(value));
        }, template);
    };
    const [data, setData] = useState<JobsResponse | null>(null);
    const [cancelingIds, setCancelingIds] = useState<Set<string>>(new Set());

    const load = useCallback(async () => {
        try {
            const res = await fetchJobs(BACKEND_URL);
            setData(res);
        } catch {
            // ポーリング失敗は静かに無視
        }
    }, []);

    useEffect(() => {
        if (!isOpen) return;
        load();
        const id = setInterval(load, 1500);
        return () => clearInterval(id);
    }, [isOpen, load]);

    const handleCancel = async (jobId: string) => {
        setCancelingIds(prev => new Set(prev).add(jobId));
        try {
            await cancelJob(BACKEND_URL, jobId);
            await load();
        } catch {
            // キャンセル失敗は状態のリフレッシュに任せる
        } finally {
            setCancelingIds(prev => { const s = new Set(prev); s.delete(jobId); return s; });
        }
    };

    if (!isOpen) return null;

    const running = data?.jobs.filter(j => j.status === 'processing') ?? [];
    const pending = data?.jobs.filter(j => j.status === 'pending') ?? [];

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="bg-surface-solid rounded-xl shadow-2xl w-full max-w-md border border-line-strong overflow-hidden">
                {/* ヘッダー */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-line-strong bg-surface">
                    <div className="flex items-center gap-2">
                        <Loader2 size={18} className="text-fg-muted" />
                        <h3 className="font-semibold text-fg text-base">{t(JOBS_I18N_KEYS.progressTitle)}</h3>
                        {data && (
                            <span className="text-xs text-fg-muted ml-1">
                                ({formatText(t(JOBS_I18N_KEYS.globalUsage), { used: data.inUse.global, limit: data.limits.global })})
                            </span>
                        )}
                    </div>
                    <button onClick={onClose} className="p-1.5 hover:bg-surface-2 rounded text-fg-muted hover:text-fg transition-colors">
                        <X size={18} />
                    </button>
                </div>

                <div className="p-4 space-y-4 max-h-[60vh] overflow-y-auto custom-scrollbar">
                    {/* 実行中 */}
                    <section>
                        <h4 className="text-xs font-medium text-fg-muted mb-2 uppercase tracking-wide">{t(JOBS_I18N_KEYS.running)} ({running.length})</h4>
                        {running.length === 0 ? (
                            <p className="text-sm text-fg-muted py-2 text-center">{t(COMMON_I18N_KEYS.none)}</p>
                        ) : (
                            <ul className="space-y-2">
                                {running.map(job => (
                                    <li key={job.jobId} className="flex items-center gap-2 p-2.5 bg-surface rounded-lg border border-line-strong">
                                        <Loader2 size={14} className="text-fg-muted animate-spin shrink-0" />
                                        <KindBadge kind={job.kind} uiCatalog={uiCatalog} />
                                        <span className="flex-1 text-sm text-fg truncate">{jobLabel(job)}</span>
                                        <span className="text-xs text-fg-muted shrink-0">{elapsed(job)}</span>
                                        <button
                                            onClick={() => handleCancel(job.jobId)}
                                            disabled={cancelingIds.has(job.jobId)}
                                            className="shrink-0 p-1 hover:bg-danger/10 rounded text-fg-muted hover:text-danger transition-colors disabled:opacity-40"
                                            title={t(JOBS_I18N_KEYS.stop)}
                                        >
                                            <XCircle size={16} />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>

                    {/* 待機中 */}
                    <section>
                        <h4 className="text-xs font-medium text-fg-muted mb-2 uppercase tracking-wide">{t(JOBS_I18N_KEYS.pending)} ({pending.length})</h4>
                        {pending.length === 0 ? (
                            <p className="text-sm text-fg-muted py-2 text-center">{t(COMMON_I18N_KEYS.none)}</p>
                        ) : (
                            <ul className="space-y-2">
                                {pending.map(job => (
                                    <li key={job.jobId} className="flex items-center gap-2 p-2.5 bg-surface rounded-lg border border-line-strong">
                                        <Clock size={14} className="text-fg-muted shrink-0" />
                                        <KindBadge kind={job.kind} uiCatalog={uiCatalog} />
                                        <span className="flex-1 text-sm text-fg-muted truncate">{jobLabel(job)}</span>
                                        <button
                                            onClick={() => handleCancel(job.jobId)}
                                            disabled={cancelingIds.has(job.jobId)}
                                            className="shrink-0 p-1 hover:bg-danger/10 rounded text-fg-muted hover:text-danger transition-colors disabled:opacity-40"
                                            title={t(JOBS_I18N_KEYS.cancel)}
                                        >
                                            <XCircle size={16} />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>

                    {/* エラー（直近のみ） */}
                    {data?.jobs.filter(j => j.status === 'error').slice(0, 3).map(job => (
                        <div key={job.jobId} className="flex items-start gap-2 p-2.5 bg-danger/10 rounded-lg border border-danger/40 text-xs text-danger">
                            <AlertCircle size={14} className="shrink-0 mt-0.5" />
                            <span className="truncate">{jobLabel(job)}: {job.error ? resolveBackendError(uiCatalog, job.error) : t(JOBS_I18N_KEYS.genericError)}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};
