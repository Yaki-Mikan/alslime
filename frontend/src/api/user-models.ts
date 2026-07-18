/**
 * user-models.ts - モデル一覧のユーザー編集 API クライアント
 *
 * モデル一覧の正本は「内蔵デフォルト＋ユーザー設定（user-models.json）のマージ」。
 * 本モジュールは編集モーダル用の取得・保存と、疎通確認（ping）を提供する。
 * 一覧本体は従来どおり GET /api/models（useChat / SettingsModal が取得）。
 */

import axios from '../lib/axios';
import type { Model, ModelProvider } from '../hooks/useChat';

export interface UserModel {
    id: string;
    name?: string;
    description?: string;
    /** 経路種別の明示指定。未指定はIDプレフィックスからの自動判定 */
    provider?: ModelProvider;
    /** Gemini系Thinkingエイリアス用（thinkingLevelとペアで指定） */
    geminiBase?: string;
    thinkingLevel?: 'high' | 'medium' | 'low';
}

export interface UserModelsData {
    builtin: Model[];
    added: UserModel[];
    hidden: string[];
}

export interface UserModelsSaveResult {
    success: boolean;
    added: UserModel[];
    hidden: string[];
    /** 保存後のマージ結果（一覧の即時反映用） */
    models: Model[];
}

export interface PingResult {
    success: boolean;
    output?: string;
    error?: string;
    elapsedMs: number;
}

export const fetchUserModels = async (backendUrl: string): Promise<UserModelsData> => {
    const response = await axios.get(`${backendUrl}/api/models/user`);
    return response.data;
};

export const saveUserModels = async (
    backendUrl: string,
    payload: { added: UserModel[]; hidden: string[] }
): Promise<UserModelsSaveResult> => {
    const response = await axios.post(`${backendUrl}/api/models/user`, payload);
    return response.data;
};

export const pingModel = async (backendUrl: string, modelId: string): Promise<PingResult> => {
    const response = await axios.post(`${backendUrl}/api/models/ping`, { model: modelId });
    return response.data;
};
