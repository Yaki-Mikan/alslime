/**
 * キャラクター付随設定の API（設定紐づけ・タグ設定）。
 *
 * 表情画像は既存の fetch 直書き（CharacterImagePanel）、画像生成・音声は
 * api/comfyui.ts・api/tts.ts が担うため、ここには新設分だけを置く。
 */

import axios from '../lib/axios';
import type { CharacterFilters, RebuildResult } from './files';

export type LinkedMode = 'append' | 'replace';

export interface LinkedAdditional {
    mode: LinkedMode;
    text: string;
}

export interface LinkedGroup {
    /** WORKSPACE_ROOT 相対・"/" 区切り（会話設定の選択値と同じ形） */
    files: string[];
    additional: LinkedAdditional;
}

export interface LinkedSettings {
    version: number;
    personalities: LinkedGroup;
    outfits: LinkedGroup;
    backgrounds: LinkedGroup;
}

export const LINKED_SETTINGS_VERSION = 1;

export function createEmptyLinkedSettings(): LinkedSettings {
    const empty = (): LinkedGroup => ({ files: [], additional: { mode: 'append', text: '' } });
    return { version: LINKED_SETTINGS_VERSION, personalities: empty(), outfits: empty(), backgrounds: empty() };
}

export async function getLinkedSettings(backendUrl: string, dirName: string): Promise<LinkedSettings> {
    const res = await axios.get(`${backendUrl}/api/characters/${encodeURIComponent(dirName)}/linked-settings`);
    return res.data.data as LinkedSettings;
}

export async function saveLinkedSettings(backendUrl: string, dirName: string, body: LinkedSettings): Promise<LinkedSettings> {
    const res = await axios.put(`${backendUrl}/api/characters/${encodeURIComponent(dirName)}/linked-settings`, body);
    return res.data.data as LinkedSettings;
}

export interface CharacterTagsInput {
    work: string | null;
    tags: string[];
}

export interface CharacterTagsSaveResult {
    work: string | null;
    tags: string[];
    filters: CharacterFilters;
    stats: RebuildResult['stats'];
}

export async function saveCharacterTags(backendUrl: string, dirName: string, body: CharacterTagsInput): Promise<CharacterTagsSaveResult> {
    const res = await axios.put(`${backendUrl}/api/character-tags/${encodeURIComponent(dirName)}`, body);
    return res.data as CharacterTagsSaveResult;
}

// ===== 表情画像生成用の表情プロンプト（キャラクター共通） =====

export interface EmotionPromptEntry {
    title: string;
    prompt: string;
}

export interface EmotionPrompts {
    version: number;
    /** 表情画像生成で選択中のワークフロー（テンプレート名）。統合設定の既定とは別に保持 */
    workflow?: string;
    /** 表情名 → 保存済みプロンプト一覧 */
    emotions: Record<string, EmotionPromptEntry[]>;
}

export function createEmptyEmotionPrompts(): EmotionPrompts {
    return { version: 1, workflow: '', emotions: {} };
}

export async function getEmotionPrompts(backendUrl: string): Promise<EmotionPrompts> {
    const res = await axios.get(`${backendUrl}/api/characters/emotion-prompts`);
    return res.data.data as EmotionPrompts;
}

export async function saveEmotionPrompts(backendUrl: string, body: EmotionPrompts): Promise<EmotionPrompts> {
    const res = await axios.put(`${backendUrl}/api/characters/emotion-prompts`, body);
    return res.data.data as EmotionPrompts;
}

export interface EmotionPromptsSampleResult {
    version: string;
    added: number;
    skipped: number;
    prompts: EmotionPrompts;
}

/**
 * 認証サーバーからサンプルプロンプトパックを取得し、無いタイトルだけ追加して取り込む。
 * パックは言語ごとに分かれているため、現在の UI 言語を渡す（他のサンプル取得と同じ）。
 */
export async function downloadEmotionPromptSample(backendUrl: string, lang: string): Promise<EmotionPromptsSampleResult> {
    const res = await axios.post(`${backendUrl}/api/characters/emotion-prompts/download-sample`, { lang });
    return res.data.data as EmotionPromptsSampleResult;
}
