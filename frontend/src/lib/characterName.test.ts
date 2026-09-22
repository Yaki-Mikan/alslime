import { describe, expect, it } from 'vitest';
import { isTempCharacterPath, normalizeCharacterName } from './characterName';

describe('normalizeCharacterName', () => {
    it('表記ゆれを束ねる', () => {
        expect(normalizeCharacterName('雪')).toBe('雪');
        expect(normalizeCharacterName(' 雪 ')).toBe('雪');
        expect(normalizeCharacterName('雪　')).toBe('雪');
        expect(normalizeCharacterName('Ｙｕｋｉ')).toBe('yuki');
        expect(normalizeCharacterName('yu_ki-')).toBe('yuki');
        expect(normalizeCharacterName('燈・あかり')).toBe('燈あかり');
    });

    it('拡張子を落とす', () => {
        expect(normalizeCharacterName('roleplay/characters/雪/settings/雪.md')).toBe('roleplay/characters/雪/settings/雪');
        expect(normalizeCharacterName('Alice_v3.md')).toBe('alicev3');
    });

    it('前方一致で同一視しない', () => {
        expect(normalizeCharacterName('雪')).not.toBe(normalizeCharacterName('雪子'));
    });
});

describe('isTempCharacterPath', () => {
    it('仮想パスを判定する', () => {
        expect(isTempCharacterPath('roleplay/temp_characters/tmp_abc/settings/燈.md')).toBe(true);
        expect(isTempCharacterPath('roleplay\\temp_characters\\tmp_abc\\settings\\燈.md')).toBe(true);
        expect(isTempCharacterPath('roleplay/characters/雪/settings/雪.md')).toBe(false);
        expect(isTempCharacterPath('')).toBe(false);
        expect(isTempCharacterPath(null)).toBe(false);
    });
});
