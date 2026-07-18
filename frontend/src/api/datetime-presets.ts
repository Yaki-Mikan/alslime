/**
 * datetime-presets.ts - 日付時刻プリセットAPI呼び出し関数
 * 
 * バックエンドの日付時刻プリセットAPIを呼び出すための関数群
 */

import type { DateTimeValue, DateTimeSettingsState } from '../types/datetime';
import { authFetch } from '../lib/authFetch';

const readPresetData = <T>(payload: any): T | null => {
    if (payload && Object.prototype.hasOwnProperty.call(payload, 'data')) {
        return payload.data as T;
    }
    if (payload && Object.prototype.hasOwnProperty.call(payload, 'preset')) {
        return payload.preset as T;
    }
    if (payload && Object.prototype.hasOwnProperty.call(payload, 'value')) {
        return payload.value as T;
    }
    return null;
};

// 時刻設定グループプリセットの型定義
export interface DateTimeGroupPreset {
    enabled: boolean;
    mode: 'current' | 'fixed';
    fixedDateTime: DateTimeValue;
    useTodayDate: boolean;
    increment: DateTimeSettingsState['increment'];  // nextIncrementも含む（B7）
    /** つきあいの長さ連動ON/OFF（B7: グループプリセットでも保存・復元） */
    linkRelationshipToElapsed?: boolean;
}

// ===== 日付時刻プリセット（値のみ） =====

/**
 * 日付時刻プリセット一覧を取得
 */
export async function listDateTimePresets(backendUrl: string): Promise<string[]> {
    try {
        const res = await authFetch(`${backendUrl}/api/datetime-presets`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return data.presets || [];
    } catch (error) {
        console.error('[DateTimePresets] Failed to list presets:', error);
        return [];
    }
}

/**
 * 日付時刻プリセットを取得
 */
export async function getDateTimePreset(backendUrl: string, name: string): Promise<DateTimeValue | null> {
    try {
        const res = await authFetch(`${backendUrl}/api/datetime-presets/${encodeURIComponent(name)}`);
        if (!res.ok) return null;
        const data = await res.json();
        return readPresetData<DateTimeValue>(data);
    } catch (error) {
        console.error(`[DateTimePresets] Failed to load preset "${name}":`, error);
        return null;
    }
}

/**
 * 日付時刻プリセットを保存
 */
export async function saveDateTimePreset(backendUrl: string, name: string, value: DateTimeValue): Promise<boolean> {
    try {
        const res = await authFetch(`${backendUrl}/api/datetime-presets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, data: value })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return true;
    } catch (error) {
        console.error(`[DateTimePresets] Failed to save preset "${name}":`, error);
        return false;
    }
}

/**
 * 日付時刻プリセットを削除
 */
export async function deleteDateTimePreset(backendUrl: string, name: string): Promise<boolean> {
    try {
        const res = await authFetch(`${backendUrl}/api/datetime-presets/${encodeURIComponent(name)}`, {
            method: 'DELETE'
        });
        if (!res.ok) return false;
        return true;
    } catch (error) {
        console.error(`[DateTimePresets] Failed to delete preset "${name}":`, error);
        return false;
    }
}

// ===== 時刻設定グループプリセット =====

/**
 * 時刻設定グループプリセット一覧を取得
 */
export async function listDateTimeGroupPresets(backendUrl: string): Promise<string[]> {
    try {
        const res = await authFetch(`${backendUrl}/api/datetime-group-presets`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return data.presets || [];
    } catch (error) {
        console.error('[DateTimePresets] Failed to list group presets:', error);
        return [];
    }
}

/**
 * 時刻設定グループプリセットを取得
 */
export async function getDateTimeGroupPreset(backendUrl: string, name: string): Promise<DateTimeGroupPreset | null> {
    try {
        const res = await authFetch(`${backendUrl}/api/datetime-group-presets/${encodeURIComponent(name)}`);
        if (!res.ok) return null;
        const data = await res.json();
        return readPresetData<DateTimeGroupPreset>(data);
    } catch (error) {
        console.error(`[DateTimePresets] Failed to load group preset "${name}":`, error);
        return null;
    }
}

/**
 * 時刻設定グループプリセットを保存
 */
export async function saveDateTimeGroupPreset(backendUrl: string, name: string, preset: DateTimeGroupPreset): Promise<boolean> {
    try {
        const res = await authFetch(`${backendUrl}/api/datetime-group-presets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, data: preset })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return true;
    } catch (error) {
        console.error(`[DateTimePresets] Failed to save group preset "${name}":`, error);
        return false;
    }
}

/**
 * 時刻設定グループプリセットを削除
 */
export async function deleteDateTimeGroupPreset(backendUrl: string, name: string): Promise<boolean> {
    try {
        const res = await authFetch(`${backendUrl}/api/datetime-group-presets/${encodeURIComponent(name)}`, {
            method: 'DELETE'
        });
        if (!res.ok) return false;
        return true;
    } catch (error) {
        console.error(`[DateTimePresets] Failed to delete group preset "${name}":`, error);
        return false;
    }
}

// ===== SSRP全体プリセット（会話設定全体） =====

import type { DateTimeSettingsState as DTSettings } from '../types/datetime';

// SSRP全体プリセットの型定義
export interface SSRPAllPreset {
    characters: string[];
    situations: string[];
    users: string[];
    worlds: string[];
    stages: string[];
    writingStyles: string[];
    characterDetails: Record<string, unknown>;
    directiveMode: 'A' | 'B' | 'C';
    parameterSchemaId: string;
    dateTimeSettings?: DTSettings;
    userName?: string; // 相関関係のtargetId='user'で使用するユーザー名
    // グローバル追加設定
    additionalWorldEnabled?: boolean;
    additionalWorldText?: string;
    additionalStageEnabled?: boolean;
    additionalStageText?: string;
    additionalWritingStyleEnabled?: boolean;
    additionalWritingStyleText?: string;
    imageGenerationNotes?: string;
    additionalSituationEnabled?: boolean;
    additionalSituationText?: string;
    additionalUserEnabled?: boolean;
    additionalUserText?: string;
    // 全体の追加設定
    additionalOverallEnabled?: boolean;
    additionalOverallText?: string;
}

/**
 * SSRP全体プリセット一覧を取得
 */
export async function listSSRPAllPresets(backendUrl: string): Promise<string[]> {
    try {
        const res = await authFetch(`${backendUrl}/api/ssrp-all-presets`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return data.presets || [];
    } catch (error) {
        console.error('[SSRPAllPresets] Failed to list presets:', error);
        return [];
    }
}

/**
 * SSRP全体プリセットを取得
 */
export async function getSSRPAllPreset(backendUrl: string, name: string): Promise<SSRPAllPreset | null> {
    try {
        const res = await authFetch(`${backendUrl}/api/ssrp-all-presets/${encodeURIComponent(name)}`);
        if (!res.ok) return null;
        const data = await res.json();
        return readPresetData<SSRPAllPreset>(data);
    } catch (error) {
        console.error(`[SSRPAllPresets] Failed to load preset "${name}":`, error);
        return null;
    }
}

/**
 * SSRP全体プリセットを保存
 */
export async function saveSSRPAllPreset(backendUrl: string, name: string, preset: SSRPAllPreset): Promise<boolean> {
    try {
        const res = await authFetch(`${backendUrl}/api/ssrp-all-presets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, data: preset })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return true;
    } catch (error) {
        console.error(`[SSRPAllPresets] Failed to save preset "${name}":`, error);
        return false;
    }
}

/**
 * SSRP全体プリセットを削除
 */
export async function deleteSSRPAllPreset(backendUrl: string, name: string): Promise<boolean> {
    try {
        const res = await authFetch(`${backendUrl}/api/ssrp-all-presets/${encodeURIComponent(name)}`, {
            method: 'DELETE'
        });
        if (!res.ok) return false;
        return true;
    } catch (error) {
        console.error(`[SSRPAllPresets] Failed to delete preset "${name}":`, error);
        return false;
    }
}

// ===== SSRPパラメータプリセット（キャラクター詳細設定） =====

// SSRPパラメータプリセットの型定義
export interface SSRPParamPreset {
    // ユーザー名（相関関係のtargetId='user'で使用）
    userName?: string;
    // ユーザーとの相関関係
    userCorrelation?: {
        relationship: string;
        details: string;
        favorability: number;
    };
    // 個別背景
    individualBackground?: string;
    individualBackgrounds?: string[];
    // 個別服装
    individualOutfits?: string[];
    // 個別性格
    individualPersonalities?: string[];
    // パラメータグループ（動的スキーマベース）
    parameterGroups?: unknown[];
    // 追加服装設定
    additionalOutfitEnabled?: boolean;
    additionalOutfitText?: string;
    // 追加背景設定
    additionalBackgroundEnabled?: boolean;
    additionalBackgroundText?: string;
    // 追加性格設定
    additionalPersonalityEnabled?: boolean;
    additionalPersonalityText?: string;
}

/**
 * SSRPパラメータプリセット一覧を取得
 */
export async function listSSRPParamPresets(backendUrl: string): Promise<string[]> {
    try {
        const res = await authFetch(`${backendUrl}/api/ssrp-param-presets`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return data.presets || [];
    } catch (error) {
        console.error('[SSRPParamPresets] Failed to list presets:', error);
        return [];
    }
}

/**
 * SSRPパラメータプリセットを取得
 */
export async function getSSRPParamPreset(backendUrl: string, name: string): Promise<SSRPParamPreset | null> {
    try {
        const res = await authFetch(`${backendUrl}/api/ssrp-param-presets/${encodeURIComponent(name)}`);
        if (!res.ok) return null;
        const data = await res.json();
        return readPresetData<SSRPParamPreset>(data);
    } catch (error) {
        console.error(`[SSRPParamPresets] Failed to load preset "${name}":`, error);
        return null;
    }
}

/**
 * SSRPパラメータプリセットを保存
 */
export async function saveSSRPParamPreset(backendUrl: string, name: string, preset: SSRPParamPreset): Promise<boolean> {
    try {
        const res = await authFetch(`${backendUrl}/api/ssrp-param-presets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, data: preset })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return true;
    } catch (error) {
        console.error(`[SSRPParamPresets] Failed to save preset "${name}":`, error);
        return false;
    }
}

/**
 * SSRPパラメータプリセットを削除
 */
export async function deleteSSRPParamPreset(backendUrl: string, name: string): Promise<boolean> {
    try {
        const res = await authFetch(`${backendUrl}/api/ssrp-param-presets/${encodeURIComponent(name)}`, {
            method: 'DELETE'
        });
        if (!res.ok) return false;
        return true;
    } catch (error) {
        console.error(`[SSRPParamPresets] Failed to delete preset "${name}":`, error);
        return false;
    }
}
