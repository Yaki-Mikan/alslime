import { useEffect, useState } from 'react';
import type { RefObject } from 'react';

// ページ全体のスクロールを止めているため、ブラウザ標準の「引っ張って更新」が
// 発動しない。ヘッダー領域で下方向のタッチ移動を検知し、一定量を超えて
// 指を離したときに再読み込みする。
// インストール済みアプリ（standalone 表示）では更新ボタンが無いので、
// これがキャッシュ更新や生成画像の反映を促す唯一の手段になる。

// 再読み込みを発動する引き量（抵抗適用後の px）
const RELOAD_THRESHOLD_PX = 72;
// 指の移動量に対する表示上の引き量の比率（引きすぎ防止の抵抗）
const PULL_RESISTANCE = 0.5;
// 引き始めと判定する最小移動量。ボタンのタップ程度の揺れを除外する
const START_SLOP_PX = 8;

export interface PullToReloadState {
    // 抵抗適用後の引き量（px）。0 のときは非表示
    pullDistance: number;
    // 閾値に達しており、離せば再読み込みされる
    isReady: boolean;
    // 再読み込みを開始した
    isReloading: boolean;
}

const canTouch = () => typeof window !== 'undefined' && 'ontouchstart' in window;

export function usePullToReload(targetRef: RefObject<HTMLElement | null>): PullToReloadState {
    const [pullDistance, setPullDistance] = useState(0);
    const [isReloading, setIsReloading] = useState(false);

    useEffect(() => {
        const el = targetRef.current;
        if (!el || !canTouch()) return;

        let startX = 0;
        let startY = 0;
        let tracking = false;
        let reloading = false;
        // state 更新関数の中で再読み込みを呼ぶと二重実行され得るため、引き量は別途保持する
        let currentPull = 0;

        const isZoomed = () => (window.visualViewport?.scale ?? 1) > 1.01;

        const updatePull = (value: number) => {
            currentPull = value;
            setPullDistance(value);
        };

        const reset = () => {
            tracking = false;
            updatePull(0);
        };

        const onTouchStart = (e: TouchEvent) => {
            if (reloading || e.touches.length !== 1 || isZoomed()) {
                tracking = false;
                return;
            }
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            tracking = true;
        };

        const onTouchMove = (e: TouchEvent) => {
            if (!tracking || reloading) return;
            if (e.touches.length !== 1 || isZoomed()) {
                reset();
                return;
            }
            const dx = e.touches[0].clientX - startX;
            const dy = e.touches[0].clientY - startY;
            // 上方向や横方向優勢の移動は対象外
            if (dy <= START_SLOP_PX || Math.abs(dx) > dy) {
                updatePull(0);
                return;
            }
            updatePull((dy - START_SLOP_PX) * PULL_RESISTANCE);
        };

        const onTouchEnd = () => {
            if (!tracking || reloading) return;
            tracking = false;
            if (currentPull >= RELOAD_THRESHOLD_PX) {
                reloading = true;
                setIsReloading(true);
                window.location.reload();
                return;
            }
            updatePull(0);
        };

        const onTouchCancel = () => {
            if (reloading) return;
            reset();
        };

        el.addEventListener('touchstart', onTouchStart, { passive: true });
        el.addEventListener('touchmove', onTouchMove, { passive: true });
        el.addEventListener('touchend', onTouchEnd, { passive: true });
        el.addEventListener('touchcancel', onTouchCancel, { passive: true });

        return () => {
            el.removeEventListener('touchstart', onTouchStart);
            el.removeEventListener('touchmove', onTouchMove);
            el.removeEventListener('touchend', onTouchEnd);
            el.removeEventListener('touchcancel', onTouchCancel);
        };
    }, [targetRef]);

    return {
        pullDistance,
        isReady: pullDistance >= RELOAD_THRESHOLD_PX,
        isReloading,
    };
}
