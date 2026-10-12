import React from 'react';
import { cn } from './cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dangerSolid';
export type ButtonSize = 'sm' | 'md';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
    primary: 'bg-accent text-on-accent font-semibold hover:brightness-110',
    secondary: 'bg-surface text-fg border border-line-strong hover:bg-surface-2',
    ghost: 'text-fg-muted hover:text-fg hover:bg-surface',
    danger: 'text-danger hover:bg-surface',
    // 消す操作を確定するボタン
    dangerSolid: 'bg-danger text-on-accent font-semibold hover:brightness-110',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
    sm: 'h-7 px-2.5 text-xs gap-1.5',
    md: 'h-9 px-3.5 text-sm gap-2',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    size?: ButtonSize;
    /** 幅いっぱいに広げる */
    block?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ variant = 'secondary', size = 'md', block = false, className, type = 'button', ...rest }, ref) => (
        <button
            ref={ref}
            type={type}
            className={cn(
                'inline-flex items-center justify-center whitespace-nowrap rounded-ui transition-colors',
                'disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                VARIANT_CLASSES[variant],
                SIZE_CLASSES[size],
                block && 'w-full',
                className,
            )}
            {...rest}
        />
    ),
);
Button.displayName = 'Button';
