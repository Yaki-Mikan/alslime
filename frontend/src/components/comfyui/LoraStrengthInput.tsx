/**
 * LoraStrengthInput
 *
 * LoRA 強度（strength_model / strength_clip）の数値入力欄。
 * - 入力中は文字列のまま保持し、「-」「1.」「空」などの途中状態を勝手に 0 へ置き換えない。
 * - 欄を離れたときに数値へ確定し、表示は常に小数第2位まで（1 → 1.00）に整形する。
 * - 空や数値でない文字列のまま離れた場合は、確定前の値へ戻す。
 * - マイナス値を許容する。上下キーで step 刻みの増減ができる（min/max はこの増減にだけ効く）。
 */
import React, { useEffect, useState } from 'react';

interface Props {
    value: number;
    onCommit: (value: number) => void;
    step?: number;
    min?: number;
    max?: number;
    className?: string;
    title?: string;
}

const roundTo2 = (n: number): number => Math.round(n * 100) / 100;

const formatStrength = (n: number): string => (Number.isFinite(n) ? roundTo2(n) : 0).toFixed(2);

const parseStrength = (raw: string): number | null => {
    const trimmed = raw.trim();
    if (trimmed === '') return null;
    // 全角の数字・記号を半角へ寄せてから解釈する
    const normalized = trimmed
        .replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
        .replace(/[．]/g, '.')
        .replace(/[－ー−]/g, '-');
    if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(normalized)) return null;
    const n = parseFloat(normalized);
    return Number.isFinite(n) ? n : null;
};

export const LoraStrengthInput: React.FC<Props> = ({
    value,
    onCommit,
    step = 0.05,
    min,
    max,
    className,
    title,
}) => {
    const [text, setText] = useState(() => formatStrength(value));
    const [focused, setFocused] = useState(false);

    // 外部から値が変わったときは、編集中でなければ表示を追従させる
    useEffect(() => {
        if (!focused) setText(formatStrength(value));
    }, [value, focused]);

    const clamp = (n: number): number => {
        let out = n;
        if (min !== undefined && out < min) out = min;
        if (max !== undefined && out > max) out = max;
        return out;
    };

    const commit = (raw: string) => {
        const parsed = parseStrength(raw);
        if (parsed === null) {
            setText(formatStrength(value));
            return;
        }
        const next = roundTo2(parsed);
        setText(formatStrength(next));
        if (next !== value) onCommit(next);
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value;
        setText(raw);
        // 入力途中でも数値として読める場合は親へ反映する（丸めは確定時のみ）
        const parsed = parseStrength(raw);
        if (parsed !== null && parsed !== value) onCommit(parsed);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const base = parseStrength(text) ?? value;
            const delta = e.key === 'ArrowUp' ? step : -step;
            const next = roundTo2(clamp(base + delta));
            setText(formatStrength(next));
            if (next !== value) onCommit(next);
            return;
        }
        if (e.key === 'Enter') {
            commit(text);
        }
    };

    return (
        <input
            type="text"
            inputMode="decimal"
            value={text}
            onChange={handleChange}
            onFocus={() => setFocused(true)}
            onBlur={() => {
                setFocused(false);
                commit(text);
            }}
            onKeyDown={handleKeyDown}
            className={className}
            title={title}
        />
    );
};
