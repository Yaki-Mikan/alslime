import { describe, expect, it } from 'vitest';
import { mergeResponseAdvancedSettings } from './responseAdvancedSettings';

const detail = (duration: unknown, extra: Record<string, unknown> = {}) => ({
    parameterGroups: [
        { id: 'emotion', enabled: true, isOpen: false, values: { joy: 3 } },
        { id: 'relationship', enabled: true, isOpen: false, values: { relationshipDuration: duration, ...extra } },
    ],
});

describe('mergeResponseAdvancedSettings', () => {
    it('日付時刻の設定と付き合いの長さだけを本体の値にし、ほかの変更は残す', () => {
        const ui = {
            situations: ['変更した場面.md'],
            dateTimeSettings: { enabled: true, currentSessionTime: { year: 2026, month: 10, day: 11, hour: 15, minute: 0 } },
            characterDetails: { 'a.md': detail({ years: 1 }, { relationship: '友人（変更）' }) },
        };
        const saved = {
            situations: ['元の場面.md'],
            dateTimeSettings: { enabled: true, currentSessionTime: { year: 2026, month: 10, day: 11, hour: 17, minute: 20 }, totalElapsedDays: 0.1 },
            characterDetails: { 'a.md': detail({ years: 1, days: 1 }, { relationship: '友人' }) },
        };
        const merged = mergeResponseAdvancedSettings(ui, saved);
        expect(merged.situations).toEqual(['変更した場面.md']);
        expect(merged.dateTimeSettings).toEqual(saved.dateTimeSettings);
        const relationship = merged.characterDetails['a.md'].parameterGroups[1].values;
        expect(relationship.relationshipDuration).toEqual({ years: 1, days: 1 });
        expect(relationship.relationship).toBe('友人（変更）');
        expect(merged.characterDetails['a.md'].parameterGroups[0].values).toEqual({ joy: 3 });
    });

    it('元の設定を書き換えず、本体に無いキャラや項目には触れない', () => {
        const ui = { characterDetails: { 'a.md': detail({ years: 1 }), 'b.md': detail({ years: 2 }) } };
        const saved = { characterDetails: { 'a.md': { parameterGroups: [] } } };
        const merged = mergeResponseAdvancedSettings(ui, saved);
        expect(merged).toEqual(ui);
        expect(merged).not.toBe(ui);
        expect(merged.dateTimeSettings).toBeUndefined();
    });
});
