import { describe, expect, it } from 'vitest';

// 画面の部品は設計値（bg-surface・text-fg-muted など）で書く。Tailwind の色の直書きが入り込んでいないかを見張る。
const TARGETS = import.meta.glob(
    ['../**/*.tsx', '!../**/*.test.tsx'],
    { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

const RAW_COLOR = /\b(?:bg|text|border|ring|from|to|via|divide|placeholder|fill|stroke|outline|accent)-(?:gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g;

describe('設計値で書き直した部品', () => {
    it('対象のファイルが見つかる', () => {
        expect(Object.keys(TARGETS).length).toBeGreaterThan(5);
    });

    for (const [path, source] of Object.entries(TARGETS)) {
        it(`${path} に色の直書きが無い`, () => {
            expect(source.match(RAW_COLOR) ?? []).toEqual([]);
        });
    }
});
