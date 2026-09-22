/**
 * BackendTabs.tsx - 画像生成バックエンドの切替タブ（ComfyUI ／ API サービス）
 *
 * 画像生成設定・統合設定・左メニューの各画面の最上部に置く共通部品。
 * 選択は全画面で共用する 1 つの値（imageBackend / apiService）で、変更は即時保存する
 * （GET → 差し替え → PUT。他画面の項目を落とさない）。API サービス側はタブ直下に
 * サービス選択のプルダウンを出す。
 */

import React, { useEffect, useState } from 'react';
import { Server, Cloud, Loader2, AlertCircle } from 'lucide-react';
import { getComfyUIConfig, patchComfyUIConfig } from '../../api/comfyui';
import type { ApiServiceId, ImageBackend } from '../../api/comfyui';
import type { I18NCatalog } from '../../api/i18n';
import { createComfyUIText } from './i18n';
import { API_SERVICES, normalizeApiService, normalizeImageBackend } from './apiservice/services';

export interface BackendSelection {
    imageBackend: ImageBackend;
    apiService: ApiServiceId;
}

interface BackendTabsProps {
    backendUrl: string;
    uiCatalog?: I18NCatalog | null;
    /** 表示中（開いているモーダル・展開中のパネル）のときだけ設定を読み直す */
    active: boolean;
    /** 選択が確定（保存完了）するたびに親へ通知する */
    onChange: (selection: BackendSelection) => void;
    /** 親が既に読み込んだ値があれば初期表示に使う */
    initial?: Partial<BackendSelection>;
    /** 上下の余白を詰める（左メニュー用） */
    compact?: boolean;
}

export const BackendTabs: React.FC<BackendTabsProps> = ({
    backendUrl,
    uiCatalog = null,
    active,
    onChange,
    initial,
    compact = false,
}) => {
    const { BACKEND } = createComfyUIText(uiCatalog);
    const [imageBackend, setImageBackend] = useState<ImageBackend>(normalizeImageBackend(initial?.imageBackend));
    const [apiService, setApiService] = useState<ApiServiceId>(normalizeApiService(initial?.apiService));
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!active) return;
        let cancelled = false;
        (async () => {
            try {
                const config = await getComfyUIConfig(backendUrl);
                if (cancelled) return;
                const next: BackendSelection = {
                    imageBackend: normalizeImageBackend(config.imageBackend),
                    apiService: normalizeApiService(config.apiService),
                };
                setImageBackend(next.imageBackend);
                setApiService(next.apiService);
                onChange(next);
            } catch (e) {
                console.error('[BackendTabs] config load failed:', e);
            }
        })();
        return () => {
            cancelled = true;
        };
        // onChange は親側で useCallback されている前提。読み直しは active の変化時だけ。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active, backendUrl]);

    const persist = async (next: BackendSelection) => {
        setIsSaving(true);
        setError(null);
        try {
            await patchComfyUIConfig(backendUrl, { imageBackend: next.imageBackend, apiService: next.apiService });
            setImageBackend(next.imageBackend);
            setApiService(next.apiService);
            onChange(next);
        } catch (e) {
            console.error('[BackendTabs] save failed:', e);
            setError(BACKEND.MESSAGES.SWITCH_FAILED);
        } finally {
            setIsSaving(false);
        }
    };

    const tabs: { value: ImageBackend; label: string; icon: React.ReactNode }[] = [
        { value: 'comfyui', label: BACKEND.TABS.COMFYUI, icon: <Server size={14} /> },
        { value: 'api', label: BACKEND.TABS.API_SERVICE, icon: <Cloud size={14} /> },
    ];

    return (
        <div className={compact ? 'space-y-1.5' : 'space-y-2'}>
            <div className="flex rounded-lg border border-gray-700 bg-gray-800 p-1" role="tablist">
                {tabs.map((tab) => {
                    const selected = imageBackend === tab.value;
                    return (
                        <button
                            key={tab.value}
                            type="button"
                            role="tab"
                            aria-selected={selected}
                            disabled={isSaving}
                            onClick={() => {
                                if (selected) return;
                                void persist({ imageBackend: tab.value, apiService });
                            }}
                            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm rounded transition-colors disabled:opacity-60 ${
                                selected ? 'bg-green-700 text-white' : 'text-gray-300 hover:bg-gray-700'
                            }`}
                        >
                            {isSaving && selected ? <Loader2 size={14} className="animate-spin" /> : tab.icon}
                            {tab.label}
                        </button>
                    );
                })}
            </div>
            {imageBackend === 'api' && (
                <label className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 shrink-0">{BACKEND.LABELS.SERVICE}</span>
                    <select
                        value={apiService}
                        disabled={isSaving}
                        onChange={(e) => void persist({ imageBackend, apiService: normalizeApiService(e.target.value) })}
                        className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 outline-none focus:border-green-500 transition-colors disabled:opacity-60"
                    >
                        {API_SERVICES.map((s) => (
                            <option key={s.id} value={s.id}>{s.label}</option>
                        ))}
                    </select>
                </label>
            )}
            {error && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs bg-red-900/30 border border-red-700/50 text-red-300">
                    <AlertCircle size={12} />
                    {error}
                </div>
            )}
        </div>
    );
};
