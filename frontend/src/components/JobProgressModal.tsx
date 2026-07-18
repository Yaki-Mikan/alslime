/**
 * JobProgressModal.tsx - ジョブ進行状況モーダル
 *
 * 実行中・待機中のジョブ一覧を表示し、待機中ジョブをキャンセルできる。
 */

import React, { useState, useEffect, useCallback } from 'react';
import { X, Loader2, Clock, AlertCircle, XCircle } from 'lucide-react';
import { fetchJobs, cancelJob, type Job, type JobsResponse } from '../api/jobs';
import { BACKEND_URL } from '../api/base-url';
import { resolveMessage, type I18NCatalog } from '../api/i18n';
import { COMMON_I18N_KEYS, COMMON_TEXT_FALLBACK_JA, JOBS_I18N_KEYS, JOBS_TEXT_FALLBACK_JA } from '../constants/i18n';

const KIND_LABEL: Record<string, string> = {
    gemini: 'Gemini',
    claude: 'Claude',
    antigravity: 'Antigravity',
};

const KIND_COLOR: Record<string, string> = {
    gemini: 'text-blue-400 bg-blue-900/40 border-blue-700',
    claude: 'text-orange-400 bg-orange-900/40 border-orange-700',
    antigravity: 'text-purple-400 bg-purple-900/40 border-purple-700',
};

function elapsed(job: Job): string {
    const start = job.startedAt ?? job.createdAt;
    const sec = Math.floor((Date.now() - start) / 1000);
    if (sec < 60) return `${sec}s`;
    return `${Math.floor(sec / 60)}m${sec % 60}s`;
}

function KindBadge({ kind }: { kind: string }) {
    return (
        <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${KIND_COLOR[kind] || 'text-gray-400 bg-gray-800 border-gray-600'}`}>
            {KIND_LABEL[kind] || kind}
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
            <div className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-md border border-gray-700 overflow-hidden">
                {/* ヘッダー */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 bg-gray-800">
                    <div className="flex items-center gap-2">
                        <Loader2 size={18} className="text-gray-400" />
                        <h3 className="font-semibold text-gray-100 text-base">{t(JOBS_I18N_KEYS.progressTitle)}</h3>
                        {data && (
                            <span className="text-xs text-gray-500 ml-1">
                                ({formatText(t(JOBS_I18N_KEYS.globalUsage), { used: data.inUse.global, limit: data.limits.global })})
                            </span>
                        )}
                    </div>
                    <button onClick={onClose} className="p-1.5 hover:bg-gray-700 rounded text-gray-400 hover:text-gray-200 transition-colors">
                        <X size={18} />
                    </button>
                </div>

                <div className="p-4 space-y-4 max-h-[60vh] overflow-y-auto custom-scrollbar">
                    {/* 実行中 */}
                    <section>
                        <h4 className="text-xs font-medium text-gray-400 mb-2 uppercase tracking-wide">{t(JOBS_I18N_KEYS.running)} ({running.length})</h4>
                        {running.length === 0 ? (
                            <p className="text-sm text-gray-600 py-2 text-center">{t(COMMON_I18N_KEYS.none)}</p>
                        ) : (
                            <ul className="space-y-2">
                                {running.map(job => (
                                    <li key={job.jobId} className="flex items-center gap-2 p-2.5 bg-gray-800 rounded-lg border border-gray-700">
                                        <Loader2 size={14} className="text-gray-400 animate-spin shrink-0" />
                                        <KindBadge kind={job.kind} />
                                        <span className="flex-1 text-sm text-gray-200 truncate">{job.label}</span>
                                        <span className="text-xs text-gray-500 shrink-0">{elapsed(job)}</span>
                                        <button
                                            onClick={() => handleCancel(job.jobId)}
                                            disabled={cancelingIds.has(job.jobId)}
                                            className="shrink-0 p-1 hover:bg-red-900/40 rounded text-gray-500 hover:text-red-400 transition-colors disabled:opacity-40"
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
                        <h4 className="text-xs font-medium text-gray-400 mb-2 uppercase tracking-wide">{t(JOBS_I18N_KEYS.pending)} ({pending.length})</h4>
                        {pending.length === 0 ? (
                            <p className="text-sm text-gray-600 py-2 text-center">{t(COMMON_I18N_KEYS.none)}</p>
                        ) : (
                            <ul className="space-y-2">
                                {pending.map(job => (
                                    <li key={job.jobId} className="flex items-center gap-2 p-2.5 bg-gray-800 rounded-lg border border-gray-700">
                                        <Clock size={14} className="text-gray-500 shrink-0" />
                                        <KindBadge kind={job.kind} />
                                        <span className="flex-1 text-sm text-gray-300 truncate">{job.label}</span>
                                        <button
                                            onClick={() => handleCancel(job.jobId)}
                                            disabled={cancelingIds.has(job.jobId)}
                                            className="shrink-0 p-1 hover:bg-red-900/40 rounded text-gray-500 hover:text-red-400 transition-colors disabled:opacity-40"
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
                        <div key={job.jobId} className="flex items-start gap-2 p-2.5 bg-red-950/30 rounded-lg border border-red-900/50 text-xs text-red-400">
                            <AlertCircle size={14} className="shrink-0 mt-0.5" />
                            <span className="truncate">{job.label}: {job.error || t(JOBS_I18N_KEYS.genericError)}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};
