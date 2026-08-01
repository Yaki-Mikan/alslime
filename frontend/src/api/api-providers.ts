/**
 * api-providers.ts - openai_compat 接続先管理の API クライアント
 *
 * キー値はレスポンスに一切含まれない（hasApiKey の 2 値のみ）。
 * apiKey の更新は 3 値区別: フィールド省略=維持 / 非空=上書き / clearApiKey=削除。
 */

import axios from '../lib/axios';

export interface ApiProviderConnection {
    id: string;
    preset: string;
    label: string;
    baseUrl: string;
    authScheme: 'bearer' | 'api-key-header' | 'x-api-key-header' | 'none';
    enabled: boolean;
    forceNonStreaming?: boolean;
    extraParams?: Record<string, unknown>;
    hasApiKey: boolean;
}

export interface ApiProviderPreset {
    id: string;
    labelKey: string;
    baseUrl: string;
    authScheme: string;
    noticeKeys: string[];
    supportsModelsApi: boolean;
    cacheKeyParam: string;
}

export interface ApiProviderSaveRequest {
    preset: string;
    label: string;
    baseUrl: string;
    authScheme: string;
    enabled: boolean;
    forceNonStreaming?: boolean;
    extraParams?: Record<string, unknown>;
    /** 省略=既存維持 / 非空=上書き（3値区別。clearApiKey との同時指定は 400） */
    apiKey?: string;
    clearApiKey?: boolean;
}

export interface ApiProviderTestModel {
    id: string;
    name?: string;
}

export interface ApiProviderTestResult {
    success: boolean;
    models: ApiProviderTestModel[];
    supportsModelsApi: boolean;
    messageKey?: string;
    failureKind?: 'auth' | 'network' | 'models_unavailable' | 'invalid_response' | 'save_failed';
    /** サニタイズ済みの可変詳細。接続テストの一時表示専用（履歴へ保存しない） */
    details?: string;
}

export interface ApiProviderDeleteResult {
    userModels: string[];
    isDefaultModel: boolean;
    deletesConnectionPrompts: boolean;
}

export interface ApiProviderSystemPrompt {
    content: string;
    label: string;
    locale: string;
    /** 設定ファイルエディタで表示する論理パス。物理絶対パスではない。 */
    file: string;
}

export type ApiProviderInstructionLocale = 'ja' | 'en';

export interface ApiProviderInstructionTarget {
    connectionId: string;
    preset: string;
    locale: ApiProviderInstructionLocale;
}

export const fetchApiProviders = async (backendUrl: string): Promise<ApiProviderConnection[]> => {
    const response = await axios.get(`${backendUrl}/api/api-providers`);
    return response.data.connections ?? [];
};

export const fetchApiProviderPresets = async (backendUrl: string): Promise<ApiProviderPreset[]> => {
    const response = await axios.get(`${backendUrl}/api/api-providers/presets`);
    return response.data.presets ?? [];
};

export const createApiProvider = async (
    backendUrl: string,
    payload: ApiProviderSaveRequest
): Promise<ApiProviderConnection> => {
    const response = await axios.post(`${backendUrl}/api/api-providers`, payload);
    return response.data;
};

export const updateApiProvider = async (
    backendUrl: string,
    id: string,
    payload: ApiProviderSaveRequest
): Promise<ApiProviderConnection> => {
    const response = await axios.put(`${backendUrl}/api/api-providers/${encodeURIComponent(id)}`, payload);
    return response.data;
};

export const dryRunDeleteApiProvider = async (
    backendUrl: string,
    id: string
): Promise<ApiProviderDeleteResult> => {
    const response = await axios.delete(`${backendUrl}/api/api-providers/${encodeURIComponent(id)}`);
    return response.data;
};

export const deleteApiProvider = async (
    backendUrl: string,
    id: string
): Promise<ApiProviderDeleteResult> => {
    const response = await axios.delete(
        `${backendUrl}/api/api-providers/${encodeURIComponent(id)}?dryRun=false`
    );
    return response.data;
};

export const testApiProvider = async (
    backendUrl: string,
    id: string
): Promise<ApiProviderTestResult> => {
    const response = await axios.post(`${backendUrl}/api/api-providers/${encodeURIComponent(id)}/test`);
    return response.data;
};

export const fetchApiProviderSystemPrompt = async (
    backendUrl: string,
    id: string,
    locale: ApiProviderInstructionLocale
): Promise<ApiProviderSystemPrompt> => {
    const response = await axios.get(
        `${backendUrl}/api/api-providers/${encodeURIComponent(id)}/system-prompt?locale=${locale}`
    );
    return response.data;
};

export const saveApiProviderSystemPrompt = async (
    backendUrl: string,
    id: string,
    locale: ApiProviderInstructionLocale,
    content: string
): Promise<void> => {
    await axios.put(
        `${backendUrl}/api/api-providers/${encodeURIComponent(id)}/system-prompt?locale=${locale}`,
        { content }
    );
};
