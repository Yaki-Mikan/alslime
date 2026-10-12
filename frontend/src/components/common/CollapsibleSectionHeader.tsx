import React from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface Props {
    label: string;
    open: boolean;
    onToggle: () => void;
    extra?: React.ReactNode;
}

// 狭画面で縦積みにしたエリアの開閉見出しバー
export const CollapsibleSectionHeader: React.FC<Props> = ({ label, open, onToggle, extra }) => (
    <button
        onClick={onToggle}
        className="flex items-center justify-between w-full px-4 py-2 text-xs text-fg-muted bg-surface border-b border-line-strong hover:bg-surface transition-colors shrink-0"
    >
        <span className="flex items-center gap-2">
            {open ? <ChevronUp size={14} className="text-accent" /> : <ChevronDown size={14} className="text-accent" />}
            {label}
        </span>
        {extra}
    </button>
);
