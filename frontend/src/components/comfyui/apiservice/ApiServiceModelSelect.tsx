/**
 * ApiServiceModelSelect.tsx - API サービスで使うモデルの選択
 *
 * 使うモデルは生成プリセットとは別に、全体で 1 つ選んで保存する。生成プリセットが切り替わっても
 * 変わらない。切り替えたら専用の保存の口で即時保存する（設定全体を読んで書き戻す方式は使わない）。
 * 保存の応答が返るまでは選択を確定せず、失敗したら元のモデルの表示のまま失敗を出す。画面に出ている
 * モデルと、実際に生成で使われるモデルが食い違う状態を作らない。
 */

import React, { useEffect, useState } from 'react';
import { AlertCircle, Cpu, Loader2 } from 'lucide-react';
import {
    apiServiceModelOf,
    getApiServiceCatalog,
    getComfyUIConfig,
    setApiServiceModel,
} from '../../../api/comfyui';
import type { ApiServiceId, NovelAIModelInfo } from '../../../api/comfyui';
import type { I18NCatalog } from '../../../api/i18n';
import { createComfyUIText } from '../i18n';

interface ApiServiceModelSelectProps {
    backendUrl: string;
    uiCatalog?: I18NCatalog | null;
    service: ApiServiceId;
    active: boolean;
    /** 保存済みの使用モデルが分かったとき、変わったときに親へ知らせる */
    onModelChange?: (modelId: string) => void;
    /** 保存中かどうかを親へ知らせる（保存中はテスト生成を押せないようにするため） */
    onSavingChange?: (saving: boolean) => void;
}

const inputClass = 'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-green-500 transition-colors disabled:opacity-50';

export const ApiServiceModelSelect: React.FC<ApiServiceModelSelectProps> = ({
    backendUrl,
    uiCatalog = null,
    service,
    active,
    onModelChange,
    onSavingChange,
}) => {
    const { NOVELAI } = createComfyUIText(uiCatalog);
    const [models, setModels] = useState<NovelAIModelInfo[]>([]);
    const [modelId, setModelId] = useState('');
    // 保存中の切り替え先。応答が返るまでは、これを選択欄に見せて欄を押せない表示にする。
    const [pendingId, setPendingId] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);

    // 画面を開くたびに、保存済みの値を読み直す（ほかの画面での変更を拾う）。
    useEffect(() => {
        if (!active) return;
        let cancelled = false;
        (async () => {
            try {
                const [catalog, config] = await Promise.all([
                    getApiServiceCatalog(backendUrl, service),
                    getComfyUIConfig(backendUrl),
                ]);
                if (cancelled) return;
                const saved = apiServiceModelOf(config, service);
                setModels(catalog.models);
                setModelId(saved);
                setFailed(false);
                onModelChange?.(saved);
            } catch (e) {
                console.error('[ApiServiceModelSelect] load failed:', e);
            }
        })();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active, backendUrl, service]);

    const handleChange = async (next: string) => {
        if (!next || next === modelId || pendingId !== null) return;
        setPendingId(next);
        setFailed(false);
        onSavingChange?.(true);
        try {
            const saved = await setApiServiceModel(backendUrl, next, service);
            setModelId(saved);
            onModelChange?.(saved);
        } catch (e) {
            // 保存できなかったので、選択は元のモデルのまま。
            console.error('[ApiServiceModelSelect] save failed:', e);
            setFailed(true);
        } finally {
            setPendingId(null);
            onSavingChange?.(false);
        }
    };

    const shown = pendingId ?? modelId;
    const model = models.find(m => m.id === modelId);

    return (
        <div className="space-y-1">
            <label className="flex items-center gap-2 text-sm font-medium text-gray-400">
                <Cpu size={16} className="text-green-400" />
                {NOVELAI.LABELS.MODEL}
                {pendingId !== null && <Loader2 size={12} className="animate-spin text-gray-500" />}
            </label>
            <select
                value={shown}
                disabled={models.length === 0 || pendingId !== null}
                onChange={(e) => void handleChange(e.target.value)}
                className={inputClass}
                aria-label={NOVELAI.LABELS.MODEL}
            >
                {models.map(m => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                ))}
            </select>
            <p className="text-xs text-gray-500">{NOVELAI.HELP.MODEL_SELECTED_ELSEWHERE}</p>
            {model && !model.supportsJapanese && <p className="text-xs text-amber-300">{NOVELAI.HELP.JAPANESE_V45}</p>}
            {model && !model.supportsReference && <p className="text-xs text-gray-500">{NOVELAI.HELP.REFERENCE_V45_ONLY}</p>}
            {failed && (
                <p className="flex items-center gap-1 text-xs text-red-300">
                    <AlertCircle size={12} />
                    {NOVELAI.MESSAGES.MODEL_SAVE_FAILED}
                </p>
            )}
        </div>
    );
};
