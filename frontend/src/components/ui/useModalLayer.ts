import { useEffect, useRef, useState } from 'react';
import { pushModal } from './modalStack';

/**
 * 開いている間、窓の積み上げに加わる。Esc で一番上だけが閉じ、閉じると入力の位置を元へ戻す。
 * 返す値は重なりの段数（z-index の加算に使う）。
 */
export const useModalLayer = (open: boolean, onClose: () => void): number => {
    const [level, setLevel] = useState(0);
    const onCloseRef = useRef(onClose);

    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    useEffect(() => {
        if (!open) return;
        const previousFocus = document.activeElement as HTMLElement | null;
        const layer = pushModal(() => onCloseRef.current());
        setLevel(layer.level);
        return () => {
            layer.release();
            if (previousFocus && document.contains(previousFocus)) previousFocus.focus();
        };
    }, [open]);

    return level;
};
