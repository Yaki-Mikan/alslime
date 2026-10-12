/**
 * DialogEditPanel.tsx - 設定ファイルの「対話で編集」
 *
 * 開いているファイルを、AI と話しながら直す。今の対話作成の仕組み（config-gen の dialog）をそのまま使う。
 * - 対話の記録はファイルごとに1つ。開いたら読み出して続きから話せる。「新しい対話を始める」で消して始め直す
 * - 送ると、本文が実ファイルと違えばサーバーが先に保存する。AI は実ファイルを直接書き換えるので、応答のあと本文を読み直す
 * - 別の場所で書き換えられていたら（409）送るのを止め、「本文を読み直す」を出す
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw, Send, Loader2, Plus } from 'lucide-react';
import { resolveMessage, type I18NCatalog } from '../../../api/i18n';
import {
    contentHash,
    getConfigGenDialog,
    sendConfigGenDialog,
    startConfigGenDialog,
    type ConfigGenDialogSession,
    type ConfigGenResultFile,
} from '../../../api/config-gen';
import { getConfigFile, saveConfigFile } from '../../../api/config-editor';
import { CONFIG_GEN_I18N_KEYS, CONFIG_GEN_TEXT_FALLBACK_JA, MATERIAL_I18N_KEYS, MATERIAL_TEXT_FALLBACK_JA } from '../../../constants/i18n';
import { useConfigGenJob } from '../../../hooks/useConfigGenJob';
import { invalidateSSRPOptionsCache } from '../../SSRP/RolePlaySettings';
import { keepFocusOnPointerDown } from '../../../lib/pointer';
import { Button, Modal, TextArea, cn } from '../../ui';
import { ConfigGenAiPicker } from './ConfigGenAiPicker';
import { useConfigGenAi } from './useConfigGenAi';

interface DialogEditPanelProps {
    backendUrl: string;
    uiCatalog: I18NCatalog | null;
    categoryId: string;
    dirName: string;
    fileName: string;
    /** 今の本文（保存していない変更を含む） */
    content: string;
    /** 本文に保存していない変更がある */
    isDirty: boolean;
    /** 欄が見えている（見えたときに対話を読み出す） */
    active: boolean;
    /** 送るときにサーバーが本文を保存した。呼び出し側は「保存済み」に戻す */
    onBodySaved: (content: string) => void;
    /** AI が書き換えた本文（または元に戻した本文）を本文へ入れる。保存済みとして扱う */
    onContentReplaced: (content: string) => void;
    /** 画面の下に短く知らせる */
    onToast: (message: string) => void;
}

const fill = (template: string, values: Record<string, string | number>) =>
    Object.entries(values).reduce((text, [key, value]) => text.split(`{{${key}}}`).join(String(value)), template);

type DiffLine = { kind: 'same' | 'add' | 'del'; text: string };

/** 行ごとの違い（最長共通部分列で求める。設定ファイルの長さなら十分に速い） */
const diffLines = (before: string, after: string): DiffLine[] => {
    const a = before.split('\n');
    const b = after.split('\n');
    const n = a.length;
    const m = b.length;
    const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
        }
    }
    const out: DiffLine[] = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
        if (a[i] === b[j]) { out.push({ kind: 'same', text: a[i] }); i++; j++; }
        else if (table[i + 1][j] >= table[i][j + 1]) { out.push({ kind: 'del', text: a[i] }); i++; }
        else { out.push({ kind: 'add', text: b[j] }); j++; }
    }
    while (i < n) out.push({ kind: 'del', text: a[i++] });
    while (j < m) out.push({ kind: 'add', text: b[j++] });
    return out;
};

export const DialogEditPanel: React.FC<DialogEditPanelProps> = ({
    backendUrl,
    uiCatalog,
    categoryId,
    dirName,
    fileName,
    content,
    isDirty,
    active,
    onBodySaved,
    onContentReplaced,
    onToast,
}) => {
    const t = (key: string) => resolveMessage(uiCatalog, key, MATERIAL_TEXT_FALLBACK_JA[key] || key);
    const tk = (key: string, fallback: string) => resolveMessage(uiCatalog, key, fallback);
    const locale = uiCatalog?.lang || 'ja';
    const { state, attachJob } = useConfigGenJob(backendUrl);
    const [session, setSession] = useState<ConfigGenDialogSession | null>(null);
    // 使う AI。前回使った値を既定として読み、欄の下で選び直せる。送るたびに選んでいる AI で送る
    const ai = useConfigGenAi(backendUrl, active);
    const [input, setInput] = useState('');
    const [resetAsk, setResetAsk] = useState(false);
    const [conflict, setConflict] = useState(false);
    const [change, setChange] = useState<{ before: string; after: string } | null>(null);
    const [diffOpen, setDiffOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const beforeSendRef = useRef('');
    const endRef = useRef<HTMLDivElement | null>(null);
    const running = state.running;

    const start = async (reset: boolean) => {
        setLoading(true);
        try {
            const next = await startConfigGenDialog(backendUrl, {
                categoryId,
                dirName,
                fileName,
                provider: ai.provider,
                model: ai.model,
                locale,
                reset,
            });
            setSession(next);
        } catch (error: unknown) {
            const data = (error as { response?: { data?: { messageKey?: string } } })?.response?.data;
            onToast(data?.messageKey ? tk(data.messageKey, t(MATERIAL_I18N_KEYS.dialogStartFailed)) : t(MATERIAL_I18N_KEYS.dialogStartFailed));
        } finally {
            setLoading(false);
        }
    };

    // 欄が見えたら対話を読み出す（ファイルが変わったときは部品ごと作り直されるので、1回だけ）
    useEffect(() => {
        if (active && !session && !loading) void start(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active]);

    useEffect(() => {
        endRef.current?.scrollIntoView({ block: 'nearest' });
    }, [session?.messages.length, change, conflict]);

    const refresh = async (sessionId: string) => {
        try {
            setSession(await getConfigGenDialog(backendUrl, sessionId));
        } catch {
            // 読み直せなくても、次の送信で最新になる
        }
    };

    const handleComplete = async (result: ConfigGenResultFile) => {
        if (result.kind !== 'setting') return;
        invalidateSSRPOptionsCache();
        try {
            const after = await getConfigFile(backendUrl, categoryId, dirName, fileName);
            onContentReplaced(after);
            if (after !== beforeSendRef.current) setChange({ before: beforeSendRef.current, after });
        } catch {
            onToast(t(MATERIAL_I18N_KEYS.dialogFailed));
        }
        if (result.sessionId) await refresh(result.sessionId);
    };

    const handleFinished = (status: string) => {
        if (status === 'completed') return;
        if (session) void refresh(session.sessionId);
        onToast(t(MATERIAL_I18N_KEYS.dialogFailed));
    };

    const send = async () => {
        const message = input.trim();
        if (!message || !session || running || conflict) return;
        const editorContent = content;
        const hash = await contentHash(editorContent);
        beforeSendRef.current = editorContent;
        setChange(null);
        // 楽観的に発言を足す（サーバー側にも記録される。応答のあとに読み直す）
        setSession(prev => prev ? { ...prev, messages: [...prev.messages, { role: 'user', content: message, timestamp: new Date().toISOString() }] } : prev);
        setInput('');
        try {
            const { jobId } = await sendConfigGenDialog(backendUrl, {
                sessionId: session.sessionId,
                message,
                editorContent,
                editorHash: hash,
                ...ai.requestFields(),
                locale,
            });
            // 送る時点でサーバーが本文を保存している
            onBodySaved(editorContent);
            // 送ったときの AI を次の既定として残す（「AI で作る」と同じ）
            void ai.persist();
            attachJob(jobId, ai.timeoutMinutes, handleComplete, handleFinished);
        } catch (error: unknown) {
            const response = (error as { response?: { status?: number; data?: { messageKey?: string } } })?.response;
            if (response?.status === 409) {
                setConflict(true);
            } else {
                const key = response?.data?.messageKey;
                onToast(key ? tk(key, t(MATERIAL_I18N_KEYS.dialogFailed)) : t(MATERIAL_I18N_KEYS.dialogFailed));
            }
            void refresh(session.sessionId);
        }
    };

    const undo = async () => {
        if (!change) return;
        try {
            await saveConfigFile(backendUrl, categoryId, dirName, fileName, change.before);
            invalidateSSRPOptionsCache();
            onContentReplaced(change.before);
            setChange(null);
            onToast(t(MATERIAL_I18N_KEYS.dialogUndone));
        } catch {
            onToast(t(MATERIAL_I18N_KEYS.dialogFailed));
        }
    };

    const reloadBody = async () => {
        try {
            onContentReplaced(await getConfigFile(backendUrl, categoryId, dirName, fileName));
            setConflict(false);
        } catch {
            onToast(t(MATERIAL_I18N_KEYS.dialogFailed));
        }
    };

    const diff = useMemo(() => (change && diffOpen ? diffLines(change.before, change.after) : []), [change, diffOpen]);
    const changedCount = useMemo(() => (change ? diffLines(change.before, change.after).filter(l => l.kind !== 'same').length : 0), [change]);

    return (
        <div className="flex flex-col h-full min-h-0">
            <div className="flex items-center justify-between gap-2 mb-3">
                <span className="text-xs text-fg-muted">{fill(t(MATERIAL_I18N_KEYS.dialogCount), { count: session?.messages.length ?? 0 })}</span>
                <Button size="sm" variant="ghost" disabled={!session || running} onClick={() => setResetAsk(true)}>
                    <Plus size={13} />
                    {t(MATERIAL_I18N_KEYS.dialogNew)}
                </Button>
            </div>

            {resetAsk && (
                <div className="mb-3 rounded-ui-lg bg-accent-soft p-3 text-xs space-y-2">
                    <p className="font-semibold text-fg">{t(MATERIAL_I18N_KEYS.dialogNewConfirmTitle)}</p>
                    <p className="text-fg-muted">{t(MATERIAL_I18N_KEYS.dialogNewConfirmMessage)}</p>
                    <div className="flex gap-2">
                        <Button size="sm" variant="primary" onClick={() => { setResetAsk(false); setChange(null); void start(true); }}>
                            {t(MATERIAL_I18N_KEYS.dialogNewConfirmOk)}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setResetAsk(false)}>{t(MATERIAL_I18N_KEYS.dialogCancel)}</Button>
                    </div>
                </div>
            )}

            <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2.5 pb-3">
                {loading && <Loader2 size={16} className="animate-spin text-fg-muted self-center mt-4" />}
                {session?.messages.map((message, i) => (
                    <div
                        key={i}
                        className={cn(
                            'max-w-[92%] rounded-ui-lg px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap',
                            message.role === 'user' ? 'self-end bg-accent-soft text-fg' : 'self-start bg-surface border border-line text-fg',
                            message.canceled && 'opacity-60',
                        )}
                    >
                        {message.content}
                    </div>
                ))}
                {running && (
                    <div className="self-start flex items-center gap-2 text-xs text-fg-muted">
                        <Loader2 size={13} className="animate-spin" />
                        {t(MATERIAL_I18N_KEYS.dialogRunning)}
                    </div>
                )}
                {change && (
                    <div className="rounded-ui-lg border border-accent bg-accent-soft p-3 text-xs space-y-2">
                        <p className="font-semibold text-fg">{t(MATERIAL_I18N_KEYS.dialogChanged)}</p>
                        <p className="text-fg-muted">{fill(t(MATERIAL_I18N_KEYS.dialogChangedLines), { count: changedCount })}</p>
                        <div className="flex gap-2">
                            <Button size="sm" variant="secondary" onClick={() => void undo()}>
                                <RotateCcw size={12} />
                                {t(MATERIAL_I18N_KEYS.dialogUndo)}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setDiffOpen(true)}>{t(MATERIAL_I18N_KEYS.dialogDiff)}</Button>
                        </div>
                    </div>
                )}
                {conflict && (
                    <div className="rounded-ui-lg border border-warn p-3 text-xs space-y-2">
                        <p className="font-semibold text-fg">{t(MATERIAL_I18N_KEYS.dialogConflictTitle)}</p>
                        <p className="text-fg-muted">{t(MATERIAL_I18N_KEYS.dialogConflictMessage)}</p>
                        <Button size="sm" variant="primary" onClick={() => void reloadBody()}>{t(MATERIAL_I18N_KEYS.dialogReload)}</Button>
                    </div>
                )}
                <div ref={endRef} />
            </div>

            {isDirty && <p className="text-xs text-fg-muted mb-1.5">{t(MATERIAL_I18N_KEYS.dialogUnsavedHint)}</p>}
            <div className="flex gap-2 items-end">
                <TextArea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={t(MATERIAL_I18N_KEYS.dialogPlaceholder)}
                    className="min-h-[64px] text-[13px]"
                    disabled={!session || running}
                />
                {/* 押したときに入力欄から外さない（外れるとキーボードが閉じて配置が動き、指で押した1回目が押下にならない） */}
                <Button variant="primary" className="shrink-0" disabled={!session || running || conflict || !input.trim()} onPointerDown={keepFocusOnPointerDown} onClick={() => void send()}>
                    <Send size={14} />
                    {isDirty ? t(MATERIAL_I18N_KEYS.dialogSaveAndSend) : t(MATERIAL_I18N_KEYS.dialogSend)}
                </Button>
            </div>
            <div className="mt-1.5">
                <ConfigGenAiPicker
                    ai={ai}
                    uiCatalog={uiCatalog}
                    disabled={running}
                    onPinged={ok => {
                        const key = ok ? CONFIG_GEN_I18N_KEYS.pingOk : CONFIG_GEN_I18N_KEYS.pingFailed;
                        onToast(resolveMessage(uiCatalog, key, CONFIG_GEN_TEXT_FALLBACK_JA[key] || key));
                    }}
                />
            </div>

            <Modal
                open={diffOpen && !!change}
                onClose={() => setDiffOpen(false)}
                title={t(MATERIAL_I18N_KEYS.dialogDiffTitle)}
                size="lg"
                closeLabel={resolveMessage(uiCatalog, 'common.close', '閉じる')}
            >
                <pre className="p-4 text-xs leading-relaxed font-mono whitespace-pre-wrap">
                    {diff.map((line, i) => (
                        <div
                            key={i}
                            className={cn(
                                line.kind === 'add' && 'bg-[color-mix(in_srgb,var(--c-ok)_18%,transparent)] text-fg',
                                line.kind === 'del' && 'bg-[color-mix(in_srgb,var(--c-danger)_18%,transparent)] text-fg-muted line-through',
                                line.kind === 'same' && 'text-fg-muted',
                            )}
                        >
                            {line.kind === 'add' ? '+ ' : line.kind === 'del' ? '- ' : '  '}{line.text || ' '}
                        </div>
                    ))}
                </pre>
            </Modal>
        </div>
    );
};
