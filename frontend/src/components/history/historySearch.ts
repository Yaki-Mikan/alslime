import type { Session } from '../../hooks/useSession';

/** 履歴の検索：会話の題・キャラ名・プリセット名・シチュエーション名のどれかに、探す文字が含まれるか（大文字小文字は区別しない） */
export const matchesHistoryQuery = (session: Session, query: string): boolean => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const texts = [
        session.title,
        session.presetName ?? '',
        ...(session.characters ?? []),
        ...(session.situations ?? []),
    ];
    return texts.some(text => text.toLowerCase().includes(q));
};
