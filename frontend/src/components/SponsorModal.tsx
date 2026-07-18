/**
 * SponsorModal.tsx - 支援者機能（entitlement）の管理モーダル
 *
 * GitHub ログインでの支援者トークン取得、支援状態の表示、手動更新、ログアウトを提供する。
 * 状態の正本は backend gate（署名検証）で、ここは /api/sponsor/* の結果を表示するだけ。
 * トークン値そのものはフロントへ来ない（state と tier 等のスナップショットのみ）。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Download, ExternalLink, Heart, LogOut, RefreshCw, X } from 'lucide-react';
import {
    MODULE_ACTION_CHOICE,
    fetchModulesStatus,
    fetchSponsorStatus,
    installModule,
    refreshSponsorToken,
    sponsorLogout,
    startSponsorLogin,
    type ModuleStatusEntry,
    type SponsorStatus,
} from '../api/sponsor';
import { getGlobalSettings, updateGlobalSettings } from '../api/global-settings';
import type { EntitlementState } from '../api/system';
import { resolveMessage, type I18NCatalog } from '../api/i18n';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    backendUrl: string;
    uiCatalog?: I18NCatalog | null;
}

// 状態別のバッジ色（SystemDiagnosticsModal の STATUS_CLASSES と同系統）。
const STATE_CLASSES: Record<EntitlementState, string> = {
    valid: 'border-emerald-800 bg-emerald-950/30 text-emerald-300',
    grace: 'border-amber-800 bg-amber-950/30 text-amber-300',
    none: 'border-gray-700 bg-gray-800 text-gray-400',
    expired: 'border-red-800 bg-red-950/30 text-red-300',
    invalid: 'border-red-800 bg-red-950/30 text-red-300',
};

const STATE_FALLBACK_JA: Record<EntitlementState, string> = {
    none: '未認証（free）',
    valid: '有効',
    grace: '更新待ち（猶予期間中）',
    expired: '失効',
    invalid: '無効なトークン',
};

// ログイン完了待ちポーリングの間隔と上限（backend 側リスナーは 5 分でタイムアウト）。
const LOGIN_POLL_INTERVAL_MS = 2000;
const LOGIN_POLL_LIMIT_MS = 5 * 60 * 1000;

// モジュールID → 表示名（i18nキーとJAフォールバック）。
const MODULE_LABELS: Record<string, { key: string; fallback: string }> = {
    comfy: { key: 'sponsor.module.name.comfy', fallback: 'ComfyUI 連携モジュール（画像生成）' },
    actionchoice: { key: 'sponsor.module.name.actionchoice', fallback: '行動選択肢モジュール' },
};

export const SponsorModal: React.FC<Props> = ({ isOpen, onClose, backendUrl, uiCatalog = null }) => {
    const [status, setStatus] = useState<SponsorStatus | null>(null);
    const [authUrl, setAuthUrl] = useState<string | null>(null);
    const [isBusy, setIsBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [modules, setModules] = useState<ModuleStatusEntry[]>([]);
    const [installingId, setInstallingId] = useState<string | null>(null);
    const [installNotice, setInstallNotice] = useState<string | null>(null);
    // 行動選択肢の機能ON/OFF（globalsettings featureToggles.actionChoice。既定 true）。
    const [actionChoiceEnabled, setActionChoiceEnabled] = useState(true);
    const [isTogglingChoice, setIsTogglingChoice] = useState(false);
    const pollTimer = useRef<number | null>(null);

    const t = useCallback((key: string, fallback: string) => (
        resolveMessage(uiCatalog, key, fallback)
    ), [uiCatalog]);

    const stopPolling = useCallback(() => {
        if (pollTimer.current !== null) {
            window.clearInterval(pollTimer.current);
            pollTimer.current = null;
        }
    }, []);

    const load = useCallback(async () => {
        try {
            const next = await fetchSponsorStatus(backendUrl);
            setStatus(next);
            // モジュール状態・機能トグルは付随情報。取得失敗しても支援状態の表示は続ける。
            try {
                setModules(await fetchModulesStatus(backendUrl));
            } catch {
                setModules([]);
            }
            try {
                const settings = await getGlobalSettings(backendUrl);
                const toggles = (settings.featureToggles ?? {}) as Record<string, boolean>;
                // 既定は有効（明示 false のときだけ OFF。backend 判定と同じ規則）。
                setActionChoiceEnabled(toggles['actionChoice'] !== false);
            } catch {
                setActionChoiceEnabled(true);
            }
            return next;
        } catch {
            setError(t('systemDiagnostics.fetchError', '診断情報の取得に失敗しました。'));
            return null;
        }
    }, [backendUrl, t]);

    useEffect(() => {
        if (!isOpen) {
            stopPolling();
            setAuthUrl(null);
            setError(null);
            setInstallNotice(null);
            return;
        }
        void load();
        return stopPolling;
    }, [isOpen, load, stopPolling]);

    // モジュールの取得・配置。成功したら再起動が必要な旨を表示する。
    const handleInstallModule = async (moduleId: string) => {
        setInstallingId(moduleId);
        setError(null);
        setInstallNotice(null);
        try {
            const result = await installModule(backendUrl, moduleId);
            setModules(result.modules ?? []);
            setInstallNotice(t('sponsor.module.installedNotice', 'モジュールを配置しました。AlSlime を再起動すると有効になります。'));
        } catch (err: unknown) {
            const key = (err as { response?: { data?: { messageKey?: string } } })?.response?.data?.messageKey;
            setError(t(key || 'error.sponsorModuleInstallFailed', 'モジュールの取得・配置に失敗しました。接続を確認して再試行してください。'));
        } finally {
            setInstallingId(null);
        }
    };

    // 行動選択肢の機能ON/OFF切替（featureToggles へマージ保存。再起動不要で即反映）。
    const handleToggleActionChoice = async () => {
        const next = !actionChoiceEnabled;
        setIsTogglingChoice(true);
        setError(null);
        try {
            const settings = await getGlobalSettings(backendUrl);
            const toggles = { ...((settings.featureToggles ?? {}) as Record<string, boolean>), actionChoice: next };
            const ok = await updateGlobalSettings(backendUrl, { featureToggles: toggles });
            if (ok) {
                setActionChoiceEnabled(next);
            } else {
                setError(t('sponsor.module.toggleFailed', '設定の保存に失敗しました。'));
            }
        } finally {
            setIsTogglingChoice(false);
        }
    };

    // ログイン開始 → ブラウザで認可 URL を開き、完了（loginPending 解除）までポーリング。
    const handleLogin = async () => {
        setIsBusy(true);
        setError(null);
        setAuthUrl(null);
        try {
            const { authUrl: nextUrl } = await startSponsorLogin(backendUrl);
            setAuthUrl(nextUrl);
            // ポップアップブロック時に備え、リンクも画面に残す（下の「開かない場合」導線）。
            window.open(nextUrl, '_blank', 'noopener');
            const startedAt = Date.now();
            stopPolling();
            pollTimer.current = window.setInterval(async () => {
                const next = await load();
                const finished = next !== null && !next.loginPending;
                if (finished || Date.now() - startedAt > LOGIN_POLL_LIMIT_MS) {
                    stopPolling();
                    setAuthUrl(null);
                    setIsBusy(false);
                }
            }, LOGIN_POLL_INTERVAL_MS);
        } catch {
            setError(t('sponsor.error.server_error', 'サーバーでエラーが発生しました。時間をおいて再試行してください。'));
            setIsBusy(false);
        }
    };

    const handleLogout = async () => {
        setIsBusy(true);
        setError(null);
        try {
            setStatus(await sponsorLogout(backendUrl));
        } catch {
            setError(t('sponsor.error.server_error', 'サーバーでエラーが発生しました。時間をおいて再試行してください。'));
        } finally {
            setIsBusy(false);
        }
    };

    const handleRefresh = async () => {
        setIsBusy(true);
        setError(null);
        try {
            setStatus(await refreshSponsorToken(backendUrl));
        } catch (err: unknown) {
            // backend は messageKey を返す。未知の失敗は汎用文言へ丸める。
            const key = (err as { response?: { data?: { messageKey?: string } } })?.response?.data?.messageKey;
            setError(t(key || 'error.sponsorRefreshFailed', 'トークンの更新に失敗しました。接続を確認して再試行してください。'));
        } finally {
            setIsBusy(false);
        }
    };

    if (!isOpen) return null;

    const state: EntitlementState = status?.entitlement.state ?? 'none';
    const stateLabel = t(`entitlement.state.${state}`, STATE_FALLBACK_JA[state] ?? state);
    const tier = status?.entitlement.tier;
    const hasToken = state === 'valid' || state === 'grace' || state === 'expired' || state === 'invalid';
    const expiresAt = status?.entitlement.expiresAt;
    const loginPending = status?.loginPending ?? false;
    const lastLoginError = status?.lastLoginError;
    // モジュール取得は supporter 以上・有効（grace 含む）トークンのときだけ見せる。
    const canUseModule = (state === 'valid' || state === 'grace') &&
        (tier === 'supporter' || tier === 'plus');
    const moduleStateLabel = (entry: ModuleStatusEntry) => entry.installed
        ? (entry.active
            ? t('sponsor.module.sidecarActive', '有効（サイドカー動作中）')
            : t('sponsor.module.restartRequired', '配置済み（再起動後に有効になります）'))
        : t('sponsor.module.notInstalled', '未配置');
    const moduleLabel = (id: string) => {
        const label = MODULE_LABELS[id];
        return label ? t(label.key, label.fallback) : id;
    };

    return (
        <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-md border border-gray-700 overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 bg-gray-800">
                    <div className="flex items-center gap-2">
                        <Heart size={18} className="text-pink-400" />
                        <h3 className="font-semibold text-gray-100 text-base">{t('sponsor.title', '支援者機能')}</h3>
                    </div>
                    <button onClick={onClose} className="p-1.5 hover:bg-gray-700 rounded text-gray-400 hover:text-gray-200 transition-colors">
                        <X size={18} />
                    </button>
                </div>

                <div className="p-5 space-y-4">
                    <p className="text-sm text-gray-400">
                        {t('sponsor.description', 'GitHub Sponsors で支援中のアカウントでログインすると、支援者向け機能が有効になります。')}
                    </p>

                    <div className="flex items-center gap-3 rounded border border-gray-700 bg-gray-800/60 px-3 py-3">
                        <span className={`shrink-0 rounded border px-2 py-0.5 text-xs ${STATE_CLASSES[state]}`}>
                            {stateLabel}
                        </span>
                        {tier && <span className="text-sm text-gray-200">{tier}</span>}
                        {expiresAt ? (
                            <span className="ml-auto text-xs text-gray-500">
                                〜{new Date(expiresAt * 1000).toLocaleDateString()}
                            </span>
                        ) : null}
                    </div>

                    {canUseModule && modules.map((entry) => (
                        <div key={entry.id} className="rounded border border-gray-700 bg-gray-800/60 px-3 py-3 space-y-2">
                            <div className="flex items-center gap-2">
                                <span className="text-sm text-gray-200">{moduleLabel(entry.id)}</span>
                                <span className="ml-auto text-xs text-gray-400">{moduleStateLabel(entry)}</span>
                            </div>
                            {!entry.active && (
                                <button
                                    onClick={() => handleInstallModule(entry.id)}
                                    disabled={installingId !== null}
                                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-800 hover:bg-gray-700 border border-emerald-700 rounded-lg text-sm text-gray-300 hover:text-emerald-300 transition-colors disabled:opacity-50"
                                >
                                    <Download size={16} />
                                    {installingId === entry.id
                                        ? t('sponsor.module.downloading', 'ダウンロード中...')
                                        : t('sponsor.module.download', 'モジュールをダウンロード')}
                                </button>
                            )}
                            {entry.id === MODULE_ACTION_CHOICE && entry.installed && (
                                <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer select-none">
                                    <input
                                        type="checkbox"
                                        checked={actionChoiceEnabled}
                                        onChange={handleToggleActionChoice}
                                        disabled={isTogglingChoice}
                                        className="accent-emerald-500"
                                    />
                                    {t('sponsor.module.actionChoiceToggle', '行動選択肢を有効にする（再起動不要で反映）')}
                                </label>
                            )}
                        </div>
                    ))}
                    {canUseModule && installNotice && (
                        <p className="text-sm text-emerald-300 bg-emerald-950/30 border border-emerald-900/50 rounded px-3 py-2">
                            {installNotice}
                        </p>
                    )}

                    {error && (
                        <p className="text-sm text-red-300 bg-red-950/30 border border-red-900/50 rounded px-3 py-2">{error}</p>
                    )}
                    {!error && lastLoginError && (
                        <p className="text-sm text-amber-300 bg-amber-950/30 border border-amber-900/50 rounded px-3 py-2">
                            {t(`sponsor.error.${lastLoginError}`, 'ログインに失敗しました。')}
                        </p>
                    )}

                    {loginPending && (
                        <div className="text-sm text-cyan-300">
                            {t('sponsor.loginPending', 'ブラウザでログインを完了してください...')}
                            {authUrl && (
                                <a
                                    href={authUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="ml-2 inline-flex items-center gap-1 text-cyan-400 underline"
                                >
                                    <ExternalLink size={12} />
                                    {t('sponsor.openManually', '開かない場合はこちら')}
                                </a>
                            )}
                        </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <button
                            onClick={handleLogin}
                            disabled={isBusy && !loginPending}
                            className="flex items-center justify-center gap-2 px-4 py-3 bg-gray-800 hover:bg-gray-700 border border-pink-700 rounded-lg text-sm text-gray-300 hover:text-pink-300 transition-colors disabled:opacity-50"
                        >
                            <ExternalLink size={16} />
                            {t('sponsor.login', 'GitHub でログイン')}
                        </button>
                        {hasToken && (
                            <button
                                onClick={handleRefresh}
                                disabled={isBusy}
                                className="flex items-center justify-center gap-2 px-4 py-3 bg-gray-800 hover:bg-gray-700 border border-cyan-700 rounded-lg text-sm text-gray-300 hover:text-cyan-300 transition-colors disabled:opacity-50"
                            >
                                <RefreshCw size={16} />
                                {t('sponsor.refresh', '状態を更新')}
                            </button>
                        )}
                        {hasToken && (
                            <button
                                onClick={handleLogout}
                                disabled={isBusy}
                                className="flex items-center justify-center gap-2 px-4 py-3 bg-gray-800 hover:bg-red-900/30 border border-gray-600 hover:border-red-800 rounded-lg text-sm text-gray-300 hover:text-red-400 transition-colors disabled:opacity-50"
                            >
                                <LogOut size={16} />
                                {t('sponsor.logout', 'ログアウト')}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
