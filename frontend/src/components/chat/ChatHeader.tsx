import React, { useState } from 'react';
import { Activity, Heart, Pencil, Settings2, SlidersHorizontal } from 'lucide-react';
import { Button, cn } from '../ui';

interface ChatHeaderProps {
    /** 下引きで再読み込みする領域（usePullToReload）に使う */
    headerRef: React.Ref<HTMLElement>;
    title: string;
    /** 題の下の行（参加キャラ名、または始める前の案内） */
    subtitle: string;
    /** 会話が保存されていて、題を直せる */
    canEditTitle: boolean;
    /** 会話中だけ「状態」を出す */
    showStatus: boolean;
    runningJobCount: number;
    isPrepareOpen: boolean;
    /** 「クイック設定」を出すか（画像生成か読み上げが使えるとき） */
    showQuickSettings: boolean;
    isQuickSettingsOpen: boolean;
    onToggleQuickSettings: () => void;
    onOpenStatus: () => void;
    onTogglePrepare: () => void;
    onOpenJobs: () => void;
    /** 題の保存。成功したら true */
    onSaveTitle: (title: string) => Promise<boolean>;
    t: (key: string) => string;
    keys: {
        status: string;
        prepare: string;
        quickSettings: string;
        jobsRunning: string;
        titleEdit: string;
        save: string;
        cancel: string;
    };
}

/** 会話画面の見出し。題・参加キャラ・実行中の件数と、「クイック設定」「状態」「準備・調整」の開閉を置く。 */
export const ChatHeader: React.FC<ChatHeaderProps> = ({
    headerRef,
    title,
    subtitle,
    canEditTitle,
    showStatus,
    runningJobCount,
    isPrepareOpen,
    showQuickSettings,
    isQuickSettingsOpen,
    onToggleQuickSettings,
    onOpenStatus,
    onTogglePrepare,
    onOpenJobs,
    onSaveTitle,
    t,
    keys,
}) => {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState('');

    const save = async () => {
        const next = draft.trim();
        if (!next) return;
        if (await onSaveTitle(next)) setEditing(false);
    };

    return (
        <header
            ref={headerRef}
            className={cn(
                // 背景画像は透かさない（ボタンが見えにくくならないよう、画面の地の色で塗る）
                'relative z-10 shrink-0 flex items-center gap-3 h-14 sm:h-[60px] pl-4 sm:pl-6 pr-2 sm:pr-4 border-b border-line bg-bg',
            )}
        >
            <div className="flex-1 min-w-0">
                {editing ? (
                    <div className="flex items-center gap-2">
                        <input
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Escape') setEditing(false);
                                if (e.key === 'Enter' && !e.nativeEvent.isComposing) void save();
                            }}
                            autoFocus
                            className="flex-1 min-w-0 h-8 px-2.5 rounded-ui bg-surface border border-line-strong text-fg text-sm outline-none focus:border-accent"
                        />
                        <Button size="sm" variant="primary" onClick={() => void save()}>{t(keys.save)}</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>{t(keys.cancel)}</Button>
                    </div>
                ) : (
                    <div className="group flex items-center gap-1 min-w-0">
                        <div className="min-w-0">
                            <h1 className="font-head text-[15px] font-semibold truncate">{title}</h1>
                            {subtitle && <p className="text-xs text-fg-muted truncate">{subtitle}</p>}
                        </div>
                        {canEditTitle && (
                            <button
                                type="button"
                                onClick={() => { setDraft(title); setEditing(true); }}
                                className="shrink-0 p-1 rounded-ui text-fg-muted hover:text-fg hover:bg-surface md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                                title={t(keys.titleEdit)}
                                aria-label={t(keys.titleEdit)}
                            >
                                <Pencil size={14} />
                            </button>
                        )}
                    </div>
                )}
            </div>

            {!editing && (
                <div className="flex items-center gap-1 shrink-0">
                    {runningJobCount > 0 && (
                        <button
                            type="button"
                            onClick={onOpenJobs}
                            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-xs bg-accent-soft text-fg hover:brightness-110"
                        >
                            <Activity size={13} className="animate-pulse" />
                            {t(keys.jobsRunning).split('{{count}}').join(String(runningJobCount))}
                        </button>
                    )}
                    {showQuickSettings && (
                        <Button
                            variant="ghost"
                            size="md"
                            onClick={onToggleQuickSettings}
                            aria-pressed={isQuickSettingsOpen}
                            title={t(keys.quickSettings)}
                            className={cn('px-2.5', isQuickSettingsOpen && 'bg-accent-soft text-fg')}
                        >
                            <Settings2 size={16} />
                            <span className="hidden sm:inline">{t(keys.quickSettings)}</span>
                        </Button>
                    )}
                    {showStatus && (
                        <Button variant="ghost" size="md" onClick={onOpenStatus} title={t(keys.status)} className="px-2.5">
                            <Heart size={16} />
                            <span className="hidden sm:inline">{t(keys.status)}</span>
                        </Button>
                    )}
                    <Button
                        variant="ghost"
                        size="md"
                        onClick={onTogglePrepare}
                        aria-pressed={isPrepareOpen}
                        title={t(keys.prepare)}
                        className={cn('px-2.5', isPrepareOpen && 'bg-accent-soft text-fg')}
                    >
                        <SlidersHorizontal size={16} />
                        <span className="hidden sm:inline">{t(keys.prepare)}</span>
                    </Button>
                </div>
            )}
        </header>
    );
};
