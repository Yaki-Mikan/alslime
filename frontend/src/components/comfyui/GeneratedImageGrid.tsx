/**
 * GeneratedImageGrid - 表情画像生成モーダルの生成画像一覧。
 *
 * 正方形サムネイルで並べ、クリックで選択、ダブルクリックで拡大表示する。
 * 失敗した生成は赤枠でエラー文を出す。
 */

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, AlertCircle } from 'lucide-react';

export interface GeneratedImageResult {
    id: string;
    base64?: string;
    mimeType?: string;
    positivePrompt?: string;
    error?: string;
}

interface Props {
    results: GeneratedImageResult[];
    selectedId: string | null;
    onSelect: (id: string) => void;
    emptyLabel: string;
    hintLabel: string;
}

export function generatedImageDataUrl(result: GeneratedImageResult): string {
    return `data:${result.mimeType || 'image/png'};base64,${result.base64 || ''}`;
}

export const GeneratedImageGrid: React.FC<Props> = ({ results, selectedId, onSelect, emptyLabel, hintLabel }) => {
    const [previewId, setPreviewId] = useState<string | null>(null);
    const preview = previewId ? results.find(r => r.id === previewId) : undefined;

    if (results.length === 0) {
        return <p className="text-sm text-gray-500 text-center py-10 border border-dashed border-gray-700 rounded-lg">{emptyLabel}</p>;
    }

    return (
        <div className="space-y-2">
            <p className="text-[11px] text-gray-500">{hintLabel}</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {results.map(result => {
                    const isSelected = result.id === selectedId;
                    if (result.error || !result.base64) {
                        return (
                            <div key={result.id} className="aspect-square rounded-lg border border-red-800 bg-red-900/20 flex flex-col items-center justify-center gap-1 p-2 text-red-300 text-xs text-center">
                                <AlertCircle size={18} />
                                <span className="line-clamp-4">{result.error}</span>
                            </div>
                        );
                    }
                    return (
                        <button
                            key={result.id}
                            type="button"
                            onClick={() => onSelect(result.id)}
                            onDoubleClick={() => setPreviewId(result.id)}
                            className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-colors ${isSelected ? 'border-blue-500 ring-2 ring-blue-500/40' : 'border-gray-700 hover:border-blue-500/60'}`}
                        >
                            <img src={generatedImageDataUrl(result)} alt="" className="w-full h-full object-cover" />
                            {isSelected && <div className="absolute inset-0 bg-blue-600/15 pointer-events-none" />}
                        </button>
                    );
                })}
            </div>

            {/* 拡大表示（祖先の transform の影響を避けるため body 直下へ） */}
            {preview && preview.base64 && createPortal(
                <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 p-6" onClick={() => setPreviewId(null)}>
                    <div className="relative max-w-[90vw] max-h-[90vh] flex flex-col items-center gap-2" onClick={e => e.stopPropagation()}>
                        <button
                            type="button"
                            onClick={() => setPreviewId(null)}
                            className="absolute -top-3 -right-3 bg-gray-800 border border-gray-600 rounded-full p-1.5 text-gray-300 hover:text-white"
                        >
                            <X size={16} />
                        </button>
                        <img src={generatedImageDataUrl(preview)} alt="" className="max-w-[90vw] max-h-[80vh] object-contain rounded-lg shadow-2xl" />
                        {preview.positivePrompt && (
                            <p className="max-w-[90vw] text-xs text-gray-300 bg-gray-900/90 border border-gray-700 rounded px-3 py-2 break-words">{preview.positivePrompt}</p>
                        )}
                    </div>
                </div>,
                document.body,
            )}
        </div>
    );
};
