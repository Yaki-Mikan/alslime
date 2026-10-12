import { cn } from './cn';

export interface SegmentedOption<T extends string> {
    value: T;
    label: string;
}

interface SegmentedProps<T extends string> {
    options: SegmentedOption<T>[];
    value: T;
    onChange: (value: T) => void;
    /** 読み上げ用のまとまりの名前 */
    label: string;
    block?: boolean;
    className?: string;
}

/** 少数の選択肢を横並びで切り替える。 */
export function Segmented<T extends string>({ options, value, onChange, label, block = false, className }: SegmentedProps<T>) {
    return (
        <div
            role="radiogroup"
            aria-label={label}
            className={cn('inline-flex flex-wrap max-w-full gap-0.5 p-0.5 rounded-ui bg-surface border border-line', block && 'flex w-full', className)}
        >
            {options.map((option) => {
                const selected = option.value === value;
                return (
                    <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => onChange(option.value)}
                        className={cn(
                            'h-7 px-2.5 sm:px-3 rounded-ui text-sm whitespace-nowrap transition-colors',
                            block && 'flex-1',
                            selected ? 'bg-surface-2 text-fg font-semibold' : 'text-fg-muted hover:text-fg',
                        )}
                    >
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
}
