/**
 * セッションからの一時キャラクター取り込み：話者一覧の作成。
 *
 * AI の応答を TURN 区切りで読んで話者名を集め、表記ゆれを正規化で束ねる。
 * 登録済みキャラクター（名前・ディレクトリ名・置き換え前の元の名前）と正規化後の完全一致で照合し、
 * 会話設定内の一時キャラクター（登録先パスの有無）も見て、チェックできるかどうかを決める。
 */

import { parseMultiCharacterResponse } from './multiCharacterParser';
import { normalizeCharacterName } from './characterName';

/** 集計に必要な最小限のメッセージ形（useChat の Message と互換） */
export interface SpeakerSourceMessage {
    role: 'user' | 'agent';
    content: string;
    errorType?: string;
}

/** 登録済みキャラクターの照合に必要な最小限の形（CharacterTagInfo と互換） */
export interface RegisteredCharacterLike {
    name: string;
    dirName: string;
    originalName?: string;
}

/** 会話設定内の一時キャラクターの照合に必要な最小限の形（TempCharacter と互換） */
export interface TempCharacterLike {
    name: string;
    registeredPath?: string;
}

export type SpeakerStatus =
    /** 未登録。チェックして分析できる */
    | 'unregistered'
    /** 登録済みキャラクター。チェック不可 */
    | 'registered'
    /** このセッションで一時登録済み。チェック不可、再分析は可 */
    | 'temp'
    /** このセッションで一時登録し、キャラ設定登録まで済んだもの。チェック不可 */
    | 'tempRegistered';

export interface SpeakerEntry {
    /** 初出の表記 */
    displayName: string;
    normalized: string;
    /** 登場 TURN 数 */
    count: number;
    status: SpeakerStatus;
    /** status が temp / tempRegistered のとき、会話設定内の仮想パス */
    virtualPath?: string;
}

export function collectSpeakers(
    messages: SpeakerSourceMessage[],
    registered: RegisteredCharacterLike[],
    tempCharacters: Record<string, TempCharacterLike> | undefined,
    userName: string
): SpeakerEntry[] {
    const byNormalized = new Map<string, { displayName: string; count: number }>();
    for (const message of messages) {
        if (message.role !== 'agent' || message.errorType) continue;
        for (const turn of parseMultiCharacterResponse(message.content)) {
            if (!turn.character) continue;
            const displayName = turn.character.trim();
            const normalized = normalizeCharacterName(displayName);
            if (!normalized) continue;
            const entry = byNormalized.get(normalized);
            if (entry) {
                entry.count += 1;
            } else {
                byNormalized.set(normalized, { displayName, count: 1 });
            }
        }
    }

    const userNormalized = normalizeCharacterName(userName || '');
    const registeredNames = new Set<string>();
    for (const c of registered) {
        for (const candidate of [c.name, c.dirName, c.originalName]) {
            if (!candidate) continue;
            const n = normalizeCharacterName(candidate);
            if (n) registeredNames.add(n);
        }
    }
    const tempByNormalized = new Map<string, { virtualPath: string; registeredPath?: string }>();
    for (const [virtualPath, tc] of Object.entries(tempCharacters || {})) {
        const n = normalizeCharacterName(tc.name || '');
        if (n) tempByNormalized.set(n, { virtualPath, registeredPath: tc.registeredPath });
    }

    const out: SpeakerEntry[] = [];
    for (const [normalized, entry] of byNormalized) {
        if (userNormalized && normalized === userNormalized) continue;
        const temp = tempByNormalized.get(normalized);
        let status: SpeakerStatus = 'unregistered';
        if (temp) {
            status = temp.registeredPath ? 'tempRegistered' : 'temp';
        } else if (registeredNames.has(normalized)) {
            status = 'registered';
        }
        out.push({
            displayName: entry.displayName,
            normalized,
            count: entry.count,
            status,
            virtualPath: temp?.virtualPath,
        });
    }
    out.sort((a, b) => b.count - a.count || a.displayName.localeCompare(b.displayName, 'ja'));
    return out;
}
