/**
 * EmotionDropdown - 表情（心情）の選択ドロップダウン。
 *
 * 閉じている時は表示名だけ、開いた時は表示名と説明を出す。
 * 標準の select では閉じた表示と選択肢の文字列を分けられないため自前で描く。
 * 画像管理パネルと表情画像生成モーダルで共用する。
 */

import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { EmotionCatalogEntry } from '../../api/emotion-catalog';

interface Props {
    emotions: EmotionCatalogEntry[];
    value: string;
    onChange: (name: string) => void;
    /** 無効な表情に付ける注記（i18n 済み文字列） */
    disabledSuffix?: string;
    disabled?: boolean;
}

export const EmotionDropdown: React.FC<Props> = ({ emotions, value, onChange, disabledSuffix = '', disabled = false }) => {
    const [isOpen, setIsOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const selected = emotions.find(e => e.name === value);

    useEffect(() => {
        if (!isOpen) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) setIsOpen(false);
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    return (
        <div className="relative" ref={rootRef}>
            <button
                type="button"
                disabled={disabled}
                onClick={() => setIsOpen(v => !v)}
                className="w-full bg-gray-800 border border-gray-700 text-gray-100 rounded-lg p-2 flex items-center justify-between text-left hover:border-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
                <span className="truncate">
                    {selected ? (selected.label || selected.name) : value}
                    {selected && !selected.enabled ? disabledSuffix : ''}
                </span>
                <ChevronDown size={16} className="text-gray-500 shrink-0 ml-1" />
            </button>
            {isOpen && (
                <div className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto custom-scrollbar bg-gray-800 border border-gray-600 rounded-lg shadow-xl">
                    {emotions.map(emotion => {
                        const isSelected = emotion.name === value;
                        return (
                            <button
                                key={emotion.name}
                                type="button"
                                onClick={() => { onChange(emotion.name); setIsOpen(false); }}
                                className={`w-full text-left px-3 py-2 transition-colors ${isSelected ? 'bg-blue-600/30 text-blue-200' : 'text-gray-200 hover:bg-gray-700'}`}
                            >
                                <div className="text-sm font-medium">
                                    {emotion.label || emotion.name}
                                    {emotion.enabled ? '' : <span className="text-amber-400">{disabledSuffix}</span>}
                                </div>
                                {emotion.description && (
                                    <div className={`text-xs mt-0.5 ${isSelected ? 'text-blue-200/70' : 'text-gray-400'}`}>{emotion.description}</div>
                                )}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
