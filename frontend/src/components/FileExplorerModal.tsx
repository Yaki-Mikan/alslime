import React, { useState, useEffect } from 'react';
import { X, Check, Paperclip, FolderOpen } from 'lucide-react';
import { FileTree } from './FileTree';
import { resolveMessage, type I18NCatalog } from '../api/i18n';
import { COMMON_I18N_KEYS, COMMON_TEXT_FALLBACK_JA, FILE_EXPLORER_I18N_KEYS, FILE_EXPLORER_TEXT_FALLBACK_JA } from '../constants/i18n';

interface FileExplorerModalProps {
    isOpen: boolean;
    onClose: () => void;
    onFilesSelected: (files: string[]) => void;
    backendUrl: string;
    selectedFiles?: string[];  // 既に選択されているファイル
    uiCatalog?: I18NCatalog | null;
}

export const FileExplorerModal: React.FC<FileExplorerModalProps> = ({
    isOpen,
    onClose,
    onFilesSelected,
    backendUrl,
    selectedFiles = [],
    uiCatalog = null
}) => {
    const [tempSelectedFiles, setTempSelectedFiles] = useState<string[]>([]);
    const t = (key: string) => resolveMessage(
        uiCatalog,
        key,
        FILE_EXPLORER_TEXT_FALLBACK_JA[key] || COMMON_TEXT_FALLBACK_JA[key] || key
    );
    const formatText = (template: string, values: Record<string, string | number>) =>
        Object.entries(values).reduce((text, [key, value]) => text.split(`{{${key}}}`).join(String(value)), template);

    // モーダルが開かれたとき、既存の選択を反映
    useEffect(() => {
        if (isOpen) {
            setTempSelectedFiles([...selectedFiles]);
        }
    }, [isOpen, selectedFiles]);

    if (!isOpen) return null;

    const handleFileSelect = (path: string) => {
        setTempSelectedFiles(prev => {
            // 既に選択されていれば削除、なければ追加
            if (prev.includes(path)) {
                return prev.filter(p => p !== path);
            } else {
                return [...prev, path];
            }
        });
    };

    const handleConfirm = () => {
        onFilesSelected(tempSelectedFiles);
        onClose();
    };

    const handleClear = () => {
        setTempSelectedFiles([]);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* オーバーレイ */}
            <div
                className="absolute inset-0 bg-black/70 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* モーダル本体 */}
            <div className="relative bg-gray-900 border border-gray-700 rounded-lg shadow-2xl w-[90vw] max-w-2xl h-[70vh] flex flex-col">
                {/* ヘッダー */}
                <div className="flex items-center justify-between p-4 border-b border-gray-700">
                    <div className="flex items-center gap-2">
                        <Paperclip size={20} className="text-blue-400" />
                        <span className="font-semibold text-gray-200">{t(FILE_EXPLORER_I18N_KEYS.attachFile)}</span>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-gray-800 rounded text-gray-400">
                        <X size={20} />
                    </button>
                </div>

                {/* ファイルツリー */}
                <div className="flex-1 overflow-y-auto p-3">
                    <FileTree
                        backendUrl={backendUrl}
                        onSelectFile={handleFileSelect}
                        multiSelect={true}
                        selectedPaths={tempSelectedFiles}
                    />
                </div>

                {/* 選択済みファイル表示 */}
                {tempSelectedFiles.length > 0 && (
                    <div className="px-4 py-2 border-t border-gray-700 bg-gray-800/50">
                        <div className="text-xs text-gray-400 mb-1">
                            {formatText(t(COMMON_I18N_KEYS.selectedCount), { count: tempSelectedFiles.length })}
                        </div>
                        <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                            {tempSelectedFiles.map(file => (
                                <span
                                    key={file}
                                    className="px-2 py-0.5 bg-blue-600/30 text-blue-300 rounded text-xs flex items-center gap-1"
                                >
                                    <FolderOpen size={12} />
                                    {file.split('/').pop()}
                                    <button
                                        onClick={() => handleFileSelect(file)}
                                        className="hover:text-red-400 ml-1"
                                    >
                                        ×
                                    </button>
                                </span>
                            ))}
                        </div>
                    </div>
                )}

                {/* フッター */}
                <div className="flex items-center justify-between p-4 border-t border-gray-700">
                    <button
                        onClick={handleClear}
                        className="px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200 transition-colors"
                        disabled={tempSelectedFiles.length === 0}
                    >
                        {t(COMMON_I18N_KEYS.clear)}
                    </button>
                    <div className="flex gap-2">
                        <button
                            onClick={onClose}
                            className="px-4 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 text-gray-200 rounded transition-colors"
                        >
                            {t(COMMON_I18N_KEYS.cancel)}
                        </button>
                        <button
                            onClick={handleConfirm}
                            className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors flex items-center gap-1"
                        >
                            <Check size={16} />
                            {t(COMMON_I18N_KEYS.confirm)}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
