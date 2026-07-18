import axios from '../lib/axios';
import { BACKEND_URL } from './base-url';

export interface FileItem {
    name: string;
    isDirectory: boolean;
    path: string;
}

export interface ListFilesResponse {
    files: FileItem[];
    currentPath: string;
}

/**
 * ファイル一覧を取得
 */
export const listFiles = async (path: string = '.'): Promise<ListFilesResponse> => {
    const res = await axios.get(`${BACKEND_URL}/api/files`, {
        params: { path }
    });
    return res.data;
};

/**
 * ファイルを作成または上書き
 */
export const writeFile = async (path: string, content: string): Promise<void> => {
    await axios.post(`${BACKEND_URL}/api/files/write`, {
        path,
        content
    });
};

/**
 * ディレクトリを作成（再帰的）
 */
export const mkdir = async (path: string): Promise<void> => {
    await axios.post(`${BACKEND_URL}/api/files/mkdir`, {
        path
    });
};

// ===== キャラクターフィルタリング関連 =====

export interface CharacterTagInfo {
    name: string;
    dirName: string;
    path: string;
    work: string | null;
    tags: string[];
}

export interface CharacterFilters {
    works: string[];
    tags: string[];
}

export interface RebuildResult extends CharacterFilters {
    stats: {
        totalCharacters: number;
        withTags: number;
        withoutTags: number;
    };
}

/**
 * キャラクター一覧 + タグ情報を取得
 */
export const getCharacterTags = async (): Promise<{ characters: CharacterTagInfo[] }> => {
    const res = await axios.get(`${BACKEND_URL}/api/character-tags`);
    return res.data;
};

/**
 * フィルタマスタ一覧を取得
 */
export const getCharacterFilters = async (): Promise<CharacterFilters> => {
    const res = await axios.get(`${BACKEND_URL}/api/character-filters`);
    return res.data;
};

/**
 * フィルタマスタを再構築
 */
export const rebuildCharacterFilters = async (): Promise<RebuildResult> => {
    const res = await axios.post(`${BACKEND_URL}/api/character-filters/rebuild`);
    return res.data;
};
