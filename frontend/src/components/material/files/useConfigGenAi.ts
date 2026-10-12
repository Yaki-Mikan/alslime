/**
 * useConfigGenAi.ts - 設定を AI に作らせる・直させるときに使う AI
 *
 * 「AI で作る」と設定ファイルの「対話で編集」で共通に使う。
 * - 前回使った値（全体の設定の configGen）を既定として読む
 * - 選べるモデルは、選んだ種類のものに絞る。Antigravity の考える深さはモデルごとに選べる値へ寄せる
 * - つながるかの確認の結果と、送ったときの値は全体の設定へ残す（次に開いたときの既定になる）
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import axios from '../../../lib/axios';
import { getCLIStatus, type CLIStatusEntry } from '../../../api/config-gen';
import { getGlobalSettings, updateGlobalSettings } from '../../../api/global-settings';
import { pingModel } from '../../../api/user-models';
import {
    DEFAULT_ANTIGRAVITY_THINKING,
    antigravityThinkingLevelsOf,
    normalizeAntigravityThinking,
    type AntigravityThinking,
} from '../../../constants/antigravity';
import type { Model, ModelProvider } from '../../../hooks/useChat';
import { modelProviderOf } from '../../../hooks/useChat';

export const CONFIG_GEN_PROVIDERS: ModelProvider[] = ['antigravity', 'claude', 'gemini'];
export const DEFAULT_CONFIG_GEN_TIMEOUT_MINUTES = 20;

export interface PingRecord {
    ok: boolean;
    at: string;
}

/** 全体の設定に残している前回の値 */
export interface SavedConfigGen {
    provider?: ModelProvider;
    model?: string;
    effort?: string;
    timeoutMinutes?: number;
    method?: string;
    ping?: Record<string, PingRecord>;
    [key: string]: unknown;
}

const readSaved = async (backendUrl: string): Promise<SavedConfigGen> => {
    const settings = await getGlobalSettings(backendUrl).catch(() => null);
    const saved = settings?.configGen;
    return (saved && typeof saved === 'object') ? saved as SavedConfigGen : {};
};

/**
 * @param active 画面に出しているか。出したときにモデルの一覧と CLI の状態を読み直す
 * @param onSavedLoaded 前回の値を初めて読んだときに呼ぶ（AI 以外の前回の値を使う呼び出し側のため）
 */
export const useConfigGenAi = (backendUrl: string, active: boolean, onSavedLoaded?: (saved: SavedConfigGen) => void) => {
    const [provider, setProvider] = useState<ModelProvider>('antigravity');
    const [model, setModel] = useState('');
    const [effort, setEffort] = useState('');
    const [antigravityThinking, setAntigravityThinking] = useState<AntigravityThinking>(DEFAULT_ANTIGRAVITY_THINKING);
    const [timeoutMinutes, setTimeoutMinutes] = useState(DEFAULT_CONFIG_GEN_TIMEOUT_MINUTES);
    const [models, setModels] = useState<Model[]>([]);
    const [cliStatus, setCliStatus] = useState<CLIStatusEntry[]>([]);
    const [pingRecords, setPingRecords] = useState<Record<string, PingRecord>>({});
    const [pingRunning, setPingRunning] = useState(false);
    const savedLoaded = useRef(false);
    const onSavedLoadedRef = useRef(onSavedLoaded);
    useEffect(() => { onSavedLoadedRef.current = onSavedLoaded; });

    // 出すたびに、選べるモデルと CLI の状態を読み直す。前回の値は初めの1回だけ読む
    useEffect(() => {
        if (!active) return;
        axios.get(`${backendUrl}/api/models`).then(res => setModels(res.data?.models || [])).catch(() => {});
        getCLIStatus(backendUrl).then(setCliStatus).catch(() => {});
        if (savedLoaded.current) return;
        savedLoaded.current = true;
        readSaved(backendUrl).then(saved => {
            if (saved.provider && CONFIG_GEN_PROVIDERS.includes(saved.provider)) setProvider(saved.provider);
            if (typeof saved.model === 'string') setModel(saved.model);
            if (typeof saved.effort === 'string') setEffort(saved.effort);
            if (typeof saved.timeoutMinutes === 'number') setTimeoutMinutes(saved.timeoutMinutes);
            if (saved.ping && typeof saved.ping === 'object') setPingRecords(saved.ping);
            onSavedLoadedRef.current?.(saved);
        });
    }, [active, backendUrl]);

    // CLI が見つかるか（状態が取れないときは絞らない）
    const cliFound = (p: ModelProvider): boolean => {
        const entry = cliStatus.find(c => c.id === p);
        return entry ? entry.status === 'ok' : true;
    };
    const providerModels = useMemo(() => models.filter(m => modelProviderOf(m) === provider), [models, provider]);
    useEffect(() => {
        if (providerModels.length > 0 && !providerModels.some(m => m.id === model)) {
            setModel(providerModels[0].id);
        }
    }, [providerModels, model]);
    // Antigravity の考える深さの選択肢はモデルごと（サーバーの値が正）。選べない値は Low へ落とす
    const antigravityThinkingLevels = useMemo(
        () => (provider === 'antigravity' ? antigravityThinkingLevelsOf(providerModels.find(m => m.id === model)) : []),
        [provider, providerModels, model],
    );
    useEffect(() => {
        if (antigravityThinkingLevels.length > 0 && !antigravityThinkingLevels.includes(antigravityThinking)) {
            setAntigravityThinking(normalizeAntigravityThinking(antigravityThinking, antigravityThinkingLevels));
        }
    }, [antigravityThinkingLevels, antigravityThinking]);

    const modelLabel = providerModels.find(m => m.id === model)?.name || model;

    /** つながるかを確かめ、結果を全体の設定へ残す。確かめられたら true、つながらなければ false、確かめなかったら null */
    const ping = async (): Promise<boolean | null> => {
        if (!model || pingRunning) return null;
        setPingRunning(true);
        try {
            const result = await pingModel(backendUrl, model);
            const record: PingRecord = { ok: !!result.success, at: new Date().toISOString() };
            const next = { ...pingRecords, [provider]: record };
            setPingRecords(next);
            updateGlobalSettings(backendUrl, { configGen: { ...(await readSaved(backendUrl)), ping: next } }).catch(() => {});
            return record.ok;
        } catch {
            return false;
        } finally {
            setPingRunning(false);
        }
    };

    /** 送ったときの値を次の既定として残す（extra は AI 以外に残したい値） */
    const persist = async (extra?: Partial<SavedConfigGen>) => {
        const saved = await readSaved(backendUrl);
        updateGlobalSettings(backendUrl, {
            configGen: { ...saved, provider, model, effort, timeoutMinutes, ...extra },
        }).catch(() => {});
    };

    /** 送るときに付ける使う AI の指定 */
    const requestFields = () => ({
        model,
        claudeEffort: provider === 'claude' ? effort : undefined,
        antigravityThinking: provider === 'antigravity' ? antigravityThinking : undefined,
        timeoutMinutes,
    });

    return {
        provider, setProvider,
        model, setModel,
        effort, setEffort,
        antigravityThinking, setAntigravityThinking,
        timeoutMinutes, setTimeoutMinutes,
        pingRecords, pingRunning,
        cliFound, providerModels, antigravityThinkingLevels, modelLabel,
        ping, persist, requestFields,
    };
};

export type ConfigGenAi = ReturnType<typeof useConfigGenAi>;
