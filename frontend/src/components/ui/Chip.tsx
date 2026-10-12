import React from 'react';
import { cn } from './cn';

interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    selected?: boolean;
}

/** 押して選べる小さな札（タグ・絞り込み）。 */
export const Chip: React.FC<ChipProps> = ({ selected = false, className, type = 'button', ...rest }) => (
    <button
        type={type}
        aria-pressed={selected}
        className={cn(
            'inline-flex items-center gap-1 h-6 px-2.5 rounded-full text-xs whitespace-nowrap border transition-colors',
            selected ? 'bg-accent-soft text-fg border-transparent' : 'bg-surface text-fg-muted border-line hover:text-fg',
            className,
        )}
        {...rest}
    />
);

export type BadgeTone = 'default' | 'ok' | 'warn' | 'danger';

const TONE_CLASSES: Record<BadgeTone, string> = {
    default: 'bg-accent-soft text-fg',
    ok: 'bg-accent-soft text-ok',
    warn: 'bg-accent-soft text-warn',
    danger: 'bg-accent-soft text-danger',
};

/** 押せない小さな札（状態・件数）。 */
export const Badge: React.FC<{ tone?: BadgeTone; className?: string; children: React.ReactNode }> = ({ tone = 'default', className, children }) => (
    <span className={cn('inline-flex items-center gap-1 h-5 px-2 rounded-full text-xs whitespace-nowrap', TONE_CLASSES[tone], className)}>
        {children}
    </span>
);
