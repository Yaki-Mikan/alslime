import { afterEach, describe, expect, it } from 'vitest';
import { measurePickerMaxHeight } from './MessageInput';

const originalVisualViewport = window.visualViewport;
const originalClientHeight = Object.getOwnPropertyDescriptor(document.documentElement, 'clientHeight');

const setVisibleViewport = (offsetTop: number, height: number): void => {
    Object.defineProperty(document.documentElement, 'clientHeight', {
        configurable: true,
        value: offsetTop + height,
    });
    Object.defineProperty(window, 'visualViewport', {
        configurable: true,
        value: { offsetTop, height },
    });
};

const anchorAt = (top: number): HTMLElement => ({
    getBoundingClientRect: () => ({ top }),
}) as HTMLElement;

const boundaryEndingAt = (bottom: number): HTMLElement => ({
    getBoundingClientRect: () => ({ bottom }),
}) as HTMLElement;

afterEach(() => {
    Object.defineProperty(window, 'visualViewport', {
        configurable: true,
        value: originalVisualViewport,
    });
    if (originalClientHeight) {
        Object.defineProperty(document.documentElement, 'clientHeight', originalClientHeight);
    } else {
        Reflect.deleteProperty(document.documentElement, 'clientHeight');
    }
});

describe('モデル選択小窓の表示可能高さ', () => {
    it('キーボード表示中の可視領域上端と開閉ボタンの間に収める', () => {
        setVisibleViewport(40, 320);

        expect(measurePickerMaxHeight(anchorAt(280))).toBe(224);
    });

    it('表示できる高さが狭くても最低高を強制して画面外へはみ出さない', () => {
        setVisibleViewport(40, 160);

        expect(measurePickerMaxHeight(anchorAt(100))).toBe(44);
    });

    it('開閉ボタンが可視領域上端より上でも負の高さにしない', () => {
        setVisibleViewport(80, 160);

        expect(measurePickerMaxHeight(anchorAt(70))).toBe(0);
    });

    it('固定表示の見出しより下の範囲だけを小窓に使う', () => {
        setVisibleViewport(40, 320);

        expect(measurePickerMaxHeight(anchorAt(280), boundaryEndingAt(96))).toBe(168);
    });
});
