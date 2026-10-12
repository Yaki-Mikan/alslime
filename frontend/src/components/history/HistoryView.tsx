import React, { useMemo, useState } from 'react';
import { ListChecks, Plus, Search, Trash2 } from 'lucide-react';
import { formatPair, joinNames, resolveMessage, type I18NCatalog } from '../../api/i18n';
import {
    CHAT_VIEW_I18N_KEYS,
    CHAT_VIEW_TEXT_FALLBACK_JA,
    COMMON_I18N_KEYS,
    COMMON_TEXT_FALLBACK_JA,
} from '../../constants/i18n';
import type { Session } from '../../hooks/useSession';
import { matchesHistoryQuery } from './historySearch';
import { Button, IconButton, Modal, cn } from '../ui';

interface HistoryViewProps {
    sessions: Session[];
    currentSessionId: string | null;
    uiCatalog: I18NCatalog | null;
    onResume: (session: Session) => void;
    onNew: () => void;
    deleteSession: (sessionId: string) => Promise<boolean>;
    deleteSessions: (sessionIds: string[]) => Promise<{ deletedIds: string[]; failedCount: number }>;
    /** 開いている会話を消したとき（新しい会話の状態へ戻す） */
    onCurrentDeleted: () => Promise<void> | void;
}

const fill = (template: string, values: Record<string, string | number>) =>
    Object.entries(values).reduce((text, [key, value]) => text.split(`{{${key}}}`).join(String(value)), template);

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** 最後に更新してからの経過時間（1 分未満・分・時間・日）を表示言語の文で返す。時刻が無ければ空。 */
const timeAgoText = (timestamp: number | undefined, t: (key: string) => string) => {
    if (!timestamp) return '';
    const elapsed = Date.now() - timestamp;
    if (elapsed < MINUTE_MS) return t(CHAT_VIEW_I18N_KEYS.historyTimeAgoJustNow);
    const [key, unit] = elapsed < HOUR_MS
        ? [CHAT_VIEW_I18N_KEYS.historyTimeAgoMinutes, MINUTE_MS]
        : elapsed < DAY_MS
            ? [CHAT_VIEW_I18N_KEYS.historyTimeAgoHours, HOUR_MS]
            : [CHAT_VIEW_I18N_KEYS.historyTimeAgoDays, DAY_MS];
    return fill(t(key), { count: Math.max(1, Math.floor(elapsed / unit)) });
};

const isThisMonth = (timestamp: number | undefined, now: Date) => {
    if (!timestamp) return false;
    const d = new Date(timestamp);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
};

/** 履歴の画面。探す・月で分ける・再開・削除・まとめて削除。 */
export const HistoryView: React.FC<HistoryViewProps> = ({
    sessions,
    currentSessionId,
    uiCatalog,
    onResume,
    onNew,
    deleteSession,
    deleteSessions,
    onCurrentDeleted,
}) => {
    const t = (key: string) => resolveMessage(
        uiCatalog,
        key,
        CHAT_VIEW_TEXT_FALLBACK_JA[key] || COMMON_TEXT_FALLBACK_JA[key] || key,
    );
    const [query, setQuery] = useState('');
    const [selectMode, setSelectMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
    const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);

    const groups = useMemo(() => {
        const matched = sessions.filter(s => matchesHistoryQuery(s, query));
        const now = new Date();
        return [
            { key: CHAT_VIEW_I18N_KEYS.historyThisMonth, items: matched.filter(s => isThisMonth(s.timestamp, now)) },
            { key: CHAT_VIEW_I18N_KEYS.historyEarlier, items: matched.filter(s => !isThisMonth(s.timestamp, now)) },
        ].filter(g => g.items.length > 0);
    }, [sessions, query]);

    const leaveSelectMode = () => {
        setSelectMode(false);
        setSelectedIds(new Set());
    };

    const toggleSelected = (id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const confirmDeleteOne = async () => {
        if (!deleteTarget) return;
        const target = deleteTarget;
        setDeleteTarget(null);
        if (!await deleteSession(target.id)) {
            window.alert(t(CHAT_VIEW_I18N_KEYS.deleteSessionFailed));
            return;
        }
        if (currentSessionId === target.id) await onCurrentDeleted();
    };

    const confirmDeleteMany = async () => {
        const ids = Array.from(selectedIds);
        setBulkConfirmOpen(false);
        if (ids.length === 0) return;
        const { deletedIds, failedCount } = await deleteSessions(ids);
        // 失敗した分は選んだまま残し、やり直せるようにする
        setSelectedIds(prev => {
            const next = new Set(prev);
            deletedIds.forEach(id => next.delete(id));
            return next;
        });
        if (failedCount > 0) window.alert(t(CHAT_VIEW_I18N_KEYS.deleteSessionFailed));
        if (currentSessionId && deletedIds.includes(currentSessionId)) await onCurrentDeleted();
    };

    return (
        <div className="flex-1 min-h-0 flex flex-col">
            <div className="flex-1 min-h-0 overflow-auto">
                <div className="max-w-3xl mx-auto px-4 sm:px-8 py-6 sm:py-8">
                    <div className="flex items-center gap-2 mb-5">
                        <h1 className="flex-1 font-head text-lg font-bold tracking-wide">{t(CHAT_VIEW_I18N_KEYS.historyTitle)}</h1>
                        <IconButton
                            label={t(CHAT_VIEW_I18N_KEYS.deleteSessionSelectMode)}
                            active={selectMode}
                            onClick={() => (selectMode ? leaveSelectMode() : setSelectMode(true))}
                        >
                            <ListChecks size={18} />
                        </IconButton>
                        <Button variant="primary" onClick={onNew}>
                            <Plus size={16} />
                            {t(CHAT_VIEW_I18N_KEYS.historyNew)}
                        </Button>
                    </div>

                    <label className="relative block mb-2">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted pointer-events-none" />
                        <input
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder={t(CHAT_VIEW_I18N_KEYS.historySearch)}
                            className="w-full h-10 pl-9 pr-3 rounded-ui bg-surface border border-line-strong text-fg text-sm outline-none focus:border-accent placeholder:text-fg-muted"
                        />
                    </label>

                    {sessions.length === 0 ? (
                        <p className="py-12 text-center text-sm text-fg-muted">{t(CHAT_VIEW_I18N_KEYS.noSessionHistory)}</p>
                    ) : groups.length === 0 ? (
                        <p className="py-12 text-center text-sm text-fg-muted">{t(CHAT_VIEW_I18N_KEYS.historyNoMatch)}</p>
                    ) : groups.map(group => (
                        <section key={group.key}>
                            <h2 className="mt-6 mb-2 text-xs font-semibold tracking-wider text-fg-muted">{t(group.key)}</h2>
                            <ul className="flex flex-col gap-0.5">
                                {group.items.map(session => {
                                    const names = session.characters || [];
                                    const detail = [
                                        session.presetName ? `${t(CHAT_VIEW_I18N_KEYS.sessionInfoPreset)}: ${session.presetName}` : '',
                                        (session.situations || []).length > 0 ? `${t(CHAT_VIEW_I18N_KEYS.sessionInfoSituations)}: ${(session.situations || []).join(', ')}` : '',
                                    ].filter(Boolean).join('　');
                                    const selected = selectedIds.has(session.id);
                                    return (
                                        <li key={session.id} className="group flex items-center gap-1 rounded-ui-lg hover:bg-surface">
                                            <button
                                                type="button"
                                                onClick={() => (selectMode ? toggleSelected(session.id) : onResume(session))}
                                                aria-pressed={selectMode ? selected : undefined}
                                                className="flex-1 min-w-0 flex items-center gap-3 px-3 py-2.5 text-left"
                                            >
                                                {selectMode ? (
                                                    <input type="checkbox" checked={selected} readOnly className="pointer-events-none shrink-0 w-4 h-4 accent-[var(--c-accent)]" />
                                                ) : (
                                                    <span className="grid place-items-center w-8 h-8 shrink-0 rounded-full bg-surface-2 text-fg text-xs font-bold">
                                                        {(names[0] || session.title || '?').slice(0, 1)}
                                                    </span>
                                                )}
                                                <span className="min-w-0 flex-1">
                                                    <span className={cn('block truncate text-sm', session.id === currentSessionId ? 'font-bold text-fg' : 'text-fg')}>
                                                        {session.title}
                                                    </span>
                                                    <span className="block truncate text-xs text-fg-muted">
                                                        {(() => {
                                                            const namesText = joinNames(uiCatalog, names.filter(Boolean));
                                                            const ago = timeAgoText(session.timestamp, t);
                                                            return namesText && ago ? formatPair(uiCatalog, namesText, ago) : namesText || ago;
                                                        })()}
                                                    </span>
                                                    {detail && <span className="hidden lg:block truncate text-xs text-fg-muted">{detail}</span>}
                                                </span>
                                            </button>
                                            {!selectMode && (
                                                <IconButton
                                                    label={t(CHAT_VIEW_I18N_KEYS.deleteSession)}
                                                    size="sm"
                                                    className="mr-2 hover:text-danger md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100"
                                                    onClick={() => setDeleteTarget({ id: session.id, title: session.title })}
                                                >
                                                    <Trash2 size={15} />
                                                </IconButton>
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>
                        </section>
                    ))}
                </div>
            </div>

            {selectMode && (
                <div className="shrink-0 flex items-center justify-between gap-3 px-4 sm:px-8 py-3 border-t border-line bg-panel">
                    <span className="text-sm text-fg-muted">
                        {fill(t(COMMON_I18N_KEYS.selectedCount), { count: selectedIds.size })}
                    </span>
                    <div className="flex gap-2">
                        <Button variant="ghost" onClick={leaveSelectMode}>{t(COMMON_I18N_KEYS.cancel)}</Button>
                        <Button
                            variant="dangerSolid"
                            disabled={selectedIds.size === 0}
                            onClick={() => setBulkConfirmOpen(true)}
                        >
                            {t(COMMON_I18N_KEYS.delete)}
                        </Button>
                    </div>
                </div>
            )}

            <Modal
                open={!!deleteTarget}
                onClose={() => setDeleteTarget(null)}
                title={t(CHAT_VIEW_I18N_KEYS.deleteSession)}
                size="sm"
                closeLabel={t(COMMON_I18N_KEYS.close)}
                footer={(
                    <div className="flex justify-end gap-2">
                        <Button variant="ghost" onClick={() => setDeleteTarget(null)}>{t(COMMON_I18N_KEYS.cancel)}</Button>
                        <Button variant="dangerSolid" onClick={() => void confirmDeleteOne()}>{t(COMMON_I18N_KEYS.delete)}</Button>
                    </div>
                )}
            >
                <div className="p-5">
                    <p className="font-medium text-fg truncate mb-2">{deleteTarget?.title}</p>
                    <p className="text-sm text-fg-muted">{t(CHAT_VIEW_I18N_KEYS.deleteSessionConfirmMessage)}</p>
                </div>
            </Modal>

            <Modal
                open={bulkConfirmOpen}
                onClose={() => setBulkConfirmOpen(false)}
                title={t(CHAT_VIEW_I18N_KEYS.deleteSession)}
                size="sm"
                closeLabel={t(COMMON_I18N_KEYS.close)}
                footer={(
                    <div className="flex justify-end gap-2">
                        <Button variant="ghost" onClick={() => setBulkConfirmOpen(false)}>{t(COMMON_I18N_KEYS.cancel)}</Button>
                        <Button variant="dangerSolid" onClick={() => void confirmDeleteMany()}>{t(COMMON_I18N_KEYS.delete)}</Button>
                    </div>
                )}
            >
                <p className="p-5 text-sm text-fg-muted">
                    {fill(t(CHAT_VIEW_I18N_KEYS.deleteSessionBulkConfirmMessage), { count: selectedIds.size })}
                </p>
            </Modal>
        </div>
    );
};
