import { describe, expect, it } from 'vitest';
import { collectSpeakers } from './tempCharacterSpeakers';

const agent = (content: string, errorType?: string) => ({ role: 'agent' as const, content, errorType });
const user = (content: string) => ({ role: 'user' as const, content });

describe('collectSpeakers', () => {
    it('TURN 区切りの話者を数え、表記ゆれを束ねる', () => {
        const messages = [
            user('こんにちは'),
            agent('[TURN character="雪"]雪：「やあ」[/TURN][TURN character="燈"]燈：「うん」[/TURN]'),
            agent('[TURN character="雪 "]雪：「また来たの」[/TURN]'),
        ];
        const result = collectSpeakers(messages, [], undefined, 'おっさん');
        expect(result.map(r => [r.displayName, r.count, r.status])).toEqual([
            ['雪', 2, 'unregistered'],
            ['燈', 1, 'unregistered'],
        ]);
    });

    it('登録済み・一時登録済み・ユーザーを判定する', () => {
        const messages = [
            agent('[TURN character="雪"]a[/TURN][TURN character="燈"]b[/TURN][TURN character="A/B"]c[/TURN][TURN character="おっさん"]d[/TURN][TURN character="ことり"]e[/TURN]'),
        ];
        const registered = [
            { name: '雪', dirName: '雪' },
            { name: 'A／B', dirName: 'A／B', originalName: 'A/B' },
        ];
        const temps = {
            'roleplay/temp_characters/tmp_1/settings/燈.md': { name: '燈' },
            'roleplay/temp_characters/tmp_2/settings/ことり.md': { name: 'ことり', registeredPath: 'roleplay/characters/ことり/settings/ことり.md' },
        };
        const result = collectSpeakers(messages, registered, temps, 'おっさん');
        const byName = Object.fromEntries(result.map(r => [r.displayName, r]));
        expect(byName['雪'].status).toBe('registered');
        expect(byName['A/B'].status).toBe('registered');
        expect(byName['燈'].status).toBe('temp');
        expect(byName['燈'].virtualPath).toBe('roleplay/temp_characters/tmp_1/settings/燈.md');
        expect(byName['ことり'].status).toBe('tempRegistered');
        expect(byName['おっさん']).toBeUndefined();
    });

    it('エラー応答と区切りの無い応答は数えない', () => {
        const messages = [
            agent('[TURN character="雪"]a[/TURN]', 'timeout'),
            agent('区切りの無い本文'),
        ];
        expect(collectSpeakers(messages, [], undefined, '')).toEqual([]);
    });

    it('前方一致では登録済みにしない', () => {
        const messages = [agent('[TURN character="雪子"]a[/TURN]')];
        const result = collectSpeakers(messages, [{ name: '雪', dirName: '雪' }], undefined, '');
        expect(result[0].status).toBe('unregistered');
    });
});
