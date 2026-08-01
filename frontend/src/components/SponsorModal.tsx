/**
 * SponsorModal.tsx - 支援者機能（entitlement）の管理モーダル
 *
 * GitHub ログインでの支援者トークン取得、支援状態の表示、手動更新、ログアウトを提供する。
 * 状態の正本は backend gate（署名検証）で、ここは /api/sponsor/* の結果を表示するだけ。
 * トークン値そのものはフロントへ来ない（state と tier 等のスナップショットのみ）。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Download, ExternalLink, Heart, LogOut, RefreshCw, Trash2, X } from 'lucide-react';
import { downloadComfyUITemplate } from '../api/comfyui';
import {
    MODULE_ACTION_CHOICE,
    MODULE_COMFY,
    cleanModule,
    fetchCleanPreview,
    fetchModulesStatus,
    fetchSponsorStatus,
    installModule,
    refreshSponsorToken,
    sponsorLogout,
    startSponsorLogin,
    type CleanPreview,
    type ModuleStatusEntry,
    type SponsorStatus,
} from '../api/sponsor';
import { ConfirmDialog } from './ConfirmDialog';
import { getGlobalSettings, updateGlobalSettings } from '../api/global-settings';
import type { EntitlementState } from '../api/system';
import { resolveMessage, type I18NCatalog } from '../api/i18n';
import { fetchUpdateCheck, type ModuleUpdateEntry } from '../api/update';

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
    none: '未ログイン',
    valid: '有効',
    grace: '更新待ち（猶予期間中）',
    expired: '失効',
    invalid: '無効なトークン',
};

// ログイン完了待ちポーリングの間隔と上限（backend 側リスナーは 5 分でタイムアウト）。
const LOGIN_POLL_INTERVAL_MS = 2000;
const LOGIN_POLL_LIMIT_MS = 5 * 60 * 1000;

// GitHub Sponsors の支援ページ（「支援者になる」ボタンの飛び先）。
const SPONSOR_URL = 'https://github.com/sponsors/Yaki-Mikan';

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
    // モジュールの更新有無（/api/update/check の modules 部。ID 引き。01番 9章）
    const [moduleUpdates, setModuleUpdates] = useState<Record<string, ModuleUpdateEntry>>({});
    const [installingId, setInstallingId] = useState<string | null>(null);
    const [installNotice, setInstallNotice] = useState<string | null>(null);
    // クリーン再導入の確認対象（null 以外で ConfirmDialog を表示。01番 7章）
    const [cleanTarget, setCleanTarget] = useState<CleanPreview | null>(null);
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
                const check = await fetchUpdateCheck(backendUrl);
                const byId: Record<string, ModuleUpdateEntry> = {};
                for (const entry of check.modules) {
                    byId[entry.id] = entry;
                }
                setModuleUpdates(byId);
            } catch {
                setModuleUpdates({});
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
            if (result.companionPackConfigured && !result.companionPackInstalled) {
                setError(t(
                    'sponsor.module.companionPackFailed',
                    'モジュールは配置しましたが、付属ファイルの取得・配置に失敗しました。再度ダウンロードしてください。'
                ));
            } else {
                const restartNotice = t(
                    'sponsor.module.installedNotice',
                    'モジュールを配置しました。AlSlime を再起動すると有効になります。'
                );
                const workflowTemplates = moduleId === MODULE_COMFY && result.companionPackInstalled
                    ? (result.companionPackWorkflowTemplates ?? []).filter((name) => name.trim() !== '')
                    : [];

                if (workflowTemplates.length === 0) {
                    setInstallNotice(restartNotice);
                } else {
                    const failedTemplates: string[] = [];
                    for (const templateName of workflowTemplates) {
                        try {
                            await downloadComfyUITemplate(backendUrl, templateName);
                        } catch {
                            // 1件の失敗で残りの自動保存を中断しない。
                            failedTemplates.push(templateName);
                        }
                    }

                    const successCount = workflowTemplates.length - failedTemplates.length;
                    const formatResult = (message: string) => message
                        .replace('{success}', String(successCount))
                        .replace('{total}', String(workflowTemplates.length))
                        .replace('{names}', failedTemplates.join(', '));

                    if (failedTemplates.length === 0) {
                        const downloadNotice = formatResult(t(
                            'sponsor.module.workflowDownloadAllSucceeded',
                            '付属ワークフローをブラウザへ保存しました（{success}/{total}件）。'
                        ));
                        setInstallNotice(`${restartNotice} ${downloadNotice}`);
                    } else {
                        setInstallNotice(restartNotice);
                        const resultKey = successCount > 0
                            ? 'sponsor.module.workflowDownloadPartiallyFailed'
                            : 'sponsor.module.workflowDownloadAllFailed';
                        const fallback = successCount > 0
                            ? '付属ワークフローのブラウザ保存は一部失敗しました（成功 {success}/{total}件）。失敗: {names}。画像生成設定のダウンロードアイコンから再取得できます。'
                            : '付属ワークフローをブラウザへ保存できませんでした（{total}件）。失敗: {names}。画像生成設定のダウンロードアイコンから再取得してください。';
                        setError(formatResult(t(resultKey, fallback)));
                    }
                }
            }
        } catch (err: unknown) {
            const key = (err as { response?: { data?: { messageKey?: string } } })?.response?.data?.messageKey;
            setError(t(key || 'error.sponsorModuleInstallFailed', 'モジュールの取得・配置に失敗しました。接続を確認して再試行してください。'));
        } finally {
            setInstallingId(null);
        }
    };

    // クリーン再導入（01番 7章）: 削除対象のプレビューを取ってから確認モーダルを出す。
    const handleRequestClean = async (moduleId: string) => {
        setError(null);
        setInstallNotice(null);
        try {
            setCleanTarget(await fetchCleanPreview(backendUrl, moduleId));
        } catch (err: unknown) {
            const key = (err as { response?: { data?: { messageKey?: string } } })?.response?.data?.messageKey;
            setError(t(key || 'error.sponsorModuleCleanFailed', 'クリーン再導入に失敗しました。'));
        }
    };

    const handleCleanConfirm = async () => {
        if (!cleanTarget) return;
        const moduleId = cleanTarget.id;
        setCleanTarget(null);
        setInstallingId(moduleId);
        try {
            await cleanModule(backendUrl, moduleId, true);
            setInstallNotice(t(
                'sponsor.module.clean.done',
                'クリーン再導入が完了しました。反映には AlSlime の再起動が必要です。'
            ));
            void load();
        } catch (err: unknown) {
            const key = (err as { response?: { data?: { messageKey?: string } } })?.response?.data?.messageKey;
            setError(t(key || 'error.sponsorModuleCleanFailed', 'クリーン再導入に失敗しました。'));
        } finally {
            setInstallingId(null);
        }
    };

    // 確認モーダルの本文（削除対象を「、」区切りで埋め込む。ConfirmDialog は単一文字列のみ）。
    const cleanConfirmMessage = (): string => {
        if (!cleanTarget) return '';
        const targets: string[] = [];
        if (cleanTarget.exeInstalled) {
            targets.push(t('sponsor.module.clean.targetExe', 'モジュール本体'));
        }
        if (cleanTarget.workflowTemplates.length > 0) {
            targets.push(t('sponsor.module.clean.targetTemplates', 'サンプルワークフロー（{{names}}）')
                .split('{{names}}').join(cleanTarget.workflowTemplates.join(', ')));
        }
        let message = t(
            'sponsor.module.clean.message',
            '配布物を削除して最新版を入れ直します。対象: {{targets}}。同名テンプレートを編集していた場合、その内容も削除されます。よろしいですか？'
        ).split('{{targets}}').join(targets.join('、'));
        if (!cleanTarget.receiptFound) {
            message += ` ${t('sponsor.module.clean.noReceipt', '配置記録が無いため、テンプレートは削除されません。')}`;
        }
        return message;
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
    // GitHub 認証成功・有効な支援なし（Free ログイン成功）。失敗ではないので肯定的に見せる。
    const loginedAsFree = status?.loginedAsFree ?? false;
    // state=none は「トークン無し＝free 動作」。Free ログイン済みなら未ログインと区別して見せる。
    const badgeIsFreePlan = state === 'none' && loginedAsFree;
    const stateLabel = badgeIsFreePlan
        ? t('entitlement.badge.freePlan', 'Free プラン')
        : t(`entitlement.state.${state}`, STATE_FALLBACK_JA[state] ?? state);
    const badgeClass = badgeIsFreePlan
        ? 'border-sky-800 bg-sky-950/30 text-sky-300'
        : STATE_CLASSES[state];
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

                    {status?.notice && (
                        <div className="rounded border border-cyan-900/50 bg-cyan-950/30 px-3 py-2">
                            <p className="text-xs text-cyan-400 mb-1">
                                {t('sponsor.notice.title', '開発者からのお知らせ')}
                            </p>
                            <p className="text-sm text-cyan-100 whitespace-pre-wrap">{status.notice}</p>
                        </div>
                    )}

                    <div className="flex items-center gap-3 rounded border border-gray-700 bg-gray-800/60 px-3 py-3">
                        <span className={`shrink-0 rounded border px-2 py-0.5 text-xs ${badgeClass}`}>
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
                            {moduleUpdates[entry.id]?.hasUpdate && (
                                <p className="text-xs text-amber-300">
                                    {t('update.module.updateAvailable', '更新あり（{{version}}）')
                                        .split('{{version}}').join(moduleUpdates[entry.id].latestVersion)}
                                </p>
                            )}
                            {!moduleUpdates[entry.id]?.hasUpdate && moduleUpdates[entry.id]?.companionPackUpdate && (
                                <p className="text-xs text-amber-300">
                                    {t('update.module.companionPackUpdate', 'サンプルワークフローに更新があります')}
                                </p>
                            )}
                            {moduleUpdates[entry.id]?.needsAppUpdate && (
                                <p className="text-xs text-red-300">
                                    {t('update.module.needsAppUpdate', '先に AlSlime 本体の更新が必要です')}
                                </p>
                            )}
                            {moduleUpdates[entry.id]?.incompatible && (
                                <p className="text-xs text-red-300">
                                    {t('update.module.incompatible', 'このモジュールは現在の AlSlime 本体・環境に対応していません')}
                                </p>
                            )}
                            {entry.active && !moduleUpdates[entry.id]?.needsAppUpdate && !moduleUpdates[entry.id]?.incompatible &&
                                (moduleUpdates[entry.id]?.hasUpdate || moduleUpdates[entry.id]?.companionPackUpdate) && (
                                <button
                                    onClick={() => handleInstallModule(entry.id)}
                                    disabled={installingId !== null}
                                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-800 hover:bg-gray-700 border border-amber-700 rounded-lg text-sm text-gray-300 hover:text-amber-300 transition-colors disabled:opacity-50"
                                >
                                    <Download size={16} />
                                    {installingId === entry.id
                                        ? t('sponsor.module.downloading', 'ダウンロード中...')
                                        : t('update.module.updateButton', '更新')}
                                </button>
                            )}
                            {!entry.active && (
                                <button
                                    onClick={() => handleInstallModule(entry.id)}
                                    disabled={installingId !== null
                                        || moduleUpdates[entry.id]?.needsAppUpdate
                                        || moduleUpdates[entry.id]?.incompatible}
                                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-800 hover:bg-gray-700 border border-emerald-700 rounded-lg text-sm text-gray-300 hover:text-emerald-300 transition-colors disabled:opacity-50"
                                >
                                    <Download size={16} />
                                    {installingId === entry.id
                                        ? t('sponsor.module.downloading', 'ダウンロード中...')
                                        : t('sponsor.module.download', 'モジュールをダウンロード')}
                                </button>
                            )}
                            {entry.installed && (
                                <button
                                    onClick={() => handleRequestClean(entry.id)}
                                    disabled={installingId !== null
                                        || moduleUpdates[entry.id]?.needsAppUpdate
                                        || moduleUpdates[entry.id]?.incompatible}
                                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-gray-800 hover:bg-red-900/30 border border-gray-600 hover:border-red-800 rounded-lg text-xs text-gray-400 hover:text-red-300 transition-colors disabled:opacity-50"
                                >
                                    <Trash2 size={14} />
                                    {t('sponsor.module.cleanButton', 'クリーン再導入')}
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
                    {!error && !lastLoginError && loginedAsFree && !loginPending && (
                        <p className="text-sm text-sky-300 bg-sky-950/30 border border-sky-900/50 rounded px-3 py-2">
                            {t('sponsor.loginedAsFree', 'GitHub ログインに成功しました。支援すると支援者向け機能が有効になります。')}
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
                            onClick={() => window.open(SPONSOR_URL, '_blank', 'noopener')}
                            className="flex items-center justify-center gap-2 px-4 py-3 bg-pink-900/30 hover:bg-pink-900/50 border border-pink-600 rounded-lg text-sm text-pink-300 hover:text-pink-200 transition-colors"
                        >
                            <Heart size={16} />
                            {t('sponsor.becomeSponsor', '支援者になる')}
                        </button>
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

            {/* クリーン再導入の確認（削除対象を明示してから実行。01番 7章） */}
            <ConfirmDialog
                isOpen={cleanTarget !== null}
                title={t('sponsor.module.clean.title', 'クリーン再導入の確認')}
                message={cleanConfirmMessage()}
                onYes={handleCleanConfirm}
                onNo={() => setCleanTarget(null)}
                onCancel={() => setCleanTarget(null)}
                uiCatalog={uiCatalog}
            />
        </div>
    );
};
