/**
 * GridSelectionModal - 検索付きのカード型選択モーダル（汎用）。
 *
 * 会話設定メニューのキャラクター選択・関係性選択で使っている「検索して選ぶ」UI。
 * 現在選択中の値を選択状態で表示し、開いた時にその位置へスクロールする。
 * TTS 統合設定のキャラクター／Voice 選択でも同じ器を使う（RolePlaySettings から抽出）。
 */

import React, { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';

export const GridSelectionModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onSelect: (value: string) => void;
    options: { label: string; value: string; description?: string }[];
    title: string;
    emptyLabel?: string;
    searchable?: boolean;
    searchPlaceholder: string;
    noMatchTemplate: string;
    // 現在選択中の値。該当カードを選択状態で表示し、開いた時に見える位置へスクロールする
    selectedValue?: string;
    // 横広・列少なめレイアウト（キャラクター選択用。スマホ幅では1列）
    wide?: boolean;
}> = ({ isOpen, onClose, onSelect, options, title, emptyLabel, searchable = false, searchPlaceholder, noMatchTemplate, selectedValue, wide = false }) => {
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
            <div className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-4xl border border-gray-700 max-h-[80vh] flex flex-col overflow-hidden">
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700 bg-gray-800">
                    <h3 className="text-lg font-semibold text-gray-100">{title}</h3>
                    <button onClick={onClose} className="p-1.5 hover:bg-gray-700 rounded text-gray-400 hover:text-gray-200 transition-colors">
                        <X size={20} />
                    </button>
                </div>
                {searchable && (
                    <div className="p-3 border-b border-gray-700 bg-gray-800/60">
                        <div className="relative">
                            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                            <input
                                type="text"
                                value={searchInput}
                                onChange={(e) => setSearchInput(e.target.value)}
                                onCompositionStart={() => { isComposingRef.current = true; }}
                                onCompositionEnd={() => { isComposingRef.current = false; }}
                                onKeyDown={handleSearchKeyDown}
                                placeholder={searchPlaceholder}
                                className="w-full bg-gray-900 border border-gray-700 rounded pl-9 pr-3 py-2 text-sm text-gray-200 placeholder-gray-500 outline-none focus:border-blue-500 transition-colors"
                            />
                        </div>
                    </div>
                )}
                <div className="overflow-y-auto p-4 flex-1 custom-scrollbar">
                    <div className={wide ? 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3' : 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3'}>
                        {emptyLabel !== undefined && (
                            <button
                                onClick={() => onSelect('')}
                                className="text-left p-3 rounded hover:bg-gray-700 transition-colors border border-gray-700/50 hover:border-gray-500 h-full flex items-center justify-center min-h-[80px]"
                            >
                                <div className="font-bold text-gray-400 text-center">{emptyLabel}</div>
                            </button>
                        )}
                        {filteredOptions.map(opt => {
                            const isSelected = selectedValue !== undefined && selectedValue !== '' && opt.value === selectedValue;
                            return (
                                <button
                                    key={opt.value}
                                    ref={isSelected ? selectedRef : undefined}
                                    onClick={() => onSelect(opt.value)}
                                    className={`text-left p-3 rounded transition-colors border group h-full flex flex-col justify-center min-h-[80px] ${isSelected
                                        ? 'bg-blue-600/20 border-blue-500'
                                        : 'border-gray-700/50 hover:bg-gray-700 hover:border-blue-500/50'}`}
                                >
                                    <div className={`font-bold break-words w-full text-center ${isSelected ? 'text-blue-300' : 'text-gray-200 group-hover:text-blue-400'}`}>{opt.label}</div>
                                    {opt.description && (
                                        <div className={`text-xs mt-1 text-center ${isSelected ? 'text-blue-200/70' : 'text-gray-500 group-hover:text-gray-400'}`}>{opt.description}</div>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                    {searchable && normalizedTerm && filteredOptions.length === 0 && (
                        <div className="text-center text-gray-500 text-sm mt-6">
                            {noMatchTemplate.split('{{searchTerm}}').join(searchTerm)}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
