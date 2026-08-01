import axios from '../lib/axios';

// アップデート確認 API（ファイル自動更新、確認 01番 8章）。

export interface AppUpdateInfo {
    enabled: boolean;
    current: string;
    latest: string;
    hasUpdate: boolean;
    skipped: boolean;
    postponedToday: boolean;
    canApply: boolean;
    notesUrl: string;
    notes: string;
    checkFailed: boolean;
}

export interface ModuleUpdateEntry {
    id: string;
    installedVersion: string;
    latestVersion: string;
    hasUpdate: boolean;
    companionPackUpdate: boolean;
    needsAppUpdate: boolean;
    // 本体が新しすぎる等で配布モジュールが対応していない（操作ボタンを無効化する）
    incompatible: boolean;
}

export interface UpdateCheckResponse {
    app: AppUpdateInfo;
    autoCheck: boolean;
    modules: ModuleUpdateEntry[];
}

export interface UpdateSettings {
    autoCheck: boolean;
    skippedVersion: string;
}

// UpdateSettingsPatch は部分更新の送信形。postponeToday: true で「後で」の
// 当日抑止をバックエンドの現在日付で記録する。
export interface UpdateSettingsPatch {
    autoCheck?: boolean;
    skippedVersion?: string;
    postponeToday?: boolean;
}

// fetchUpdateCheck は本体＋モジュールの更新有無を取得する。
export const fetchUpdateCheck = async (backendUrl: string): Promise<UpdateCheckResponse> => {
    const res = await axios.get(`${backendUrl}/api/update/check`);
    return res.data;
};

// fetchUpdateSettings は更新確認設定を取得する。
export const fetchUpdateSettings = async (backendUrl: string): Promise<UpdateSettings> => {
    const res = await axios.get(`${backendUrl}/api/update/settings`);
    return res.data;
};

// UpdateApplyStatus は本体直接アップデートの進捗（GET /api/update/status）。
// current は応答したプロセスの本体バージョン（復帰判定用。交換日記 002）。
export interface UpdateApplyStatus {
    phase: 'idle' | 'downloading' | 'verifying' | 'staging' | 'restarting' | 'error';
    percent: number;
    messageKey?: string;
    current: string;
}

// APPLY_POST_TIMEOUT_MS は更新開始 POST のタイムアウト。バックエンドの開始処理は
// 同期部分（前提検査＋リリース照会）だけなので短くてよいが、応答直後にサーバーが
// 再起動へ進むため受信を取り損ねる可能性があり、無期限 pending を防ぐ目的で持つ。
export const APPLY_POST_TIMEOUT_MS = 30000;

// applyUpdate は本体の直接アップデートを開始する（進捗は fetchUpdateApplyStatus で追う）。
export const applyUpdate = async (backendUrl: string): Promise<UpdateApplyStatus> => {
    const res = await axios.post(`${backendUrl}/api/update/apply`, undefined, {
        timeout: APPLY_POST_TIMEOUT_MS,
    });
    return res.data;
};

// fetchUpdateApplyStatus は直接アップデートの進捗を取得する。
export const fetchUpdateApplyStatus = async (backendUrl: string): Promise<UpdateApplyStatus> => {
    const res = await axios.get(`${backendUrl}/api/update/status`);
    return res.data;
};

// saveUpdateSettings は更新確認設定を部分更新する（skippedVersion: '' でスキップ解除）。
export const saveUpdateSettings = async (
    backendUrl: string,
    patch: UpdateSettingsPatch,
): Promise<UpdateSettings> => {
    const res = await axios.post(`${backendUrl}/api/update/settings`, patch);
    return res.data;
};
