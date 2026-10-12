import React from 'react';
import { cn } from './cn';

export interface SelectOption {
    value: string;
    label: string;
}

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
    options: SelectOption[];
    onChange: (value: string) => void;
}

/** ブラウザ標準の選択欄に設計値を当てたもの。明るさに合わせた描画は color-scheme に任せる。 */
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
    ({ options, onChange, className, ...rest }, ref) => (
        <select
            ref={ref}
            onChange={(e) => onChange(e.target.value)}
            className={cn(
                'w-full h-9 px-2.5 rounded-ui bg-surface border border-line-strong text-fg text-sm outline-none transition-colors focus:border-accent disabled:opacity-50',
                className,
            )}
            {...rest}
        >
            {options.map((option) => (
                <option key={option.value} value={option.value}>
                    {option.label}
                </option>
            ))}
        </select>
    ),
);
Select.displayName = 'Select';
