import React, { useMemo, useState } from 'react';
import { X, Search, FileText } from 'lucide-react';

/**
 * SearchPickerModal - 検索ボックス付きの汎用一覧選択モーダル。
 *
 * 会話設定メニューのキャラクター選択と同調の「検索して選ぶ」UI。
 * 設定ファイルエディタの既存ファイル選択などから使う。
 */
export interface SearchPickerItem {
    key: string;
    label: string;
}

interface Props {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    searchPlaceholder: string;
    emptyText: string;
    items: SearchPickerItem[];
    onSelect: (key: string) => void;
}

export const SearchPickerModal: React.FC<Props> = ({
    isOpen, onClose, title, searchPlaceholder, emptyText, items, onSelect,
}) => {
    const [query, setQuery] = useState('');

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return items;
        return items.filter(item => item.label.toLowerCase().includes(q));
    }, [items, query]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
            <div
                className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg max-h-[70vh] border border-green-700 flex flex-col overflow-hidden"
                onClick={e => e.stopPropagation()}
            >
                {/* ヘッダー */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-green-800 bg-green-950/40 shrink-0">
                    <h3 className="text-sm font-semibold text-green-200">{title}</h3>
                    <button onClick={onClose} className="text-green-300 hover:text-green-100 transition-colors">
                        <X size={16} />
                    </button>
                </div>

                {/* 検索 */}
                <div className="px-4 py-2 border-b border-gray-700 shrink-0">
                    <div className="flex items-center gap-2 bg-gray-800 border border-gray-600 rounded px-2 py-1.5">
                        <Search size={14} className="text-gray-500 shrink-0" />
                        <input
                            type="text"
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder={searchPlaceholder}
                            className="w-full bg-transparent text-sm text-gray-200 focus:outline-none"
                            autoFocus
                        />
                    </div>
                </div>

                {/* 一覧 */}
                <div className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-1.5">
                    {filtered.length === 0 && (
                        <p className="text-xs text-gray-500 text-center py-6">{emptyText}</p>
                    )}
                    {filtered.map(item => (
                        <button
                            key={item.key}
                            onClick={() => { onSelect(item.key); setQuery(''); }}
                            className="w-full text-left px-3 py-2 border border-gray-700 rounded hover:border-green-500 hover:bg-green-950/20 transition-colors"
                        >
                            <span className="flex items-center gap-2 text-sm text-gray-200">
                                <FileText size={14} className="text-green-400 shrink-0" />
                                <span className="truncate">{item.label}</span>
                            </span>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};
