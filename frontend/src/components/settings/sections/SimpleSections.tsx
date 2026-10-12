// 下書きを持たない分類（押した時点で動く操作と、窓を開く行だけ）
import React, { useEffect, useState } from 'react';
import { Download, ExternalLink, LogOut } from 'lucide-react';
import { resolveMessage, type I18NCatalog } from '../../../api/i18n';
import { BACKEND_URL } from '../../../api/base-url';
import { fetchSystemHealth } from '../../../api/system';
import type { ModuleStatusEntry } from '../../../api/sponsor';
import { downloadSamplePack, downloadTemplatePack, type SettingsPackImportResult } from '../../../api/settings-pack';
import {
    CONFIG_GEN_I18N_KEYS,
    CONFIG_GEN_TEXT_FALLBACK_JA,
    DEFAULT_UI_LANGUAGE,
    SETTINGS_I18N_KEYS,
    SETTINGS_TEXT_FALLBACK_JA,
    SETTINGS_VIEW_I18N_KEYS,
    SETTINGS_VIEW_TEXT_FALLBACK_JA,
} from '../../../constants/i18n';
import { Button, SettingRow, Toggle, cn } from '../../ui';
import { SponsorModal } from '../../SponsorModal';
import { invalidateSSRPOptionsCache } from '../../SSRP/RolePlaySettings';
import { SettingsPackModal } from '../SettingsPackModal';
import { SettingsGroup } from './parts';

const useText = (uiCatalog: I18NCatalog | null) => (key: string, fallback?: string) =>
    resolveMessage(uiCatalog, key, fallback || SETTINGS_VIEW_TEXT_FALLBACK_JA[key] || SETTINGS_TEXT_FALLBACK_JA[key] || CONFIG_GEN_TEXT_FALLBACK_JA[key] || key);

type SampleTarget = 'settings' | 'templates';

/** 取り込みの結果。行の説明の下に出す */
interface SampleOutcome {
    ok: boolean;
    text: string;
}

interface SamplesSectionProps {
    uiCatalog: I18NCatalog | null;
}

export const SamplesSection: React.FC<SamplesSectionProps> = ({ uiCatalog }) => {
    const t = useText(uiCatalog);
    const [running, setRunning] = useState<SampleTarget | null>(null);
    const [outcomes, setOutcomes] = useState<Partial<Record<SampleTarget, SampleOutcome>>>({});
    const [templatesOverwrite, setTemplatesOverwrite] = useState(false);

    // サンプルは ja / en だけ用意されているので、UI 言語をどちらかへ寄せる
    const lang = (uiCatalog?.lang || DEFAULT_UI_LANGUAGE).toLowerCase().startsWith('en') ? 'en' : 'ja';

    const download = async (
        target: SampleTarget,
        fetchPack: () => Promise<SettingsPackImportResult>,
        failKey: string,
        failFallback: string,
    ) => {
        setRunning(target);
        setOutcomes(prev => ({ ...prev, [target]: undefined }));
        try {
            const result = await fetchPack();
            if (result.written.length > 0) {
                // 会話設定メニューの選択肢はキャッシュから出るため、取り込んだファイルがすぐ並ぶよう捨てる
                invalidateSSRPOptionsCache();
            }
            const text = t(SETTINGS_VIEW_I18N_KEYS.samplesResult)
                .split('{{written}}').join(String(result.written.length))
                .split('{{skipped}}').join(String(result.skipped.length));
            setOutcomes(prev => ({ ...prev, [target]: { ok: true, text } }));
        } catch (error) {
            console.error(`[SamplesSection] ${target} download failed:`, error);
            const messageKey = (error as { response?: { data?: { messageKey?: string } } })?.response?.data?.messageKey;
            setOutcomes(prev => ({ ...prev, [target]: { ok: false, text: messageKey ? t(messageKey) : t(failKey, failFallback) } }));
        } finally {
            setRunning(null);
        }
    };

    const outcomeText = (target: SampleTarget) => {
        const outcome = outcomes[target];
        if (!outcome) return undefined;
        return <span className={cn(outcome.ok ? 'text-ok' : 'text-danger')}>{outcome.text}</span>;
    };

    const runButton = (target: SampleTarget, onClick: () => void) => (
        <Button size="sm" disabled={running !== null} onClick={onClick}>
            <Download size={14} />
            {running === target ? t(SETTINGS_VIEW_I18N_KEYS.samplesRunning) : t(SETTINGS_VIEW_I18N_KEYS.run)}
        </Button>
    );

    return (
        <>
            <SettingsGroup title={t(SETTINGS_VIEW_I18N_KEYS.samplesSettings)} note={t(SETTINGS_VIEW_I18N_KEYS.samplesSettingsNote)}>
                <SettingRow title={t(SETTINGS_VIEW_I18N_KEYS.samplesImport)} description={outcomeText('settings')} compactControl>
                    {runButton('settings', () => void download(
                        'settings',
                        () => downloadSamplePack(BACKEND_URL, lang),
                        'settingsPack.samples.errorDownloadFailed',
                        'サンプルのダウンロードに失敗しました。ネットワーク接続を確認してください。',
                    ))}
                </SettingRow>
            </SettingsGroup>

            <SettingsGroup title={t(SETTINGS_VIEW_I18N_KEYS.samplesTemplates)} note={t(SETTINGS_VIEW_I18N_KEYS.samplesTemplatesNote)}>
                <SettingRow title={t(CONFIG_GEN_I18N_KEYS.templatePackOverwrite)} compactControl>
                    <Toggle checked={templatesOverwrite} disabled={running !== null} onChange={setTemplatesOverwrite} />
                </SettingRow>
                <SettingRow title={t(SETTINGS_VIEW_I18N_KEYS.samplesImport)} description={outcomeText('templates')} compactControl>
                    {runButton('templates', () => void download(
                        'templates',
                        () => downloadTemplatePack(BACKEND_URL, lang, templatesOverwrite ? 'overwrite' : 'skip'),
                        'settingsPack.templates.errorDownloadFailed',
                        'テンプレートパックのダウンロードに失敗しました。ネットワーク接続を確認してください。',
                    ))}
                </SettingRow>
            </SettingsGroup>

            <SettingsGroup title={t('settingsPack.title', '設定パック')}>
                <SettingsPackModal isOpen embedded onClose={() => {}} backendUrl={BACKEND_URL} uiCatalog={uiCatalog} />
            </SettingsGroup>
        </>
    );
};

interface AccountSectionProps {
    uiCatalog: I18NCatalog | null;
    uiLanguage: string;
    onLogout?: () => void;
    onModulesChanged?: (modules: ModuleStatusEntry[]) => void;
}

export const AccountSection: React.FC<AccountSectionProps> = ({ uiCatalog, uiLanguage, onLogout, onModulesChanged }) => {
    const t = useText(uiCatalog);
    const [settingsPackOpen, setSettingsPackOpen] = useState(false);

    return (
        <>
            <section className="mb-8">
                <h3 className="font-head text-xs font-bold tracking-wider text-fg-muted mb-2">{t('sponsor.title', '支援者機能')}</h3>
                <div className="rounded-ui-lg bg-surface border border-line p-4">
                    <SponsorModal
                        isOpen
                        embedded
                        onClose={() => {}}
                        backendUrl={BACKEND_URL}
                        uiCatalog={uiCatalog}
                        uiLanguage={uiLanguage}
                        onModulesChanged={onModulesChanged}
                    />
                </div>
            </section>

            <SettingsGroup title={t(SETTINGS_VIEW_I18N_KEYS.groupManage)}>
                <SettingRow title={t('settingsPack.title', '設定パック')} compactControl>
                    <Button size="sm" onClick={() => setSettingsPackOpen(true)}>{t(SETTINGS_VIEW_I18N_KEYS.open)}</Button>
                </SettingRow>
                {onLogout && (
                    <SettingRow title={t(SETTINGS_I18N_KEYS.logoutLabel)} compactControl>
                        <Button size="sm" variant="danger" onClick={onLogout}>
                            <LogOut size={14} />
                            {t(SETTINGS_I18N_KEYS.logoutLabel)}
                        </Button>
                    </SettingRow>
                )}
            </SettingsGroup>

            <SettingsPackModal isOpen={settingsPackOpen} onClose={() => setSettingsPackOpen(false)} backendUrl={BACKEND_URL} uiCatalog={uiCatalog} />
        </>
    );
};

interface HelpSectionProps {
    uiCatalog: I18NCatalog | null;
    uiLanguage: string;
}

export const HelpSection: React.FC<HelpSectionProps> = ({ uiCatalog, uiLanguage }) => {
    const t = useText(uiCatalog);
    const [version, setVersion] = useState('');

    useEffect(() => {
        fetchSystemHealth(BACKEND_URL).then(health => setVersion(health.version)).catch(() => setVersion(''));
    }, []);

    // 操作マニュアルは GitHub 上の正本をブラウザで開く（本体へは焼き込まない）
    const manualUrl = (uiLanguage || DEFAULT_UI_LANGUAGE) === DEFAULT_UI_LANGUAGE
        ? 'https://github.com/Yaki-Mikan/alslime/blob/main/docs/manual/index.md'
        : 'https://github.com/Yaki-Mikan/alslime/blob/main/docs/manual/en/index.md';

    return (
        <SettingsGroup title={t(SETTINGS_VIEW_I18N_KEYS.categoryHelp)}>
            <SettingRow title={t('manual.title', '操作マニュアル')} compactControl>
                <Button size="sm" onClick={() => window.open(manualUrl, '_blank', 'noopener')}>
                    <ExternalLink size={14} />
                    {t(SETTINGS_VIEW_I18N_KEYS.open)}
                </Button>
            </SettingRow>
            <SettingRow title={t(SETTINGS_VIEW_I18N_KEYS.version)} compactControl>
                <span className="text-sm text-fg-muted tabular-nums">{version || '—'}</span>
            </SettingRow>
        </SettingsGroup>
    );
};
