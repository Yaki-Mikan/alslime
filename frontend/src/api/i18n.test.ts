import { describe, expect, it } from 'vitest';
import { resolveBackendError, type I18NCatalog } from './i18n';

const catalog: I18NCatalog = {
    lang: 'ja',
    defaultLang: 'ja',
    fallbackLang: 'ja',
    messages: {
        'error.nai.textSpecTooLong': '上限 {{limit}} 文字、合計 {{total}} 文字、対象：{{fields}}',
        'error.nai.busy': '混雑しています',
        'label.nai.inputField.basePrompt': 'ベースプロンプト',
        'label.nai.inputField.extraPrompt': '追加プロンプト',
    },
};

describe('resolveBackendError', () => {
    it('差し込み口のある文言へ、名前=値 の形の補足を差し込み、入力欄の識別子を欄の名前へ直す', () => {
        const got = resolveBackendError(catalog, 'error.nai.textSpecTooLong: fields=basePrompt,extraPrompt; limit=374; total=402');
        expect(got).toBe('上限 374 文字、合計 402 文字、対象：ベースプロンプト / 追加プロンプト');
    });

    it('差し込み口の無い文言は、今までどおり補足を括弧で添える', () => {
        expect(resolveBackendError(catalog, 'error.nai.busy: status 429')).toBe('混雑しています（status 429）');
        expect(resolveBackendError(catalog, 'error.nai.busy')).toBe('混雑しています');
    });

    it('補足が 名前=値 の形でなければ差し込まず、括弧で添える', () => {
        expect(resolveBackendError(catalog, 'error.nai.textSpecTooLong: something else')).toBe('上限 {{limit}} 文字、合計 {{total}} 文字、対象：{{fields}}（something else）');
    });

    it('辞書キーで始まらない文字列や未翻訳のキーはそのまま返す', () => {
        expect(resolveBackendError(catalog, 'plain failure')).toBe('plain failure');
        expect(resolveBackendError(catalog, 'error.unknown: x=1')).toBe('error.unknown: x=1');
        expect(resolveBackendError(null, 'error.nai.busy')).toBe('error.nai.busy');
    });
});
