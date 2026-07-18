/**
 * StatusDrawer.tsx - セッション状態ドロワー
 *
 * ヘッダー左のハンバーガーメニューから開く左側ドロワー。
 * 旧ツリービューエクスプローラ（Sidebar）の置き換えで、
 * ⌚セッション時刻パネルと💛キャラクター状態パネルを埋め込み表示する。
 * 各パネルは開閉可能で、デフォルトはどちらも閉。
 */
import React, { useRef, useEffect } from 'react';
import { X } from 'lucide-react';
import { resolveMessage, type I18NCatalog } from '../api/i18n';
import { CHAT_VIEW_I18N_KEYS, CHAT_VIEW_TEXT_FALLBACK_JA } from '../constants/i18n';

interface StatusDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    uiCatalog: I18NCatalog | null;
    children: React.ReactNode;
}

export const StatusDrawer: React.FC<StatusDrawerProps> = ({ isOpen, onClose, uiCatalog, children }) => {
    const drawerRef = useRef<HTMLDivElement>(null);
    const t = (key: string) => resolveMessage(uiCatalog, key, CHAT_VIEW_TEXT_FALLBACK_JA[key] || key);

    // 外側クリックで閉じる
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (isOpen && drawerRef.current && !drawerRef.current.contains(event.target as Node)) {
                onClose();
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen, onClose]);

    return (
        <>
            {/* Overlay */}
            {isOpen && (
                <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-30 transition-opacity" />
            )}

            {/* Drawer Panel */}
            <div
                ref={drawerRef}
                className={`fixed inset-y-0 left-0 w-[300px] sm:w-[400px] bg-[#181a21] border-r border-gray-700 z-40 transform transition-transform duration-300 ease-in-out shadow-2xl ${isOpen ? 'translate-x-0' : '-translate-x-full'
                    }`}
            >
                <div className="flex flex-col h-full">
                    <div className="flex items-center justify-between p-4 border-b border-gray-700">
                        <span className="font-semibold text-gray-200">{t(CHAT_VIEW_I18N_KEYS.statusMenu)}</span>
                        <button onClick={onClose} className="p-1.5 hover:bg-gray-800 rounded text-gray-400 ml-2">
                            <X size={20} />
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
                        {children}
                    </div>
                </div>
            </div>
        </>
    );
};
