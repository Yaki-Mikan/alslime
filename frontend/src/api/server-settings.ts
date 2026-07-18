import axios from '../lib/axios';

// CLIPaths は各 AI CLI 実行ファイルの明示指定パス。
// 空文字は「未設定＝PATH 探索」を意味する。
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

// updateServerSettings は次回起動用のサーバー設定を保存する。
export const updateServerSettings = async (
    backendUrl: string,
    patch: Partial<ServerSettings>
): Promise<ServerSettingsResponse> => {
    const response = await axios.post(`${backendUrl}/api/settings/server`, patch);
    return response.data;
};
