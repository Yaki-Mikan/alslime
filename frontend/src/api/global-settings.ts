/**
 * global-settings.ts - グローバル設定APIクライアント
 *
 * デフォルト設定.jsonへのアクセスを提供する。
 * - ロック機能の設定
 * - カレンダー最終更新日時
 * など
 */

import axios from '../lib/axios';

// グローバル設定の型定義
export interface GlobalSettings {
    dateTimeEnabledLocked?: boolean;   // 日付時刻をプロンプトに含める設定のロック
    calendarLastUpdate?: string;       // カレンダー最終更新日時（ISO 8601形式）
    isMenuPinned?: boolean;            // メニューのピン留め状態（固定表示かどうか）
    defaultSSRPPresetName?: string;    // デフォルトSSRPプリセット名
    antigravityDirectConnection?: boolean; // Antigravity直接接続モード（HTTP直接 vs agy.exe）
    antigravityStreamOutput?: boolean;     // Antigravityストリーム出力（stream vs non-stream）
    defaultModels?: Record<string, string>; // プロバイダ別デフォルトモデル（gemini/claude/antigravity → モデルID）
    defaultProvider?: string;          // チャット欄の初期プロバイダ（空 = antigravity）
    [key: string]: any;                // その他の設定
}

// 起動時に Chat / useChat / RolePlaySettings / AIModelSettingsModal がそれぞれ独立に
// 取得して重複リクエストになるため、TTL 付きでキャッシュする。同時要求は in-flight の
// Promise を共有して 1 リクエストにまとめ、updateGlobalSettings 成功時は無効化して
// 次回取得で最新を読み直す。
let settingsCache: { promise: Promise<GlobalSettings>; fetchedAt: number; backendUrl: string } | null = null;
const SETTINGS_CACHE_TTL_MS = 30_000;

/**
 * グローバル設定を取得
 */
export async function getGlobalSettings(backendUrl: string): Promise<GlobalSettings> {
    const now = Date.now();
    if (!settingsCache || settingsCache.backendUrl !== backendUrl || now - settingsCache.fetchedAt >= SETTINGS_CACHE_TTL_MS) {
        const promise = axios.get(`${backendUrl}/api/settings/global`).then(res => res.data as GlobalSettings);
        const entry = { promise, fetchedAt: now, backendUrl };
        settingsCache = entry;
        // 失敗はキャッシュに残さない（次回呼び出しで再試行する）
        promise.catch(() => {
            if (settingsCache === entry) settingsCache = null;
        });
    }
    try {
        return await settingsCache.promise;
    } catch (error) {
        console.error('[GlobalSettings] Error fetching settings:', error);
        return {};
    }
}

/**
 * グローバル設定を更新（パーシャルアップデート）
 */
export async function updateGlobalSettings(
    backendUrl: string,
    updates: Partial<GlobalSettings>
): Promise<boolean> {
    try {
        await axios.post(`${backendUrl}/api/settings/global`, updates);
        settingsCache = null; // 書き込み後は次回取得で最新を読み直す
        console.log('[GlobalSettings] Settings updated:', Object.keys(updates));
        return true;
    } catch (error) {
        console.error('[GlobalSettings] Error updating settings:', error);
        return false;
    }
}
