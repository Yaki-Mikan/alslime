/**
 * GridSelectionModal - 検索付きのカード型選択モーダル（汎用）。
 *
 * 会話設定メニューのキャラクター選択・関係性選択で使っている「検索して選ぶ」UI。
 * 現在選択中の値を選択状態で表示し、開いた時にその位置へスクロールする。
 */

import React, { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';

export const GridSelectionModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onSelect: (value: string) => void;
    // imageUrl があるカードは画像を背景に敷いた正方形カード（キャラカード）として描く
    options: { label: string; value: string; description?: string; imageUrl?: string }[];
    title: string;
    emptyLabel?: string;
    searchable?: boolean;
    searchPlaceholder: string;
    noMatchTemplate: string;
    // 現在選択中の値。該当カードを選択状態で表示し、開いた時に見える位置へスクロールする
    selectedValue?: string;
    // 横広・列少なめレイアウト（キャラクター選択用。スマホ幅では1列）
    wide?: boolean;
    // 検索欄の下に出す追加の絞り込み（キャラクター選択の作品・タグなど）
    filters?: React.ReactNode;
}> = ({ isOpen, onClose, onSelect, options, title, emptyLabel, searchable = false, searchPlaceholder, noMatchTemplate, selectedValue, wide = false, filters }) => {
    // 入力中の値（debounce対象）
    const [searchInput, setSearchInput] = useState('');
    // 実際に絞り込みに使う値
    const [searchTerm, setSearchTerm] = useState('');
    // IME変換中フラグ（変換中のEnterで検索が走らないようにする）
    const isComposingRef = useRef(false);
    // 選択中カードへの参照（開いた時のスクロール用）
    const selectedRef = useRef<HTMLButtonElement | null>(null);

    // モーダルが閉じたら検索状態を初期化
    useEffect(() => {
        if (!isOpen) {
            setSearchInput('');
            setSearchTerm('');
        }
    }, [isOpen]);

    // 開いた時に選択中カードが見えるようスクロール
    useEffect(() => {
        if (isOpen) {
            selectedRef.current?.scrollIntoView({ block: 'center' });
        }
    }, [isOpen]);

    // 入力から1秒経過で自動検索
    useEffect(() => {
        if (!searchable) return;
        const timer = setTimeout(() => {
            setSearchTerm(searchInput);
        }, 1000);
        return () => clearTimeout(timer);
    }, [searchInput, searchable]);

    if (!isOpen) return null;

    const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        // IME変換中のEnterは確定操作なので検索をトリガーしない
        // - isComposingRef: compositionstart/end で管理
        // - e.nativeEvent.isComposing: Chromium系のフォールバック
        // - keyCode === 229: Safari等のフォールバック
        if (e.key !== 'Enter') return;
        if (isComposingRef.current) return;
        if (e.nativeEvent.isComposing) return;
        if (e.keyCode === 229) return;
        e.preventDefault();
        setSearchTerm(searchInput);
    };

    const normalizedTerm = searchTerm.trim().toLowerCase();
    const filteredOptions = normalizedTerm
        ? options.filter(opt => opt.label.toLowerCase().includes(normalizedTerm))
        : options;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fade-in">
            <div className="bg-panel-solid text-fg rounded-ui-lg shadow-2xl w-full max-w-4xl border border-line-strong max-h-[80vh] flex flex-col overflow-hidden">
                <div className="flex items-center justify-between px-5 h-14 border-b border-line">
                    <h3 className="font-head text-base font-bold tracking-wide">{title}</h3>
                    <button onClick={onClose} className="p-1.5 hover:bg-surface rounded-ui text-fg-muted hover:text-fg transition-colors">
                        <X size={20} />
                    </button>
                </div>
                {(searchable || filters) && (
                    <div className="p-3 border-b border-line space-y-2">
                        <div className="relative">
                            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted pointer-events-none" />
                            <input
                                type="text"
                                value={searchInput}
                                onChange={(e) => setSearchInput(e.target.value)}
                                onCompositionStart={() => { isComposingRef.current = true; }}
                                onCompositionEnd={() => { isComposingRef.current = false; }}
                                onKeyDown={handleSearchKeyDown}
                                placeholder={searchPlaceholder}
                                className="w-full bg-surface border border-line-strong rounded-ui pl-9 pr-3 py-2 text-sm text-fg placeholder:text-fg-muted outline-none focus:border-accent transition-colors"
                            />
                        </div>
                        {filters}
                    </div>
                )}
                <div className="overflow-y-auto p-4 flex-1 custom-scrollbar">
                    <div className={wide ? 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3' : 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3'}>
                        {emptyLabel !== undefined && (
                            <button
                                onClick={() => onSelect('')}
                                className="text-left p-3 rounded-ui hover:bg-surface transition-colors border border-line hover:border-line-strong h-full flex items-center justify-center min-h-[80px]"
                            >
                                <div className="font-bold text-fg-muted text-center">{emptyLabel}</div>
                            </button>
                        )}
                        {filteredOptions.map(opt => {
                            const isSelected = selectedValue !== undefined && selectedValue !== '' && opt.value === selectedValue;
                            if (opt.imageUrl) {
                                // キャラカード：正方形アイコンを背景に敷き、下端のグラデーション帯の上に名前を重ねる
                                return (
                                    <button
                                        key={opt.value}
                                        ref={isSelected ? selectedRef : undefined}
                                        onClick={() => onSelect(opt.value)}
                                        className={`relative overflow-hidden rounded-ui transition-colors border group aspect-square min-h-[80px] ${isSelected
                                            ? 'bg-accent-soft border-accent'
                                            : 'border-line hover:border-accent'}`}
                                    >
                                        <img
                                            src={opt.imageUrl}
                                            alt=""
                                            loading="lazy"
                                            className={`absolute inset-0 w-full h-full object-cover transition-opacity ${isSelected ? 'opacity-70' : 'opacity-60 group-hover:opacity-80'}`}
                                        />
                                        {/* 画像の上の名前は、明るさに関わらず白字と暗い帯で読ませる */}
                                        <div className="absolute inset-x-0 bottom-0 pt-8 pb-2 px-2 bg-gradient-to-t from-black/85 via-black/60 to-transparent">
                                            <div className="font-bold break-words w-full text-center drop-shadow text-fg">{opt.label}</div>
                                            {opt.description && (
                                                <div className="text-xs mt-0.5 text-center text-fg/80">{opt.description}</div>
                                            )}
                                        </div>
                                    </button>
                                );
                            }
                            return (
                                <button
                                    key={opt.value}
                                    ref={isSelected ? selectedRef : undefined}
                                    onClick={() => onSelect(opt.value)}
                                    className={`text-left p-3 rounded-ui transition-colors border group h-full flex flex-col justify-center min-h-[80px] ${isSelected
                                        ? 'bg-accent-soft border-accent'
                                        : 'border-line hover:bg-surface hover:border-accent'}`}
                                >
                                    <div className="font-bold break-words w-full text-center text-fg">{opt.label}</div>
                                    {opt.description && (
                                        <div className="text-xs mt-1 text-center text-fg-muted">{opt.description}</div>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                    {searchable && normalizedTerm && filteredOptions.length === 0 && (
                        <div className="text-center text-fg-muted text-sm mt-6">
                            {noMatchTemplate.split('{{searchTerm}}').join(searchTerm)}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
