import { describe, expect, it } from 'vitest';
import {
    buildCharacterImageDirectoryMap,
    extractCharacterDirectoryName,
    resolveCharacterImageDirectory,
} from './characterImagePath';

describe('extractCharacterDirectoryName', () => {
    it('版付きの設定ファイル名ではなく親のキャラクターディレクトリ名を返す', () => {
        expect(extractCharacterDirectoryName('roleplay/characters/Alice/settings/Alice_v3.md'))
            .toBe('Alice');
        expect(extractCharacterDirectoryName('ロールプレイ/キャラリスト/中野二乃/設定/中野二乃_v2.md'))
            .toBe('中野二乃');
    });

    it('Windows区切りのパスも解決する', () => {
        expect(extractCharacterDirectoryName('roleplay\\characters\\Alice\\settings\\Alice_v2.md'))
            .toBe('Alice');
    });

    it('設定ディレクトリを含まないパスは null を返す', () => {
        expect(extractCharacterDirectoryName('Alice_v3.md')).toBeNull();
        expect(extractCharacterDirectoryName('settings/Alice.md')).toBeNull();
    });
});

describe('characterImagePath', () => {
    it('設定Markdown名と物理ディレクトリ名を対応付ける', () => {
        const map = buildCharacterImageDirectoryMap([
            'roleplay/characters/ライネス・エルメロイ・アーチゾルテ/settings/ライネス・エルメロイ・アーチゾルテ_v3.md',
        ]);

        expect(resolveCharacterImageDirectory('ライネス・エルメロイ・アーチゾルテ_v3', map))
            .toBe('ライネス・エルメロイ・アーチゾルテ');
        expect(resolveCharacterImageDirectory('ライネス・エルメロイ・アーチゾルテ', map))
            .toBe('ライネス・エルメロイ・アーチゾルテ');
    });

    it('Windows区切りの保存済みパスも解決する', () => {
        const map = buildCharacterImageDirectoryMap([
            'roleplay\\characters\\Alice\\settings\\Alice_v2.md',
        ]);

        expect(resolveCharacterImageDirectory('Alice_v2', map)).toBe('Alice');
    });

    it('日本語名時代に保存されたパスも解決する', () => {
        const map = buildCharacterImageDirectoryMap([
            'ロールプレイ/キャラリスト/中野二乃/設定/中野二乃_v2.md',
        ]);

        expect(resolveCharacterImageDirectory('中野二乃_v2', map)).toBe('中野二乃');
        expect(resolveCharacterImageDirectory('中野二乃', map)).toBe('中野二乃');
    });

    it('新旧のパスが混在していても双方を取り込む', () => {
        const map = buildCharacterImageDirectoryMap([
            'ロールプレイ/キャラリスト/タチバナ/設定/タチバナ.md',
            'roleplay/characters/BB（ドバイ）/settings/BB（ドバイ）.md',
        ]);

        expect(resolveCharacterImageDirectory('タチバナ', map)).toBe('タチバナ');
        expect(resolveCharacterImageDirectory('BB（ドバイ）', map)).toBe('BB（ドバイ）');
    });

    it('対応のないTURN名は従来どおりそのまま使う', () => {
        const map = buildCharacterImageDirectoryMap([]);
        expect(resolveCharacterImageDirectory('Unknown', map)).toBe('Unknown');
    });
});
