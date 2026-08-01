import { useEffect, useRef, useState } from 'react';
import { resolveMessage, type I18NCatalog } from '../api/i18n';
import {
    applyUpdate,
    fetchUpdateApplyStatus,
    type AppUpdateInfo,
    type UpdateApplyStatus,
} from '../api/update';
import { UPDATE_I18N_KEYS, UPDATE_TEXT_FALLBACK_JA } from '../constants/i18n';

// UpdateModal は起動時の更新告知モーダル（ファイル自動更新、確認 01番 9章）。
// 「後で」は当日中の再表示を抑止（postponeToday）、「このバージョンの告知をスキップ」は
// skippedVersion を保存してより新しい版が出るまで表示しない。
// canApply のリリース（固定名 exe ＋ SHA256SUMS.txt の新形式）では「今すぐ更新」で
// 直接アップデートを実行し、進捗ポーリング → 再起動 → 復帰検知で自動リロードする。
interface UpdateModalProps {
    isOpen: boolean;
    app: AppUpdateInfo | null;
    uiCatalog: I18NCatalog | null;
    backendUrl: string;
    onLater: () => void;
    onSkip: () => void;
}

const STATUS_POLL_MS = 1000;
// ポーリングの上限（約3分。超過後は reloadHint の案内表示のまま静かに打ち切る）。
const STATUS_POLL_MAX_TRIES = 180;

type ApplyUIPhase = UpdateApplyStatus['phase'];

export const UpdateModal = ({ isOpen, app, uiCatalog, backendUrl, onLater, onSkip }: UpdateModalProps) => {
    const [phase, setPhase] = useState<ApplyUIPhase>('idle');
    const [percent, setPercent] = useState(0);
    const [errorKey, setErrorKey] = useState<string | null>(null);
    const [reconnectTimedOut, setReconnectTimedOut] = useState(false);
    const timerRef = useRef<number | null>(null);

    const stopPolling = () => {
        if (timerRef.current !== null) {
            window.clearInterval(timerRef.current);
            timerRef.current = null;
        }
    };
    useEffect(() => stopPolling, []);

    if (!isOpen || !app) {
        return null;
    }
    const t = (key: string) => resolveMessage(uiCatalog, key, UPDATE_TEXT_FALLBACK_JA[key] || key);
    const applying = phase === 'downloading' || phase === 'verifying' || phase === 'staging' || phase === 'restarting';

    const openReleasePage = () => {
        if (app.notesUrl) {
            window.open(app.notesUrl, '_blank', 'noopener,noreferrer');
        }
        onLater();
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
    const handleApply = () => {
        setErrorKey(null);
        setReconnectTimedOut(false);
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

    const phaseLabel = (): string => {
        switch (phase) {
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
            onClick={applying ? undefined : onLater}
        >
            <div
                className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-md border border-gray-700 overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="px-5 py-4 border-b border-gray-700">
                    <h2 className="text-lg font-semibold text-gray-100">{t(UPDATE_I18N_KEYS.modalTitle)}</h2>
                </div>
                <div className="px-5 py-4 space-y-3">
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
                    {app.canApply && (
                        <button
                            type="button"
                            onClick={handleApply}
                            disabled={applying}
                            className="w-full px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium"
                        >
                            {t(UPDATE_I18N_KEYS.applyNow)}
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={openReleasePage}
                        disabled={applying}
                        className={`w-full px-4 py-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed text-sm ${
                            app.canApply
                                ? 'bg-gray-700 hover:bg-gray-600 text-gray-200'
                                : 'bg-emerald-600 hover:bg-emerald-500 text-white font-medium'
                        }`}
                    >
                        {t(UPDATE_I18N_KEYS.open)}
                    </button>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={onLater}
                            disabled={applying}
                            className="flex-1 px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-gray-200 text-sm"
                        >
                            {t(UPDATE_I18N_KEYS.later)}
                        </button>
                        <button
                            type="button"
                            onClick={onSkip}
                            disabled={applying}
                            className="flex-1 px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed text-gray-400 text-sm border border-gray-700"
                        >
                            {t(UPDATE_I18N_KEYS.skip)}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
