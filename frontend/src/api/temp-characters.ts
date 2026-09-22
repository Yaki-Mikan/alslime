/**
 * temp-characters.ts - セッション内の一時キャラクターに対する操作 API クライアント
 *
 * 本文更新（簡易エディタの保存）・削除（スロットのごみ箱）・キャラ設定登録。
 * いずれも更新後の会話設定（ssrpSettings）を返すので、呼び出し側はそれを画面へ反映する。
 */

import axios from '../lib/axios';

export interface TempCharacterSettingsResponse {
    success: boolean;
    ssrpSettings: Record<string, unknown>;
    /** キャラ設定登録のみ。作成した設定ファイルのパス */
    registeredPath?: string;
}

export const updateTempCharacter = async (
    backendUrl: string,
    sessionId: string,
    virtualPath: string,
    content: string
): Promise<TempCharacterSettingsResponse> => {
    const response = await axios.post(`${backendUrl}/api/temp-characters/update`, { sessionId, virtualPath, content });
    return response.data;
};

export const removeTempCharacter = async (
    backendUrl: string,
    sessionId: string,
    virtualPath: string
): Promise<TempCharacterSettingsResponse> => {
    const response = await axios.post(`${backendUrl}/api/temp-characters/remove`, { sessionId, virtualPath });
    return response.data;
};

export const registerTempCharacter = async (
    backendUrl: string,
    sessionId: string,
    virtualPath: string
): Promise<TempCharacterSettingsResponse> => {
    const response = await axios.post(`${backendUrl}/api/temp-characters/register`, { sessionId, virtualPath });
    return response.data;
};
