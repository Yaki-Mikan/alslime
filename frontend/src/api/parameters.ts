/**
 * パラメータ外部入力化機能 - APIクライアント（フロントエンド）
 */
import axios from 'axios';
import type { ParameterSchema, ParameterSchemaListItem } from '../types/Parameter';
import { BACKEND_URL } from './base-url';

/**
 * 項目設定一覧を取得
 */
export async function getParameterSchemas(): Promise<ParameterSchemaListItem[]> {
    try {
        const response = await axios.get(`${BACKEND_URL}/api/parameters/schemas`);
        return response.data.schemas || [];
    } catch (error) {
        console.error('[Parameters API] Failed to fetch schemas:', error);
        return [];
    }
}

/**
 * 項目設定詳細を取得
 */
export async function getParameterSchema(schemaId: string): Promise<ParameterSchema | null> {
    try {
        const response = await axios.get(`${BACKEND_URL}/api/parameters/schema/${schemaId}`);
        return response.data.schema || null;
    } catch (error) {
        console.error(`[Parameters API] Failed to fetch schema: ${schemaId}`, error);
        return null;
    }
}

/**
 * パラメータグループ状態を初期化
 */
export function initializeParameterGroups(schema: ParameterSchema): import('../types/Parameter').ParameterGroupState[] {
    return schema.groups.map(group => ({
        id: group.id,
        enabled: group.defaultEnabled,
        isOpen: group.defaultOpen,
        values: Object.fromEntries(
            group.elements.map(el => [el.id, el.defaultValue])
        )
    }));
}

// =====================
// プリセット機能
// =====================

export interface Preset {
    name: string;
    parameterGroups: import('../types/Parameter').ParameterGroupState[];
}

/**
 * プリセット一覧を取得
 */
export async function getPresets(schemaId: string): Promise<string[]> {
    try {
        const response = await axios.get(`${BACKEND_URL}/api/parameters/presets/${schemaId}`);
        return response.data.presets || [];
    } catch (error) {
        console.error(`[Parameters API] Failed to fetch presets for ${schemaId}:`, error);
        return [];
    }
}

/**
 * プリセット詳細を取得
 */
export async function getPreset(schemaId: string, name: string): Promise<Preset | null> {
    try {
        const response = await axios.get(`${BACKEND_URL}/api/parameters/presets/${schemaId}/${encodeURIComponent(name)}`);
        return response.data.preset || null;
    } catch (error) {
        console.error(`[Parameters API] Failed to fetch preset: ${name}`, error);
        return null;
    }
}

/**
 * プリセットを保存
 */
export async function savePreset(schemaId: string, name: string, parameterGroups: import('../types/Parameter').ParameterGroupState[]): Promise<boolean> {
    try {
        const response = await axios.post(`${BACKEND_URL}/api/parameters/presets/${schemaId}`, {
            name,
            parameterGroups
        });
        return response.data.success === true;
    } catch (error) {
        console.error(`[Parameters API] Failed to save preset: ${name}`, error);
        return false;
    }
}

/**
 * プリセットを削除
 */
export async function deletePreset(schemaId: string, name: string): Promise<boolean> {
    try {
        const response = await axios.delete(`${BACKEND_URL}/api/parameters/presets/${schemaId}/${encodeURIComponent(name)}`);
        return response.data.success === true;
    } catch (error) {
        console.error(`[Parameters API] Failed to delete preset: ${name}`, error);
        return false;
    }
}
