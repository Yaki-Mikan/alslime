import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { resolveMessage, type I18NCatalog } from '../api/i18n';
import {
    applyUpdate,
    fetchUpdateApplyStatus,
    saveUpdateSettings,
    type AppUpdateInfo,
    type ModuleUpdateEntry,
    type UpdateApplyStatus,
} from '../api/update';
import { installModule, type ModuleStatusEntry } from '../api/sponsor';
import { SPONSOR_MODULE_LABELS, UPDATE_I18N_KEYS, UPDATE_TEXT_FALLBACK_JA } from '../constants/i18n';

// UpdateModal は本体とサイドカーモジュールの更新を 1 画面に統合した更新告知モーダル
// （起動時チェック・手動更新確認の両方から表示。ファイル自動更新、確認 01番 9章）。
//
// - modules は更新のあるモジュールのみを親が絞り込んで渡す（更新の無いモジュールは
//   カード・更新ボタンとも表示されず、一括全更新の対象にもならない）。
// - 「一括全更新」: 今の本体のまま適用できるモジュールをその場で更新（サイドカー
//   再起動込み）→ 本体更新が先に必要なモジュールを承認として記録 → 本体を更新。
//   承認済み分は本体更新後の起動時にバックエンドが一度だけ適用する。
// - 「本体のみを更新」: 既存の本体直接アップデートのみ（モジュール更新が無い場合の
//   ラベルは従来どおり「今すぐ更新」）。
// - モジュールカード内の「更新」: 当該モジュールのみ取得・配置・サイドカー再起動。
// - 本体更新が無い（app=null）場合はモジュールのみの表示となり、フッターは「閉じる」。
interface UpdateModalProps {
    isOpen: boolean;
    // app は本体更新の告知対象（本体の告知を出さない場合は null）。
    app: AppUpdateInfo | null;
    // modules は更新のあるモジュールのみ（hasUpdate または companionPackUpdate）。
    modules: ModuleUpdateEntry[];
    uiCatalog: I18NCatalog | null;
    backendUrl: string;
    onLater: () => void;
    onSkip: () => void;
    // モジュール配置状態の変化を親へ中継する（SponsorModal と同じ契約。
    // これが無いと配置後も Chat 側の表示条件が古いままになる）。
    onModulesChanged?: (modules: ModuleStatusEntry[]) => void;
}

const STATUS_POLL_MS = 1000;
// ポーリングの上限（約3分。超過後は reloadHint の案内表示のまま静かに打ち切る）。
const STATUS_POLL_MAX_TRIES = 180;

// 'modules' は一括全更新の先頭で行うモジュール適用フェーズ（本体 apply の前段）。
type ApplyUIPhase = UpdateApplyStatus['phase'] | 'modules';

type ModuleOutcome = 'restarted' | 'restartRequired';

export const UpdateModal = ({ isOpen, app, modules, uiCatalog, backendUrl, onLater, onSkip, onModulesChanged }: UpdateModalProps) => {
    const [phase, setPhase] = useState<ApplyUIPhase>('idle');
    const [percent, setPercent] = useState(0);
    const [errorKey, setErrorKey] = useState<string | null>(null);
    const [reconnectTimedOut, setReconnectTimedOut] = useState(false);
    const timerRef = useRef<number | null>(null);
    // モジュール個別更新の進行と結果（ID 引き）。
    const [installingId, setInstallingId] = useState<string | null>(null);
    const [moduleOutcomes, setModuleOutcomes] = useState<Record<string, ModuleOutcome>>({});
    const [moduleErrors, setModuleErrors] = useState<Record<string, string>>({});

    const stopPolling = () => {
        if (timerRef.current !== null) {
            window.clearInterval(timerRef.current);
            timerRef.current = null;
        }
    };
    useEffect(() => stopPolling, []);

    // 閉じたらモジュール更新の結果表示をリセットする（再表示時に古い結果を残さない）。
    useEffect(() => {
        if (!isOpen) {
            setModuleOutcomes({});
            setModuleErrors({});
        }
    }, [isOpen]);

    if (!isOpen || (!app && modules.length === 0)) {
        return null;
    }
    const t = (key: string, fallback?: string) =>
        resolveMessage(uiCatalog, key, fallback ?? UPDATE_TEXT_FALLBACK_JA[key] ?? key);
    const moduleLabel = (id: string) => {
        const label = SPONSOR_MODULE_LABELS[id];
        return label ? t(label.key, label.fallback) : id;
    };
    const applying = phase === 'modules' || phase === 'downloading' || phase === 'verifying'
        || phase === 'staging' || phase === 'restarting';
    const busy = applying || installingId !== null;

    // 未更新のモジュールのうち、今の本体のまま適用できるもの／本体更新が先に必要なもの。
    const pendingModules = modules.filter((m) => !moduleOutcomes[m.id]);
    const updatableNow = pendingModules.filter((m) => !m.needsAppUpdate && !m.incompatible);
    const approveTargets = pendingModules.filter((m) => m.needsAppUpdate && !m.incompatible);

    const openReleasePage = () => {
        if (app?.notesUrl) {
            window.open(app.notesUrl, '_blank', 'noopener,noreferrer');
        }
        onLater();
    };

    // 1 モジュールの取得・配置・サイドカー再起動。結果・エラーはカード内に表示する。
    const handleInstallOne = async (moduleId: string) => {
        setInstallingId(moduleId);
        setModuleErrors((prev) => {
            const next = { ...prev };
            delete next[moduleId];
            return next;
        });
        try {
            const result = await installModule(backendUrl, moduleId);
            setModuleOutcomes((prev) => ({
                ...prev,
                [moduleId]: result.sidecarRestarted ? 'restarted' : 'restartRequired',
            }));
            onModulesChanged?.(result.modules ?? []);
        } catch (err: unknown) {
            const key = (err as { response?: { data?: { messageKey?: string } } })?.response?.data?.messageKey;
            setModuleErrors((prev) => ({
                ...prev,
                [moduleId]: t(key || 'error.sponsorModuleInstallFailed', 'モジュールの取得・配置に失敗しました。接続を確認して再試行してください。'),
            }));
        } finally {
            setInstallingId(null);
        }
    };

    // 進捗と復帰検知を status ポーリング一本で行う（制御の契約は交換日記 002）。
    //
    // 復帰判定は「応答した status.current が更新先バージョン（app.latest）に
    // 変わったか」で行う。graceful shutdown 中の旧プロセスが Keep-Alive 接続で
    // 応答してくる期間があるため、phase や疎通の成否だけでは新旧を決定的に
    // 区別できない。接続断（shutdown〜新プロセス listen までの間）は表示だけ
    // 再起動中にしてポーリングを続ける。
    const startStatusPolling = (latest: string) => {
        stopPolling();
        let tries = 0;
        timerRef.current = window.setInterval(async () => {
            tries += 1;
            if (tries > STATUS_POLL_MAX_TRIES) {
                stopPolling();
                setReconnectTimedOut(true);
                return;
            }
            try {
                const status = await fetchUpdateApplyStatus(backendUrl);
                if (status.current && latest && status.current === latest) {
                    // 更新先バージョンのプロセスが応答した ＝ 更新完了。
                    stopPolling();
                    window.location.reload();
                    return;
                }
                if (status.phase === 'error') {
                    stopPolling();
                    setPhase('error');
                    setErrorKey(status.messageKey || 'error.updateApplyFailed');
                    return;
                }
                if (status.phase !== 'idle') {
                    setPhase(status.phase);
                    setPercent(status.percent);
                }
                // idle（開始 POST が処理される前の旧プロセス）は表示を変えず継続。
            } catch {
                // 再起動中の接続断。表示を切り替えてポーリングを続ける。
                setPhase('restarting');
            }
        }, STATUS_POLL_MS);
    };

    // クリック直後に UI をロックし、開始 POST と進捗ポーリングを独立に走らせる。
    // POST の完了を UI 更新・監視開始の前提にしない（202 応答の直後にサーバーが
    // 再起動へ進むため、応答を受け取れず pending になり得る。交換日記 002）。
    const startAppApply = () => {
        if (!app) return;
        setPhase('downloading');
        setPercent(0);
        startStatusPolling(app.latest);
        applyUpdate(backendUrl).catch((err) => {
            // サーバーが明示的に拒否した場合（messageKey 付き 4xx/409）のみ
            // エラー表示に切り替える。応答を受け損ねただけ（タイムアウト・
            // 接続断）なら更新は進んでいる可能性があるため、ポーリングに任せる。
            const key = (err as { response?: { data?: { messageKey?: string } } })?.response?.data?.messageKey;
            if (key) {
                stopPolling();
                setPhase('error');
                setErrorKey(key);
            }
        });
    };

    const handleApplyAppOnly = () => {
        setErrorKey(null);
        setReconnectTimedOut(false);
        startAppApply();
    };

    // 一括全更新: 適用できるモジュールをその場で更新 → 本体更新が先に必要な分を
    // 承認として記録 → 本体の直接アップデート。
    const handleUpdateAll = async () => {
        setErrorKey(null);
        setReconnectTimedOut(false);
        setPhase('modules');
        for (const entry of updatableNow) {
            // 逐次適用（配置とサイドカー再起動はサーバー側で排他されるため並列にしない）。
            // 個別の失敗はカード内表示のうえ続行する（本体更新後の告知で再度更新できる）。
            await handleInstallOne(entry.id);
        }
        if (approveTargets.length > 0) {
            try {
                await saveUpdateSettings(backendUrl, {
                    approveModuleUpdates: approveTargets.map((entry) => entry.id),
                });
            } catch {
                // 記録に失敗しても本体更新は続行する（残り分は本体更新後の通常告知に任せる）。
            }
        }
        startAppApply();
    };

    const phaseLabel = (): string => {
        switch (phase) {
            case 'modules':
                return t(UPDATE_I18N_KEYS.applyModules);
            case 'downloading':
                return `${t(UPDATE_I18N_KEYS.applyDownloading)} ${percent}%`;
            case 'verifying':
                return t(UPDATE_I18N_KEYS.applyVerifying);
            case 'staging':
                return t(UPDATE_I18N_KEYS.applyStaging);
            case 'restarting':
                return t(UPDATE_I18N_KEYS.applyRestarting);
            default:
                return '';
        }
    };

    return (
        <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
            onClick={busy ? undefined : onLater}
        >
            <div
                className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-md border border-gray-700 overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="px-5 py-4 border-b border-gray-700">
                    <h2 className="text-lg font-semibold text-gray-100">
                        {app ? t(UPDATE_I18N_KEYS.modalTitle) : t(UPDATE_I18N_KEYS.moduleModalTitle)}
                    </h2>
                </div>
                <div className="px-5 py-4 space-y-3 max-h-[65vh] overflow-y-auto">
                    {app && (
                        <>
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-gray-400">{t(UPDATE_I18N_KEYS.currentLabel)}</span>
                                <span className="text-gray-200 font-mono">{app.current}</span>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-gray-400">{t(UPDATE_I18N_KEYS.latestLabel)}</span>
                                <span className="text-emerald-400 font-mono font-semibold">{app.latest}</span>
                            </div>
                            {app.notes && !applying && (
                                <div className="text-xs text-gray-300 bg-gray-800/60 border border-gray-700 rounded-lg p-3 max-h-40 overflow-y-auto whitespace-pre-wrap">
                                    {app.notes}
                                </div>
                            )}
                        </>
                    )}
                    {modules.map((entry) => (
                        <div key={entry.id} className="rounded border border-gray-700 bg-gray-800/60 px-3 py-3 space-y-2">
                            <div className="text-sm text-gray-200">{moduleLabel(entry.id)}</div>
                            {entry.hasUpdate && (
                                <p className="text-xs text-amber-300">
                                    {t(UPDATE_I18N_KEYS.moduleUpdateAvailable)
                                        .split('{{version}}').join(entry.latestVersion)}
                                </p>
                            )}
                            {!entry.hasUpdate && entry.companionPackUpdate && (
                                <p className="text-xs text-amber-300">{t(UPDATE_I18N_KEYS.moduleCompanionPackUpdate)}</p>
                            )}
                            {entry.needsAppUpdate && (
                                <p className="text-xs text-red-300">{t(UPDATE_I18N_KEYS.moduleNeedsAppUpdate)}</p>
                            )}
                            {entry.incompatible && (
                                <p className="text-xs text-red-300">{t(UPDATE_I18N_KEYS.moduleIncompatible)}</p>
                            )}
                            {moduleOutcomes[entry.id] === 'restarted' && (
                                <p className="text-xs text-emerald-400">{t(UPDATE_I18N_KEYS.moduleUpdatedRestarted)}</p>
                            )}
                            {moduleOutcomes[entry.id] === 'restartRequired' && (
                                <p className="text-xs text-emerald-400">{t(UPDATE_I18N_KEYS.moduleUpdatedRestartRequired)}</p>
                            )}
                            {moduleErrors[entry.id] && (
                                <p className="text-xs text-red-300">{moduleErrors[entry.id]}</p>
                            )}
                            {!moduleOutcomes[entry.id] && !entry.needsAppUpdate && !entry.incompatible && (
                                <button
                                    type="button"
                                    onClick={() => handleInstallOne(entry.id)}
                                    disabled={busy}
                                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-amber-700 rounded-lg text-sm text-gray-300 hover:text-amber-300 transition-colors disabled:opacity-50"
                                >
                                    <Download size={16} />
                                    {installingId === entry.id
                                        ? t('sponsor.module.downloading', 'ダウンロード中...')
                                        : t(UPDATE_I18N_KEYS.moduleUpdateButton)}
                                </button>
                            )}
                        </div>
                    ))}
                    {applying && (
                        <div className="space-y-2">
                            <div className="text-sm text-gray-200">{phaseLabel()}</div>
                            <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
                                <div
                                    className={`h-full bg-emerald-500 transition-all ${phase === 'downloading' ? '' : 'animate-pulse w-full'}`}
                                    style={phase === 'downloading' ? { width: `${percent}%` } : undefined}
                                />
                            </div>
                            {(phase === 'restarting' || reconnectTimedOut) && (
                                <div className="text-xs text-gray-400">{t(UPDATE_I18N_KEYS.applyReloadHint)}</div>
                            )}
                        </div>
                    )}
                    {errorKey && (
                        <div className="text-xs text-red-300 bg-red-900/30 border border-red-800 rounded-lg p-3">
                            {t(errorKey)}
                        </div>
                    )}
                </div>
                <div className="px-5 py-4 border-t border-gray-700 space-y-2">
                    {app?.canApply && modules.length > 0 && (
                        <button
                            type="button"
                            onClick={handleUpdateAll}
                            disabled={busy}
                            className="w-full px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium"
                        >
                            {t(UPDATE_I18N_KEYS.updateAll)}
                        </button>
                    )}
                    {app?.canApply && (
                        <button
                            type="button"
                            onClick={handleApplyAppOnly}
                            disabled={busy}
                            className={`w-full px-4 py-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed text-sm ${
                                modules.length > 0
                                    ? 'bg-gray-700 hover:bg-gray-600 text-gray-200'
                                    : 'bg-emerald-600 hover:bg-emerald-500 text-white font-medium'
                            }`}
                        >
                            {modules.length > 0 ? t(UPDATE_I18N_KEYS.appOnly) : t(UPDATE_I18N_KEYS.applyNow)}
                        </button>
                    )}
                    {app && (
                        <button
                            type="button"
                            onClick={openReleasePage}
                            disabled={busy}
                            className={`w-full px-4 py-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed text-sm ${
                                app.canApply
                                    ? 'bg-gray-700 hover:bg-gray-600 text-gray-200'
                                    : 'bg-emerald-600 hover:bg-emerald-500 text-white font-medium'
                            }`}
                        >
                            {t(UPDATE_I18N_KEYS.open)}
                        </button>
                    )}
                    {app ? (
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={onLater}
                                disabled={busy}
                                className="flex-1 px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-gray-200 text-sm"
                            >
                                {t(UPDATE_I18N_KEYS.later)}
                            </button>
                            <button
                                type="button"
                                onClick={onSkip}
                                disabled={busy}
                                className="flex-1 px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed text-gray-400 text-sm border border-gray-700"
                            >
                                {t(UPDATE_I18N_KEYS.skip)}
                            </button>
                        </div>
                    ) : (
                        <button
                            type="button"
                            onClick={onLater}
                            disabled={busy}
                            className="w-full px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-gray-200 text-sm"
                        >
                            {t(UPDATE_I18N_KEYS.moduleClose)}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};
