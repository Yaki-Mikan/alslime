/**
 * recentCharacters.ts - 素材づくりで最近さわったキャラ（直近10人のディレクトリ名）をブラウザに覚えておく
 */
const RECENT_STORAGE_KEY = 'alslime.material.recent';
const RECENT_LIMIT = 10;

export const readRecentCharacters = (): string[] => {
    try {
        const raw = localStorage.getItem(RECENT_STORAGE_KEY);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list.filter((v): v is string => typeof v === 'string') : [];
    } catch {
        return [];
    }
};

/** 最近さわったキャラの先頭へ足し、足したあとの一覧を返す */
export const rememberRecentCharacter = (dirName: string): string[] => {
    const next = [dirName, ...readRecentCharacters().filter(d => d !== dirName)].slice(0, RECENT_LIMIT);
    try { localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next)); } catch { /* 覚えられなくても一覧は使える */ }
    return next;
};
