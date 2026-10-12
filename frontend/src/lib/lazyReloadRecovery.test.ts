import { beforeEach, describe, expect, it } from 'vitest';
import {
    clearLazyReloadRecovery,
    readLazyReloadRecovery,
    saveLazyReloadRecovery,
} from './lazyReloadRecovery';

describe('lazyReloadRecovery', () => {
    beforeEach(() => {
        sessionStorage.clear();
    });

    it('準備・調整内容と遷移先を再読み込み後に読める', () => {
        const saved = saveLazyReloadRecovery({
            sessionId: 'session-1',
            ssrpSettings: { characters: ['characters/work/Alice.md'] },
            activeView: 'material',
            materialRequest: { tab: 'images', character: 'Alice', section: 'voice' },
            settingsCategory: 'general',
            prepareOpen: true,
        });

        expect(saved).toBe(true);
        expect(readLazyReloadRecovery()).toMatchObject({
            sessionId: 'session-1',
            ssrpSettings: { characters: ['characters/work/Alice.md'] },
            activeView: 'material',
            materialRequest: { tab: 'images', character: 'Alice', section: 'voice' },
            prepareOpen: true,
        });
    });

    it('形式が不正な復旧情報は使用しない', () => {
        sessionStorage.setItem('alslime.lazyReloadRecovery', JSON.stringify({ version: 1, activeView: 'unknown' }));

        expect(readLazyReloadRecovery()).toBeNull();
        expect(sessionStorage.getItem('alslime.lazyReloadRecovery')).toBeNull();
    });

    it('正常復旧後に保存内容を削除できる', () => {
        saveLazyReloadRecovery({
            sessionId: null,
            ssrpSettings: { characters: [] },
            activeView: 'chat',
            materialRequest: null,
            settingsCategory: 'general',
            prepareOpen: false,
        });

        clearLazyReloadRecovery();

        expect(readLazyReloadRecovery()).toBeNull();
    });
});
