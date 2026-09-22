import { describe, it, expect } from 'vitest';
import { resolveBackendError, type I18NCatalog } from '../../api/i18n';
import {
    formatAnima,
    formatDanbooruTag,
    formatTriggerWord,
    formatTriggerLine,
    appendTriggerLineDedup,
    formatForApiService,
    formatIdentityForComfyUI,
} from './danbooru-format';

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

describe('キャラクター名・作品名の ComfyUI 用出力', () => {
    it('重なった括弧のエスケープも出力先の形式へ揃える', () => {
        const input = String.raw`some_name \\(series\\), work \\(title\\)`;
        expect(formatForApiService(input)).toBe('some name (series), work (title)');
        expect(formatIdentityForComfyUI(input, 'anima')).toBe(String.raw`some name \(series\), work \(title\)`);
        expect(formatIdentityForComfyUI(input, 'underscore')).toBe('some_name_(series), work_(title)');
    });
    it('アンダーバー設定では単語の間を _ にする', () => {
        expect(formatIdentityForComfyUI('hatsune miku, vocaloid', 'underscore')).toBe('hatsune_miku, vocaloid');
        expect(formatIdentityForComfyUI('hatsune_miku', 'underscore')).toBe('hatsune_miku');
        expect(formatIdentityForComfyUI('saber \\(fate\\)', 'underscore')).toBe('saber_(fate)');
    });

    it('スペース設定では _ を半角スペースにする', () => {
        expect(formatIdentityForComfyUI('saber_(fate)', 'space')).toBe('saber (fate)');
        expect(formatIdentityForComfyUI('  hatsune   miku ,, ', 'space')).toBe('hatsune miku');
    });

    it('Anima 設定ではスペースにして括弧をエスケープし、二重にしない', () => {
        expect(formatIdentityForComfyUI('saber_(fate)', 'anima')).toBe('saber \\(fate\\)');
        expect(formatIdentityForComfyUI('saber \\(fate\\)', 'anima')).toBe('saber \\(fate\\)');
    });

    it('空は空', () => {
        expect(formatIdentityForComfyUI('   ', 'space')).toBe('');
    });
});

describe('API サービス用出力', () => {
    it('括弧のエスケープを外し、_ を半角スペースにする', () => {
        expect(formatForApiService('saber_\\(fate\\), fate/stay_night')).toBe('saber (fate), fate/stay night');
        expect(formatForApiService('hatsune_miku,  vocaloid ,')).toBe('hatsune miku, vocaloid');
    });
});

describe('キーと補足の形のエラー文言', () => {
    const catalog = {
        messages: { 'error.nai.badRequest': 'NovelAI が要求を受け付けませんでした。' },
    } as unknown as I18NCatalog;

    it('キーを文言にして補足を括弧で添える', () => {
        expect(resolveBackendError(catalog, 'error.nai.badRequest: 400: bad prompt')).toBe('NovelAI が要求を受け付けませんでした。（400: bad prompt）');
        expect(resolveBackendError(catalog, 'error.nai.badRequest')).toBe('NovelAI が要求を受け付けませんでした。');
    });

    it('辞書に無いキーや通常の文字列はそのまま返す', () => {
        expect(resolveBackendError(catalog, 'error.nai.unknown: 500')).toBe('error.nai.unknown: 500');
        expect(resolveBackendError(catalog, 'connection refused')).toBe('connection refused');
        expect(resolveBackendError(null, 'error.nai.badRequest: 400')).toBe('error.nai.badRequest: 400');
        expect(resolveBackendError(catalog, undefined)).toBe('');
    });
});
