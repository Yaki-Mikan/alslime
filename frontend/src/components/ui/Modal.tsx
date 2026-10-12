import React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from './cn';
import { IconButton } from './IconButton';
import { useModalLayer } from './useModalLayer';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

const SIZE_CLASSES: Record<ModalSize, string> = {
    sm: 'max-w-sm',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-5xl',
    full: 'max-w-[min(1400px,100%)] h-full',
};

interface ModalProps {
    open: boolean;
    onClose: () => void;
    /** 見出し。省略すると見出しの帯を出さない */
    title?: React.ReactNode;
    /** 見出しの左に置くアイコン */
    icon?: React.ReactNode;
    children: React.ReactNode;
    /** 下の帯（ボタン類） */
    footer?: React.ReactNode;
    size?: ModalSize;
    /** 外側を押したときに閉じるか（入力途中の窓では false にする） */
    closeOnOverlay?: boolean;
    /** 閉じるボタンの説明 */
    closeLabel: string;
    className?: string;
}

/** 窓の外枠。中身は呼び出し側が持つ。 */
export const Modal: React.FC<ModalProps> = ({
    open,
    onClose,
    title,
    icon,
    children,
    footer,
    size = 'md',
    closeOnOverlay = true,
    closeLabel,
    className,
}) => {
    const level = useModalLayer(open, onClose);
    if (!open) return null;

    return createPortal(
        <div
            className="fixed inset-0 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
            style={{ zIndex: `calc(var(--z-modal) + ${level})` }}
            onMouseDown={(e) => {
                if (closeOnOverlay && e.target === e.currentTarget) onClose();
            }}
        >
            <div
                role="dialog"
                aria-modal="true"
                className={cn(
                    'w-full max-h-full flex flex-col rounded-ui-lg bg-panel-solid border border-line-strong text-fg shadow-2xl overflow-hidden backdrop-blur-xl',
                    SIZE_CLASSES[size],
                    className,
                )}
            >
                {title !== undefined && (
                    <div className="flex items-center justify-between gap-3 pl-5 pr-3 h-14 shrink-0 border-b border-line">
                        <h2 className="flex items-center gap-2 min-w-0 font-head text-base font-bold tracking-wide truncate">
                            {icon}
                            {title}
                        </h2>
                        <IconButton label={closeLabel} onClick={onClose}>
                            <X size={18} />
                        </IconButton>
                    </div>
                )}
                <div className="flex-1 min-h-0 overflow-auto">{children}</div>
                {footer && <div className="shrink-0 flex justify-end gap-2 px-4 py-3 border-t border-line">{footer}</div>}
            </div>
        </div>,
        document.body,
    );
};
