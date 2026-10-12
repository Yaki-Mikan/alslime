import { describe, expect, it } from 'vitest';
import type { Session } from '../../hooks/useSession';
import { matchesHistoryQuery } from './historySearch';

const session: Session = {
    index: 0,
    title: 'いろはと雨宿り',
    id: 's1',
    presetName: '雨の日セット',
    characters: ['陽森いろは'],
    situations: ['古道具屋の店先'],
};

describe('履歴の検索', () => {
    it('会話の題・キャラ名・プリセット名・シチュエーション名で見つかる', () => {
        expect(matchesHistoryQuery(session, '雨宿り')).toBe(true);
        expect(matchesHistoryQuery(session, 'いろは')).toBe(true);
        expect(matchesHistoryQuery(session, '雨の日')).toBe(true);
        expect(matchesHistoryQuery(session, '古道具屋')).toBe(true);
    });

    it('どれにも含まれなければ見つからない。空の検索はすべて出す', () => {
        expect(matchesHistoryQuery(session, '猫')).toBe(false);
        expect(matchesHistoryQuery(session, '  ')).toBe(true);
    });

    it('大文字小文字を区別せず、プリセット名やシチュエーションが無い会話でも落ちない', () => {
        const plain: Session = { index: 1, title: 'Hello', id: 's2' };
        expect(matchesHistoryQuery(plain, 'hello')).toBe(true);
        expect(matchesHistoryQuery(plain, 'preset')).toBe(false);
    });
});
