import axios from '../lib/axios';
import type { EntitlementStatus } from './system';

// SponsorStatus は支援者機能の現在状態（GET /api/sponsor/status）。
export interface SponsorStatus {
    entitlement: EntitlementStatus;
    loginPending: boolean;
    lastLoginError?: string;
    // loginedAsFree は直近ログインが GitHub 認証成功・有効な支援なし（Free 扱い）
    // だったとき true。失敗ではなくログイン成功の一種。
    loginedAsFree?: boolean;
    // notice はサーバーから受領した開発者お知らせ文言（未受領は空・省略）。
    // ログイン完了時・状態更新時に取り直され、それまで保持される。
    notice?: string;
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
// CleanPreview はクリーン再導入の削除対象（確認モーダル表示用）。
export interface CleanPreview {
    id: string;
    exeInstalled: boolean;
    receiptFound: boolean;
    workflowTemplates: string[];
}

// クリーン再導入の削除対象一覧を取得する（削除は行わない）。
export const fetchCleanPreview = async (backendUrl: string, moduleId: string): Promise<CleanPreview> => {
    const response = await axios.get(`${backendUrl}/api/sponsor/module/clean-preview`, {
        params: { module: moduleId },
    });
    return response.data;
};

// 配布物一式（テンプレート → exe → レシート）を削除して最新版を入れ直す。
export const cleanModule = async (
    backendUrl: string,
    moduleId: string,
    reinstall = true
): Promise<{
    success: boolean;
    version: string;
    restartRequired: boolean;
    modules: ModuleStatusEntry[];
}> => {
    const response = await axios.post(`${backendUrl}/api/sponsor/module/clean`, {
        module: moduleId,
        reinstall,
    });
    return response.data;
};

export const installModule = async (
    backendUrl: string,
    moduleId: string
): Promise<{
    success: boolean;
    version: string;
    restartRequired: boolean;
    companionPackConfigured: boolean;
    companionPackInstalled: boolean;
    companionPackWorkflowTemplates: string[];
    modules: ModuleStatusEntry[];
}> => {
    const response = await axios.post(`${backendUrl}/api/sponsor/module/install`, { module: moduleId });
    return response.data;
};
