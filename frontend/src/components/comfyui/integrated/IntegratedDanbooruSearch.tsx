/**
 * IntegratedDanbooruSearch.tsx - Danbooruタグ検索（素材づくりのタグのタブ・キャラのタブの画像の設定、設定ファイルの画像生成タブで使う）
 *
 * 検索結果クリックでクリップボードコピー。キャラの設定の中では「キャラ/作品のみ」の切り替えを出し、
 * 入っている間はキャラクター名・作品名の分類だけを探す（刷新前のキャラ設定の窓と同じ。最初は入った状態）。
 */

import React, { useState, useCallback } from 'react';
import { Search } from 'lucide-react';
import { searchDanbooruTags } from '../../../api/comfyui';
import type { DanbooruTagResult } from '../../../api/comfyui';
import type { DanbooruTagFormat } from '../../../api/comfyui';
import { createComfyUIText, formatComfyText } from '../i18n';
import { formatWithNote, type I18NCatalog } from '../../../api/i18n';
import { formatDanbooruTag } from '../danbooru-format';
import { Toggle } from '../../ui';

/** Danbooru の分類番号：作品名・キャラクター名 */
const CHARA_WORK_CATEGORIES = [3, 4];

interface Props {
    backendUrl: string;
    danbooruTagFormat?: DanbooruTagFormat;
    uiCatalog?: I18NCatalog | null;
    /** 「キャラ/作品のみ」の切り替えを出す（キャラの設定の中で使うとき） */
    characterFilter?: boolean;
}

export const IntegratedDanbooruSearch: React.FC<Props> = ({ backendUrl, danbooruTagFormat = 'underscore', uiCatalog = null, characterFilter = false }) => {
    const { DANBOORU, COMMON } = createComfyUIText(uiCatalog);
    const [charaOnly, setCharaOnly] = useState(true);
    const filterOn = characterFilter && charaOnly;
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
            const result = await searchDanbooruTags(backendUrl, q, filterOn ? CHARA_WORK_CATEGORIES : []);
            if (result.success) {
                setResults(result.results);
            }
        } catch { /* 無視 */ }
        setIsLoading(false);
    }, [backendUrl, query, filterOn]);

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
            case 0: return 'text-accent';
            case 1: return 'text-danger';
            case 3: return 'text-accent';
            case 4: return 'text-ok';
            case 5: return 'text-fg-muted';
            default: return 'text-fg-muted';
        }
    };

    return (
        <div className="space-y-2 border border-line-strong rounded-lg p-4 bg-surface">
            <div className="flex flex-wrap items-center gap-x-2 text-sm font-medium text-fg">
                <Search size={16} className="text-accent" />
                {DANBOORU.LABELS.TAG_SEARCH}
                <span className="text-xs font-normal text-fg-muted">
                    {characterFilter
                        ? (charaOnly ? DANBOORU.LABELS.FILTER_ON_DESC : DANBOORU.LABELS.FILTER_OFF_DESC)
                        : formatComfyText(COMMON.MESSAGES.JAPANESE_SEARCH_TO_COPY, { action: DANBOORU.MESSAGES.CLICK_TO_COPY })}
                </span>
            </div>
            {/* 添え書きの長さで折り返し位置が変わらないよう、トグルはいつも見出しの次の行の右端に置く */}
            {characterFilter && (
                <div className="flex justify-end">
                    <Toggle
                        size="sm"
                        checked={charaOnly}
                        onChange={setCharaOnly}
                        label={DANBOORU.LABELS.CHARA_WORK_ONLY}
                        labelClassName="text-xs text-fg-muted"
                    />
                </div>
            )}
            <div className="flex gap-2">
                <div className="relative flex-1">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted pointer-events-none" />
                    <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={filterOn ? DANBOORU.PLACEHOLDERS.SEARCH_CHARA : DANBOORU.PLACEHOLDERS.SEARCH_ALL}
                        className="w-full bg-surface border border-line-strong rounded pl-8 pr-3 py-1.5 text-sm text-fg placeholder-fg-muted outline-none focus:border-accent transition-colors"
                    />
                </div>
                <button
                    onClick={handleSearch}
                    disabled={isLoading || !query.trim()}
                    className="px-3 py-1.5 bg-accent hover:brightness-110 disabled:opacity-50 rounded text-sm text-on-accent transition-colors whitespace-nowrap"
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
                                className="w-full text-left flex items-center gap-2 px-2 py-1 rounded hover:bg-surface-2 transition-colors group text-xs"
                                title={formatWithNote(uiCatalog, `${DANBOORU.MESSAGES.CLICK_TO_COPY}: ${formattedValue}`, `${DANBOORU.MESSAGES.POST_COUNT}: ${tag.postCount.toLocaleString()}`)}
                            >
                                <span className={`shrink-0 w-12 ${getCategoryColor(tag.category)}`}>
                                    {getCategoryName(tag.category)}
                                </span>
                                <span className="text-fg truncate flex-1">
                                    {formattedValue}
                                    {tag.antecedent && (
                                        <span className="text-fg-muted ml-1">← {tag.antecedent}</span>
                                    )}
                                </span>
                                <span className="text-fg-muted shrink-0">{tag.postCount.toLocaleString()}</span>
                                {copiedValue === formattedValue && (
                                    <span className="text-ok shrink-0">{DANBOORU.MESSAGES.COPIED}</span>
                                )}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
