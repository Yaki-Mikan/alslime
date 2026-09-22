/**
 * appearance-prompt.ts - キャラクター容姿プロンプト作成 API クライアント
 *
 * キャラクター設定ファイルの本文を AI に読ませ、容姿を表す Danbooru タグをグループごとの
 * 行として受け取る。投入・状態取得・中止の 3 点。結果は状態取得で返る。
 */

import axios from '../lib/axios';

export interface AppearancePromptSubmitRequest {
    dirName: string;
    fileName: string;
    provider: string;
    model: string;
    claudeEffort?: string;
    antigravityThinking?: string;
    timeoutMinutes?: number;
    locale?: string;
    /** 画面のキャラクタープロンプト欄の現在値（未保存分を含む） */
    currentCharacterPrompt: string;
    /** 画面の身体的特徴欄の現在値（未保存分を含む） */
    currentPhysicalFeatures: string;
}

export interface AppearancePromptGroup {
    key: string;
    tags: string[];
}

export interface AppearancePromptResult {
    dirName: string;
    fileName: string;
    groups: AppearancePromptGroup[];
    /** 各グループを順に連結して重複除去した全タグ */
    all: string[];
}

export interface AppearancePromptStatus {
    jobId: string;
    status: 'pending' | 'processing' | 'completed' | 'error' | 'canceled';
    elapsedSeconds: number;
    result?: AppearancePromptResult;
    error?: string;
}

export const submitAppearancePrompt = async (
    backendUrl: string,
    req: AppearancePromptSubmitRequest
): Promise<{ jobId: string }> => {
    const response = await axios.post(`${backendUrl}/api/appearance-prompt/submit`, req);
    return response.data;
};

export const getAppearancePromptStatus = async (
    backendUrl: string,
    jobId: string
): Promise<AppearancePromptStatus> => {
    const response = await axios.get(`${backendUrl}/api/appearance-prompt/status/${encodeURIComponent(jobId)}`);
    return response.data;
};

export const cancelAppearancePrompt = async (backendUrl: string, jobId: string): Promise<void> => {
    await axios.post(`${backendUrl}/api/appearance-prompt/cancel/${encodeURIComponent(jobId)}`);
};
