/**
 * emotion-catalog.ts - 表情種別管理API呼び出しモジュール
 *
 * 表情種別（心情）カタログの取得・保存と、定義に無い表情画像の一括削除を提供
 */

import { getIdToken } from '../firebase';

// 表情種別 1 件
export interface EmotionCatalogEntry {
    // 表情の識別子。AI が出力する値で、画像ファイル名にもなる
    name: string;
    // UI 表示用の名称。AI へは渡さない
    label: string;
    // AI への説明。どんな時にする表情かを伝える
    description: string;
    // false の表情は AI へ候補として渡さない
    enabled: boolean;
}

// 表情種別カタログ全体
export interface EmotionCatalog {
    version: string;
    emotions: EmotionCatalogEntry[];
    lastModified: string;
}

// 一括削除の結果
export interface PruneOrphanImagesResult {
    scannedCharacters: number;
    affectedCharacters: number;
    deletedFiles: number;
    deletedEntries: number;
}

/**
 * API がエラー本文で返す i18n キーを保持するエラー。
 * 呼び出し側は messageKey を UI 辞書で解決して利用者へ表示できる。
 */
export class EmotionCatalogApiError extends Error {
    messageKey?: string;

    constructor(message: string, messageKey?: string) {
        super(message);
        this.name = 'EmotionCatalogApiError';
        this.messageKey = messageKey;
    }
}

async function authHeaders(): Promise<Record<string, string>> {
    const token = await getIdToken();
    return {
        'Authorization': `Bearer ${token || ''}`,
        'Content-Type': 'application/json',
    };
}

async function throwApiError(response: Response, fallback: string): Promise<never> {
    let messageKey: string | undefined;
    try {
        const body = await response.json();
        messageKey = body?.messageKey || undefined;
    } catch {
        // 本文が JSON でない場合はステータスのみで報告する
    }
    throw new EmotionCatalogApiError(`${fallback}: ${response.status}`, messageKey);
}

/**
 * 表情種別カタログを取得
 * @param backendUrl バックエンドURL
 */
export async function getEmotionCatalog(backendUrl: string): Promise<EmotionCatalog> {
    const response = await fetch(`${backendUrl}/api/characters/emotion-catalog`, {
        method: 'GET',
        headers: await authHeaders(),
    });
    if (!response.ok) {
        await throwApiError(response, 'Failed to get emotion catalog');
    }
    const body = await response.json();
    return body.data as EmotionCatalog;
}

/**
 * 表情種別カタログを保存（AI 送信用ファイルも再生成される）
 * @param backendUrl バックエンドURL
 * @param catalog 保存するカタログ
 */
export async function saveEmotionCatalog(
    backendUrl: string,
    catalog: EmotionCatalog
): Promise<EmotionCatalog> {
    const response = await fetch(`${backendUrl}/api/characters/emotion-catalog`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify(catalog),
    });
    if (!response.ok) {
        await throwApiError(response, 'Failed to save emotion catalog');
    }
    const body = await response.json();
    return body.data as EmotionCatalog;
}

/**
 * 定義に無い表情の画像を全キャラクターから削除
 * @param backendUrl バックエンドURL
 */
export async function pruneOrphanEmotionImages(
    backendUrl: string
): Promise<PruneOrphanImagesResult> {
    const response = await fetch(`${backendUrl}/api/characters/emotion-images/prune`, {
        method: 'POST',
        headers: await authHeaders(),
    });
    if (!response.ok) {
        await throwApiError(response, 'Failed to prune orphan emotion images');
    }
    const body = await response.json();
    return body.data as PruneOrphanImagesResult;
}
