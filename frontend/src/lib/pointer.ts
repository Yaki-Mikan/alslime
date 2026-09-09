/**
 * pointer.ts - ポインタ操作にまつわる小さなヘルパ。
 *
 * スマートフォンでは、入力欄以外の要素をタップするとフォーカスが移り、
 * ソフトウェアキーボードが閉じてしまう。モデル選択などの操作中は
 * キーボードを出したままにしたいので、タッチ操作に限りフォーカス移動を抑止する。
 */

import type React from 'react';

/**
 * タッチ／ペン操作のときだけフォーカス移動を止める pointerdown ハンドラ。
 * click 自体は発火するため、ボタンやチェックボックスの動作は妨げない。
 * マウス操作では通常どおりフォーカスを移し、キーボード操作性を保つ。
 */
export const keepFocusOnPointerDown = (e: React.PointerEvent): void => {
    if (e.pointerType !== 'mouse') {
        e.preventDefault();
    }
};
