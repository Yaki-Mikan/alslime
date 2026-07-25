/**
 * config-gen.ts - 設定ファイル自動作成（AI 生成）API クライアント
 *
 * submit / status / cancel と、じっくり作成（2段階）でユーザーが手直しする
 * 調査メモの取得・保存を提供する。
 */

import axios from '../lib/axios';

export type ConfigGenMethod = 'two_step' | 'one_shot';

export interface ConfigGenSubmitRequest {
    categoryId: string;
    method: ConfigGenMethod;
    step?: number; // two_step のみ 1 | 2
    characterName: string;
    workTitle: string;
    /** 調査メモの所在ディレクトリ（通常はキャラクター名。設定ファイルの配置は常にキャラクター名基準） */
    dirName: string;
    model?: string;
    claudeEffort?: string;
    timeoutMinutes?: number;
    locale?: string;
    /** 設定作成備考（ユーザーの要望・指示。指示ファイルへ結合される） */
    notes?: string;
}

export interface ConfigGenProgressEntry {
    seq: number;
    kind: 'text' | 'tool' | 'done' | 'error';
    text?: string;
    textKey?: string;
    args?: string[];
}

export interface ConfigGenResultFile {
    kind: 'research' | 'setting';
    categoryId: string;
    dirName: string;
    fileName: string;
    relPath: string;
}

export interface ConfigGenStatus {
    jobId: string;
    status: 'pending' | 'processing' | 'completed' | 'error' | 'canceled';
    progress?: ConfigGenProgressEntry[];
    elapsedSeconds: number;
    result?: ConfigGenResultFile;
    error?: string;
}

export const submitConfigGen = async (
    backendUrl: string,
    req: ConfigGenSubmitRequest
): Promise<{ jobId: string }> => {
    const response = await axios.post(`${backendUrl}/api/config-gen/submit`, req);
    return response.data;
};

export const getConfigGenStatus = async (
    backendUrl: string,
    jobId: string,
    since: number
): Promise<ConfigGenStatus> => {
    const response = await axios.get(`${backendUrl}/api/config-gen/status/${encodeURIComponent(jobId)}`, {
        params: since > 0 ? { since } : undefined,
    });
    return response.data;
};

export const cancelConfigGen = async (backendUrl: string, jobId: string): Promise<void> => {
    await axios.post(`${backendUrl}/api/config-gen/cancel/${encodeURIComponent(jobId)}`);
};

export interface ConfigGenActive {
    active: boolean;
    jobId?: string;
    status?: string;
    elapsedSeconds?: number;
}

export const getConfigGenActive = async (backendUrl: string): Promise<ConfigGenActive> => {
    const response = await axios.get(`${backendUrl}/api/config-gen/active`);
    return response.data;
};

export const deleteResearchMemo = async (
    backendUrl: string,
    categoryId: string,
    dirName: string,
    characterName: string
): Promise<void> => {
    await axios.delete(
        `${backendUrl}/api/config-gen/research/${encodeURIComponent(categoryId)}/${encodeURIComponent(dirName)}/${encodeURIComponent(characterName)}`
    );
};

export interface CLIStatusEntry {
    id: string;
    label: string;
    status: string; // 'cliFound' | 'cliNotFound' 等
    authStatus?: string;
}

export const getCLIStatus = async (backendUrl: string): Promise<CLIStatusEntry[]> => {
    const response = await axios.get(`${backendUrl}/api/system/cli-status`);
    return response.data?.clis ?? [];
};

export interface ResearchMemoEntry {
    dirName: string;
    characterName: string;
    fileName: string;
}

export const listResearchMemos = async (
    backendUrl: string,
    categoryId: string
): Promise<ResearchMemoEntry[]> => {
    const response = await axios.get(
        `${backendUrl}/api/config-gen/research-list/${encodeURIComponent(categoryId)}`
    );
    return response.data?.files ?? [];
};

export const getResearchMemo = async (
    backendUrl: string,
    categoryId: string,
    dirName: string,
    characterName: string
): Promise<{ exists: boolean; content?: string; workTitle?: string }> => {
    const response = await axios.get(
        `${backendUrl}/api/config-gen/research/${encodeURIComponent(categoryId)}/${encodeURIComponent(dirName)}/${encodeURIComponent(characterName)}`
    );
    return response.data;
};

export const saveResearchMemo = async (
    backendUrl: string,
    categoryId: string,
    dirName: string,
    characterName: string,
    content: string
): Promise<void> => {
    await axios.post(
        `${backendUrl}/api/config-gen/research/${encodeURIComponent(categoryId)}/${encodeURIComponent(dirName)}/${encodeURIComponent(characterName)}`,
        { content }
    );
};
