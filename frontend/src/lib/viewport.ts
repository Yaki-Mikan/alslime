/**
 * viewport.ts - 画面のうち実際に見えている範囲
 *
 * スマホでソフトウェアキーボードが出ていると、画面の下の一部がキーボードで隠れる。
 * 上に重ねて出す一覧や小窓は、この見えている範囲に収めないと、はみ出した分を選べなくなる。
 */

export interface VisibleViewportBounds {
    /** 見えている範囲の上端（getBoundingClientRect と position: fixed の基準での値） */
    top: number;
    /** 見えている範囲の下端（同上） */
    bottom: number;
}

export const visibleViewportBounds = (): VisibleViewportBounds => {
    const layoutHeight = document.documentElement.clientHeight;
    const vv = window.visualViewport;
    if (!vv) return { top: 0, bottom: layoutHeight };
    return {
        top: vv.offsetTop,
        bottom: Math.min(layoutHeight, vv.offsetTop + vv.height),
    };
};
