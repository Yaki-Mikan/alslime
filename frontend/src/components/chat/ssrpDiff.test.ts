import { describe, expect, it } from 'vitest';
import { isCharacterSetDifferent, isSSRPConfigDifferent } from './ssrpDiff';

describe('isCharacterSetDifferent', () => {
    it('相手を入れ替えた・増やした・減らしたときだけ違いとする', () => {
        expect(isCharacterSetDifferent(['a.md', 'b.md'], ['a.md', 'b.md'])).toBe(false);
        expect(isCharacterSetDifferent(['b.md', 'a.md'], ['a.md', 'b.md'])).toBe(false);
        expect(isCharacterSetDifferent(['a.md', '', 'b.md'], ['a.md', 'b.md'])).toBe(false);
        expect(isCharacterSetDifferent(['c.md', 'b.md'], ['a.md', 'b.md'])).toBe(true);
        expect(isCharacterSetDifferent(['a.md'], ['a.md', 'b.md'])).toBe(true);
        expect(isCharacterSetDifferent(['a.md', 'b.md'], undefined)).toBe(true);
        expect(isCharacterSetDifferent(undefined, null)).toBe(false);
    });
});

describe('isSSRPConfigDifferent', () => {
    const saved = {
        characters: ['roleplay/characters/a.md'],
        worldview: '',
        parameterSchemaId: 'default',
        characterDetails: { a: { hp: 80, isOpen: false } },
    };

    it('保存値に無い項目を画面が空の値で埋めていても、違いにしない', () => {
        const ui = {
            ...saved,
            tempCharacters: {},
            voiceDesignByCharacter: {},
            imageGenWorkflowId: '',
            imageGenApiPresetId: '',
            extraList: [],
            nested: { empty: '', none: null },
        };
        expect(isSSRPConfigDifferent(ui, saved)).toBe(false);
    });

    it('保存値の項目設定が空なら、画面が選んだ項目設定とは比べない', () => {
        expect(isSSRPConfigDifferent({ ...saved, parameterSchemaId: 'default' }, { ...saved, parameterSchemaId: '' })).toBe(false);
        expect(isSSRPConfigDifferent({ ...saved, parameterSchemaId: 'other' }, saved)).toBe(true);
    });

    it('世界観を選べば違いになり、未選択に戻せば違いでなくなる', () => {
        expect(isSSRPConfigDifferent({ ...saved, worldview: 'roleplay/global/worldviews/明治の東京.md' }, saved)).toBe(true);
        expect(isSSRPConfigDifferent({ ...saved, worldview: '' }, saved)).toBe(false);
    });

    it('欄の開閉と、実行の記録は比べない', () => {
        const ui = { ...saved, lastModel: 'x', characterDetails: { a: { hp: 80, isOpen: true, isCorrelationOpen: true } } };
        expect(isSSRPConfigDifferent(ui, saved)).toBe(false);
    });

    it('中身のある値の違いは拾う', () => {
        expect(isSSRPConfigDifferent({ ...saved, characterDetails: { a: { hp: 70 } } }, saved)).toBe(true);
        expect(isSSRPConfigDifferent({ ...saved, characters: [] }, saved)).toBe(true);
        expect(isSSRPConfigDifferent({ ...saved, flag: false }, saved)).toBe(true);
    });
});
