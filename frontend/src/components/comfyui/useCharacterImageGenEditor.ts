/**
 * useCharacterImageGenEditor - キャラクター画像生成設定（image_gen_config.json）の
 * 読込・編集・保存と、フォーム描画に必要な LoRA 一覧・トリガーワード取得をまとめたフック。
 *
 * 設定ファイルエディタのキャラクター種別（画像生成設定タブ）から使う。
 * 対象キャラクターは dirName で固定し、変わったら読み直す。
 */

import { useCallback, useEffect, useState } from 'react';
import {
    getCharacterImageGenConfig,
    saveCharacterImageGenConfig,
    getLoraTriggerWords,
} from '../../api/comfyui';
import type { CharacterImageGenConfig, TriggerWordFormat } from '../../api/comfyui';
import { useComfyLoras } from './useComfyLoras';
import { useTriggerWordFormat } from './useTriggerWordFormat';
import { withTrailingEmptyLora } from './loraEntries';

const DEFAULT_CONFIG: CharacterImageGenConfig = {
    characterName: '',
    workName: '',
    aliases: [],
    characterPrompt: '',
    physicalFeatures: '',
    lora: [],
    outfits: [],
    extraPositive: '',
    extraNegative: '',
};

export function useCharacterImageGenEditor(backendUrl: string, dirName: string | null, active: boolean) {
    const [config, setConfig] = useState<CharacterImageGenConfig>({ ...DEFAULT_CONFIG });
    const [isLoading, setIsLoading] = useState(false);
    const [isDirty, setIsDirty] = useState(false);

    const enabled = active && !!dirName;
    const { lorasByCategory, comfyUnreachable, retry: refreshLoras } = useComfyLoras(backendUrl, ['character', 'outfit'], enabled);
    const availableLoras = lorasByCategory['character'] ?? [];
    const availableOutfitLoras = lorasByCategory['outfit'] ?? [];
    const triggerWordFormat: TriggerWordFormat = useTriggerWordFormat(backendUrl, enabled, undefined);

    // dirName が変わるたびに読み直す（未保存の編集は捨てる）。
    useEffect(() => {
        if (!enabled || !dirName) {
            setConfig({ ...DEFAULT_CONFIG });
            setIsDirty(false);
            return;
        }
        let cancelled = false;
        setIsLoading(true);
        (async () => {
            try {
                const loaded = await getCharacterImageGenConfig(backendUrl, dirName);
                if (cancelled) return;
                loaded.lora = withTrailingEmptyLora(loaded.lora);
                if (!loaded.outfits) loaded.outfits = [];
                loaded.outfits = loaded.outfits.map(outfit => ({
                    ...outfit,
                    lora: withTrailingEmptyLora(outfit.lora),
                }));
                setConfig(loaded);
                setIsDirty(false);
            } catch {
                if (!cancelled) setConfig({ ...DEFAULT_CONFIG, characterName: dirName });
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [backendUrl, dirName, enabled]);

    const updateConfig = useCallback(<K extends keyof CharacterImageGenConfig>(key: K, value: CharacterImageGenConfig[K]) => {
        setConfig(prev => ({ ...prev, [key]: value }));
        setIsDirty(true);
    }, []);

    const save = useCallback(async () => {
        if (!dirName) return false;
        try {
            const clean = {
                ...config,
                lora: config.lora.filter(l => l.name),
                outfits: config.outfits
                    .map(outfit => ({
                        ...outfit,
                        name: outfit.name.trim(),
                        prompt: outfit.prompt.trim(),
                        lora: outfit.lora.filter(l => l.name),
                    }))
                    .filter(outfit => outfit.name || outfit.prompt || outfit.lora.length > 0),
            };
            await saveCharacterImageGenConfig(backendUrl, dirName, clean);
            setIsDirty(false);
            return true;
        } catch (error) {
            console.error('[useCharacterImageGenEditor] save failed:', error);
            return false;
        }
    }, [backendUrl, dirName, config]);

    const fetchTriggerWords = useCallback(async (loraName: string) => {
        if (!loraName) return null;
        try {
            const result = await getLoraTriggerWords(backendUrl, loraName);
            if (result.success) {
                const lines = (result.triggerLines && result.triggerLines.length > 0)
                    ? result.triggerLines
                    : (result.triggerWords.length > 0 ? [result.triggerWords.join(', ')] : []);
                return { words: result.triggerWords, lines };
            }
        } catch { /* 取得失敗はボタン側で「なし」扱い */ }
        return null;
    }, [backendUrl]);

    return {
        config,
        isLoading,
        isDirty,
        updateConfig,
        save,
        availableLoras,
        availableOutfitLoras,
        comfyUnreachable,
        refreshLoras,
        fetchTriggerWords,
        triggerWordFormat,
    };
}
