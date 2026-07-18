import React, { useRef, useEffect } from 'react';
import { FileTree } from './FileTree';
import { X } from 'lucide-react';

interface SidebarProps {
    isOpen: boolean;
    onClose: () => void;
    onSelectFile: (path: string) => void;
    backendUrl: string;
    isViewingFile?: boolean;  // ファイル閲覧中かどうか
}

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose, onSelectFile, backendUrl, isViewingFile }) => {
    const sidebarRef = useRef<HTMLDivElement>(null);

    // Close when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (isOpen && sidebarRef.current && !sidebarRef.current.contains(event.target as Node)) {
                // ファイル閲覧中は閲覧を邪魔しない。
                if (isViewingFile) return;
                onClose();
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen, onClose, isViewingFile]);

    return (
        <>
            {/* Overlay */}
            {isOpen && (
                <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-30 transition-opacity" />
            )}

            {/* Sidebar Panel */}
            <div
                ref={sidebarRef}
                className={`fixed inset-y-0 left-0 width-[280px] sm:w-[320px] bg-[#181a21] border-r border-gray-700 z-40 transform transition-transform duration-300 ease-in-out shadow-2xl ${isOpen ? 'translate-x-0' : '-translate-x-full'
                    }`}
            >
                <div className="flex flex-col h-full">
                    <div className="flex items-center justify-between p-4 border-b border-gray-700">
                        <span className="font-semibold text-gray-200">Explorer</span>
                        <div className="flex items-center gap-1">
                            {/* 閉じるボタン */}
                            <button onClick={onClose} className="p-1.5 hover:bg-gray-800 rounded text-gray-400 ml-2">
                                <X size={20} />
                            </button>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-2 scrollbar-thin scrollbar-thumb-gray-700">
                        <FileTree
                            backendUrl={backendUrl}
                            onSelectFile={(path) => {
                                onSelectFile(path);
                            }}
                        />
                    </div>
                </div>
            </div>
        </>
    );
};
