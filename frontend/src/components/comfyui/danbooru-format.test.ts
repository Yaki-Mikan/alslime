import { describe, it, expect } from 'vitest';
import { formatAnima, formatDanbooruTag, formatTriggerWord, formatTriggerLine, appendTriggerLineDedup } from './danbooru-format';

describe('Anima向け表記', () => {
    it('アンダーバーを半角スペースにし、括弧をエスケープする', () => {
        expect(formatAnima('char_(series)')).toBe('char \\(series\\)');
        expect(formatDanbooruTag('char_(series)', 'anima')).toBe('char \\(series\\)');
        expect(formatTriggerWord('char (series)', 'anima')).toBe('char \\(series\\)');
    });

    it('既にエスケープ済みの括弧は二重にしない', () => {
        expect(formatAnima('char \\(series\\)')).toBe('char \\(series\\)');
    });

    it('括弧の無いタグはスペース区切りと同じ結果になる', () => {
        expect(formatAnima('long_hair')).toBe('long hair');
        expect(formatDanbooruTag('long_hair', 'anima')).toBe(formatDanbooruTag('long_hair', 'space'));
    });

    it('行全体にも適用される', () => {
        expect(formatTriggerLine('char_(series), long_hair', 'anima')).toBe('char \\(series\\), long hair');
    });

    it('重複判定はエスケープの有無と表記揺れを吸収する', () => {
        expect(appendTriggerLineDedup('char \\(series\\)', 'char_(series), smile', 'anima')).toBe('char \\(series\\), smile');
    });
});

describe('既存の表記', () => {
    it('underscore / space は従来どおり', () => {
        expect(formatDanbooruTag('long_hair', 'underscore')).toBe('long_hair');
        expect(formatDanbooruTag('long_hair', 'space')).toBe('long hair');
        expect(formatTriggerWord('long hair', 'underscore')).toBe('long_hair');
        expect(formatTriggerWord('char_(series)', 'space')).toBe('char (series)');
        expect(formatTriggerWord('char_(series)', 'raw')).toBe('char_(series)');
    });
});
