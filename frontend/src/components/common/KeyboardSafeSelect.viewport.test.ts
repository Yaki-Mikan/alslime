import { afterEach, describe, expect, it } from 'vitest';
import { measureMenuVerticalLayout } from './keyboardSafeSelectLayout';

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

describe('キーボードを閉じない選択肢リストの表示領域', () => {
    it('上側へ開く一覧の高さを固定表示の見出しより下に制限する', () => {
        setVisibleViewport(40, 420);

        expect(measureMenuVerticalLayout({ top: 250, bottom: 282 }, 120)).toEqual({
            opensUpward: true,
            available: 118,
        });
    });

    it('上に開く場合も固定表示の見出しより下だけを利用する', () => {
        setVisibleViewport(40, 420);

        expect(measureMenuVerticalLayout({ top: 360, bottom: 392 }, 120)).toEqual({
            opensUpward: true,
            available: 228,
        });
    });
});
