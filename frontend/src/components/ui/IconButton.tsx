import React from 'react';
import { cn } from './cn';

export interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
    /** 何のボタンかの説明。読み上げと、ポインタを乗せたときの表示に使うため必須 */
    label: string;
    size?: 'sm' | 'md';
    active?: boolean;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
    ({ label, size = 'md', active = false, className, type = 'button', title, children, ...rest }, ref) => (
        <button
            ref={ref}
            type={type}
            aria-label={label}
            title={title ?? label}
            className={cn(
                'inline-grid place-items-center rounded-ui transition-colors',
                'disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-accent',
                size === 'sm' ? 'w-7 h-7' : 'w-9 h-9',
                active ? 'bg-accent-soft text-fg' : 'text-fg-muted hover:text-fg hover:bg-surface',
                className,
            )}
            {...rest}
        >
            {children}
        </button>
    ),
);
IconButton.displayName = 'IconButton';
