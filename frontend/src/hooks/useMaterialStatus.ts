/**
 * useMaterialStatus - 素材づくりのキャラ一覧と、キャラごとの状態（画像設定・表情画像・声）を読む
 *
 * 状態は1人ずつ読まず、集計 API でまとめて読む。読めなかった状態は null（不明）のまま返し、
 * 呼び出し側はキャラを選んだときに1人分の API で読む。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from '../lib/axios';
import { subscribeConfigFilesChanged } from '../lib/configFilesChanged';
import type { CharacterTagInfo } from '../api/files';
import {
    fetchMaterialImageStatus,
    fetchCharacterImageConfigSummary,
    fetchCharacterVoiceSummary,
    type CharacterImageConfigSummary,
    type CharacterVoiceSummary,
} from '../api/material';

export type DotState = 'ok' | 'partial' | 'none' | 'unknown';

export interface CharacterMaterialState {
    image: DotState;
    faces: DotState;
    voice: DotState;
    /** 元画像がある表情の数と有効な表情の数（表情画像が読めたときだけ） */
    faceCount?: { done: number; total: number };
    voiceId?: string;
}

export interface MaterialStatusResult {
    characters: CharacterTagInfo[];
    loading: boolean;
    /** dirName ごとの状態 */
    states: Record<string, CharacterMaterialState>;
    /** 画像設定・表情画像・声の集計を読めたか */
    known: { image: boolean; faces: boolean; voice: boolean };
    reload: () => void;
}

interface Options {
    imageGenEnabled: boolean;
    ttsEnabled: boolean;
}

export const useMaterialStatus = (backendUrl: string, { imageGenEnabled, ttsEnabled }: Options): MaterialStatusResult => {
    const [characters, setCharacters] = useState<CharacterTagInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [faces, setFaces] = useState<Awaited<ReturnType<typeof fetchMaterialImageStatus>>>(null);
    const [images, setImages] = useState<CharacterImageConfigSummary[] | null>(null);
    const [voices, setVoices] = useState<CharacterVoiceSummary[] | null>(null);
    const [generation, setGeneration] = useState(0);

    const reload = useCallback(() => {
        setLoading(true);
        setGeneration(g => g + 1);
    }, []);

    // 設定ファイルが増えた・消えた・書き換わったら（AI で作ったときなど）読み直す。
    // 素材づくりは一度開いたら隠すだけなので、読み直さないとページを読み直すまで一覧・検索に出ない
    useEffect(() => subscribeConfigFilesChanged(reload), [reload]);

    useEffect(() => {
        let alive = true;
        Promise.all([
            axios.get(`${backendUrl}/api/character-tags`).then(res => (res.data?.characters ?? []) as CharacterTagInfo[]).catch(() => [] as CharacterTagInfo[]),
            fetchMaterialImageStatus(backendUrl),
            imageGenEnabled ? fetchCharacterImageConfigSummary(backendUrl) : Promise.resolve(null),
            ttsEnabled ? fetchCharacterVoiceSummary(backendUrl) : Promise.resolve(null),
        ]).then(([list, faceStatus, imageSummary, voiceSummary]) => {
            if (!alive) return;
            setCharacters(list);
            setFaces(faceStatus);
            setImages(imageSummary);
            setVoices(voiceSummary);
            setLoading(false);
        });
        return () => { alive = false; };
    }, [backendUrl, imageGenEnabled, ttsEnabled, generation]);

    // 状態は読み込んだ値が変わったときだけ作り直す（一覧の行の描き直しを省けるように）
    const states = useMemo(() => {
        const imageMap = new Map((images ?? []).map(s => [s.dirName, s]));
        const faceMap = new Map((faces?.characters ?? []).map(s => [s.dirName, s]));
        const voiceMap = new Map((voices ?? []).map(s => [s.dirName, s]));
        const out: Record<string, CharacterMaterialState> = {};
        for (const c of characters) {
            const state: CharacterMaterialState = { image: 'unknown', faces: 'unknown', voice: 'unknown' };
            if (images) {
                const s = imageMap.get(c.dirName);
                state.image = s && (s.loraCount > 0 || s.hasPrompt) ? 'ok' : s ? 'partial' : 'none';
            }
            if (faces) {
                const total = faces.enabledEmotions;
                const done = faceMap.get(c.dirName)?.originals ?? 0;
                state.faceCount = { done, total };
                state.faces = total > 0 && done >= total ? 'ok' : done > 0 ? 'partial' : 'none';
            }
            if (voices) {
                const voiceId = voiceMap.get(c.dirName)?.voiceId ?? '';
                state.voiceId = voiceId;
                state.voice = voiceId ? 'ok' : 'none';
            }
            out[c.dirName] = state;
        }
        return out;
    }, [characters, images, faces, voices]);
    const known = useMemo(() => ({ image: images !== null, faces: faces !== null, voice: voices !== null }), [images, faces, voices]);

    return {
        characters,
        loading,
        states,
        known,
        reload,
    };
};
