import { describe, expect, it } from 'vitest';
import {
    buildCharacterIconUrlMap,
    resolveCharacterIconUrl,
} from './characterIconUrls';

describe('characterIconUrls', () => {
    it('iconUrl を持つ心情だけを取り込む', () => {
        const map = buildCharacterIconUrlMap({
            default: { iconUrl: '/images/characters/%E9%9B%AA/images/icons/default.png?v=abc' },
            happy: { iconUrl: null },
            angry: {},
        });

        expect(map).toEqual({
            default: '/images/characters/%E9%9B%AA/images/icons/default.png?v=abc',
        });
    });

    it('images が無い応答でも空マップを返す', () => {
        expect(buildCharacterIconUrlMap(null)).toEqual({});
        expect(buildCharacterIconUrlMap(undefined)).toEqual({});
    });

    it('取得済みの iconUrl をバックエンドURLに繋いで使う', () => {
        const map = buildCharacterIconUrlMap({
            default: { iconUrl: '/images/characters/Alice/images/icons/default.webp?v=abc' },
        });

        expect(resolveCharacterIconUrl('http://localhost:8080', 'Alice', 'default', map))
            .toBe('http://localhost:8080/images/characters/Alice/images/icons/default.webp?v=abc');
    });

    it('未取得の心情は従来の拡張子固定パスへ退避する', () => {
        expect(resolveCharacterIconUrl('http://localhost:8080', 'Alice', 'happy', {}))
            .toBe('http://localhost:8080/images/characters/Alice/images/icons/happy.png');
        expect(resolveCharacterIconUrl('http://localhost:8080', 'Alice', 'happy', undefined))
            .toBe('http://localhost:8080/images/characters/Alice/images/icons/happy.png');
    });

    it('ディレクトリ名が空なら既定画像を返す', () => {
        expect(resolveCharacterIconUrl('http://localhost:8080', '', 'default', {}))
            .toBe('/assets/default/no-image-female.png');
    });

    it('backendUrl が空でも同一オリジンの相対URLを組み立てる', () => {
        expect(resolveCharacterIconUrl('', 'Alice', 'happy', {}))
            .toBe('/images/characters/Alice/images/icons/happy.png');

        const map = buildCharacterIconUrlMap({
            default: { iconUrl: '/images/characters/Alice/images/icons/default.webp?v=abc' },
        });
        expect(resolveCharacterIconUrl('', 'Alice', 'default', map))
            .toBe('/images/characters/Alice/images/icons/default.webp?v=abc');
    });
});
