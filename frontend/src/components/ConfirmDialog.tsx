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
            <div className="bg-surface-solid rounded-xl shadow-2xl w-full max-w-sm border border-line-strong overflow-hidden">
                <div className="px-5 py-4 border-b border-line-strong bg-surface">
                    <h3 className="font-semibold text-fg text-lg">{title}</h3>
                </div>
                <div className="px-5 py-4">
                    <p className="text-fg-muted text-sm whitespace-pre-line">{message}</p>
                </div>
                <div className="px-5 py-3 bg-panel/50 flex justify-end gap-2">
                    <button
                        onClick={onCancel}
                        className="px-4 py-2 text-sm text-fg-muted hover:text-fg hover:bg-surface-2 rounded transition-colors"
                    >
                        {t(COMMON_I18N_KEYS.cancel)}
                    </button>
                    <button
                        onClick={onNo}
                        className="px-4 py-2 text-sm text-fg-muted bg-surface-2 hover:bg-surface-2 rounded transition-colors"
                    >
                        {t(COMMON_I18N_KEYS.no)}
                    </button>
                    <button
                        onClick={onYes}
                        className="px-4 py-2 text-sm text-on-accent bg-accent hover:brightness-110 rounded transition-colors"
                    >
                        {t(COMMON_I18N_KEYS.yes)}
                    </button>
                </div>
            </div>
        </div>
    );
};
