import axios from '../lib/axios';

export type CheckStatus = 'ok' | 'warning' | 'error' | 'disabled' | 'unknown';

export interface CheckResult {
    id: string;
    status: CheckStatus;
    messageKey?: string;
    details?: Record<string, unknown>;
}

// EntitlementState は支援トークンの検証状態（backend coreapi.TokenState と対応）。
export type EntitlementState = 'none' | 'valid' | 'grace' | 'expired' | 'invalid';

// EntitlementStatus は支援状態のスナップショット。tier 等は valid / grace のときのみ。
// 表示専用で、最終判定は backend gate（features）が担う。
export interface EntitlementStatus {
    state: EntitlementState;
    tier?: string;
    channel?: string;
    expiresAt?: number;
    graceUntil?: number;
}

export interface HealthResponse {
    status: CheckStatus;
    version: string;
    buildMode: string;
    os: string;
    arch: string;
    workspaceRoot: string;
    host: string;
    port: number;
    features: Record<string, boolean>;
    entitlement: EntitlementStatus;
    checks: CheckResult[];
}

export interface FileCheckResult {
    locationId: string;
    path: string;
    status: CheckStatus;
    messageKey?: string;
}

export interface ConfigCheckResult {
    status: CheckStatus;
    files: FileCheckResult[];
}

// AuthStatus は CLI の認証状態。ok/missing/unknown の 3 値。
// missing は未認証（loginRequired 案内対象）、unknown は判定不能
// （Windows の Antigravity=OS 資格ストア等）。
export type AuthStatus = 'ok' | 'missing' | 'unknown';

export interface CLIStatusItem {
    id: string;
    label: string;
    status: CheckStatus;
    messageKey: string;
    command: string;
    authStatus: AuthStatus;
    authMessageKey?: string;
    details?: Record<string, unknown>;
}

export interface CLIStatusResponse {
    status: CheckStatus;
    clis: CLIStatusItem[];
}

export interface CacheStatus {
    status: CheckStatus;
    messageKey: string;
    path: string;
    exists: boolean;
    fileCount: number;
    dirCount: number;
    sizeBytes: number;
}

export interface BackupInfo {
    name: string;
    path: string;
    sizeBytes: number;
    createdAt: string;
}

export interface BackupListResult {
    status: CheckStatus;
    messageKey: string;
    backups: BackupInfo[];
}

export interface DiagnosticsResponse {
    status: CheckStatus;
    health: HealthResponse;
    configCheck: ConfigCheckResult;
    cliStatus: CLIStatusResponse;
    cache: CacheStatus;
    backups: BackupListResult;
}

export const fetchSystemDiagnostics = async (backendUrl: string): Promise<DiagnosticsResponse> => {
    const response = await axios.get(`${backendUrl}/api/system/diagnostics`);
    return response.data;
};

export const fetchSystemHealth = async (backendUrl: string): Promise<HealthResponse> => {
    const response = await axios.get(`${backendUrl}/api/system/health`);
    return response.data;
};

export const scanSystemConfig = async (backendUrl: string): Promise<ConfigCheckResult> => {
    const response = await axios.post(`${backendUrl}/api/system/config-check`);
    return response.data;
};
