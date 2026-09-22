/**
 * ApiServiceBalancePanel.tsx - 左メニュー用の API サービス残高パネル
 *
 * 画像生成バックエンドが API サービスのときだけ表示し、プラン・Anlas 残高・無料枠・
 * 使用量枠を出す。取得はドロワーが開くたび（active）と再取得ボタン。取得に失敗したときは
 * 前回の値を薄く残して失敗印を添える。バックエンドの選択は親（タグ判定パネルの切替タブ）
 * から受け取り、受け取れていないときは自分で設定を読む。
 */

import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, ChevronDown, ChevronRight, Coins, Loader2 } from 'lucide-react';
import { getApiServiceBalance, getComfyUIConfig } from '../../../api/comfyui';
import type { ApiServiceId, NovelAISubscription } from '../../../api/comfyui';
import type { I18NCatalog } from '../../../api/i18n';
import { createComfyUIText } from '../i18n';
import type { BackendSelection } from '../BackendTabs';
import { normalizeApiService, normalizeImageBackend } from './services';
import { BalanceRefreshButton, SubscriptionSummary } from './ApiServiceConnectionSection';

interface Props {
    backendUrl: string;
    uiCatalog?: I18NCatalog | null;
    // ドロワーが開いているか。true になるたびに残高を読み直す（未指定なら常に有効）。
    active?: boolean;
    // 親が把握している全画面共用の選択。null なら自分で設定を読む。
    selection?: BackendSelection | null;
}

export const ApiServiceBalancePanel: React.FC<Props> = ({ backendUrl, uiCatalog = null, active = true, selection = null }) => {
    const { API_SERVICE } = createComfyUIText(uiCatalog);
    const [isOpen, setIsOpen] = useState(true);
    const [ownSelection, setOwnSelection] = useState<BackendSelection | null>(null);
    const [subscription, setSubscription] = useState<NovelAISubscription | null>(null);
    const [loading, setLoading] = useState(false);
    const [failed, setFailed] = useState(false);

    // 親から選択が来ないときだけ設定を読んで表示可否を決める。
    useEffect(() => {
        if (selection || !active) return;
        let cancelled = false;
        (async () => {
            try {
                const config = await getComfyUIConfig(backendUrl);
                if (cancelled) return;
                setOwnSelection({
                    imageBackend: normalizeImageBackend(config.imageBackend),
                    apiService: normalizeApiService(config.apiService),
                });
            } catch (e) {
                console.error('[ApiServiceBalancePanel] config load failed:', e);
            }
        })();
        return () => { cancelled = true; };
    }, [selection, active, backendUrl]);

    const effective = selection ?? ownSelection;
    const visible = effective?.imageBackend === 'api';
    const service: ApiServiceId = effective?.apiService ?? 'novelai';

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const result = await getApiServiceBalance(backendUrl, service);
            if (result.success && result.subscription) {
                setSubscription(result.subscription);
                setFailed(false);
            } else {
                setFailed(true);
            }
        } catch (e) {
            console.error('[ApiServiceBalancePanel] balance load failed:', e);
            setFailed(true);
        } finally {
            setLoading(false);
        }
    }, [backendUrl, service]);

    // ドロワーが開くたび、表示対象になった直後、サービスが変わったときに読み直す。
    useEffect(() => {
        if (!visible || !active) return;
        void refresh();
    }, [visible, active, refresh]);

    if (!visible) return null;

    return (
        <div className="border border-gray-700/60 rounded-lg overflow-hidden bg-gray-800/40">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-200 hover:bg-gray-700/60 transition-colors text-left"
            >
                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <Coins size={14} className="text-amber-400" />
                <span>{API_SERVICE.LABELS.BALANCE_PANEL}</span>
                {failed && <AlertCircle size={14} className="ml-auto text-amber-400" />}
            </button>
            {isOpen && (
                <div className="p-3 border-t border-gray-700/60 space-y-2">
                    {subscription ? (
                        <div className={failed ? 'opacity-60' : ''}>
                            <SubscriptionSummary subscription={subscription} uiCatalog={uiCatalog} compact />
                        </div>
                    ) : loading ? (
                        <p className="flex items-center gap-1 text-xs text-gray-500">
                            <Loader2 size={12} className="animate-spin" />
                            {API_SERVICE.MESSAGES.BALANCE_LOADING}
                        </p>
                    ) : (
                        <p className="text-xs text-gray-500">{API_SERVICE.MESSAGES.BALANCE_UNAVAILABLE}</p>
                    )}
                    {failed && subscription && (
                        <p className="flex items-center gap-1 text-[11px] text-amber-300">
                            <AlertCircle size={11} />
                            {API_SERVICE.MESSAGES.BALANCE_STALE}
                        </p>
                    )}
                    <div className="flex justify-end">
                        <BalanceRefreshButton onClick={() => void refresh()} loading={loading} label={API_SERVICE.BUTTONS.REFRESH_BALANCE} />
                    </div>
                </div>
            )}
        </div>
    );
};
