/**
 * DraggablePanel - 上部バーをドラッグして動かせる小窓
 *
 * 広い画面ではオーバーレイ無しの小窓として出し、上部バーのドラッグで移動できる。
 * 動かした位置はブラウザに記憶し（storageKey）、画面外に出ていたら中央へ戻す。
 * スマホでは他のモーダルと同じ全画面表示になり、ドラッグは効かない。
 * 中身は children（スクロール領域）と footer（下部バー）で渡す。extra は確認ダイアログ等、
 * 小窓の外側に描画したい要素。
 */

import React, { useRef, useState } from 'react';
import { X, GripHorizontal } from 'lucide-react';
import { useIsWideScreen } from '../../hooks/useIsWideScreen';

export type DraggablePanelAccent = 'orange' | 'pink';

interface Position {
    x: number;
    y: number;
}

/** 記憶した小窓の位置を読む。画面外なら中央（null）に戻す */
const readStoredPosition = (storageKey: string): Position | null => {
    try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return null;
        const p = JSON.parse(raw);
        if (typeof p?.x === 'number' && typeof p?.y === 'number'
            && p.x >= 0 && p.y >= 0 && p.x < window.innerWidth - 120 && p.y < window.innerHeight - 60) {
            return { x: p.x, y: p.y };
        }
    } catch { /* 記憶が読めなくても中央表示で動く */ }
    return null;
};

const ACCENT_CLASSES: Record<DraggablePanelAccent, { border: string; bar: string; title: string; grip: string }> = {
    orange: {
        border: 'border-orange-700/60',
        bar: 'border-b border-orange-800/60 bg-orange-950/40',
        title: 'text-orange-200',
        grip: 'text-orange-400/70',
    },
    pink: {
        border: 'border-pink-700/60',
        bar: 'border-b border-pink-800/60 bg-pink-950/40',
        title: 'text-pink-200',
        grip: 'text-pink-400/70',
    },
};

interface Props {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    /** 位置を記憶する localStorage のキー（小窓ごとに別にする） */
    storageKey: string;
    accent?: DraggablePanelAccent;
    /** 重なり順（上に出す親モーダルより大きくする） */
    zIndexClass?: string;
    widthClass?: string;
    maxHeightClass?: string;
    /** スクロール領域のクラス */
    bodyClass?: string;
    closeTitle?: string;
    children: React.ReactNode;
    footer?: React.ReactNode;
    extra?: React.ReactNode;
}

export const DraggablePanel: React.FC<Props> = ({
    isOpen,
    onClose,
    title,
    storageKey,
    accent = 'orange',
    zIndexClass = 'z-50',
    widthClass = 'w-[34rem]',
    maxHeightClass = 'max-h-[80vh]',
    bodyClass = 'p-3 space-y-4',
    closeTitle,
    children,
    footer,
    extra,
}) => {
    const isWide = useIsWideScreen();
    const colors = ACCENT_CLASSES[accent];

    // ドラッグ移動（広画面のみ）。位置はブラウザに記憶し、画面外なら中央へ戻す。
    const panelRef = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState<Position | null>(() => readStoredPosition(storageKey));
    const posRef = useRef<Position | null>(pos);
    const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
    const onBarPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!isWide) return;
        const rect = panelRef.current?.getBoundingClientRect();
        if (!rect) return;
        dragRef.current = { startX: e.clientX, startY: e.clientY, originX: rect.left, originY: rect.top };
        e.currentTarget.setPointerCapture?.(e.pointerId);
    };
    const onBarPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        const d = dragRef.current;
        if (!d) return;
        const x = Math.max(0, Math.min(window.innerWidth - 120, d.originX + e.clientX - d.startX));
        const y = Math.max(0, Math.min(window.innerHeight - 60, d.originY + e.clientY - d.startY));
        posRef.current = { x, y };
        setPos(posRef.current);
    };
    const onBarPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!dragRef.current) return;
        dragRef.current = null;
        e.currentTarget.releasePointerCapture?.(e.pointerId);
        try {
            if (posRef.current) localStorage.setItem(storageKey, JSON.stringify(posRef.current));
        } catch { /* 記憶できなくても機能に影響なし */ }
    };

    if (!isOpen) return null;

    const body = (
        <div className="flex flex-col h-full min-h-0">
            {/* 上部バー（広画面ではドラッグで移動） */}
            <div
                className={`flex items-center justify-between px-3 py-2 select-none ${colors.bar} ${isWide ? 'cursor-move' : ''}`}
                onPointerDown={onBarPointerDown}
                onPointerMove={onBarPointerMove}
                onPointerUp={onBarPointerUp}
                onPointerCancel={onBarPointerUp}
            >
                <div className="flex items-center gap-2 min-w-0">
                    {isWide && <GripHorizontal size={14} className={`${colors.grip} shrink-0`} />}
                    <h2 className={`text-sm font-bold truncate ${colors.title}`}>{title}</h2>
                </div>
                <button onClick={onClose} onPointerDown={e => e.stopPropagation()} className="p-1 text-gray-400 hover:text-white rounded" title={closeTitle}>
                    <X size={16} />
                </button>
            </div>

            <div className={`flex-1 min-h-0 overflow-y-auto ${bodyClass}`}>
                {children}
            </div>

            {footer && (
                <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-gray-800">
                    {footer}
                </div>
            )}
        </div>
    );

    if (!isWide) {
        return (
            <div className={`fixed inset-0 ${zIndexClass} flex items-center justify-center bg-black/70 backdrop-blur-sm p-4`}>
                <div className={`bg-gray-900 border ${colors.border} rounded-lg shadow-xl w-full h-full flex flex-col`}>
                    {body}
                </div>
                {extra}
            </div>
        );
    }

    return (
        <>
            <div
                ref={panelRef}
                style={pos ? { left: pos.x, top: pos.y } : undefined}
                className={`fixed ${zIndexClass} ${widthClass} max-w-[calc(100vw-2rem)] ${maxHeightClass} bg-gray-900 border ${colors.border} rounded-lg shadow-2xl flex flex-col ${pos ? '' : 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2'}`}
            >
                {body}
            </div>
            {extra}
        </>
    );
};
