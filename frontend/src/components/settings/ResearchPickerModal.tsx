import React, { useMemo, useState } from 'react';
import { X, Search, FileText } from 'lucide-react';
import type { ResearchMemoEntry } from '../../api/config-gen';
import { resolveMessage, type I18NCatalog } from '../../api/i18n';
import { CONFIG_GEN_I18N_KEYS, CONFIG_GEN_TEXT_FALLBACK_JA } from '../../constants/i18n';

/**
 * 保存済み調査メモの検索・選択モーダル（レビュー002対応 3.1）。
 * 各項目の右上の×で削除できる（削除確認は親側の ConfirmDialog が担う）。
 */
interface Props {
    isOpen: boolean;
    onClose: () => void;
    uiCatalog?: I18NCatalog | null;
    memos: ResearchMemoEntry[];
    onSelect: (memo: ResearchMemoEntry) => void;
    onRequestDelete: (memo: ResearchMemoEntry) => void;
}

export const ResearchPickerModal: React.FC<Props> = ({
    isOpen, onClose, uiCatalog = null, memos, onSelect, onRequestDelete,
}) => {
    const t = (key: string) => resolveMessage(uiCatalog, key, CONFIG_GEN_TEXT_FALLBACK_JA[key] || key);
    const [query, setQuery] = useState('');

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return memos;
        return memos.filter(m => m.fileName.toLowerCase().includes(q) || m.dirName.toLowerCase().includes(q));
    }, [memos, query]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
            <div
                className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg max-h-[70vh] border border-purple-700 flex flex-col overflow-hidden"
                onClick={e => e.stopPropagation()}
            >
                {/* ヘッダー */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-purple-800 bg-purple-950/40 shrink-0">
                    <h3 className="text-sm font-semibold text-purple-200">{t(CONFIG_GEN_I18N_KEYS.pickResearchTitle)}</h3>
                    <button onClick={onClose} className="text-purple-300 hover:text-purple-100 transition-colors">
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
                            placeholder={t(CONFIG_GEN_I18N_KEYS.searchPlaceholder)}
                            className="w-full bg-transparent text-sm text-gray-200 focus:outline-none"
                            autoFocus
                        />
                    </div>
                </div>

                {/* 一覧 */}
                <div className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-1.5">
                    {filtered.length === 0 && (
                        <p className="text-xs text-gray-500 text-center py-6">{t(CONFIG_GEN_I18N_KEYS.noResearchFound)}</p>
                    )}
                    {filtered.map(memo => (
                        <div
                            key={`${memo.dirName}|||${memo.characterName}`}
                            className="relative group border border-gray-700 rounded hover:border-purple-500 hover:bg-purple-950/20 transition-colors"
                        >
                            <button
                                onClick={() => onSelect(memo)}
                                className="w-full text-left px-3 py-2 pr-8"
                            >
                                <span className="flex items-center gap-2 text-sm text-gray-200">
                                    <FileText size={14} className="text-purple-400 shrink-0" />
                                    <span className="truncate">{memo.fileName}</span>
                                </span>
                            </button>
                            {/* 右上の削除ボタン */}
                            <button
                                onClick={e => { e.stopPropagation(); onRequestDelete(memo); }}
                                className="absolute top-1 right-1 p-1 text-gray-500 hover:text-red-400 transition-colors"
                                title={t(CONFIG_GEN_I18N_KEYS.deleteResearchTitle)}
                            >
                                <X size={12} />
                            </button>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};
