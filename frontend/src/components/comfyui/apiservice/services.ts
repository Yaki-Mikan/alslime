/**
 * services.ts - 画像生成 API サービスの定義一覧
 *
 * 「API サービス」タブ直下のプルダウンはこの配列から作る。サービスを増やすときは
 * ここへ 1 件足し、サービス固有の設定部品を対応させる。
 */

import type { ApiServiceId, ImageBackend } from '../../../api/comfyui';

export interface ApiServiceDefinition {
    id: ApiServiceId;
    /** プルダウンの表示名（固有名詞なので翻訳しない） */
    label: string;
}

export const API_SERVICES: readonly ApiServiceDefinition[] = [
    { id: 'novelai', label: 'Novel AI' },
] as const;

export const DEFAULT_API_SERVICE: ApiServiceId = 'novelai';
export const DEFAULT_IMAGE_BACKEND: ImageBackend = 'comfyui';

export const normalizeImageBackend = (value: string | undefined | null): ImageBackend =>
    value === 'api' ? 'api' : 'comfyui';

export const normalizeApiService = (value: string | undefined | null): ApiServiceId =>
    API_SERVICES.some(s => s.id === value) ? (value as ApiServiceId) : DEFAULT_API_SERVICE;
