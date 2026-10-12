import React from 'react';
import { cn } from './cn';

const FIELD_CLASSES =
    'w-full rounded-ui bg-surface border border-line-strong text-fg placeholder:text-fg-muted outline-none transition-colors focus:border-accent disabled:opacity-50';

export const TextField = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
    ({ className, ...rest }, ref) => (
        <input ref={ref} className={cn(FIELD_CLASSES, 'h-9 px-3 text-sm', className)} {...rest} />
    ),
);
TextField.displayName = 'TextField';

export const TextArea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
    ({ className, ...rest }, ref) => (
        <textarea ref={ref} className={cn(FIELD_CLASSES, 'px-3 py-2 text-sm leading-relaxed resize-y', className)} {...rest} />
    ),
);
TextArea.displayName = 'TextArea';
