/**
 * KeyboardSafeSelect - ソフトウェアキーボードを閉じさせない選択ドロップダウン。
 *
 * スマートフォンの select 要素は OS 純正のピッカーを開くため、
 * タップした時点で必ずソフトウェアキーボードが閉じてしまう。
 * チャット入力中にモデル選択などを行ってもキーボードを出したままにしたいので、
 * 自前で描いてタッチ操作時のフォーカス移動を抑止する。
 *
 * - タッチ操作: フォーカスを移さない。タップだけで開閉と選択ができる。
 * - マウス／キーボード操作: 通常どおりフォーカスを取り、矢印キーと Enter で選べる。
 *
 * 選択肢は position: fixed で描く。入力欄の祖先が overflow: hidden のため、
 * absolute で上方向に開くと画面が狭いときに切れてしまう。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronUp } from 'lucide-react';
import { keepFocusOnPointerDown } from '../../lib/pointer';

export interface KeyboardSafeSelectOption {
    value: string;
    label: string;
}

interface Props {
    value: string;
    options: KeyboardSafeSelectOption[];
    onChange: (value: string) => void;
    /** 閉じている時のボタンに当てる追加クラス（幅指定などの見た目調整用） */
    className?: string;
    title?: string;
    ariaLabel?: string;
    disabled?: boolean;
}

/** 選択肢リストと画面端の間に残す余白 */
const MENU_VIEWPORT_MARGIN = 8;
/** 選択肢リストの高さの上限 */
const MENU_MAX_HEIGHT = 240;
/** 上に開くだけの高さが無いときに下へ回すかを判断する下限 */
const MENU_MIN_HEIGHT = 96;

export const KeyboardSafeSelect: React.FC<Props> = ({
    value,
    options,
    onChange,
    className = '',
    title,
    ariaLabel,
    disabled = false,
}) => {
    const [isOpen, setIsOpen] = useState(false);
    // キーボード操作でなぞっている選択肢。マウス／タッチ操作では使わない。
    const [activeIndex, setActiveIndex] = useState(-1);
    const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
    const buttonRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    // タッチ操作で開いた場合はフォーカスを移していないため、閉じる際に戻す先も無い。
    const shouldRestoreFocusRef = useRef(false);

    const selectedIndex = options.findIndex(option => option.value === value);
    const selectedLabel = selectedIndex >= 0 ? options[selectedIndex].label : value;

    // ボタンの位置から選択肢リストの表示位置を決める。
    // 入力欄は画面下部にあるので上方向を基本とし、上が狭ければ下へ回す。
    const layoutMenu = useCallback(() => {
        const rect = buttonRef.current?.getBoundingClientRect();
        if (!rect) return;

        const viewportHeight = document.documentElement.clientHeight;
        const spaceAbove = rect.top - MENU_VIEWPORT_MARGIN;
        const spaceBelow = viewportHeight - rect.bottom - MENU_VIEWPORT_MARGIN;
        const opensUpward = spaceAbove >= MENU_MIN_HEIGHT || spaceAbove >= spaceBelow;
        const available = opensUpward ? spaceAbove : spaceBelow;

        setMenuStyle({
            position: 'fixed',
            left: Math.max(MENU_VIEWPORT_MARGIN, rect.left),
            minWidth: rect.width,
            maxWidth: `calc(100vw - ${MENU_VIEWPORT_MARGIN * 2}px)`,
            maxHeight: Math.max(MENU_MIN_HEIGHT, Math.min(MENU_MAX_HEIGHT, available)),
            ...(opensUpward
                ? { bottom: viewportHeight - rect.top + 4 }
                : { top: rect.bottom + 4 }),
        });
    }, []);

    const closeMenu = useCallback((restoreFocus: boolean) => {
        setIsOpen(false);
        setActiveIndex(-1);
        if (restoreFocus && shouldRestoreFocusRef.current) {
            buttonRef.current?.focus();
        }
    }, []);

    const openMenu = useCallback((fromKeyboard: boolean) => {
        if (disabled) return;
        layoutMenu();
        setActiveIndex(fromKeyboard ? Math.max(0, selectedIndex) : -1);
        setIsOpen(true);
    }, [disabled, layoutMenu, selectedIndex]);

    const selectAt = useCallback((index: number, restoreFocus: boolean) => {
        const option = options[index];
        if (option) onChange(option.value);
        closeMenu(restoreFocus);
    }, [options, onChange, closeMenu]);

    useEffect(() => {
        if (!isOpen) return;

        // リストの外を押したら閉じる。ここでは preventDefault しないので、
        // 押した先の操作（入力欄へのフォーカスなど）はそのまま通る。
        const handlePointerDownOutside = (e: PointerEvent) => {
            const target = e.target as Node;
            if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
            closeMenu(false);
        };
        // 表示領域が変わるとリストの位置がずれるため閉じる
        //（ソフトウェアキーボードの開閉、画面回転、表示領域のスクロール）。
        const handleViewportChange = () => closeMenu(false);

        document.addEventListener('pointerdown', handlePointerDownOutside);
        window.addEventListener('resize', handleViewportChange);
        window.addEventListener('orientationchange', handleViewportChange);
        window.visualViewport?.addEventListener('resize', handleViewportChange);
        window.visualViewport?.addEventListener('scroll', handleViewportChange);

        return () => {
            document.removeEventListener('pointerdown', handlePointerDownOutside);
            window.removeEventListener('resize', handleViewportChange);
            window.removeEventListener('orientationchange', handleViewportChange);
            window.visualViewport?.removeEventListener('resize', handleViewportChange);
            window.visualViewport?.removeEventListener('scroll', handleViewportChange);
        };
    }, [isOpen, closeMenu]);

    const handleButtonPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
        // マウス操作ではフォーカスを取り、そのままキーボードでも操作できる状態にする。
        shouldRestoreFocusRef.current = e.pointerType === 'mouse';
        keepFocusOnPointerDown(e);
    };

    const handleButtonKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            shouldRestoreFocusRef.current = true;
            if (!isOpen) {
                openMenu(true);
                return;
            }
            const delta = e.key === 'ArrowUp' ? -1 : 1;
            setActiveIndex(prev => {
                const base = prev < 0 ? Math.max(0, selectedIndex) : prev;
                return Math.min(options.length - 1, Math.max(0, base + delta));
            });
            return;
        }
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            shouldRestoreFocusRef.current = true;
            if (isOpen) {
                selectAt(activeIndex < 0 ? selectedIndex : activeIndex, true);
            } else {
                openMenu(true);
            }
            return;
        }
        if (e.key === 'Escape' && isOpen) {
            e.preventDefault();
            closeMenu(true);
        }
    };

    return (
        <div className="relative">
            <button
                ref={buttonRef}
                type="button"
                disabled={disabled}
                title={title}
                aria-label={ariaLabel}
                aria-haspopup="listbox"
                aria-expanded={isOpen}
                onPointerDown={handleButtonPointerDown}
                onClick={() => (isOpen ? closeMenu(false) : openMenu(false))}
                onKeyDown={handleButtonKeyDown}
                className={`bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded pl-2 pr-7 py-1.5 outline-none focus:border-blue-500 disabled:opacity-50 cursor-pointer hover:bg-gray-700 transition-colors text-left truncate ${className}`}
            >
                {selectedLabel}
            </button>
            <ChevronUp size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />

            {isOpen && (
                <div
                    ref={menuRef}
                    role="listbox"
                    aria-label={ariaLabel}
                    style={menuStyle}
                    className="z-[80] overflow-y-auto bg-gray-800 border border-gray-600 rounded shadow-xl"
                >
                    {options.map((option, index) => {
                        const isSelected = option.value === value;
                        const isActive = index === activeIndex;
                        return (
                            <button
                                key={option.value}
                                type="button"
                                role="option"
                                aria-selected={isSelected}
                                onPointerDown={keepFocusOnPointerDown}
                                onClick={() => selectAt(index, false)}
                                className={`w-full text-left text-xs px-3 py-2 transition-colors ${
                                    isSelected
                                        ? 'bg-blue-600/30 text-blue-200'
                                        : isActive
                                            ? 'bg-gray-700 text-gray-100'
                                            : 'text-gray-200 hover:bg-gray-700'
                                }`}
                            >
                                {option.label}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
