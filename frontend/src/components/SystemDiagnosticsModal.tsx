/**
 * SystemDiagnosticsModal.tsx - 配布版の自己診断モーダル
 *
 * WORKSPACE_ROOT、支援状態（entitlement）、CLI 検出、設定 JSON 破損を読み取り専用で表示する。
 * 認証情報や絶対パスをフロント側で広げないため、backend が返す安全化済み情報だけを描画する。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, RefreshCw, X } from 'lucide-react';
import {
    fetchSystemDiagnostics,
    scanSystemConfig,
    type AuthStatus,
    type CheckStatus,
    type DiagnosticsResponse,
    type EntitlementStatus,
} from '../api/system';
import { DEFAULT_UI_LANGUAGE, SYSTEM_DIAGNOSTICS_I18N_KEYS, SYSTEM_DIAGNOSTICS_TEXT_FALLBACK_JA } from '../constants/i18n';
import { fetchI18NCatalog, resolveMessage, type I18NCatalog } from '../api/i18n';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    backendUrl: string;
    uiLanguage?: string;
    // 親（Chat/SettingsModal）が保持する保存済み言語の UI 辞書。
    // 表示言語が同じなら専用カタログを再取得しない（重複fetch回避。04調査 低#9）。
    uiCatalog?: I18NCatalog | null;
}

const STATUS_LABEL_KEYS: Record<CheckStatus, string> = {
    ok: SYSTEM_DIAGNOSTICS_I18N_KEYS.statusOk,
    warning: SYSTEM_DIAGNOSTICS_I18N_KEYS.statusWarning,
    error: SYSTEM_DIAGNOSTICS_I18N_KEYS.statusError,
    disabled: SYSTEM_DIAGNOSTICS_I18N_KEYS.statusDisabled,
    unknown: SYSTEM_DIAGNOSTICS_I18N_KEYS.statusUnknown,
};

const statusFallback = (status: CheckStatus): string => (
    SYSTEM_DIAGNOSTICS_TEXT_FALLBACK_JA[STATUS_LABEL_KEYS[status] ?? STATUS_LABEL_KEYS.unknown]
    ?? SYSTEM_DIAGNOSTICS_TEXT_FALLBACK_JA[SYSTEM_DIAGNOSTICS_I18N_KEYS.statusUnknown]
);

const STATUS_CLASSES: Record<CheckStatus, string> = {
    ok: 'border-emerald-800 bg-emerald-950/30 text-emerald-300',
    warning: 'border-amber-800 bg-amber-950/30 text-amber-300',
    error: 'border-red-800 bg-red-950/30 text-red-300',
    disabled: 'border-gray-700 bg-gray-800 text-gray-400',
    unknown: 'border-slate-700 bg-slate-900 text-slate-300',
};

const formatBytes = (bytes: number): string => {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex++;
    }
    return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const StatusBadge: React.FC<{ status: CheckStatus; label: string }> = ({ status, label }) => (
    <span className={`shrink-0 rounded border px-2 py-0.5 text-xs ${STATUS_CLASSES[status] ?? STATUS_CLASSES.unknown}`}>
        {label}
    </span>
);

// 認証状態は発見（存在）とは別軸で示す。ok=認証済み / missing=未認証 / unknown=判定不能。
const AUTH_STATUS_CLASSES: Record<AuthStatus, string> = {
    ok: STATUS_CLASSES.ok,
    missing: STATUS_CLASSES.warning,
    unknown: STATUS_CLASSES.unknown,
};

const AUTH_LABEL_KEYS: Record<AuthStatus, string> = {
    ok: SYSTEM_DIAGNOSTICS_I18N_KEYS.authOk,
    missing: SYSTEM_DIAGNOSTICS_I18N_KEYS.authMissing,
    unknown: SYSTEM_DIAGNOSTICS_I18N_KEYS.authUnknown,
};

const AuthBadge: React.FC<{ status: AuthStatus; label: string }> = ({ status, label }) => (
    <span className={`shrink-0 rounded border px-2 py-0.5 text-xs ${AUTH_STATUS_CLASSES[status] ?? AUTH_STATUS_CLASSES.unknown}`}>
        {label}
    </span>
);

export const SystemDiagnosticsModal: React.FC<Props> = ({ isOpen, onClose, backendUrl, uiLanguage, uiCatalog = null }) => {
    const [diagnostics, setDiagnostics] = useState<DiagnosticsResponse | null>(null);
    const [catalog, setCatalog] = useState<I18NCatalog | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isScanning, setIsScanning] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const lang = uiLanguage || DEFAULT_UI_LANGUAGE;

    const t = useMemo(() => {
        return (key: string | undefined, fallback: string) => {
            if (!key) return fallback;
            // 専用カタログ未取得（初回load失敗等）でも、親の辞書があればそちらで解決する。
            return resolveMessage(catalog ?? uiCatalog, key, fallback || key);
        };
    }, [catalog, uiCatalog]);

    const statusLabel = useCallback((status: CheckStatus) => (
        t(STATUS_LABEL_KEYS[status] ?? STATUS_LABEL_KEYS.unknown, statusFallback(status))
    ), [t]);

    const authLabel = useCallback((status: AuthStatus) => {
        const key = AUTH_LABEL_KEYS[status] ?? AUTH_LABEL_KEYS.unknown;
        return t(key, SYSTEM_DIAGNOSTICS_TEXT_FALLBACK_JA[key] ?? '');
    }, [t]);

    // 支援状態の表示値。valid / grace のときだけ tier 名を併記する（backend が
    // 失効・不正トークンの中身を返さない仕様と対応）。
    const entitlementValue = useCallback((ent: EntitlementStatus | undefined) => {
        const state = ent?.state ?? 'none';
        const fallback: Record<string, string> = {
            none: '未認証（free）',
            valid: '有効',
            grace: '更新待ち（猶予期間中）',
            expired: '失効',
            invalid: '無効なトークン',
        };
        const label = t(`entitlement.state.${state}`, fallback[state] ?? state);
        return ent?.tier ? `${label} (${ent.tier})` : label;
    }, [t]);

    const load = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            // 表示言語が親の辞書と同じなら再取得せず流用する（未保存プレビュー時のみfetch）。
            const catalogPromise: Promise<I18NCatalog> = (uiCatalog && uiCatalog.lang === lang)
                ? Promise.resolve(uiCatalog)
                : fetchI18NCatalog(backendUrl, lang);
            const [nextDiagnostics, nextCatalog] = await Promise.all([
                fetchSystemDiagnostics(backendUrl),
                catalogPromise,
            ]);
            setDiagnostics(nextDiagnostics);
            setCatalog(nextCatalog);
        } catch {
            setError(t(SYSTEM_DIAGNOSTICS_I18N_KEYS.fetchError, SYSTEM_DIAGNOSTICS_TEXT_FALLBACK_JA[SYSTEM_DIAGNOSTICS_I18N_KEYS.fetchError]));
        } finally {
            setIsLoading(false);
        }
        // t はcatalog由来のため依存に含めない（load失敗時の文言だけが対象で、無限再生成を避ける）。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [backendUrl, lang, uiCatalog]);

    useEffect(() => {
        if (!isOpen) return;
        void load();
    }, [isOpen, load]);

    const handleScan = async () => {
        setIsScanning(true);
        setError(null);
        try {
            const configCheck = await scanSystemConfig(backendUrl);
            setDiagnostics(prev => prev ? {
                ...prev,
                configCheck,
                status: configCheck.status === 'error' ? 'error' : prev.status,
            } : prev);
        } catch {
            setError(t(SYSTEM_DIAGNOSTICS_I18N_KEYS.scanError, SYSTEM_DIAGNOSTICS_TEXT_FALLBACK_JA[SYSTEM_DIAGNOSTICS_I18N_KEYS.scanError]));
        } finally {
            setIsScanning(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-3xl border border-gray-700 overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 bg-gray-800">
                    <div className="flex items-center gap-2">
                        <Activity size={18} className="text-cyan-400" />
                        <h3 className="font-semibold text-gray-100 text-base">{t(SYSTEM_DIAGNOSTICS_I18N_KEYS.title, SYSTEM_DIAGNOSTICS_TEXT_FALLBACK_JA[SYSTEM_DIAGNOSTICS_I18N_KEYS.title])}</h3>
                        {diagnostics && <StatusBadge status={diagnostics.status} label={statusLabel(diagnostics.status)} />}
                    </div>
                    <button onClick={onClose} className="p-1.5 hover:bg-gray-700 rounded text-gray-400 hover:text-gray-200 transition-colors">
                        <X size={18} />
                    </button>
                </div>

                <div className="p-5 space-y-5 max-h-[72vh] overflow-y-auto custom-scrollbar">
                    {error && (
                        <p className="text-sm text-red-300 bg-red-950/30 border border-red-900/50 rounded px-3 py-2">{error}</p>
                    )}

                    {isLoading && !diagnostics ? (
                        <p className="text-sm text-gray-400">{t(SYSTEM_DIAGNOSTICS_I18N_KEYS.loading, SYSTEM_DIAGNOSTICS_TEXT_FALLBACK_JA[SYSTEM_DIAGNOSTICS_I18N_KEYS.loading])}</p>
                    ) : diagnostics ? (
                        <>
                            <section className="space-y-2">
                                <h4 className="text-sm font-medium text-gray-300">{t(SYSTEM_DIAGNOSTICS_I18N_KEYS.buildInfo, SYSTEM_DIAGNOSTICS_TEXT_FALLBACK_JA[SYSTEM_DIAGNOSTICS_I18N_KEYS.buildInfo])}</h4>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-gray-300">
                                    <InfoCell label={t(SYSTEM_DIAGNOSTICS_I18N_KEYS.version, SYSTEM_DIAGNOSTICS_TEXT_FALLBACK_JA[SYSTEM_DIAGNOSTICS_I18N_KEYS.version])} value={diagnostics.health.version} />
                                    <InfoCell label={t('systemDiagnostics.label.entitlement', '支援状態')} value={entitlementValue(diagnostics.health.entitlement)} />
                                    <InfoCell label={t(SYSTEM_DIAGNOSTICS_I18N_KEYS.build, SYSTEM_DIAGNOSTICS_TEXT_FALLBACK_JA[SYSTEM_DIAGNOSTICS_I18N_KEYS.build])} value={diagnostics.health.buildMode} />
                                    <InfoCell label={t(SYSTEM_DIAGNOSTICS_I18N_KEYS.platform, SYSTEM_DIAGNOSTICS_TEXT_FALLBACK_JA[SYSTEM_DIAGNOSTICS_I18N_KEYS.platform])} value={`${diagnostics.health.os}/${diagnostics.health.arch}`} />
                                    <InfoCell label={t(SYSTEM_DIAGNOSTICS_I18N_KEYS.bind, SYSTEM_DIAGNOSTICS_TEXT_FALLBACK_JA[SYSTEM_DIAGNOSTICS_I18N_KEYS.bind])} value={diagnostics.health.host} />
                                    <InfoCell label={t(SYSTEM_DIAGNOSTICS_I18N_KEYS.port, SYSTEM_DIAGNOSTICS_TEXT_FALLBACK_JA[SYSTEM_DIAGNOSTICS_I18N_KEYS.port])} value={String(diagnostics.health.port)} />
                                </div>
                                <p className="text-xs text-gray-500 break-all">
                                    {t('systemDiagnostics.label.workspaceRoot', 'WORKSPACE_ROOT')}: {diagnostics.health.workspaceRoot}
                                </p>
                            </section>

                            <section className="space-y-2">
                                <h4 className="text-sm font-medium text-gray-300">{t(SYSTEM_DIAGNOSTICS_I18N_KEYS.cliStatus, SYSTEM_DIAGNOSTICS_TEXT_FALLBACK_JA[SYSTEM_DIAGNOSTICS_I18N_KEYS.cliStatus])}</h4>
                                <div className="space-y-2">
                                    {diagnostics.cliStatus.clis.map(cli => (
                                        <div key={cli.id} className="flex items-start gap-3 rounded border border-gray-700 bg-gray-800/60 px-3 py-2">
                                            <div className="flex shrink-0 flex-col gap-1">
                                                <StatusBadge status={cli.status} label={statusLabel(cli.status)} />
                                                <AuthBadge status={cli.authStatus} label={authLabel(cli.authStatus)} />
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-sm text-gray-200">{cli.label}</p>
                                                <p className="text-xs text-gray-400">{t(cli.messageKey, cli.messageKey)}</p>
                                                {cli.authMessageKey ? (
                                                    <p className="text-xs text-amber-400/80">{t(cli.authMessageKey, cli.authMessageKey)}</p>
                                                ) : null}
                                                <p className="text-xs text-gray-600 break-all">{cli.command}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <p className="text-xs text-gray-500">
                                    {t(SYSTEM_DIAGNOSTICS_I18N_KEYS.cliLoginHint, SYSTEM_DIAGNOSTICS_TEXT_FALLBACK_JA[SYSTEM_DIAGNOSTICS_I18N_KEYS.cliLoginHint])}
                                </p>
                            </section>

                            <section className="space-y-2">
                                <div className="flex items-center justify-between gap-3">
                                    <h4 className="text-sm font-medium text-gray-300">{t(SYSTEM_DIAGNOSTICS_I18N_KEYS.configFiles, SYSTEM_DIAGNOSTICS_TEXT_FALLBACK_JA[SYSTEM_DIAGNOSTICS_I18N_KEYS.configFiles])}</h4>
                                    <button
                                        onClick={handleScan}
                                        disabled={isScanning}
                                        className="inline-flex items-center gap-1.5 rounded border border-gray-600 bg-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700 disabled:opacity-50"
                                    >
                                        <RefreshCw size={13} className={isScanning ? 'animate-spin' : ''} />
                                        {t(SYSTEM_DIAGNOSTICS_I18N_KEYS.rescan, SYSTEM_DIAGNOSTICS_TEXT_FALLBACK_JA[SYSTEM_DIAGNOSTICS_I18N_KEYS.rescan])}
                                    </button>
                                </div>
                                <div className="space-y-1">
                                    {diagnostics.configCheck.files.slice(0, 16).map(file => (
                                        <div key={`${file.locationId}:${file.path}`} className="flex items-start gap-3 rounded border border-gray-800 bg-gray-950/40 px-3 py-2">
                                            <StatusBadge status={file.status} label={statusLabel(file.status)} />
                                            <div className="min-w-0">
                                                <p className="text-xs text-gray-300">{file.locationId}</p>
                                                <p className="text-xs text-gray-500 break-all">{file.path}</p>
                                                <p className="text-xs text-gray-500">{t(file.messageKey, file.messageKey || '')}</p>
                                            </div>
                                        </div>
                                    ))}
                                    {diagnostics.configCheck.files.length > 16 && (
                                        <p className="text-xs text-gray-500">
                                            {t(SYSTEM_DIAGNOSTICS_I18N_KEYS.moreFilesPrefix, SYSTEM_DIAGNOSTICS_TEXT_FALLBACK_JA[SYSTEM_DIAGNOSTICS_I18N_KEYS.moreFilesPrefix])} {diagnostics.configCheck.files.length - 16} {t(SYSTEM_DIAGNOSTICS_I18N_KEYS.moreFilesSuffix, SYSTEM_DIAGNOSTICS_TEXT_FALLBACK_JA[SYSTEM_DIAGNOSTICS_I18N_KEYS.moreFilesSuffix])}
                                        </p>
                                    )}
                                </div>
                            </section>

                            <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <InfoPanel
                                    title={t(SYSTEM_DIAGNOSTICS_I18N_KEYS.cache, SYSTEM_DIAGNOSTICS_TEXT_FALLBACK_JA[SYSTEM_DIAGNOSTICS_I18N_KEYS.cache])}
                                    status={diagnostics.cache.status}
                                    statusLabel={statusLabel(diagnostics.cache.status)}
                                    message={t(diagnostics.cache.messageKey, diagnostics.cache.messageKey)}
                                    detail={`${diagnostics.cache.fileCount} ${t('systemDiagnostics.filesUnit', 'files')} / ${formatBytes(diagnostics.cache.sizeBytes)}`}
                                />
                                <InfoPanel
                                    title={t(SYSTEM_DIAGNOSTICS_I18N_KEYS.backups, SYSTEM_DIAGNOSTICS_TEXT_FALLBACK_JA[SYSTEM_DIAGNOSTICS_I18N_KEYS.backups])}
                                    status={diagnostics.backups.status}
                                    statusLabel={statusLabel(diagnostics.backups.status)}
                                    message={t(diagnostics.backups.messageKey, diagnostics.backups.messageKey)}
                                    detail={`${diagnostics.backups.backups.length} ${t('systemDiagnostics.archivesUnit', 'archives')}`}
                                />
                            </section>
                        </>
                    ) : null}
                </div>
            </div>
        </div>
    );
};

const InfoCell: React.FC<{ label: string; value: string }> = ({ label, value }) => (
    <div className="rounded border border-gray-800 bg-gray-950/50 px-3 py-2">
        <p className="text-gray-500">{label}</p>
        <p className="truncate text-gray-200">{value}</p>
    </div>
);

const InfoPanel: React.FC<{ title: string; status: CheckStatus; statusLabel: string; message: string; detail: string }> = ({
    title,
    status,
    statusLabel,
    message,
    detail,
}) => (
    <div className="rounded border border-gray-800 bg-gray-950/40 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-medium text-gray-300">{title}</h4>
            <StatusBadge status={status} label={statusLabel} />
        </div>
        <p className="mt-1 text-xs text-gray-400">{message}</p>
        <p className="mt-1 text-xs text-gray-600">{detail}</p>
    </div>
);
