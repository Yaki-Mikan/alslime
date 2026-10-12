import React, { useEffect, useImperativeHandle, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { resolveMessage } from '../../../api/i18n';
import { BACKEND_URL } from '../../../api/base-url';
import {
    checkCLIPath,
    fetchServerSettings,
    updateServerSettings,
    type CLICheckResult,
    type CLIKey,
    type ServerSettings,
} from '../../../api/server-settings';
import { fetchUpdateCheck, fetchUpdateSettings, saveUpdateSettings, type AppUpdateInfo, type ModuleUpdateEntry } from '../../../api/update';
import type { ModuleStatusEntry } from '../../../api/sponsor';
import {
    SERVER_SETTINGS_NETWORK,
    SETTINGS_I18N_KEYS,
    SETTINGS_TEXT_FALLBACK_JA,
    SETTINGS_VIEW_I18N_KEYS,
    SETTINGS_VIEW_TEXT_FALLBACK_JA,
    UPDATE_I18N_KEYS,
    UPDATE_TEXT_FALLBACK_JA,
} from '../../../constants/i18n';
import type { Settings } from '../../../types/Settings';
import { Button, SettingRow, TextField, Toggle } from '../../ui';
import { SystemDiagnosticsModal } from '../../SystemDiagnosticsModal';
import { UpdateModal } from '../../UpdateModal';
import { SettingsGroup } from './parts';
import { changed, useSettingsDraft, type SectionCommonProps, type SectionHandle } from './sectionTypes';

interface SystemSectionProps extends SectionCommonProps {
    settings: Settings;
    onSave: (settings: Settings) => Promise<void>;
    onModulesChanged?: (modules: ModuleStatusEntry[]) => void;
}

const DEBUG_KEYS = ['enableFirstResponseBackup', 'enableResponseBackup'] as const satisfies readonly (keyof Settings)[];

interface ServerDraft {
    settings: ServerSettings;
    /** 入力途中の値も持てるよう、ポートは文字で持つ */
    port: string;
}

const CLI_KEYS: { key: CLIKey; label: string }[] = [
    { key: 'gemini', label: SETTINGS_I18N_KEYS.cliPathsGeminiLabel },
    { key: 'claude', label: SETTINGS_I18N_KEYS.cliPathsClaudeLabel },
    { key: 'antigravity', label: SETTINGS_I18N_KEYS.cliPathsAntigravityLabel },
];

/** 疎通確認の表示状態。確認中・通信失敗・サーバーが返した結果のいずれか。 */
type CLICheckState = 'checking' | 'requestFailed' | CLICheckResult;

const CLI_CHECK_STATUS_KEYS: Record<Exclude<CLICheckResult['status'], 'ok'>, string> = {
    notFound: SETTINGS_I18N_KEYS.cliPathsCheckNotFound,
    configuredPathInvalid: SETTINGS_I18N_KEYS.cliPathsCheckConfiguredPathInvalid,
    failed: SETTINGS_I18N_KEYS.cliPathsCheckFailed,
    timeout: SETTINGS_I18N_KEYS.cliPathsCheckTimeout,
};

export const SystemSection = React.forwardRef<SectionHandle, SystemSectionProps>(
    ({ settings, onSave, onDirtyChange, uiCatalog, onModulesChanged }, ref) => {
        const t = (key: string) => resolveMessage(
            uiCatalog,
            key,
            SETTINGS_VIEW_TEXT_FALLBACK_JA[key] || SETTINGS_TEXT_FALLBACK_JA[key] || UPDATE_TEXT_FALLBACK_JA[key] || key,
        );
        const debug = useSettingsDraft(settings, DEBUG_KEYS);
        const [serverSaved, setServerSaved] = useState<ServerDraft | null>(null);
        const [server, setServer] = useState<ServerDraft | null>(null);
        const [serverError, setServerError] = useState<string | null>(null);

        const [updateChecking, setUpdateChecking] = useState(false);
        const [updateResult, setUpdateResult] = useState<'none' | 'latest' | 'failed'>('none');
        const [manualUpdateApp, setManualUpdateApp] = useState<AppUpdateInfo | null>(null);
        const [moduleUpdates, setModuleUpdates] = useState<ModuleUpdateEntry[]>([]);
        const [autoCheck, setAutoCheck] = useState(true);
        const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
        const [cliChecks, setCliChecks] = useState<Partial<Record<CLIKey, CLICheckState>>>({});

        useEffect(() => {
            fetchServerSettings(BACKEND_URL)
                .then(res => {
                    const initial = { settings: res.settings, port: String(res.settings.port) };
                    setServerSaved(initial);
                    setServer(initial);
                })
                .catch(err => {
                    setServerError(t(SETTINGS_I18N_KEYS.serverLoadError));
                    console.error('Failed to fetch server settings:', err);
                });
            // 自動確認の初期値（取れなければ既定の ON のまま）
            fetchUpdateSettings(BACKEND_URL).then(res => setAutoCheck(res.autoCheck)).catch(() => {});
            // 開いたときに一度だけ読む
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, []);

        const serverDirty = !!server && !!serverSaved && changed(server, serverSaved);
        const isDirty = debug.isDirty || serverDirty;
        useEffect(() => { onDirtyChange(isDirty); }, [isDirty, onDirtyChange]);

        useImperativeHandle(ref, () => ({
            save: async () => {
                const failed: string[] = [];
                if (serverDirty && server) {
                    const port = Number(server.port);
                    if (!Number.isInteger(port) || port < 1 || port > 65535) {
                        setServerError(t(SETTINGS_I18N_KEYS.serverPortInvalid));
                        failed.push(t(SETTINGS_I18N_KEYS.serverTitle));
                    } else {
                        try {
                            const res = await updateServerSettings(BACKEND_URL, {
                                ...server.settings,
                                port,
                                bindAddress: server.settings.bindAddress.trim(),
                            });
                            const next = { settings: res.settings, port: String(res.settings.port) };
                            setServerSaved(next);
                            setServer(next);
                            setServerError(null);
                        } catch {
                            setServerError(t(SETTINGS_I18N_KEYS.serverSaveError));
                            failed.push(t(SETTINGS_I18N_KEYS.serverTitle));
                        }
                    }
                }
                if (debug.isDirty) {
                    try {
                        await onSave(debug.merged());
                    } catch {
                        failed.push(t(SETTINGS_I18N_KEYS.debugLabel));
                    }
                }
                return failed;
            },
            revert: () => {
                debug.revert();
                setServer(serverSaved);
                setServerError(null);
            },
        }));

        const handleCheckUpdate = async () => {
            setUpdateChecking(true);
            setUpdateResult('none');
            try {
                const check = await fetchUpdateCheck(BACKEND_URL);
                // モジュールの更新も同じ応答で判定し、本体の分と1つの窓で見せる
                const moduleEntries = check.modules.filter(m => m.hasUpdate || m.companionPackUpdate);
                if (check.app.enabled && check.app.hasUpdate) {
                    setManualUpdateApp(check.app);
                    setModuleUpdates(moduleEntries);
                } else if (moduleEntries.length > 0) {
                    setManualUpdateApp(null);
                    setModuleUpdates(moduleEntries);
                } else if (!check.app.enabled || check.app.checkFailed) {
                    setUpdateResult('failed');
                } else {
                    setUpdateResult('latest');
                }
            } catch {
                setUpdateResult('failed');
            }
            setUpdateChecking(false);
        };

        const handleToggleAutoCheck = async (value: boolean) => {
            setAutoCheck(value);
            try {
                await saveUpdateSettings(BACKEND_URL, { autoCheck: value });
            } catch {
                setAutoCheck(!value);
            }
        };

        const updateServer = (patch: Partial<ServerSettings>) =>
            setServer(current => (current ? { ...current, settings: { ...current.settings, ...patch } } : current));

        // 保存前の入力値のまま、サーバーで実際の起動と同じ規則で解決して --version を試す
        const handleCheckCLI = async (key: CLIKey) => {
            const path = server?.settings.cliPaths?.[key] ?? '';
            setCliChecks(prev => ({ ...prev, [key]: 'checking' }));
            let next: CLICheckState;
            try {
                next = await checkCLIPath(BACKEND_URL, key, path);
            } catch {
                next = 'requestFailed';
            }
            // 確認中に入力が変わると表示は消してあるので、そのときは古い値の結果を出さない
            setCliChecks(prev => (prev[key] === 'checking' ? { ...prev, [key]: next } : prev));
        };

        const cliCheckText = (key: CLIKey): string | undefined => {
            const state = cliChecks[key];
            if (!state) return undefined;
            if (state === 'checking') return t(SETTINGS_I18N_KEYS.cliPathsChecking);
            if (state === 'requestFailed') return t(SETTINGS_I18N_KEYS.cliPathsCheckFailed);
            if (state.status !== 'ok') return t(CLI_CHECK_STATUS_KEYS[state.status]);
            const detail = [state.command, state.version].filter(Boolean).join(' / ');
            return detail ? `${t(SETTINGS_I18N_KEYS.cliPathsCheckOk)}: ${detail}` : t(SETTINGS_I18N_KEYS.cliPathsCheckOk);
        };

        return (
            <>
                <SettingsGroup title={t(SETTINGS_I18N_KEYS.serverTitle)} note={t(SETTINGS_I18N_KEYS.serverDescription)}>
                    {serverError && <p className="px-4 py-2 text-xs text-danger border-b border-line">{serverError}</p>}
                    {server && (
                        <>
                            <SettingRow title={t(SETTINGS_I18N_KEYS.serverPortLabel)}>
                                <TextField
                                    inputMode="numeric"
                                    value={server.port}
                                    onChange={(e) => {
                                        setServer({ ...server, port: e.target.value.replace(/[^\d]/g, '') });
                                        setServerError(null);
                                    }}
                                />
                            </SettingRow>
                            <SettingRow title={t(SETTINGS_I18N_KEYS.serverBindAddressLabel)}>
                                <TextField value={server.settings.bindAddress} onChange={(e) => updateServer({ bindAddress: e.target.value })} />
                            </SettingRow>
                            <SettingRow title={t(SETTINGS_I18N_KEYS.serverLanPublicLabel)} compactControl>
                                <Toggle
                                    checked={server.settings.lanPublic}
                                    onChange={(on) => updateServer({
                                        lanPublic: on,
                                        // LAN に公開するのに待ち受けが自分だけのままなら、全体へ広げる
                                        bindAddress: on && server.settings.bindAddress === SERVER_SETTINGS_NETWORK.localBindAddress
                                            ? SERVER_SETTINGS_NETWORK.lanBindAddress
                                            : server.settings.bindAddress,
                                    })}
                                />
                            </SettingRow>
                        </>
                    )}
                </SettingsGroup>

                {server && (
                    <SettingsGroup title={t(SETTINGS_I18N_KEYS.cliPathsTitle)} note={t(SETTINGS_I18N_KEYS.cliPathsDescription)}>
                        {CLI_KEYS.map(({ key, label }) => (
                            <SettingRow key={key} title={t(label)} description={cliCheckText(key)}>
                                <TextField
                                    className="min-w-0 flex-1"
                                    value={server.settings.cliPaths?.[key] ?? ''}
                                    placeholder={t(SETTINGS_I18N_KEYS.cliPathsPlaceholder)}
                                    onChange={(e) => {
                                        // 入力が変わったら、前の値で確かめた結果は消す
                                        setCliChecks(prev => ({ ...prev, [key]: undefined }));
                                        updateServer({
                                            cliPaths: {
                                                gemini: server.settings.cliPaths?.gemini ?? '',
                                                claude: server.settings.cliPaths?.claude ?? '',
                                                antigravity: server.settings.cliPaths?.antigravity ?? '',
                                                [key]: e.target.value,
                                            },
                                        });
                                    }}
                                />
                                <Button
                                    size="sm"
                                    className="shrink-0"
                                    disabled={cliChecks[key] === 'checking'}
                                    onClick={() => void handleCheckCLI(key)}
                                >
                                    {t(SETTINGS_I18N_KEYS.cliPathsCheck)}
                                </Button>
                            </SettingRow>
                        ))}
                    </SettingsGroup>
                )}

                <SettingsGroup title={t(SETTINGS_VIEW_I18N_KEYS.groupUpdates)}>
                    <SettingRow
                        title={t(UPDATE_I18N_KEYS.manualCheck)}
                        description={updateResult === 'latest'
                            ? t(UPDATE_I18N_KEYS.upToDate)
                            : updateResult === 'failed' ? t(UPDATE_I18N_KEYS.checkFailed) : undefined}
                        compactControl
                    >
                        <Button size="sm" disabled={updateChecking} onClick={() => void handleCheckUpdate()}>
                            <RefreshCw size={14} className={updateChecking ? 'animate-spin' : ''} />
                            {updateChecking ? t(UPDATE_I18N_KEYS.checking) : t(SETTINGS_VIEW_I18N_KEYS.run)}
                        </Button>
                    </SettingRow>
                    <SettingRow title={t(UPDATE_I18N_KEYS.autoCheckToggle)} compactControl>
                        <Toggle checked={autoCheck} onChange={(on) => void handleToggleAutoCheck(on)} />
                    </SettingRow>
                </SettingsGroup>

                <SettingsGroup title={t(SETTINGS_I18N_KEYS.systemTitle)}>
                    <SettingRow title={t(SETTINGS_I18N_KEYS.diagnosticsLabel)} compactControl>
                        <Button size="sm" onClick={() => setDiagnosticsOpen(true)}>{t(SETTINGS_VIEW_I18N_KEYS.open)}</Button>
                    </SettingRow>
                </SettingsGroup>

                <SettingsGroup title={t(SETTINGS_I18N_KEYS.debugLabel)} note={t(SETTINGS_I18N_KEYS.debugDescription)}>
                    <SettingRow title={t(SETTINGS_I18N_KEYS.firstResponseBackupLabel)} description={t(SETTINGS_I18N_KEYS.firstResponseBackupDescription)} compactControl>
                        <Toggle checked={debug.draft.enableFirstResponseBackup ?? false} onChange={(on) => debug.update({ enableFirstResponseBackup: on })} />
                    </SettingRow>
                    <SettingRow title={t(SETTINGS_I18N_KEYS.responseBackupLabel)} description={t(SETTINGS_I18N_KEYS.responseBackupDescription)} compactControl>
                        <Toggle checked={debug.draft.enableResponseBackup ?? false} onChange={(on) => debug.update({ enableResponseBackup: on })} />
                    </SettingRow>
                </SettingsGroup>

                <SystemDiagnosticsModal
                    isOpen={diagnosticsOpen}
                    onClose={() => setDiagnosticsOpen(false)}
                    backendUrl={BACKEND_URL}
                    uiLanguage={settings.uiLanguage}
                    uiCatalog={uiCatalog}
                />

                {/* 手動の更新確認の結果（更新があるときだけ。スキップの設定は無視して常に出す） */}
                <UpdateModal
                    isOpen={manualUpdateApp !== null || moduleUpdates.length > 0}
                    app={manualUpdateApp}
                    modules={moduleUpdates}
                    uiCatalog={uiCatalog}
                    backendUrl={BACKEND_URL}
                    onModulesChanged={onModulesChanged}
                    onClose={() => {
                        setManualUpdateApp(null);
                        setModuleUpdates([]);
                    }}
                    // 手動確認の「後で」は記録せず、本体の分だけを消す
                    onLater={() => setManualUpdateApp(null)}
                    onSkip={() => {
                        if (manualUpdateApp) {
                            saveUpdateSettings(BACKEND_URL, { skippedVersion: manualUpdateApp.latest }).catch(() => {});
                        }
                        setManualUpdateApp(null);
                    }}
                    onModuleDismiss={(moduleId) => setModuleUpdates(prev => prev.filter(m => m.id !== moduleId))}
                />
            </>
        );
    },
);
SystemSection.displayName = 'SystemSection';
