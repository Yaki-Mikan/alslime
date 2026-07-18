import axios from '../lib/axios';
import type { EntitlementStatus } from './system';

// SponsorStatus は支援者機能の現在状態（GET /api/sponsor/status）。
export interface SponsorStatus {
    entitlement: EntitlementStatus;
    loginPending: boolean;
    lastLoginError?: string;
}

export const fetchSponsorStatus = async (backendUrl: string): Promise<SponsorStatus> => {
    const response = await axios.get(`${backendUrl}/api/sponsor/status`);
    return response.data;
};

// ログイン開始。バックエンドが localhost コールバック待ち受けを起動し、
// ブラウザで開くべき認可 URL を返す。
export const startSponsorLogin = async (backendUrl: string): Promise<{ authUrl: string }> => {
    const response = await axios.post(`${backendUrl}/api/sponsor/login`);
    return response.data;
};

export const sponsorLogout = async (backendUrl: string): Promise<SponsorStatus> => {
    const response = await axios.post(`${backendUrl}/api/sponsor/logout`);
    return response.data;
};

export const refreshSponsorToken = async (backendUrl: string): Promise<SponsorStatus> => {
    const response = await axios.post(`${backendUrl}/api/sponsor/refresh`);
    return response.data;
};

// モジュールID（backend internal/module のレジストリと合わせる）。
export const MODULE_COMFY = 'comfy';
export const MODULE_ACTION_CHOICE = 'actionchoice';

// ModuleStatusEntry は 1 サイドカーモジュールの配置状態（GET /api/sponsor/modules の要素）。
export interface ModuleStatusEntry {
    id: string;
    installed: boolean;
    // 現在のプロセスで当該サイドカーが起動しているか（配置後は再起動で有効化）。
    active: boolean;
}

export const fetchModulesStatus = async (backendUrl: string): Promise<ModuleStatusEntry[]> => {
    const response = await axios.get(`${backendUrl}/api/sponsor/modules`);
    return response.data.modules ?? [];
};

// 指定モジュールを entitlement サーバーから取得・検証して配置する。
export const installModule = async (
    backendUrl: string,
    moduleId: string
): Promise<{ success: boolean; version: string; restartRequired: boolean; modules: ModuleStatusEntry[] }> => {
    const response = await axios.post(`${backendUrl}/api/sponsor/module/install`, { module: moduleId });
    return response.data;
};
