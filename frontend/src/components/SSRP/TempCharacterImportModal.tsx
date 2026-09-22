/**
 * TempCharacterImportModal - セッションからキャラクターを取り込む小窓
 *
 * 会話に登場した話者を一覧にし、チェックした話者を 1 キャラずつ AI に分析させて
 * 一時キャラクターとして会話設定へ登録する。広い画面では上部バーをドラッグして動かせる
 * 小窓（位置はブラウザに記憶）、スマホでは他のモーダルと同じ全画面。
 * 進行状態は Chat 側のフックが持つため、小窓を閉じても分析は続く。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Square, RotateCcw, RefreshCw, Save } from 'lucide-react';
import axios from '../../lib/axios';
import { ConfirmDialog } from '../ConfirmDialog';
import { DraggablePanel } from '../common/DraggablePanel';
import { getCharacterTags, type CharacterTagInfo } from '../../api/files';
import {
    listTemplates,
    getDefaultTemplates,
    listConfigGenTemplates,
    getConfigGenTemplateDefaults,
    configGenTemplateDefaultName,
} from '../../api/config-editor';
import { getGlobalSettings, updateGlobalSettings } from '../../api/global-settings';
import { getCLIStatus, type CLIStatusEntry } from '../../api/config-gen';
import { resolveMessage, type I18NCatalog } from '../../api/i18n';
import {
    SSRP_I18N_KEYS,
    SSRP_TEXT_FALLBACK_JA,
    CLAUDE_EFFORT_I18N_KEY_BY_VALUE,
    ANTIGRAVITY_THINKING_I18N_KEY_BY_VALUE,
} from '../../constants/i18n';
import { CLAUDE_EFFORT_VALUES } from '../../constants/claude';
import {
    DEFAULT_ANTIGRAVITY_THINKING,
    antigravityThinkingLevelsOf,
    normalizeAntigravityThinking,
    type AntigravityThinking,
} from '../../constants/antigravity';
import type { Model, ModelProvider } from '../../hooks/useChat';
import { modelProviderOf } from '../../hooks/useChat';
import type { TempCharacterImportHandle, TempImportItem } from '../../hooks/useTempCharacterImport';
import { collectSpeakers, type SpeakerEntry, type SpeakerSourceMessage } from '../../lib/tempCharacterSpeakers';
import type { TempCharacter } from '../../api/datetime-presets';

const PROVIDERS: ModelProvider[] = ['antigravity', 'claude', 'gemini'];
const DEFAULT_TIMEOUT_MINUTES = 20;
const POSITION_STORAGE_KEY = 'alslime.tempCharImport.pos';

/**
 * テンプレート選択値。AI 用（設定自動生成の設定ファイルテンプレート）と
 * 手動作成用の雛形を 1 つのプルダウンに並べるため、種別を接頭辞で区別する。
 */
type TemplateKind = 'setting' | 'manual';
const templateValue = (kind: TemplateKind, name: string) => `${kind}:${name}`;
const parseTemplateValue = (value: string): { kind: TemplateKind; name: string } | null => {
    const sep = value.indexOf(':');
    if (sep <= 0) return null;
    const kind = value.slice(0, sep);
    const name = value.slice(sep + 1);
    if ((kind !== 'setting' && kind !== 'manual') || !name) return null;
    return { kind, name };
};

interface TempCharacterImportModalProps {
    isOpen: boolean;
    onClose: () => void;
    backendUrl: string;
    sessionId: string | null;
    messages: SpeakerSourceMessage[];
    tempCharacters: Record<string, TempCharacter>;
    userName: string;
    tempImport: TempCharacterImportHandle;
    uiCatalog: I18NCatalog | null;
}

interface SavedGenDefaults {
    provider?: string;
    model?: string;
    effort?: string;
    thinking?: string;
    timeoutMinutes?: number;
}

const inputCls = 'w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 disabled:opacity-50';
const labelCls = 'block text-xs text-gray-400 mb-1';

export const TempCharacterImportModal: React.FC<TempCharacterImportModalProps> = ({
    isOpen, onClose, backendUrl, sessionId, messages, tempCharacters, userName, tempImport, uiCatalog,
}) => {
    const t = (key: string) => resolveMessage(uiCatalog, key, SSRP_TEXT_FALLBACK_JA[key] || key);
    const formatText = (template: string, values: Record<string, string | number>) =>
        Object.entries(values).reduce((text, [key, value]) => text.split(`{{${key}}}`).join(String(value)), template);
    const locale = uiCatalog?.lang || 'ja';
    // テンプレート置き場は基底言語（ja / en）で分かれている
    const templateLocale = locale.split(/[-_]/)[0].toLowerCase() || 'ja';

    // 登録済みキャラクター（照合用。名前・ディレクトリ名・元の名前）
    const [registered, setRegistered] = useState<CharacterTagInfo[]>([]);
    // モデル選択
    const [models, setModels] = useState<Model[]>([]);
    const [cliStatus, setCliStatus] = useState<CLIStatusEntry[]>([]);
    const [provider, setProvider] = useState<ModelProvider>('antigravity');
    const [model, setModel] = useState('');
    const [effort, setEffort] = useState('');
    const [thinking, setThinking] = useState<AntigravityThinking>(DEFAULT_ANTIGRAVITY_THINKING);
    const [timeoutMinutes, setTimeoutMinutes] = useState(DEFAULT_TIMEOUT_MINUTES);
    // テンプレート（AI 用の設定ファイルテンプレートと手動作成用の雛形の両方を並べる）
    const [settingTemplates, setSettingTemplates] = useState<string[]>([]);
    const [manualTemplates, setManualTemplates] = useState<string[]>([]);
    const [selectedTemplate, setSelectedTemplate] = useState('');
    // 選択・確認・通知
    const [checked, setChecked] = useState<Set<string>>(new Set());
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [toast, setToast] = useState('');
    const settingsLoaded = useRef(false);

    const showToast = (msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(''), 2500);
    };

    // 初期データ（すべて非同期の応答で state を更新する）
    useEffect(() => {
        if (!isOpen) return;
        getCharacterTags().then(res => setRegistered(res.characters || [])).catch(() => setRegistered([]));
        axios.get(`${backendUrl}/api/models`).then(res => setModels(res.data?.models || [])).catch(() => {});
        getCLIStatus(backendUrl).then(setCliStatus).catch(() => {});
        // 一覧は個別に失敗しても他方を並べる。初期選択は設定自動生成の既定 → AI 用の先頭 → 手動用の既定 → 手動用の先頭。
        Promise.all([
            listConfigGenTemplates(backendUrl, 'character', templateLocale, 'setting').catch(() => [] as string[]),
            getConfigGenTemplateDefaults(backendUrl).catch(() => ({})),
            listTemplates(backendUrl, 'character').catch(() => [] as string[]),
            getDefaultTemplates(backendUrl).catch(() => ({} as Record<string, string>)),
        ]).then(([setting, settingDefaults, manual, manualDefaults]) => {
            setSettingTemplates(setting);
            setManualTemplates(manual);
            const settingDef = configGenTemplateDefaultName(settingDefaults, 'character', templateLocale, 'setting');
            const manualDef = manualDefaults?.character || '';
            if (setting.includes(settingDef)) setSelectedTemplate(templateValue('setting', settingDef));
            else if (setting.length > 0) setSelectedTemplate(templateValue('setting', setting[0]));
            else if (manual.includes(manualDef)) setSelectedTemplate(templateValue('manual', manualDef));
            else if (manual.length > 0) setSelectedTemplate(templateValue('manual', manual[0]));
            else setSelectedTemplate('');
        });
        if (!settingsLoaded.current) {
            settingsLoaded.current = true;
            getGlobalSettings(backendUrl).then(settings => {
                // この機能専用の規定 → 無ければ設定自動生成の規定を初期値にする（保存はしない）
                const own = settings.tempCharacterGen;
                const saved: SavedGenDefaults | undefined = (own && typeof own === 'object') ? own : settings.configGen;
                if (saved && typeof saved === 'object') {
                    if (saved.provider && (PROVIDERS as string[]).includes(saved.provider)) setProvider(saved.provider as ModelProvider);
                    if (typeof saved.model === 'string') setModel(saved.model);
                    if (typeof saved.effort === 'string') setEffort(saved.effort);
                    if (typeof saved.thinking === 'string') setThinking(saved.thinking as AntigravityThinking);
                    if (typeof saved.timeoutMinutes === 'number') setTimeoutMinutes(saved.timeoutMinutes);
                }
            }).catch(() => {});
        }
    }, [isOpen, backendUrl, templateLocale]);

    const cliFound = (p: ModelProvider): boolean => {
        const entry = cliStatus.find(c => c.id === p);
        return entry ? entry.status === 'ok' : true;
    };
    const providerModels = useMemo(() => models.filter(m => modelProviderOf(m) === provider), [models, provider]);
    // 選択中のモデルがプロバイダの一覧に無ければ先頭を使う（派生値。state は変えない）
    const effectiveModel = providerModels.some(m => m.id === model) ? model : (providerModels[0]?.id || '');
    const thinkingLevels = useMemo(
        () => (provider === 'antigravity' ? antigravityThinkingLevelsOf(providerModels.find(m => m.id === effectiveModel)) : []),
        [provider, providerModels, effectiveModel]
    );
    const effectiveThinking = thinkingLevels.length > 0 && !thinkingLevels.includes(thinking)
        ? normalizeAntigravityThinking(thinking, thinkingLevels)
        : thinking;

    // 話者一覧
    const speakers = useMemo(
        () => collectSpeakers(messages, registered, tempCharacters, userName),
        [messages, registered, tempCharacters, userName]
    );
    const running = tempImport.running && tempImport.sessionId === sessionId;
    const itemIndexFor = (s: SpeakerEntry): number =>
        tempImport.sessionId === sessionId ? tempImport.items.findIndex(i => i.speaker.normalized === s.normalized) : -1;
    const checkedSpeakers = speakers.filter(s => s.status === 'unregistered' && checked.has(s.normalized));
    const canRun = !!sessionId && checkedSpeakers.length > 0 && !!effectiveModel && !running;

    const selectedTemplateInfo = parseTemplateValue(selectedTemplate);
    const options = () => ({
        model: effectiveModel,
        claudeEffort: provider === 'claude' ? effort : undefined,
        antigravityThinking: provider === 'antigravity' ? effectiveThinking : undefined,
        timeoutMinutes,
        locale,
        settingTemplate: selectedTemplateInfo?.kind === 'setting' ? selectedTemplateInfo.name : undefined,
        manualTemplate: selectedTemplateInfo?.kind === 'manual' ? selectedTemplateInfo.name : undefined,
    });

    const handleRun = () => {
        if (!sessionId || !canRun) return;
        setConfirmOpen(false);
        tempImport.start(sessionId, checkedSpeakers, options());
        setChecked(new Set());
    };

    const handleReanalyze = (s: SpeakerEntry) => {
        if (!sessionId || running || !effectiveModel) return;
        tempImport.start(sessionId, [s], options());
    };

    const handleSetDefault = async () => {
        const ok = await updateGlobalSettings(backendUrl, {
            tempCharacterGen: { provider, model: effectiveModel, effort, thinking: effectiveThinking, timeoutMinutes },
        });
        if (ok) showToast(t(SSRP_I18N_KEYS.tempImportSetDefaultDone));
    };

    const handleClose = () => {
        setChecked(new Set());
        setConfirmOpen(false);
        onClose();
    };

    if (!isOpen) return null;

    const statusLabel = (item: TempImportItem | undefined, s: SpeakerEntry): React.ReactNode => {
        if (item) {
            const map: Record<string, string> = {
                pending: SSRP_I18N_KEYS.tempImportStatusPending,
                analyzing: SSRP_I18N_KEYS.tempImportStatusAnalyzing,
                registered: SSRP_I18N_KEYS.tempImportStatusRegistered,
                failed: SSRP_I18N_KEYS.tempImportStatusFailed,
                canceled: SSRP_I18N_KEYS.tempImportStatusCanceled,
            };
            const color = item.status === 'failed' ? 'text-red-400' : item.status === 'registered' ? 'text-green-400' : item.status === 'analyzing' ? 'text-orange-300' : 'text-gray-400';
            return (
                <span className={`text-xs ${color}`}>
                    {t(map[item.status])}
                    {item.status === 'failed' && item.errorKey && (
                        <span className="ml-1 text-gray-500">{resolveMessage(uiCatalog, item.errorKey, item.errorKey)}</span>
                    )}
                </span>
            );
        }
        switch (s.status) {
            case 'registered':
                return <span className="text-xs px-1.5 py-0.5 rounded bg-gray-700 text-gray-300">{t(SSRP_I18N_KEYS.tempImportBadgeRegistered)}</span>;
            case 'temp':
                return <span className="text-xs px-1.5 py-0.5 rounded bg-orange-900/60 text-orange-300 border border-orange-700/60">{t(SSRP_I18N_KEYS.tempImportBadgeTemp)}</span>;
            case 'tempRegistered':
                return <span className="text-xs px-1.5 py-0.5 rounded bg-gray-700 text-gray-300">{t(SSRP_I18N_KEYS.tempImportBadgeTempRegistered)}</span>;
            default:
                return null;
        }
    };

    const body = (
        <>
                {/* 話者一覧 */}
                <div>
                    <label className={labelCls}>{t(SSRP_I18N_KEYS.tempImportSpeakers)}</label>
                    {speakers.length === 0 ? (
                        <p className="text-xs text-gray-500">{t(SSRP_I18N_KEYS.tempImportNoSpeakers)}</p>
                    ) : (
                        <ul className="space-y-1">
                            {speakers.map(s => {
                                const idx = itemIndexFor(s);
                                const item = idx >= 0 ? tempImport.items[idx] : undefined;
                                // 分析が動いていなければ、失敗・中止・止まって残った待機の話者も選び直せる
                                const selectable = s.status === 'unregistered' && !running;
                                return (
                                    <li key={s.normalized} className="flex items-center gap-2 bg-gray-800/70 border border-gray-700 rounded px-2 py-1.5">
                                        <input
                                            type="checkbox"
                                            className="accent-orange-500"
                                            disabled={!selectable}
                                            checked={selectable && checked.has(s.normalized)}
                                            onChange={e => {
                                                setChecked(prev => {
                                                    const next = new Set(prev);
                                                    if (e.target.checked) next.add(s.normalized); else next.delete(s.normalized);
                                                    return next;
                                                });
                                            }}
                                        />
                                        <span className={`flex-1 min-w-0 truncate text-sm ${s.status === 'unregistered' ? 'text-gray-100' : 'text-gray-400'}`}>{s.displayName}</span>
                                        <span className="text-xs text-gray-500 shrink-0">{formatText(t(SSRP_I18N_KEYS.tempImportCount), { count: s.count })}</span>
                                        <span className="shrink-0">{statusLabel(item, s)}</span>
                                        {item && (item.status === 'failed' || item.status === 'canceled') && !running && (
                                            <button onClick={() => tempImport.retry(idx)} className="p-1 text-gray-400 hover:text-orange-300 rounded" title={t(SSRP_I18N_KEYS.tempImportRetry)}>
                                                <RotateCcw size={14} />
                                            </button>
                                        )}
                                        {!item && s.status === 'temp' && !running && (
                                            <button onClick={() => handleReanalyze(s)} disabled={!effectiveModel} className="p-1 text-gray-400 hover:text-orange-300 rounded disabled:opacity-40" title={t(SSRP_I18N_KEYS.tempImportReanalyze)}>
                                                <RefreshCw size={14} />
                                            </button>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>

                {/* モデル選択 */}
                <div className="grid grid-cols-2 gap-2">
                    <div>
                        <label className={labelCls}>{t(SSRP_I18N_KEYS.tempImportProvider)}</label>
                        <select value={provider} disabled={running} onChange={e => setProvider(e.target.value as ModelProvider)} className={inputCls}>
                            {PROVIDERS.map(p => (
                                <option key={p} value={p} disabled={!cliFound(p)}>{p}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className={labelCls}>{t(SSRP_I18N_KEYS.tempImportModel)}</label>
                        <select value={effectiveModel} disabled={running} onChange={e => setModel(e.target.value)} className={inputCls}>
                            {providerModels.map(m => (
                                <option key={m.id} value={m.id}>{m.name || m.id}</option>
                            ))}
                        </select>
                    </div>
                    {provider === 'claude' && (
                        <div>
                            <label className={labelCls}>{t(SSRP_I18N_KEYS.tempImportEffort)}</label>
                            <select value={effort} disabled={running} onChange={e => setEffort(e.target.value)} className={inputCls}>
                                {CLAUDE_EFFORT_VALUES.map(v => (
                                    <option key={v} value={v}>{resolveMessage(uiCatalog, CLAUDE_EFFORT_I18N_KEY_BY_VALUE[v] || '', v || 'CLI default')}</option>
                                ))}
                            </select>
                        </div>
                    )}
                    {provider === 'antigravity' && thinkingLevels.length > 0 && (
                        <div>
                            <label className={labelCls}>{t(SSRP_I18N_KEYS.tempImportThinking)}</label>
                            <select value={effectiveThinking} disabled={running} onChange={e => setThinking(e.target.value as AntigravityThinking)} className={inputCls}>
                                {thinkingLevels.map(v => (
                                    <option key={v} value={v}>{resolveMessage(uiCatalog, ANTIGRAVITY_THINKING_I18N_KEY_BY_VALUE[v], v)}</option>
                                ))}
                            </select>
                        </div>
                    )}
                    <div>
                        <label className={labelCls}>{t(SSRP_I18N_KEYS.tempImportTimeout)}</label>
                        <input
                            type="number" min={1} max={60} value={timeoutMinutes} disabled={running}
                            onChange={e => setTimeoutMinutes(Math.max(1, Math.min(60, Number(e.target.value) || DEFAULT_TIMEOUT_MINUTES)))}
                            className={inputCls}
                        />
                    </div>
                </div>
                <button
                    onClick={handleSetDefault}
                    disabled={!effectiveModel}
                    className="flex items-center gap-1 text-xs text-orange-300 hover:text-orange-200 underline decoration-dotted disabled:opacity-40"
                >
                    <Save size={12} />
                    {t(SSRP_I18N_KEYS.tempImportSetDefault)}
                </button>

                {/* 雛形 */}
                <div>
                    <label className={labelCls}>{t(SSRP_I18N_KEYS.tempImportTemplate)}</label>
                    {settingTemplates.length === 0 && manualTemplates.length === 0 ? (
                        <p className="text-xs text-yellow-500/90">{t(SSRP_I18N_KEYS.tempImportNoTemplate)}</p>
                    ) : (
                        <select value={selectedTemplate} disabled={running} onChange={e => setSelectedTemplate(e.target.value)} className={inputCls}>
                            {settingTemplates.length > 0 && (
                                <optgroup label={t(SSRP_I18N_KEYS.tempImportTemplateGroupSetting)}>
                                    {settingTemplates.map(name => (
                                        <option key={templateValue('setting', name)} value={templateValue('setting', name)}>{name}</option>
                                    ))}
                                </optgroup>
                            )}
                            {manualTemplates.length > 0 && (
                                <optgroup label={t(SSRP_I18N_KEYS.tempImportTemplateGroupManual)}>
                                    {manualTemplates.map(name => (
                                        <option key={templateValue('manual', name)} value={templateValue('manual', name)}>{name}</option>
                                    ))}
                                </optgroup>
                            )}
                        </select>
                    )}
                </div>
        </>
    );

    // 実行・中止（小窓の下部バー）
    const footer = (
        <>
                {toast && <span className="text-xs text-green-400 mr-auto">{toast}</span>}
                {running ? (
                    <button onClick={tempImport.cancel} className="flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-red-800 hover:bg-red-700 text-white">
                        <Square size={14} />
                        {t(SSRP_I18N_KEYS.tempImportCancel)}
                    </button>
                ) : (
                    <button
                        onClick={() => setConfirmOpen(true)}
                        disabled={!canRun}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-orange-700 hover:bg-orange-600 text-white disabled:opacity-40"
                    >
                        <Play size={14} />
                        {t(SSRP_I18N_KEYS.tempImportRun)}
                    </button>
                )}
        </>
    );

    const confirm = (
        <ConfirmDialog
            isOpen={confirmOpen}
            title={t(SSRP_I18N_KEYS.tempImportConfirmTitle)}
            message={formatText(t(SSRP_I18N_KEYS.tempImportConfirmMessage), {
                names: checkedSpeakers.map(s => s.displayName).join('、'),
                model: effectiveModel || '-',
                template: selectedTemplateInfo?.name || '-',
            })}
            onYes={handleRun}
            onNo={() => setConfirmOpen(false)}
            onCancel={() => setConfirmOpen(false)}
            uiCatalog={uiCatalog}
        />
    );

    return (
        <DraggablePanel
            isOpen={isOpen}
            onClose={handleClose}
            title={t(SSRP_I18N_KEYS.tempImportTitle)}
            storageKey={POSITION_STORAGE_KEY}
            accent="orange"
            zIndexClass="z-50"
            widthClass="w-[34rem]"
            closeTitle={t(SSRP_I18N_KEYS.tempImportClose)}
            footer={footer}
            extra={confirm}
        >
            {body}
        </DraggablePanel>
    );
};
