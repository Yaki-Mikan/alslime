import axios from '../lib/axios';

// CLIPaths は各 AI CLI 実行ファイルの明示指定パス。
// 空文字は「未設定＝既定のインストール先と PATH の探索」を意味する。
export interface CLIPaths {
    gemini: string;
    claude: string;
    antigravity: string;
}

export interface ServerSettings {
    port: number;
    bindAddress: string;
    lanPublic: boolean;
    cliPaths: CLIPaths;
}

export interface ServerSettingsResponse {
    success?: boolean;
    settings: ServerSettings;
    restartRequired: boolean;
}

// fetchServerSettings は次回起動用のサーバー設定を取得する。
export const fetchServerSettings = async (backendUrl: string): Promise<ServerSettingsResponse> => {
    const response = await axios.get(`${backendUrl}/api/settings/server`);
    return response.data;
};

export type CLIKey = keyof CLIPaths;

// CLICheckStatus は疎通確認の結果種別。
export type CLICheckStatus = 'ok' | 'notFound' | 'configuredPathInvalid' | 'failed' | 'timeout';

// CLICheckResult は疎通確認の結果。command は解決した実行ファイルの名前だけを持つ。
export interface CLICheckResult {
    status: CLICheckStatus;
    command?: string;
    version?: string;
}

// checkCLIPath は入力中のパス（空なら既定の探索）で CLI を解決し、--version で起動を試す。
export const checkCLIPath = async (
    backendUrl: string,
    cli: CLIKey,
    path: string
): Promise<CLICheckResult> => {
    const response = await axios.post(`${backendUrl}/api/settings/server/cli-check`, { cli, path });
    return response.data;
};

// updateServerSettings は次回起動用のサーバー設定を保存する。
export const updateServerSettings = async (
    backendUrl: string,
    patch: Partial<ServerSettings>
): Promise<ServerSettingsResponse> => {
    const response = await axios.post(`${backendUrl}/api/settings/server`, patch);
    return response.data;
};
