/**
 * ToggleSwitch.tsx - 共通トグルスイッチ
 *
 * ON/OFF の切り替え。input type="checkbox" / radio の生使用は避け、2状態の切り替えは本コンポーネントを使う。
 * ON/OFF 以外の2択（表示/非表示のようなモード切替）も、ラベルを工夫してトグルで表現する。
 */

import React from 'react';

// 機能ごとの色分けはやめたため、どの値でも差し色で描く。呼び出し側の指定は互換のために受け取る。
export type ToggleAccent = 'blue' | 'pink' | 'cyan' | 'green' | 'purple' | 'orange' | 'amber' | 'red';

const SIZE_CLASSES = {
    md: {
        track: 'w-11 h-6',
        knob: 'after:h-5 after:w-5',
        label: 'text-sm font-medium text-fg',
    },
    sm: {
        track: 'w-9 h-5',
        knob: 'after:h-4 after:w-4',
        label: 'text-xs text-fg',
    },
} as const;

interface Props {
    checked: boolean;
    onChange: (checked: boolean) => void;
    /** ラベル。省略時はトグル単体 */
    label?: React.ReactNode;
    /** ラベルの位置。既定はトグルの左（設定行レイアウト用） */
    labelPosition?: 'left' | 'right';
    /** 互換のために受け取る。描画はどの値でも差し色 */
    accent?: ToggleAccent;
    size?: 'md' | 'sm';
    disabled?: boolean;
    /** ルート label 要素への追加クラス（justify-between 等のレイアウト指定に使う） */
    className?: string;
    /** ラベル文字列のクラス上書き */
    labelClassName?: string;
    title?: string;
}

export const ToggleSwitch: React.FC<Props> = ({
    checked,
    onChange,
    label,
    labelPosition = 'left',
    size = 'md',
    disabled = false,
    className = '',
    labelClassName,
    title,
}) => {
    const sizeCls = SIZE_CLASSES[size];
    const labelEl = label !== undefined && (
        <span className={labelClassName ?? sizeCls.label}>{label}</span>
    );

    return (
        <label
            className={`inline-flex items-center gap-2 ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} ${className}`}
            title={title}
        >
            {labelPosition === 'left' && labelEl}
            <div className="relative shrink-0">
                <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => onChange(e.target.checked)}
                    disabled={disabled}
                    className="sr-only peer"
                />
                <div
                    className={`${sizeCls.track} bg-surface-2 peer-focus:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-accent rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-line-strong after:border after:rounded-full ${sizeCls.knob} after:transition-all peer-checked:bg-accent`}
                ></div>
            </div>
            {labelPosition === 'right' && labelEl}
        </label>
    );
};
