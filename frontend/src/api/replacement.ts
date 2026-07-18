/**
 * replacement.ts - 置換設定API呼び出しモジュール
 * 
 * フロントエンドから置換設定の取得・保存を行うAPI呼び出しを提供
 */

import { getIdToken } from '../firebase';

// 置換後文字列のソース種別
export type ReplacementSource = 'manual' | 'user' | 'character';

// 個別の置換設定
export interface ReplacementItem {
    id: string;
    target: string;
    replacementSource: ReplacementSource;
    manualValue: string;
    enabled: boolean;
    description?: string;
}

// 置換設定全体
export interface ReplacementConfig {
    version: string;
    replacements: ReplacementItem[];
    lastModified: string;
}

/**
 * 置換設定を取得
 * @param backendUrl バックエンドURL
 * @returns 置換設定
 */
export async function getReplacementConfig(backendUrl: string): Promise<ReplacementConfig> {
    try {
        const token = await getIdToken();
        const response = await fetch(`${backendUrl}/api/settings/replacement-config`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token || ''}`,
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            throw new Error(`Failed to get replacement config: ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.error('[Replacement API] Failed to get config:', error);
        // デフォルト値を返す
        return {
            version: '2.0',
            replacements: [],
            lastModified: new Date().toISOString()
        };
    }
}

/**
 * 置換設定を保存
 * @param backendUrl バックエンドURL
 * @param config 置換設定
 */
export async function saveReplacementConfig(
    backendUrl: string,
    config: ReplacementConfig
): Promise<void> {
    const token = await getIdToken();
    const response = await fetch(`${backendUrl}/api/settings/replacement-config`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token || ''}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(config),
    });

    if (!response.ok) {
        throw new Error(`Failed to save replacement config: ${response.status}`);
    }
}
