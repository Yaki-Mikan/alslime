import React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from './cn';
import { IconButton } from './IconButton';
import { useModalLayer } from './useModalLayer';

interface SheetProps {
    open: boolean;
    onClose: () => void;
    /** 出てくる向き */
    side?: 'left' | 'right' | 'bottom';
    title?: React.ReactNode;
    children: React.ReactNode;
    footer?: React.ReactNode;
    closeLabel: string;
    /** 横から出るときの幅（Tailwind のクラス） */
    widthClassName?: string;
    className?: string;
}

const SIDE_CLASSES = {
    left: 'left-0 top-0 bottom-0 border-r',
    right: 'right-0 top-0 bottom-0 border-l',
    bottom: 'left-0 right-0 bottom-0 max-h-[85%] border-t rounded-t-ui-lg',
} as const;

/** 画面の端から重なって出る欄（状態欄・スマホの準備・調整欄など）。 */
export const Sheet: React.FC<SheetProps> = ({
    open,
    onClose,
    side = 'left',
    title,
    children,
    footer,
    closeLabel,
    widthClassName = 'w-full sm:w-96',
    className,
}) => {
    const level = useModalLayer(open, onClose);
    if (!open) return null;

    return createPortal(
        <div className="fixed inset-0" style={{ zIndex: `calc(var(--z-sheet) + ${level})` }}>
            <div className="absolute inset-0 bg-black/40 animate-fade-in" onMouseDown={onClose} />
            <aside
                className={cn(
                    'absolute flex flex-col bg-panel-solid border-line text-fg shadow-2xl backdrop-blur-xl animate-fade-in',
                    SIDE_CLASSES[side],
                    side !== 'bottom' && widthClassName,
                    className,
                )}
            >
                {title !== undefined && (
                    <div className="flex items-center justify-between gap-3 pl-5 pr-3 h-14 shrink-0 border-b border-line">
                        <h2 className="font-head text-base font-bold tracking-wide truncate">{title}</h2>
                        <IconButton label={closeLabel} onClick={onClose}>
                            <X size={18} />
                        </IconButton>
                    </div>
                )}
                <div className="flex-1 min-h-0 overflow-auto">{children}</div>
                {footer && <div className="shrink-0 px-4 py-3 border-t border-line">{footer}</div>}
            </aside>
        </div>,
        document.body,
    );
};
