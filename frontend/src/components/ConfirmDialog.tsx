import React from 'react';
import { resolveMessage, type I18NCatalog } from '../api/i18n';
import { COMMON_I18N_KEYS, COMMON_TEXT_FALLBACK_JA } from '../constants/i18n';

interface ConfirmDialogProps {
    isOpen: boolean;
    title: string;
    message: string;
    onYes: () => void;
    onNo: () => void;
    onCancel: () => void;
    uiCatalog?: I18NCatalog | null;
}

/**
 * 確認ダイアログ（はい/いいえ/キャンセル）
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
    isOpen,
    title,
    message,
    onYes,
    onNo,
    onCancel,
    uiCatalog = null,
}) => {
    if (!isOpen) return null;
    const t = (key: string) => resolveMessage(uiCatalog, key, COMMON_TEXT_FALLBACK_JA[key] || key);

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-sm border border-gray-700 overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-700 bg-gray-800">
                    <h3 className="font-semibold text-gray-100 text-lg">{title}</h3>
                </div>
                <div className="px-5 py-4">
                    <p className="text-gray-300 text-sm">{message}</p>
                </div>
                <div className="px-5 py-3 bg-gray-900/50 flex justify-end gap-2">
                    <button
                        onClick={onCancel}
                        className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 hover:bg-gray-700 rounded transition-colors"
                    >
                        {t(COMMON_I18N_KEYS.cancel)}
                    </button>
                    <button
                        onClick={onNo}
                        className="px-4 py-2 text-sm text-gray-300 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
                    >
                        {t(COMMON_I18N_KEYS.no)}
                    </button>
                    <button
                        onClick={onYes}
                        className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-500 rounded transition-colors"
                    >
                        {t(COMMON_I18N_KEYS.yes)}
                    </button>
                </div>
            </div>
        </div>
    );
};
