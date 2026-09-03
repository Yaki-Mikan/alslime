/**
 * キャラクター表情画像 API の薄い呼び出し（表情画像生成モーダルから使う）。
 *
 * 画像管理パネル（CharacterImagePanel）は従来どおり自前で fetch しているため、
 * ここは新設の呼び出し元だけが使う。エンドポイントは同じ。
 */

import { authFetch } from '../../lib/authFetch';

export interface CharacterImageInfo {
    hasOriginal: boolean;
    hasIcon: boolean;
    originalPath: string | null;
    iconPath: string | null;
    iconUrl: string | null;
    hash: string | null;
}

export interface CropAreaPixels {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface CharacterImageCropData {
    x: number;
    y: number;
    zoom: number;
    croppedAreaPixels: CropAreaPixels;
}

function characterImagesBase(backendUrl: string, dirName: string): string {
    return `${backendUrl}/api/characters/${encodeURIComponent(dirName)}/images`;
}

/** 表情ごとの画像情報（元画像・アイコンの有無）を取得する。 */
export async function fetchCharacterImages(backendUrl: string, dirName: string): Promise<Record<string, CharacterImageInfo>> {
    const res = await authFetch(characterImagesBase(backendUrl, dirName));
    const data = await res.json();
    if (!data?.success) throw new Error(data?.error?.message || 'failed to fetch character images');
    return data.data.images as Record<string, CharacterImageInfo>;
}

/** 元画像を登録する（既にあれば上書き）。 */
export async function uploadCharacterImage(backendUrl: string, dirName: string, emotion: string, file: File): Promise<void> {
    const form = new FormData();
    form.append('emotion', emotion);
    form.append('image', file);
    const res = await authFetch(`${characterImagesBase(backendUrl, dirName)}/upload`, { method: 'POST', body: form });
    const data = await res.json();
    if (!data?.success) throw new Error(data?.error?.message || 'upload failed');
}

/** 元画像からアイコンを切り抜いて保存する。 */
export async function cropCharacterImage(backendUrl: string, dirName: string, emotion: string, cropData: CharacterImageCropData): Promise<void> {
    const res = await authFetch(`${characterImagesBase(backendUrl, dirName)}/crop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emotion, cropData }),
    });
    const data = await res.json();
    if (!data?.success) throw new Error(data?.error?.message || 'crop failed');
}

/** base64（データ URL でない生の base64）を File にする。 */
export function base64ToFile(base64: string, mimeType: string, fileName: string): File {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new File([bytes], fileName, { type: mimeType });
}

/** mimeType から元画像の拡張子を決める（サーバーの受理形式に合わせる）。 */
export function imageExtensionForMime(mimeType: string): 'png' | 'jpg' | 'webp' {
    if (mimeType === 'image/webp') return 'webp';
    if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') return 'jpg';
    return 'png';
}
