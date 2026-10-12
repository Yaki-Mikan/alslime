import React from 'react';
import { cn } from '../ui';

interface ChatEmptyStateProps {
    /** 会話開始を押したあと（まだ何も送っていない） */
    started: boolean;
    /** 会話開始を押したあとに出す題 */
    startedTitle: string;
    /** 準備・調整欄で選んでいるキャラの数 */
    selectedCharacterCount: number;
    onOpenPrepare: () => void;
    t: (key: string) => string;
    keys: {
        title: string;
        lead: string;
        step1: string;
        step1Count: string;
        step1None: string;
        step2: string;
        step2Note: string;
        step3: string;
        step3Note: string;
        startedInstruction: string;
    };
}

/** 会話が空のときの案内。始めるまでの3つの手順を出す。 */
export const ChatEmptyState: React.FC<ChatEmptyStateProps> = ({
    started,
    startedTitle,
    selectedCharacterCount,
    onOpenPrepare,
    t,
    keys,
}) => {
    if (started) {
        return (
            <div className="relative z-[1] flex-1 flex items-center justify-center p-6">
                <div className="max-w-md text-center">
                    <img src="/icons/app.png" alt="" className="w-12 h-12 mx-auto mb-4 opacity-90" />
                    <p className="font-head text-lg font-semibold mb-2">{startedTitle}</p>
                    <p className="text-sm text-fg-muted">{t(keys.startedInstruction)}</p>
                </div>
            </div>
        );
    }

    const steps = [
        {
            label: t(keys.step1),
            note: selectedCharacterCount > 0
                ? t(keys.step1Count).split('{{count}}').join(String(selectedCharacterCount))
                : t(keys.step1None),
            done: selectedCharacterCount > 0,
            onClick: onOpenPrepare,
        },
        { label: t(keys.step2), note: t(keys.step2Note), done: false, onClick: onOpenPrepare },
        { label: t(keys.step3), note: t(keys.step3Note), done: false, onClick: onOpenPrepare },
    ];

    return (
        <div className="relative z-[1] flex-1 overflow-auto flex items-center justify-center p-6">
            <div className="w-full max-w-[460px] text-center">
                <img src="/icons/app.png" alt="" className="w-[52px] h-[52px] mx-auto" />
                <h2 className="font-head text-xl font-semibold mt-4 mb-2">{t(keys.title)}</h2>
                <p className="text-sm text-fg-muted mb-6">{t(keys.lead)}</p>
                <ol className="flex flex-col gap-2 text-left">
                    {steps.map((step, i) => (
                        <li key={step.label}>
                            <button
                                type="button"
                                onClick={step.onClick}
                                className="w-full flex items-center gap-3 px-4 py-3 rounded-ui-lg bg-surface border border-line hover:border-line-strong transition-colors text-left"
                            >
                                <span
                                    className={cn(
                                        'grid place-items-center w-[26px] h-[26px] shrink-0 rounded-full text-xs font-bold',
                                        step.done ? 'bg-accent text-on-accent' : 'bg-accent-soft text-fg',
                                    )}
                                >
                                    {i + 1}
                                </span>
                                <span className="min-w-0">
                                    <span className="block text-sm text-fg">{step.label}</span>
                                    <span className="block text-xs text-fg-muted">{step.note}</span>
                                </span>
                            </button>
                        </li>
                    ))}
                </ol>
            </div>
        </div>
    );
};
