/**
 * ApiServiceConnectionSection.tsx - API サービスの接続設定（トークン・接続テスト・残高）
 *
 * トークンは伏せ字で入力し、保存後は「設定済み／未設定」だけを表示する（値は画面に出さない）。
 * 接続テストはアカウント情報（プラン・Anlas 残高・無料枠・使用量枠）を返す。
 */

import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound, Wifi, WifiOff, CheckCircle, Loader2, Trash2, RefreshCw } from 'lucide-react';
import {
    deleteApiServiceToken,
    getApiServiceTokenStatus,
    setApiServiceToken,
    testApiServiceConnection,
} from '../../../api/comfyui';
import type { ApiServiceId, NovelAISubscription } from '../../../api/comfyui';
import { resolveBackendError, resolveMessage, type I18NCatalog } from '../../../api/i18n';
import { createComfyUIText, formatComfyText } from '../i18n';

interface ApiServiceConnectionSectionProps {
    backendUrl: string;
    uiCatalog?: I18NCatalog | null;
    service: ApiServiceId;
    active: boolean;
    /** 接続テストでアカウント情報が取れたときに親へ通知（無料枠判定などに使う） */
    onSubscription?: (subscription: NovelAISubscription | null) => void;
}

export const SubscriptionSummary: React.FC<{
    subscription: NovelAISubscription;
    uiCatalog: I18NCatalog | null;
    compact?: boolean;
}> = ({ subscription, uiCatalog, compact = false }) => {
    const { API_SERVICE } = createComfyUIText(uiCatalog);
    const rows: { label: string; value: string; warn?: boolean }[] = [
        { label: API_SERVICE.LABELS.PLAN, value: resolveMessage(uiCatalog, subscription.tierLabelKey, subscription.tierLabelKey) },
        { label: API_SERVICE.LABELS.ANLAS, value: `${subscription.anlas.toLocaleString()} (${subscription.fixedAnlas.toLocaleString()} + ${subscription.purchasedAnlas.toLocaleString()})` },
        {
            label: API_SERVICE.LABELS.FREE_TIER,
            value: subscription.freeTier.enabled
                ? formatComfyText(API_SERVICE.HELP.FREE_TIER_DESC, {
                    pixels: subscription.freeTier.maxPixels.toLocaleString(),
                    steps: subscription.freeTier.maxSteps,
                    samples: subscription.freeTier.maxSamples,
                })
                : API_SERVICE.MESSAGES.FREE_TIER_NONE,
        },
    ];
    if (subscription.usageKnown) {
        rows.push({
            label: API_SERVICE.LABELS.USAGE,
            value: subscription.usageNegative ? API_SERVICE.MESSAGES.USAGE_NEGATIVE : `${subscription.usagePercent}%`,
            warn: subscription.usageNegative,
        });
    }
    return (
        <div className={compact ? 'space-y-0.5' : 'space-y-1'}>
            {rows.map((row) => (
                <div key={row.label} className={`flex items-baseline gap-2 ${compact ? 'text-[11px]' : 'text-xs'}`}>
                    <span className="text-gray-500 shrink-0">{row.label}</span>
                    <span className={row.warn ? 'text-amber-300' : 'text-gray-200'}>{row.value}</span>
                </div>
            ))}
            {!compact && subscription.expiresAt > 0 && (
                <p className="text-[11px] text-gray-500">
                    {formatComfyText(API_SERVICE.MESSAGES.EXPIRES_AT, { date: new Date(subscription.expiresAt * 1000).toLocaleDateString() })}
                </p>
            )}
        </div>
    );
};

export const ApiServiceConnectionSection: React.FC<ApiServiceConnectionSectionProps> = ({
    backendUrl,
    uiCatalog = null,
    service,
    active,
    onSubscription,
}) => {
    const { API_SERVICE, SECTION_NAMES } = createComfyUIText(uiCatalog);
    const [hasToken, setHasToken] = useState<boolean | null>(null);
    const [tokenInput, setTokenInput] = useState('');
    const [isSavingToken, setIsSavingToken] = useState(false);
    const [isTesting, setIsTesting] = useState(false);
    const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
    const [subscription, setSubscription] = useState<NovelAISubscription | null>(null);

    const loadStatus = useCallback(async () => {
        try {
            const status = await getApiServiceTokenStatus(backendUrl, service);
            setHasToken(status.hasToken);
        } catch (e) {
            console.error('[ApiServiceConnectionSection] token status failed:', e);
            setHasToken(null);
        }
    }, [backendUrl, service]);

    useEffect(() => {
        if (!active) return;
        setNotice(null);
        setSubscription(null);
        void loadStatus();
    }, [active, loadStatus]);

    const handleSaveToken = async () => {
        const token = tokenInput.trim();
        if (!token) return;
        setIsSavingToken(true);
        setNotice(null);
        try {
            const status = await setApiServiceToken(backendUrl, token, service);
            setHasToken(status.hasToken);
            setTokenInput('');
            setNotice({ ok: true, text: API_SERVICE.MESSAGES.TOKEN_SAVED });
        } catch (e) {
            console.error('[ApiServiceConnectionSection] token save failed:', e);
            setNotice({ ok: false, text: API_SERVICE.MESSAGES.TOKEN_SAVE_FAILED });
        } finally {
            setIsSavingToken(false);
        }
    };

    const handleDeleteToken = async () => {
        setIsSavingToken(true);
        setNotice(null);
        try {
            const status = await deleteApiServiceToken(backendUrl, service);
            setHasToken(status.hasToken);
            setSubscription(null);
            onSubscription?.(null);
            setNotice({ ok: true, text: API_SERVICE.MESSAGES.TOKEN_DELETED });
        } catch (e) {
            console.error('[ApiServiceConnectionSection] token delete failed:', e);
            setNotice({ ok: false, text: API_SERVICE.MESSAGES.TOKEN_SAVE_FAILED });
        } finally {
            setIsSavingToken(false);
        }
    };

    const handleTest = async () => {
        setIsTesting(true);
        setNotice(null);
        try {
            const result = await testApiServiceConnection(backendUrl, service);
            if (result.success && result.subscription) {
                setSubscription(result.subscription);
                onSubscription?.(result.subscription);
                setNotice({ ok: true, text: resolveMessage(uiCatalog, result.message || '', result.message || '') });
            } else {
                setSubscription(null);
                onSubscription?.(null);
                const text = result.message ? resolveBackendError(uiCatalog, result.message) : API_SERVICE.MESSAGES.CONNECTION_FAILED;
                setNotice({ ok: false, text });
            }
        } catch (e: any) {
            const text = e?.response?.data?.messageKey
                ? resolveMessage(uiCatalog, e.response.data.messageKey, e.response.data.messageKey)
                : (e?.message || API_SERVICE.MESSAGES.CONNECTION_FAILED);
            setNotice({ ok: false, text });
        } finally {
            setIsTesting(false);
        }
    };

    return (
        <div className="space-y-3">
            <h4 className="flex items-center gap-2 text-sm font-medium text-gray-400">
                <KeyRound size={16} className="text-green-400" />
                {SECTION_NAMES.CONNECTION_SETTINGS}
            </h4>
            <div className="flex items-center gap-2 text-xs">
                <span className="text-gray-500">{API_SERVICE.LABELS.TOKEN}</span>
                <span className={hasToken ? 'text-green-300' : 'text-gray-400'}>
                    {hasToken === null ? '-' : hasToken ? API_SERVICE.LABELS.TOKEN_SET : API_SERVICE.LABELS.TOKEN_UNSET}
                </span>
                {hasToken && (
                    <button
                        type="button"
                        onClick={handleDeleteToken}
                        disabled={isSavingToken}
                        className="ml-auto flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-red-300 transition-colors disabled:opacity-50"
                    >
                        <Trash2 size={12} />
                        {API_SERVICE.BUTTONS.DELETE_TOKEN}
                    </button>
                )}
            </div>
            <div className="flex flex-col gap-2 lg:flex-row">
                <input
                    type="password"
                    autoComplete="off"
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    placeholder={API_SERVICE.PLACEHOLDERS.TOKEN}
                    className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-green-500 transition-colors"
                />
                <button
                    type="button"
                    onClick={handleSaveToken}
                    disabled={isSavingToken || !tokenInput.trim()}
                    className="px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-green-600 rounded-lg text-sm text-green-400 hover:text-green-300 transition-colors disabled:opacity-50 flex items-center gap-1.5 whitespace-nowrap"
                >
                    {isSavingToken ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
                    {API_SERVICE.BUTTONS.SAVE_TOKEN}
                </button>
                <button
                    type="button"
                    onClick={handleTest}
                    disabled={isTesting || !hasToken}
                    className="px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-green-600 rounded-lg text-sm text-green-400 hover:text-green-300 transition-colors disabled:opacity-50 flex items-center gap-1.5 whitespace-nowrap"
                >
                    {isTesting ? <Loader2 size={14} className="animate-spin" /> : <Wifi size={14} />}
                    {API_SERVICE.BUTTONS.TEST}
                </button>
            </div>
            {notice && (
                <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${notice.ok
                    ? 'bg-green-900/30 border border-green-700/50 text-green-300'
                    : 'bg-red-900/30 border border-red-700/50 text-red-300'
                }`}>
                    {notice.ok ? <CheckCircle size={14} /> : <WifiOff size={14} />}
                    {notice.text}
                </div>
            )}
            {subscription && (
                <div className="px-3 py-2 rounded-lg bg-gray-800/60 border border-gray-700">
                    <SubscriptionSummary subscription={subscription} uiCatalog={uiCatalog} />
                </div>
            )}
            <p className="text-xs text-gray-500">{API_SERVICE.HELP.TOKEN_HOWTO}</p>
            <p className="text-xs text-gray-500">{API_SERVICE.HELP.TOKEN_STORED}</p>
        </div>
    );
};

/** 残高の再取得ボタン付きの小さな表示（左メニュー用。取得は親が行う） */
export const BalanceRefreshButton: React.FC<{ onClick: () => void; loading: boolean; label: string }> = ({ onClick, loading, label }) => (
    <button
        type="button"
        onClick={onClick}
        disabled={loading}
        className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-green-300 transition-colors disabled:opacity-50"
    >
        {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
        {label}
    </button>
);
