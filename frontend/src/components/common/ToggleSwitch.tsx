/**
 * ToggleSwitch.tsx - 共通トグルスイッチ
 *
 * UIデザインガイドライン（docs/UIデザインガイドライン.md）準拠の ON/OFF トグル。
 * input type="checkbox" / radio の生使用は禁止し、2状態の切り替えは本コンポーネントを使う。
 * ON/OFF 以外の2択（表示/非表示のようなモード切替）も、ラベルを工夫してトグルで表現する。
 */

import React from 'react';

export type ToggleAccent = 'blue' | 'pink' | 'cyan' | 'green' | 'purple' | 'orange' | 'amber' | 'red';

// Tailwind はクラス名を静的に解析するため、アクセント色ごとに完全なクラス文字列を持つ
const ACCENT_CLASSES: Record<ToggleAccent, string> = {
    blue: 'peer-checked:bg-blue-600 peer-focus:ring-blue-500',
    pink: 'peer-checked:bg-pink-600 peer-focus:ring-pink-500',
    cyan: 'peer-checked:bg-cyan-600 peer-focus:ring-cyan-500',
    green: 'peer-checked:bg-green-600 peer-focus:ring-green-500',
    purple: 'peer-checked:bg-purple-600 peer-focus:ring-purple-500',
    orange: 'peer-checked:bg-orange-600 peer-focus:ring-orange-500',
    amber: 'peer-checked:bg-amber-600 peer-focus:ring-amber-500',
    red: 'peer-checked:bg-red-600 peer-focus:ring-red-500',
};

const SIZE_CLASSES = {
    md: {
        track: 'w-11 h-6',
        knob: 'after:h-5 after:w-5',
        label: 'text-sm font-medium text-gray-300',
    },
    sm: {
        track: 'w-9 h-5',
        knob: 'after:h-4 after:w-4',
        label: 'text-xs text-gray-300',
    },
} as const;

interface Props {
    checked: boolean;
    onChange: (checked: boolean) => void;
    /** ラベル。省略時はトグル単体 */
    label?: React.ReactNode;
    /** ラベルの位置。既定はトグルの左（設定行レイアウト用） */
    labelPosition?: 'left' | 'right';
    /** 機能のアクセントカラー（ガイドライン第3章の割り当てに従う） */
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
    accent = 'blue',
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
                    className={`${sizeCls.track} bg-gray-700 peer-focus:outline-none peer-focus:ring-2 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full ${sizeCls.knob} after:transition-all ${ACCENT_CLASSES[accent]}`}
                ></div>
            </div>
            {labelPosition === 'right' && labelEl}
        </label>
    );
};
