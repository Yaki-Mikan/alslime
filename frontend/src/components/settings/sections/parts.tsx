import React from 'react';
import { SectionTitle, SettingRows } from '../../ui';

/** 見出し付きの設定の行のまとまり */
export const SettingsGroup: React.FC<{ title: React.ReactNode; note?: React.ReactNode; children: React.ReactNode }> = ({ title, note, children }) => (
    <section className="mb-8 last:mb-0">
        <SectionTitle>{title}</SectionTitle>
        {note && <p className="text-xs text-fg-muted -mt-1 mb-2">{note}</p>}
        <SettingRows>{children}</SettingRows>
    </section>
);

interface RangeControlProps {
    value: number;
    min: number;
    max: number;
    step: number;
    onChange: (value: number) => void;
    /** 右に出す今の値 */
    display: string;
    disabled?: boolean;
    label: string;
}

/** つまみと今の値 */
export const RangeControl: React.FC<RangeControlProps> = ({ value, min, max, step, onChange, display, disabled = false, label }) => (
    <div className="flex items-center gap-3 w-full">
        <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            disabled={disabled}
            aria-label={label}
            onChange={(e) => onChange(parseFloat(e.target.value))}
            className="flex-1 min-w-0 accent-[var(--c-accent)] disabled:opacity-40"
        />
        <span className="w-14 shrink-0 text-right text-xs text-fg-muted tabular-nums">{display}</span>
    </div>
);
