/**
 * CollapsibleSection.tsx - 設定モーダル用の開閉セクション
 *
 * 設定メニュー整理（設定メニュー整理/やりたいこと.md）で導入。
 * 「デフォルトプロバイダ（開閉）」「起動設定（開閉）」等の折りたたみ表示に使う。
 */

import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';

interface CollapsibleSectionProps {
    title: React.ReactNode;
    defaultOpen?: boolean;
    children: React.ReactNode;
}

export const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
    title,
    defaultOpen = false,
    children,
}) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    return (
        <div className="border border-gray-700 rounded-lg overflow-hidden">
            <button
                type="button"
                onClick={() => setIsOpen(prev => !prev)}
                className="w-full flex items-center justify-between px-3 py-2.5 bg-gray-800 hover:bg-gray-700 text-sm font-medium text-gray-300 transition-colors"
            >
                <span className="flex items-center gap-2">{title}</span>
                <ChevronDown
                    size={16}
                    className={`text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                />
            </button>
            {isOpen && (
                <div className="p-3 space-y-4 border-t border-gray-700">
                    {children}
                </div>
            )}
        </div>
    );
};
