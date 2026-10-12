/**
 * material.ts - 素材づくりのキャラ一覧に出す状態の集計 API
 *
 * 表情画像は本体、画像設定と声はモジュール側が返す。古いモジュール（集計 API が無い版）や
 * 支援者でないとき・モジュールが止まっているときは読めないので、null を返して「不明」として扱う。
 */
import axios from '../lib/axios';

export interface CharacterImageStatus {
    dirName: string;
    /** 元画像がある有効な表情の数 */
    originals: number;
    /** アイコンがある有効な表情の数 */
    icons: number;
}

export interface MaterialImageStatus {
    /** 有効な表情の数（作成状況の分母） */
    enabledEmotions: number;
    characters: CharacterImageStatus[];
}

export interface CharacterImageConfigSummary {
    dirName: string;
    loraCount: number;
    hasPrompt: boolean;
}

export interface CharacterVoiceSummary {
    dirName: string;
    /** 割り当てた声（空なら未割り当て） */
    voiceId: string;
    readEnabled: boolean;
}

export async function fetchMaterialImageStatus(backendUrl: string): Promise<MaterialImageStatus | null> {
    try {
        const res = await axios.get(`${backendUrl}/api/characters/material-status`);
        return res.data?.data ?? null;
    } catch {
        return null;
    }
}

export async function fetchCharacterImageConfigSummary(backendUrl: string): Promise<CharacterImageConfigSummary[] | null> {
    try {
        const res = await axios.get(`${backendUrl}/api/comfyui/character-config-summary`);
        return Array.isArray(res.data?.characters) ? res.data.characters : null;
    } catch {
        return null;
    }
}

export async function fetchCharacterVoiceSummary(backendUrl: string): Promise<CharacterVoiceSummary[] | null> {
    try {
        const res = await axios.get(`${backendUrl}/api/tts/character-config-summary`);
        return Array.isArray(res.data?.characters) ? res.data.characters : null;
    } catch {
        return null;
    }
}
