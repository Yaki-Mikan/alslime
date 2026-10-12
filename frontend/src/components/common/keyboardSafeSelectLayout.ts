import { visibleViewportBounds } from '../../lib/viewport';

/** 選択肢リストと画面端の間に残す余白 */
export const MENU_VIEWPORT_MARGIN = 8;
/** 選択肢リストと開閉ボタンの間隔 */
export const MENU_ANCHOR_GAP = 4;
/** 上に開くだけの高さが無いときに下へ回すかを判断する下限 */
const MENU_MIN_HEIGHT = 96;

interface MenuVerticalLayout {
    opensUpward: boolean;
    available: number;
}

/** ボタンと実表示領域から、選択肢リストを開く向きと使える高さを求める。 */
export const measureMenuVerticalLayout = (
    rect: Pick<DOMRect, 'top' | 'bottom'>,
    topBoundaryBottom?: number,
): MenuVerticalLayout => {
    const { top: visibleTop, bottom: visibleBottom } = visibleViewportBounds();
    const usableTop = Math.max(visibleTop, topBoundaryBottom ?? visibleTop);
    const spaceAbove = rect.top - usableTop - MENU_ANCHOR_GAP - MENU_VIEWPORT_MARGIN;
    const spaceBelow = visibleBottom - rect.bottom - MENU_ANCHOR_GAP - MENU_VIEWPORT_MARGIN;
    const opensUpward = spaceAbove >= MENU_MIN_HEIGHT || spaceAbove >= spaceBelow;
    return {
        opensUpward,
        available: Math.max(0, opensUpward ? spaceAbove : spaceBelow),
    };
};
