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
        className="flex items-center justify-between w-full px-4 py-2 text-xs text-gray-300 bg-gray-800/80 border-b border-gray-700 hover:bg-gray-800 transition-colors shrink-0"
    >
        <span className="flex items-center gap-2">
            {open ? <ChevronUp size={14} className="text-purple-300" /> : <ChevronDown size={14} className="text-purple-300" />}
            {label}
        </span>
        {extra}
    </button>
);
