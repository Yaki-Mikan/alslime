/**
 * LoraUnreachableNotice.tsx - ComfyUI 未接続時の LoRA 一覧通知
 *
 * LoRA 選択ドロップダウンを開いて一覧が空だった、その場所にだけ出す通知。
 * 編集操作は妨げず、再試行だけを提供する（常時表示のバナーとしては使わない）。
 * compact はドロップダウン内埋め込み用の小型表示。
 */

import React, { useState } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { createComfyUIText } from './i18n';
import type { I18NCatalog } from '../../api/i18n';

interface Props {
    visible: boolean;
    onRetry: () => Promise<void> | void;
    uiCatalog?: I18NCatalog | null;
    // ドロップダウン内埋め込み用の小型表示（短文・枠なし）
    compact?: boolean;
}

export const LoraUnreachableNotice: React.FC<Props> = ({ visible, onRetry, uiCatalog = null, compact = false }) => {
    const { COMMON } = createComfyUIText(uiCatalog);
    const [isRetrying, setIsRetrying] = useState(false);

    if (!visible) return null;

    const handleRetry = async () => {
        setIsRetrying(true);
        try {
            await onRetry();
        } finally {
            setIsRetrying(false);
        }
    };

    const retryButton = (
        <button
            onClick={handleRetry}
            disabled={isRetrying}
            className="flex items-center gap-1 px-2 py-1 border border-amber-700 rounded hover:bg-amber-900/40 transition-colors disabled:opacity-50 shrink-0"
        >
            <RefreshCw size={12} className={isRetrying ? 'animate-spin' : ''} />
            {COMMON.MESSAGES.LORA_RETRY}
        </button>
    );

    if (compact) {
        return (
            <div className="px-3 py-2 space-y-1.5 text-xs text-amber-300">
                <p className="flex items-start gap-1.5">
                    <AlertCircle size={12} className="mt-0.5 shrink-0" />
                    <span>{COMMON.MESSAGES.LORA_UNREACHABLE_SHORT}</span>
                </p>
                {retryButton}
            </div>
        );
    }

    return (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs bg-amber-950/30 border border-amber-800/50 text-amber-300">
            <AlertCircle size={14} className="shrink-0" />
            <span className="flex-1">{COMMON.MESSAGES.LORA_UNREACHABLE}</span>
            {retryButton}
        </div>
    );
};
