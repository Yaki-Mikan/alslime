/**
 * IntegratedDanbooruSearch.tsx - 統合設定画面用 Danbooruタグ検索セクション
 *
 * カテゴリフィルタなしの全カテゴリ横断検索。検索結果クリックでクリップボードコピー。
 */

import React, { useState, useCallback } from 'react';
import { Search } from 'lucide-react';
import { searchDanbooruTags } from '../../../api/comfyui';
import type { DanbooruTagResult } from '../../../api/comfyui';
import type { DanbooruTagFormat } from '../../../api/comfyui';
import { createComfyUIText } from '../i18n';
import type { I18NCatalog } from '../../../api/i18n';
import { formatDanbooruTag } from '../danbooru-format';

interface Props {
    backendUrl: string;
    danbooruTagFormat?: DanbooruTagFormat;
    uiCatalog?: I18NCatalog | null;
}

export const IntegratedDanbooruSearch: React.FC<Props> = ({ backendUrl, danbooruTagFormat = 'underscore', uiCatalog = null }) => {
    const { DANBOORU, COMMON } = createComfyUIText(uiCatalog);
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<DanbooruTagResult[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [copiedValue, setCopiedValue] = useState<string | null>(null);

    const handleSearch = useCallback(async () => {
        const q = query.trim();
        if (!q) return;
        setIsLoading(true);
        setResults([]);
        setCopiedValue(null);
        try {
            const result = await searchDanbooruTags(backendUrl, q);
            if (result.success) {
                setResults(result.results);
            }
        } catch { /* 無視 */ }
        setIsLoading(false);
    }, [backendUrl, query]);

    const handleCopy = useCallback(async (value: string) => {
        const formatted = formatDanbooruTag(value, danbooruTagFormat);
        try {
            await navigator.clipboard.writeText(formatted);
            setCopiedValue(formatted);
            setTimeout(() => setCopiedValue(null), 1500);
        } catch {
            setCopiedValue(null);
        }
    }, [danbooruTagFormat]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter') handleSearch();
    }, [handleSearch]);

    const getCategoryName = (cat: number): string => {
        return DANBOORU.CATEGORY_NAMES[cat] || String(cat);
    };

    const getCategoryColor = (cat: number): string => {
        switch (cat) {
            case 0: return 'text-blue-300';
            case 1: return 'text-red-300';
            case 3: return 'text-purple-300';
            case 4: return 'text-green-300';
            case 5: return 'text-gray-400';
            default: return 'text-gray-400';
        }
    };

    return (
        <div className="space-y-2 border border-green-600/40 rounded-lg p-4 bg-gray-800/30">
            <label className="flex items-center gap-2 text-sm font-medium text-green-300">
                <Search size={16} className="text-green-400" />
                {DANBOORU.LABELS.TAG_SEARCH}
            </label>
            <div className="flex gap-2">
                <div className="relative flex-1">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                    <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={DANBOORU.PLACEHOLDERS.SEARCH_ALL}
                        className="w-full bg-gray-800 border border-gray-700 rounded pl-8 pr-3 py-1.5 text-sm text-gray-200 placeholder-gray-500 outline-none focus:border-green-500 transition-colors"
                    />
                </div>
                <button
                    onClick={handleSearch}
                    disabled={isLoading || !query.trim()}
                    className="px-3 py-1.5 bg-green-700 hover:bg-green-600 disabled:opacity-50 rounded text-sm text-white transition-colors whitespace-nowrap"
                >
                    {isLoading ? COMMON.BUTTONS.SEARCHING : COMMON.BUTTONS.SEARCH}
                </button>
            </div>

            {/* 検索結果 */}
            {results.length > 0 && (
                <div className="max-h-40 overflow-y-auto custom-scrollbar space-y-0.5">
                    {results.map((tag, i) => {
                        const formattedValue = formatDanbooruTag(tag.value, danbooruTagFormat);
                        return (
                            <button
                                key={`${tag.value}-${i}`}
                                onClick={() => handleCopy(tag.value)}
                                className="w-full text-left flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-700/50 transition-colors group text-xs"
                                title={`${DANBOORU.MESSAGES.CLICK_TO_COPY}: ${formattedValue}`}
                            >
                                <span className={`shrink-0 w-12 ${getCategoryColor(tag.category)}`}>
                                    {getCategoryName(tag.category)}
                                </span>
                                <span className="text-gray-200 truncate flex-1">
                                    {formattedValue}
                                    {tag.antecedent && (
                                        <span className="text-gray-500 ml-1">← {tag.antecedent}</span>
                                    )}
                                </span>
                                <span className="text-gray-600 shrink-0">{tag.postCount.toLocaleString()}</span>
                                {copiedValue === formattedValue && (
                                    <span className="text-green-400 shrink-0">{DANBOORU.MESSAGES.COPIED}</span>
                                )}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
