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
    MODULE_TTS,
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
import { DEFAULT_UI_LANGUAGE, SPONSOR_MODULE_LABELS } from '../constants/i18n';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    backendUrl: string;
    uiCatalog?: I18NCatalog | null;
    // 表示言語（TTSは日本語専用のため、日本語以外では取得導線を出さない。要件4章）。
    uiLanguage?: string;
    // モジュール配置状態の変化を親へ伝える（会話設定の画像生成設定欄など、
    // モーダル外の表示条件を画面更新なしで追随させる）。
    onModulesChanged?: (modules: ModuleStatusEntry[]) => void;
    /** 設定画面に埋め込む（外枠・見出し・閉じるを出さない。isOpen は true で渡す） */
    embedded?: boolean;
}

// 状態別のバッジ色（SystemDiagnosticsModal の STATUS_CLASSES と同系統）。
const STATE_CLASSES: Record<EntitlementState, string> = {
    valid: 'border-line-strong bg-ok/10 text-ok',
    grace: 'border-warn/40 bg-warn/10 text-warn',
    none: 'border-line-strong bg-surface text-fg-muted',
    expired: 'border-danger/40 bg-danger/10 text-danger',
    invalid: 'border-danger/40 bg-danger/10 text-danger',
};

const STATE_FALLBACK_JA: Record<EntitlementState, string> = {
    none: '未ログイン',
    valid: '有効',
    grace: '更新待ち（猶予期間中）',
    expired: '失効',
    invalid: '無効なトークン',
};

// ログイン完了待ちのローカル状態確認間隔。ログイン期限はサーバー応答へ追随する。
const LOGIN_POLL_INTERVAL_MS = 2000;

// GitHub Sponsors の支援ページ（「支援者になる」ボタンの飛び先）。
const SPONSOR_URL = 'https://github.com/sponsors/Yaki-Mikan';


export const SponsorModal: React.FC<Props> = ({ isOpen, onClose, backendUrl, uiCatalog = null, uiLanguage, onModulesChanged, embedded = false }) => {
    const [status, setStatus] = useState<SponsorStatus | null>(null);
    const [authUrl, setAuthUrl] = useState<string | null>(null);
    const [loginExpiresAt, setLoginExpiresAt] = useState<string | null>(null);
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
    // 親の知らせ先は親の再描画のたびに作り直される。load の依存に入れると、
    // load → 知らせ → 親の再描画 → load の作り直し → 再読み込み、が止まらなくなるため、
    // 最新の知らせ先を ref に置き、load からは ref 経由で呼ぶ。
    const onModulesChangedRef = useRef(onModulesChanged);
    onModulesChangedRef.current = onModulesChanged;

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
                const nextModules = await fetchModulesStatus(backendUrl);
                setModules(nextModules);
                onModulesChangedRef.current?.(nextModules);
            } catch {
                // 取得失敗はモーダル内の表示だけ空にする（親の表示条件は既存値を保持）。
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
            setLoginExpiresAt(null);
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
            onModulesChanged?.(result.modules ?? []);
            // 最新版を配置し終えたので「更新あり」表示を消す（次回の確認で再判定される）。
            setModuleUpdates((prev) => {
                const next = { ...prev };
                delete next[moduleId];
                return next;
            });
            if (result.companionPackConfigured && !result.companionPackInstalled) {
                setError(t(
                    'sponsor.module.companionPackFailed',
                    'モジュールは配置しましたが、付属ファイルの取得・配置に失敗しました。再度ダウンロードしてください。'
                ));
            } else {
                const restartNotice = result.sidecarRestarted
                    ? (result.firstInstall
                        ? t(
                            'sponsor.module.installedStarted',
                            'モジュールを配置し、サイドカーを起動して有効化しました。'
                        )
                        : t(
                            'update.module.updatedRestarted',
                            '更新が完了し、サイドカーを再起動して有効化しました。'
                        ))
                    : t(
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
            const result = await cleanModule(backendUrl, moduleId, true);
            setInstallNotice(result.sidecarRestarted
                ? t(
                    'sponsor.module.clean.doneRestarted',
                    'クリーン再導入が完了し、サイドカーを再起動して有効化しました。'
                )
                : t(
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
            '次の配布物を削除し、最新版を再インストールします。対象：{{targets}}。同名のテンプレートを編集している場合、その変更内容も削除されます。この操作を実行しますか？'
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
            const { authUrl: nextUrl, expiresAt: nextExpiresAt } = await startSponsorLogin(backendUrl);
            setAuthUrl(nextUrl);
            setLoginExpiresAt(nextExpiresAt);
            // ポップアップブロック時に備え、リンクも画面に残す（下の「開かない場合」導線）。
            window.open(nextUrl, '_blank', 'noopener');
            stopPolling();
            pollTimer.current = window.setInterval(async () => {
                const next = await load();
                const finished = next !== null && !next.loginPending;
                if (finished) {
                    stopPolling();
                    setAuthUrl(null);
                    setLoginExpiresAt(null);
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
            // 機能フラグが変わる操作のため、モジュール状態と併せて親の表示条件も追随させる。
            void load();
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
            // 失効からの復帰などで機能フラグが変わり得るため、親の表示条件も追随させる。
            void load();
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
        ? 'border-line-strong bg-accent-soft text-accent'
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
        const label = SPONSOR_MODULE_LABELS[id];
        return label ? t(label.key, label.fallback) : id;
    };

    const body = (
        <div className={embedded ? 'space-y-4' : 'p-5 space-y-4'}>
            <p className="text-sm text-fg-muted">
                {t('sponsor.description', 'GitHub Sponsors で支援中のアカウントでログインすると、支援者向け機能が有効になります。')}
            </p>

            {status?.notice && (
                <div className="rounded border border-line-strong bg-accent-soft px-3 py-2">
                    <p className="text-xs text-accent mb-1">
                        {t('sponsor.notice.title', '開発者からのお知らせ')}
                    </p>
                    <p className="text-sm text-fg whitespace-pre-wrap">{status.notice}</p>
                </div>
            )}

            <div className="flex items-center gap-3 rounded border border-line-strong bg-surface px-3 py-3">
                <span className={`shrink-0 rounded border px-2 py-0.5 text-xs ${badgeClass}`}>
                    {stateLabel}
                </span>
                {tier && <span className="text-sm text-fg">{tier}</span>}
                {expiresAt ? (
                    <span className="ml-auto text-xs text-fg-muted">
                        〜{new Date(expiresAt * 1000).toLocaleDateString()}
                    </span>
                ) : null}
            </div>

            {canUseModule && modules
                // TTS は日本語専用のため、日本語以外の表示言語では取得導線を出さない（要件4章）。
                .filter((entry) => entry.id !== MODULE_TTS || (uiLanguage || DEFAULT_UI_LANGUAGE) === 'ja')
                .map((entry) => (
                <div key={entry.id} className="rounded border border-line-strong bg-surface px-3 py-3 space-y-2">
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-fg">{moduleLabel(entry.id)}</span>
                        <span className="ml-auto text-xs text-fg-muted">{moduleStateLabel(entry)}</span>
                    </div>
                    {entry.id === MODULE_TTS && (
                        <>
                            <p className="text-xs text-fg-muted">
                                {t('sponsor.tts.noticeExternal', 'Irodori-TTS-Serverは外部ツールです。ご自身での構築・起動が必要です。')}
                            </p>
                            <p className="text-xs text-fg-muted">
                                {t('sponsor.tts.noticeGpu', 'GPU の使用を推奨します。必要な VRAM 容量をご確認ください。VRAM 容量が少ない環境向けには量子化版が用意されています。')}
                            </p>
                            <p className="text-xs text-fg-muted">
                                {t('sponsor.tts.noticeVramConflict', '画像生成（ComfyUI）と同時に使用すると、両方の処理が VRAM を使用するため、メモリ不足になる場合があります。')}
                            </p>
                            <p className="text-xs text-fg-muted">
                                {t('sponsor.tts.noticeEthics', '音声モデルの倫理的制約として、無断の音声クローン・なりすまし・ディープフェイクへの使用は禁止されています。')}
                            </p>
                        </>
                    )}
                    {moduleUpdates[entry.id]?.hasUpdate && (
                        <p className="text-xs text-warn">
                            {t('update.module.updateAvailable', '更新あり（{{version}}）')
                                .split('{{version}}').join(moduleUpdates[entry.id].latestVersion)}
                        </p>
                    )}
                    {!moduleUpdates[entry.id]?.hasUpdate && moduleUpdates[entry.id]?.companionPackUpdate && (
                        <p className="text-xs text-warn">
                            {t('update.module.companionPackUpdate', 'サンプルワークフローに更新があります')}
                        </p>
                    )}
                    {moduleUpdates[entry.id]?.needsAppUpdate && (
                        <p className="text-xs text-danger">
                            {t('update.module.needsAppUpdate', '先に AlSlime 本体の更新が必要です')}
                        </p>
                    )}
                    {moduleUpdates[entry.id]?.incompatible && (
                        <p className="text-xs text-danger">
                            {t('update.module.incompatible', 'このモジュールは現在の AlSlime 本体・環境に対応していません')}
                        </p>
                    )}
                    {entry.active && !moduleUpdates[entry.id]?.needsAppUpdate && !moduleUpdates[entry.id]?.incompatible &&
                        (moduleUpdates[entry.id]?.hasUpdate || moduleUpdates[entry.id]?.companionPackUpdate) && (
                        <button
                            onClick={() => handleInstallModule(entry.id)}
                            disabled={installingId !== null}
                            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-surface hover:bg-surface-2 border border-warn/40 rounded-lg text-sm text-fg-muted hover:text-warn transition-colors disabled:opacity-50"
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
                            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-surface hover:bg-surface-2 border border-line-strong rounded-lg text-sm text-fg-muted hover:text-ok transition-colors disabled:opacity-50"
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
                            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-surface hover:bg-danger/10 border border-line-strong hover:border-danger/40 rounded-lg text-xs text-fg-muted hover:text-danger transition-colors disabled:opacity-50"
                        >
                            <Trash2 size={14} />
                            {t('sponsor.module.cleanButton', 'クリーン再導入')}
                        </button>
                    )}
                    {entry.id === MODULE_ACTION_CHOICE && entry.installed && (
                        <label className="flex items-center gap-2 text-sm text-fg-muted cursor-pointer select-none">
                            <input
                                type="checkbox"
                                checked={actionChoiceEnabled}
                                onChange={handleToggleActionChoice}
                                disabled={isTogglingChoice}
                                className="accent-accent"
                            />
                            {t('sponsor.module.actionChoiceToggle', '行動選択肢を有効にする（再起動不要で反映）')}
                        </label>
                    )}
                </div>
            ))}
            {canUseModule && installNotice && (
                <p className="text-sm text-ok bg-ok/10 border border-line-strong rounded px-3 py-2">
                    {installNotice}
                </p>
            )}

            {error && (
                <p className="text-sm text-danger bg-danger/10 border border-danger/40 rounded px-3 py-2">{error}</p>
            )}
            {!error && lastLoginError && (
                <p className="text-sm text-warn bg-warn/10 border border-warn/40 rounded px-3 py-2">
                    {t(`sponsor.error.${lastLoginError}`, 'ログインに失敗しました。')}
                </p>
            )}
            {!error && !lastLoginError && loginedAsFree && !loginPending && (
                <p className="text-sm text-accent bg-accent-soft border border-line-strong rounded px-3 py-2">
                    {t('sponsor.loginedAsFree', 'GitHub ログインに成功しました。支援すると支援者向け機能が有効になります。')}
                </p>
            )}

            {loginPending && (
                <div className="space-y-2 rounded border border-line-strong bg-accent-soft px-3 py-3 text-sm text-accent">
                    <p>{t('sponsor.loginPending', 'ブラウザでログインを完了してください...')}</p>
                    {loginExpiresAt && (
                        <p className="text-xs text-fg-muted">
                            {t('sponsor.loginExpires', 'ログイン期限')}: {new Date(loginExpiresAt).toLocaleTimeString()}
                        </p>
                    )}
                    {authUrl && (
                        <a
                            href={authUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ml-2 inline-flex items-center gap-1 text-accent underline"
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
                    className="flex items-center justify-center gap-2 px-4 py-3 bg-accent-soft hover:bg-accent-soft border border-accent rounded-lg text-sm text-accent hover:text-fg transition-colors"
                >
                    <Heart size={16} />
                    {t('sponsor.becomeSponsor', '支援者になる')}
                </button>
                <button
                    onClick={handleLogin}
                    disabled={isBusy && !loginPending}
                    className="flex items-center justify-center gap-2 px-4 py-3 bg-surface hover:bg-surface-2 border border-line-strong rounded-lg text-sm text-fg-muted hover:text-accent transition-colors disabled:opacity-50"
                >
                    <ExternalLink size={16} />
                    {t('sponsor.login', 'GitHub でログイン')}
                </button>
                {hasToken && (
                    <button
                        onClick={handleRefresh}
                        disabled={isBusy}
                        className="flex items-center justify-center gap-2 px-4 py-3 bg-surface hover:bg-surface-2 border border-line-strong rounded-lg text-sm text-fg-muted hover:text-accent transition-colors disabled:opacity-50"
                    >
                        <RefreshCw size={16} />
                        {t('sponsor.refresh', '状態を更新')}
                    </button>
                )}
                {hasToken && (
                    <button
                        onClick={handleLogout}
                        disabled={isBusy}
                        className="flex items-center justify-center gap-2 px-4 py-3 bg-surface hover:bg-danger/10 border border-line-strong hover:border-danger/40 rounded-lg text-sm text-fg-muted hover:text-danger transition-colors disabled:opacity-50"
                    >
                        <LogOut size={16} />
                        {t('sponsor.logout', 'ログアウト')}
                    </button>
                )}
            </div>
        </div>
    );

    // クリーン再導入の確認（削除対象を明示してから実行。01番 7章）
    const cleanConfirm = (
        <ConfirmDialog
            isOpen={cleanTarget !== null}
            title={t('sponsor.module.clean.title', 'クリーン再導入の確認')}
            message={cleanConfirmMessage()}
            onYes={handleCleanConfirm}
            onNo={() => setCleanTarget(null)}
            onCancel={() => setCleanTarget(null)}
            uiCatalog={uiCatalog}
        />
    );

    // 設定画面に埋め込むときは、外枠と見出しを付けずに中身だけを出す
    if (embedded) {
        return (
            <>
                {body}
                {cleanConfirm}
            </>
        );
    }

    return (
        <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="bg-surface-solid rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] border border-line-strong overflow-y-auto custom-scrollbar">
                <div className="flex items-center justify-between px-5 py-4 border-b border-line-strong bg-surface">
                    <div className="flex items-center gap-2">
                        <Heart size={18} className="text-accent" />
                        <h3 className="font-semibold text-fg text-base">{t('sponsor.title', '支援者機能')}</h3>
                    </div>
                    <button onClick={onClose} className="p-1.5 hover:bg-surface-2 rounded text-fg-muted hover:text-fg transition-colors">
                        <X size={18} />
                    </button>
                </div>

                {body}
            </div>

            {cleanConfirm}
        </div>
    );
};
