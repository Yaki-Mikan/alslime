import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Play, Square, Save, Wrench, CheckCircle2, AlertCircle, MessageSquare, Trash2, FolderOpen, RotateCcw, Bot } from 'lucide-react';
import axios from '../../lib/axios';
import { ConfirmDialog } from '../ConfirmDialog';
import { ResearchPickerModal } from './ResearchPickerModal';
import { useConfigGenJob } from '../../hooks/useConfigGenJob';
import {
    getResearchMemo,
    saveResearchMemo,
    deleteResearchMemo,
    listResearchMemos,
    getCLIStatus,
    type ConfigGenResultFile,
    type ConfigGenSubmitRequest,
    type ResearchMemoEntry,
    type CLIStatusEntry,
} from '../../api/config-gen';
import { getConfigFile, checkConfigFileExists, getCategories } from '../../api/config-editor';
import type { CategoryDef } from '../../api/config-editor';
import { getGlobalSettings, updateGlobalSettings } from '../../api/global-settings';
import { pingModel } from '../../api/user-models';
import { resolveMessage, type I18NCatalog } from '../../api/i18n';
import { CONFIG_GEN_I18N_KEYS, CONFIG_GEN_TEXT_FALLBACK_JA, CLAUDE_EFFORT_I18N_KEY_BY_VALUE, COMMON_TEXT_FALLBACK_JA } from '../../constants/i18n';
import { CLAUDE_EFFORT_VALUES } from '../../constants/claude';
import type { Model, ModelProvider } from '../../hooks/useChat';
import { modelProviderOf } from '../../hooks/useChat';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    backendUrl: string;
    uiCatalog?: I18NCatalog | null;
    headerTabs?: React.ReactNode;
    /** 生成済み設定ファイルを設定ファイルタブで開く（Hub がタブ切替と選択状態の受け渡しを行う） */
    onOpenInEditor?: (file: ConfigGenResultFile) => void;
}

interface ResearchTarget {
    dirName: string;
    characterName: string;
}

type ConfirmKind =
    | { kind: 'deleteMemo'; memo: ResearchMemoEntry }
    | { kind: 'overwrite'; name: string; messageKey: string; proceed: () => void }
    | { kind: 'closeWhileRunning' };

const DEFAULT_TIMEOUT_MINUTES = 20;
const PROVIDERS: ModelProvider[] = ['antigravity', 'claude', 'gemini'];

const formatElapsed = (totalSeconds: number): string => {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const pad = (v: number) => String(v).padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
};

interface PingRecord {
    ok: boolean;
    at: string;
}

export const ConfigGenModal: React.FC<Props> = ({ isOpen, onClose, backendUrl, uiCatalog = null, headerTabs, onOpenInEditor }) => {
    const t = (key: string) => resolveMessage(uiCatalog, key, CONFIG_GEN_TEXT_FALLBACK_JA[key] || COMMON_TEXT_FALLBACK_JA[key] || key);
    const formatText = (template: string, values: Record<string, string>) =>
        Object.entries(values).reduce((text, [key, value]) => text.split(`{{${key}}}`).join(value), template);
    const resolveProgress = (text?: string, textKey?: string, args?: string[]): string => {
        if (!textKey) return text || '';
        let resolved = t(textKey);
        (args || []).forEach((arg, i) => { resolved = resolved.split(`{${i}}`).join(arg); });
        return resolved;
    };

    const { state, start, attach, cancel } = useConfigGenJob(backendUrl);

    // 画面幅（PC推奨）
    const [isWideScreen, setIsWideScreen] = useState(() =>
        typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches
    );
    useEffect(() => {
        const mql = window.matchMedia('(min-width: 1024px)');
        const onChange = (e: MediaQueryListEvent) => setIsWideScreen(e.matches);
        mql.addEventListener('change', onChange);
        return () => mql.removeEventListener('change', onChange);
    }, []);

    // 入力欄
    const [categories, setCategories] = useState<CategoryDef[]>([]);
    const [categoryId, setCategoryId] = useState('character');
    const [method, setMethod] = useState<'two_step' | 'one_shot'>('two_step');
    const [characterName, setCharacterName] = useState('');
    const [workTitle, setWorkTitle] = useState('');
    const [notes, setNotes] = useState('');
    const [provider, setProvider] = useState<ModelProvider>('antigravity');
    const [model, setModel] = useState('');
    const [effort, setEffort] = useState('');
    const [timeoutMinutes, setTimeoutMinutes] = useState(DEFAULT_TIMEOUT_MINUTES);
    const [models, setModels] = useState<Model[]>([]);

    // エディタ・調査メモ
    const [content, setContent] = useState('');
    const [researchTarget, setResearchTarget] = useState<ResearchTarget | null>(null);
    // 生成済み設定ファイル（表示中）。「設定ファイルを編集」ボタンの対象。
    const [generatedSetting, setGeneratedSetting] = useState<ConfigGenResultFile | null>(null);
    const [memoList, setMemoList] = useState<ResearchMemoEntry[]>([]);
    const [isPickerOpen, setIsPickerOpen] = useState(false);

    // プロバイダ利用可否
    const [cliStatus, setCliStatus] = useState<CLIStatusEntry[]>([]);
    const [pingRecords, setPingRecords] = useState<Record<string, PingRecord>>({});
    const [pingRunning, setPingRunning] = useState(false);

    const [confirm, setConfirm] = useState<ConfirmKind | null>(null);
    const [toast, setToast] = useState('');
    const [lastRequest, setLastRequest] = useState<ConfigGenSubmitRequest | null>(null);
    const settingsLoaded = useRef(false);
    const attached = useRef(false);
    const progressEndRef = useRef<HTMLDivElement | null>(null);

    const showToast = (msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(''), 2500);
    };

    // 初期データ: 種別・モデル・CLI状態・デフォルト設定・調査メモ一覧・実行中ジョブへの再接続。
    useEffect(() => {
        if (!isOpen) return;
        getCategories(backendUrl).then(setCategories).catch(() => {});
        axios.get(`${backendUrl}/api/models`).then(res => setModels(res.data?.models || [])).catch(() => {});
        getCLIStatus(backendUrl).then(setCliStatus).catch(() => {});
        refreshMemoList();
        if (!settingsLoaded.current) {
            settingsLoaded.current = true;
            getGlobalSettings(backendUrl).then(settings => {
                const saved = settings.configGen;
                if (saved && typeof saved === 'object') {
                    if (saved.provider && PROVIDERS.includes(saved.provider)) setProvider(saved.provider);
                    if (typeof saved.model === 'string') setModel(saved.model);
                    if (typeof saved.effort === 'string') setEffort(saved.effort);
                    if (typeof saved.timeoutMinutes === 'number') setTimeoutMinutes(saved.timeoutMinutes);
                    if (saved.method === 'two_step' || saved.method === 'one_shot') setMethod(saved.method);
                    if (saved.ping && typeof saved.ping === 'object') setPingRecords(saved.ping);
                }
            }).catch(() => {});
        }
        if (!attached.current && !state.running) {
            attached.current = true;
            attach(handleComplete, handleFinished).catch(() => {});
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, backendUrl]);

    const refreshMemoList = useCallback(() => {
        listResearchMemos(backendUrl, 'character').then(setMemoList).catch(() => {});
    }, [backendUrl]);

    useEffect(() => {
        progressEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, [state.progress.length]);

    // プロバイダの利用可否（CLI検出。レビュー002対応 7.6）。
    const cliFound = (p: ModelProvider): boolean => {
        const entry = cliStatus.find(c => c.id === p);
        return entry ? entry.status === 'ok' : true; // 状態が取れないときは絞らない
    };
    const providerModels = useMemo(
        () => models.filter(m => modelProviderOf(m) === provider),
        [models, provider]
    );
    useEffect(() => {
        if (providerModels.length > 0 && !providerModels.some(m => m.id === model)) {
            setModel(providerModels[0].id);
        }
    }, [providerModels, model]);

    // 疎通確認（任意実行。結果をグローバル設定へ記録）。
    const handlePing = async () => {
        if (!model || pingRunning) return;
        setPingRunning(true);
        try {
            const result = await pingModel(backendUrl, model);
            const record: PingRecord = { ok: !!result.success, at: new Date().toISOString() };
            const next = { ...pingRecords, [provider]: record };
            setPingRecords(next);
            updateGlobalSettings(backendUrl, { configGen: { ...(await currentSaved()), ping: next } }).catch(() => {});
            showToast(record.ok ? t(CONFIG_GEN_I18N_KEYS.pingOk) : t(CONFIG_GEN_I18N_KEYS.pingFailed));
        } catch {
            showToast(t(CONFIG_GEN_I18N_KEYS.pingFailed));
        } finally {
            setPingRunning(false);
        }
    };

    const currentSaved = async () => {
        const settings = await getGlobalSettings(backendUrl).catch(() => ({} as any));
        return (settings.configGen && typeof settings.configGen === 'object') ? settings.configGen : {};
    };

    // 実行時の値をデフォルトとして自動保存（レビュー002対応 7.3）。
    const persistDefaults = async () => {
        const saved = await currentSaved();
        updateGlobalSettings(backendUrl, {
            configGen: { ...saved, provider, model, effort, timeoutMinutes, method },
        }).catch(() => {});
    };

    // 完了通知（レビュー002対応 7.2）。
    const notify = (ok: boolean) => {
        const body = ok ? t(CONFIG_GEN_I18N_KEYS.notifyDone) : t(CONFIG_GEN_I18N_KEYS.notifyFailed);
        if (typeof Notification !== 'undefined') {
            if (Notification.permission === 'granted') {
                try { new Notification('AlSlime', { body }); } catch { /* 通知不可でも機能に影響なし */ }
            }
        }
        showToast(body);
    };

    const handleFinished = (status: string) => {
        if (status === 'completed') return; // 成功時は handleComplete 側でメモ読込等と併せて通知する
        notify(false);
    };

    const handleComplete = async (result: ConfigGenResultFile) => {
        if (result.kind === 'research') {
            try {
                const memo = await getResearchMemo(backendUrl, result.categoryId, result.dirName, result.fileName.replace(/_設定作成前メモ$/, ''));
                if (memo.exists) {
                    setContent(memo.content || '');
                    setResearchTarget({ dirName: result.dirName, characterName: result.fileName.replace(/_設定作成前メモ$/, '') });
                    setGeneratedSetting(null);
                    if (memo.workTitle) setWorkTitle(memo.workTitle);
                }
                refreshMemoList();
            } catch {
                showToast(t(CONFIG_GEN_I18N_KEYS.resultLoadFailed));
            }
            notify(true);
            return;
        }
        try {
            const c = await getConfigFile(backendUrl, result.categoryId, result.dirName, result.fileName);
            setContent(c);
            setResearchTarget(null);
            setGeneratedSetting(result);
        } catch {
            showToast(t(CONFIG_GEN_I18N_KEYS.resultLoadFailed));
        }
        notify(true);
    };

    // 実行（上書き保護 7.1 込み）。
    const submitJob = async (req: ConfigGenSubmitRequest) => {
        setLastRequest(req);
        persistDefaults();
        const res = await start(req, handleComplete, handleFinished);
        if (!res.ok) {
            showToast(resolveMessage(uiCatalog, res.errorKey || '', CONFIG_GEN_TEXT_FALLBACK_JA[res.errorKey || ''] || t(CONFIG_GEN_I18N_KEYS.submitFailed)));
        }
    };

    const buildRequest = (step?: number, target?: ResearchTarget): ConfigGenSubmitRequest => {
        const dirName = target ? target.dirName : characterName.trim();
        const character = target ? target.characterName : characterName.trim();
        return {
            categoryId,
            method,
            step: method === 'two_step' ? step : undefined,
            characterName: character,
            workTitle: workTitle.trim(),
            dirName,
            model,
            claudeEffort: provider === 'claude' ? effort : undefined,
            timeoutMinutes,
            locale: uiCatalog?.lang || 'ja',
            notes: notes.trim() || undefined,
        };
    };

    const runStep1OrOneShot = async (step?: number) => {
        if (!characterName.trim() || !workTitle.trim()) {
            showToast(t(CONFIG_GEN_I18N_KEYS.inputRequired));
            return;
        }
        const req = buildRequest(step);
        // 上書き保護: 出力先の実在チェック（設定ファイルは常にキャラクター名基準）。
        const isResearch = method === 'two_step' && step === 1;
        const exists = isResearch
            ? await getResearchMemo(backendUrl, categoryId, req.dirName, req.characterName).then(r => r.exists).catch(() => false)
            : await checkConfigFileExists(backendUrl, categoryId, req.characterName, req.characterName).catch(() => false);
        if (exists) {
            setConfirm({
                kind: 'overwrite',
                name: req.characterName,
                messageKey: isResearch ? CONFIG_GEN_I18N_KEYS.overwriteResearch : CONFIG_GEN_I18N_KEYS.overwriteSetting,
                proceed: () => { setResearchTarget(null); submitJob(req); },
            });
            return;
        }
        setResearchTarget(null);
        submitJob(req);
    };

    // 2段階目（調査メモを開いている状態のみ。実行前にエディタ内容を自動保存）。
    const runStep2 = async () => {
        if (!researchTarget) return;
        if (!workTitle.trim()) {
            showToast(t(CONFIG_GEN_I18N_KEYS.inputRequired));
            return;
        }
        try {
            await saveResearchMemo(backendUrl, categoryId, researchTarget.dirName, researchTarget.characterName, content);
        } catch {
            showToast(t(CONFIG_GEN_I18N_KEYS.researchSaveFailed));
            return;
        }
        const req = buildRequest(2, researchTarget);
        const exists = await checkConfigFileExists(backendUrl, categoryId, req.characterName, req.characterName).catch(() => false);
        if (exists) {
            setConfirm({
                kind: 'overwrite',
                name: req.characterName,
                messageKey: CONFIG_GEN_I18N_KEYS.overwriteSetting,
                proceed: () => submitJob(req),
            });
            return;
        }
        submitJob(req);
    };

    // 調査メモを開く。
    const handleOpenMemo = async (memo: ResearchMemoEntry) => {
        setIsPickerOpen(false);
        try {
            const res = await getResearchMemo(backendUrl, categoryId, memo.dirName, memo.characterName);
            if (res.exists) {
                setContent(res.content || '');
                setResearchTarget({ dirName: memo.dirName, characterName: memo.characterName });
                setGeneratedSetting(null);
                setCharacterName(memo.characterName);
                if (res.workTitle) setWorkTitle(res.workTitle);
            }
        } catch {
            showToast(t(CONFIG_GEN_I18N_KEYS.resultLoadFailed));
        }
    };

    // 調査メモの削除（確認後）。
    const doDeleteMemo = async (memo: ResearchMemoEntry) => {
        try {
            await deleteResearchMemo(backendUrl, categoryId, memo.dirName, memo.characterName);
            if (researchTarget && researchTarget.dirName === memo.dirName && researchTarget.characterName === memo.characterName) {
                setResearchTarget(null);
                setContent('');
            }
            refreshMemoList();
            showToast(t(CONFIG_GEN_I18N_KEYS.deleted));
        } catch {
            showToast(t(CONFIG_GEN_I18N_KEYS.deleteFailed));
        }
    };

    const handleSaveResearch = async () => {
        if (!researchTarget) return;
        try {
            await saveResearchMemo(backendUrl, categoryId, researchTarget.dirName, researchTarget.characterName, content);
            showToast(t(CONFIG_GEN_I18N_KEYS.researchSaved));
        } catch {
            showToast(t(CONFIG_GEN_I18N_KEYS.researchSaveFailed));
        }
    };

    // エディタで開いている調査メモ・生成済み設定の選択と本文を解除する。
    const handleClearEditorSelection = () => {
        setResearchTarget(null);
        setGeneratedSetting(null);
        setContent('');
    };

    const handleClose = () => {
        if (state.running) {
            setConfirm({ kind: 'closeWhileRunning' });
            return;
        }
        onClose();
    };

    const handleConfirmYes = () => {
        const c = confirm;
        setConfirm(null);
        if (!c) return;
        if (c.kind === 'deleteMemo') doDeleteMemo(c.memo);
        else if (c.kind === 'overwrite') c.proceed();
        else if (c.kind === 'closeWhileRunning') onClose();
    };

    if (!isOpen) return null;

    const running = state.running;
    const errorText = state.errorKey
        ? resolveMessage(uiCatalog, state.errorKey, CONFIG_GEN_TEXT_FALLBACK_JA[state.errorKey] || state.errorKey)
        : '';
    const currentMemo = researchTarget
        ? memoList.find(m => m.dirName === researchTarget.dirName && m.characterName === researchTarget.characterName)
        : undefined;

    const confirmMeta = confirm ? (
        confirm.kind === 'deleteMemo'
            ? { title: t(CONFIG_GEN_I18N_KEYS.deleteResearchTitle), message: formatText(t(CONFIG_GEN_I18N_KEYS.deleteResearchMessage), { name: confirm.memo.fileName }) }
            : confirm.kind === 'overwrite'
                ? { title: t(CONFIG_GEN_I18N_KEYS.overwriteTitle), message: formatText(t(confirm.messageKey), { name: confirm.name }) }
                : { title: t(CONFIG_GEN_I18N_KEYS.tab), message: t(CONFIG_GEN_I18N_KEYS.closeWhileRunning) }
    ) : null;

    const progressIcon = (kind: string) => {
        switch (kind) {
            case 'tool': return <Wrench size={12} className="text-yellow-400 shrink-0 mt-0.5" />;
            case 'done': return <CheckCircle2 size={12} className="text-green-400 shrink-0 mt-0.5" />;
            case 'error': return <AlertCircle size={12} className="text-red-400 shrink-0 mt-0.5" />;
            default: return <MessageSquare size={12} className="text-blue-400 shrink-0 mt-0.5" />;
        }
    };

    const inputCls = "w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-gray-500 disabled:opacity-60";
    const labelCls = "block text-xs text-gray-400 mb-1";

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-7xl h-[90vh] border border-green-700 flex flex-col overflow-hidden">
                {/* ヘッダー */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-green-800 bg-green-950 shrink-0">
                    <div className="flex items-center gap-4">
                        <h2 className="flex items-center gap-2 text-base font-semibold text-green-200">
                            <Bot size={16} className="text-purple-300" />
                            {t(CONFIG_GEN_I18N_KEYS.tab)}
                        </h2>
                        {headerTabs}
                    </div>
                    <button onClick={handleClose} className="text-green-400 hover:text-green-200 transition-colors">
                        <X size={18} />
                    </button>
                </div>

                {!isWideScreen ? (
                    <div className="flex-1 flex items-center justify-center p-8">
                        <p className="text-sm text-gray-400 text-center">{t(CONFIG_GEN_I18N_KEYS.narrowScreen)}</p>
                    </div>
                ) : (
                    <div className="flex flex-1 overflow-hidden">
                        {/* 左カラム: エディタ（タイトル欄なし・調査メモセレクタ付き） */}
                        <div className="flex flex-col flex-1 overflow-hidden border-r border-gray-700">
                            <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-700 shrink-0">
                                <button
                                    onClick={() => setIsPickerOpen(true)}
                                    className="flex items-center gap-2 flex-1 bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-sm text-gray-300 hover:border-purple-500 transition-colors text-left"
                                >
                                    <FolderOpen size={14} className="text-purple-400 shrink-0" />
                                    <span className="truncate">
                                        {currentMemo ? currentMemo.fileName : t(CONFIG_GEN_I18N_KEYS.pickResearch)}
                                    </span>
                                </button>
                                <button
                                    onClick={handleClearEditorSelection}
                                    disabled={!researchTarget && !generatedSetting}
                                    className="p-1.5 text-gray-500 hover:text-yellow-300 border border-gray-700 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                    title={t(CONFIG_GEN_I18N_KEYS.clearEditorSelection)}
                                    aria-label={t(CONFIG_GEN_I18N_KEYS.clearEditorSelection)}
                                >
                                    <X size={14} />
                                </button>
                                <button
                                    onClick={() => { if (currentMemo) setConfirm({ kind: 'deleteMemo', memo: currentMemo }); }}
                                    disabled={!currentMemo}
                                    className="p-1.5 text-gray-500 hover:text-red-400 border border-gray-700 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                    title={t(CONFIG_GEN_I18N_KEYS.deleteResearchTitle)}
                                >
                                    <Trash2 size={14} />
                                </button>
                            </div>
                            <div className="flex-1 overflow-y-auto px-4 py-3">
                                <textarea
                                    value={content}
                                    onChange={e => setContent(e.target.value)}
                                    className="w-full h-full bg-transparent border-none text-sm text-gray-200 focus:outline-none resize-none font-mono"
                                />
                            </div>
                            {/* 調査メモ編集中の保存バー */}
                            {researchTarget && (
                                <div className="flex items-center justify-between gap-3 px-4 py-2 border-t border-purple-800 bg-purple-950/30 shrink-0">
                                    <span className="text-xs text-purple-300">
                                        {t(CONFIG_GEN_I18N_KEYS.researchEditing)}：{researchTarget.characterName}
                                    </span>
                                    <button
                                        onClick={handleSaveResearch}
                                        className="flex items-center gap-1.5 px-3 py-1 text-xs text-white bg-purple-700 rounded hover:bg-purple-600 transition-colors"
                                    >
                                        <Save size={12} />
                                        {t(CONFIG_GEN_I18N_KEYS.saveResearch)}
                                    </button>
                                </div>
                            )}
                            {/* 生成済み設定ファイルの編集導線（設定ファイルタブへ移動して選択状態で開く） */}
                            {!researchTarget && generatedSetting && (
                                <div className="flex items-center justify-between gap-3 px-4 py-2 border-t border-green-800 bg-green-950/30 shrink-0">
                                    <span className="text-xs text-green-300 truncate">{generatedSetting.fileName}</span>
                                    <button
                                        onClick={() => onOpenInEditor?.(generatedSetting)}
                                        className="flex items-center gap-1.5 px-3 py-1 text-xs text-white bg-green-700 rounded hover:bg-green-600 transition-colors shrink-0"
                                    >
                                        <FolderOpen size={12} />
                                        {t(CONFIG_GEN_I18N_KEYS.openInEditor)}
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* 中カラム: AI自動作成の入力欄 */}
                        <div className="w-72 shrink-0 flex flex-col gap-3 px-4 py-4 overflow-y-auto border-r border-gray-700">
                            <p className="text-xs text-orange-400/90 leading-relaxed">{t(CONFIG_GEN_I18N_KEYS.disclaimer)}</p>

                            <div>
                                <label className={labelCls}>{t(CONFIG_GEN_I18N_KEYS.category)}</label>
                                <select value={categoryId} disabled={running} onChange={e => setCategoryId(e.target.value)} className={inputCls}>
                                    {categories.map(c => (
                                        <option key={c.id} value={c.id} disabled={!c.isCharacter}>{c.label}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className={labelCls}>{t(CONFIG_GEN_I18N_KEYS.mode)}</label>
                                <select value="research" disabled={running} onChange={() => {}} className={inputCls}>
                                    <option value="research">{t(CONFIG_GEN_I18N_KEYS.modeResearch)}</option>
                                    <option value="dialog" disabled>{t(CONFIG_GEN_I18N_KEYS.modeDialog)}</option>
                                </select>
                            </div>

                            <div>
                                <label className={labelCls}>{t(CONFIG_GEN_I18N_KEYS.characterName)}</label>
                                <input type="text" value={characterName} disabled={running} onChange={e => setCharacterName(e.target.value)} className={inputCls} />
                            </div>
                            <div>
                                <label className={labelCls}>{t(CONFIG_GEN_I18N_KEYS.workTitle)}</label>
                                <input type="text" value={workTitle} disabled={running} onChange={e => setWorkTitle(e.target.value)} className={inputCls} />
                            </div>

                            <div>
                                <label className={labelCls}>{t(CONFIG_GEN_I18N_KEYS.method)}</label>
                                <select value={method} disabled={running} onChange={e => setMethod(e.target.value as 'two_step' | 'one_shot')} className={inputCls}>
                                    <option value="two_step">{t(CONFIG_GEN_I18N_KEYS.methodTwoStep)}</option>
                                    <option value="one_shot">{t(CONFIG_GEN_I18N_KEYS.methodOneShot)}</option>
                                </select>
                            </div>

                            <div>
                                <label className={labelCls}>{t(CONFIG_GEN_I18N_KEYS.notes)}</label>
                                <textarea
                                    value={notes}
                                    disabled={running}
                                    onChange={e => setNotes(e.target.value)}
                                    placeholder={t(CONFIG_GEN_I18N_KEYS.notesPlaceholder)}
                                    rows={3}
                                    maxLength={2000}
                                    className={`${inputCls} resize-y`}
                                />
                            </div>

                            {/* AIプロバイダ → モデル の2段選択 */}
                            <div>
                                <label className={labelCls}>{t(CONFIG_GEN_I18N_KEYS.provider)}</label>
                                <select value={provider} disabled={running} onChange={e => setProvider(e.target.value as ModelProvider)} className={inputCls}>
                                    {PROVIDERS.map(p => {
                                        const found = cliFound(p);
                                        const ping = pingRecords[p];
                                        const suffix = !found
                                            ? `（${t(CONFIG_GEN_I18N_KEYS.providerNotFound)}）`
                                            : ping
                                                ? (ping.ok ? '' : `（${t(CONFIG_GEN_I18N_KEYS.pingFailed)}）`)
                                                : `（${t(CONFIG_GEN_I18N_KEYS.pingUnchecked)}）`;
                                        return (
                                            <option key={p} value={p} disabled={!found || (ping ? !ping.ok : false)}>
                                                {p}{suffix}
                                            </option>
                                        );
                                    })}
                                </select>
                                <button
                                    onClick={handlePing}
                                    disabled={running || pingRunning || !model}
                                    className="mt-1 text-xs text-purple-300 hover:text-purple-200 underline decoration-dotted disabled:opacity-40"
                                >
                                    {pingRunning ? t(CONFIG_GEN_I18N_KEYS.pingChecking) : t(CONFIG_GEN_I18N_KEYS.pingCheck)}
                                </button>
                            </div>

                            <div>
                                <label className={labelCls}>{t(CONFIG_GEN_I18N_KEYS.model)}</label>
                                <select value={model} disabled={running} onChange={e => setModel(e.target.value)} className={inputCls}>
                                    {providerModels.map(m => (
                                        <option key={m.id} value={m.id}>{m.name || m.id}</option>
                                    ))}
                                </select>
                                <p className="text-xs text-gray-500 mt-1 leading-relaxed">{t(CONFIG_GEN_I18N_KEYS.modelRecommend)}</p>
                            </div>

                            {/* Effort（Claude のみ） */}
                            {provider === 'claude' && (
                                <div>
                                    <label className={labelCls}>{t(CONFIG_GEN_I18N_KEYS.effort)}</label>
                                    <select value={effort} disabled={running} onChange={e => setEffort(e.target.value)} className={inputCls}>
                                        {CLAUDE_EFFORT_VALUES.map(v => (
                                            <option key={v} value={v}>
                                                {resolveMessage(uiCatalog, CLAUDE_EFFORT_I18N_KEY_BY_VALUE[v] || '', v || 'CLI default')}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            <div>
                                <label className={labelCls}>{t(CONFIG_GEN_I18N_KEYS.timeout)}</label>
                                <input
                                    type="number" min={1} max={60} value={timeoutMinutes} disabled={running}
                                    onChange={e => setTimeoutMinutes(Math.max(1, Math.min(60, Number(e.target.value) || DEFAULT_TIMEOUT_MINUTES)))}
                                    className={inputCls}
                                />
                            </div>

                            <p className="text-xs text-yellow-500/90 leading-relaxed">{t(CONFIG_GEN_I18N_KEYS.notice)}</p>

                            {/* 実行ボタン群 */}
                            {!running ? (
                                <div className="flex flex-col gap-2">
                                    {method === 'two_step' ? (
                                        <>
                                            <button onClick={() => runStep1OrOneShot(1)} className="flex items-center justify-center gap-2 w-full px-3 py-1.5 text-xs text-white bg-purple-700 rounded hover:bg-purple-600 transition-colors">
                                                <Play size={12} />
                                                {t(CONFIG_GEN_I18N_KEYS.runStep1)}
                                            </button>
                                            <button
                                                onClick={runStep2}
                                                disabled={!researchTarget}
                                                title={!researchTarget ? t(CONFIG_GEN_I18N_KEYS.step2RequiresResearch) : undefined}
                                                className="flex items-center justify-center gap-2 w-full px-3 py-1.5 text-xs text-white bg-purple-700 rounded hover:bg-purple-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                            >
                                                <Play size={12} />
                                                {t(CONFIG_GEN_I18N_KEYS.runStep2)}
                                            </button>
                                        </>
                                    ) : (
                                        <button onClick={() => runStep1OrOneShot()} className="flex items-center justify-center gap-2 w-full px-3 py-1.5 text-xs text-white bg-purple-700 rounded hover:bg-purple-600 transition-colors">
                                            <Play size={12} />
                                            {t(CONFIG_GEN_I18N_KEYS.run)}
                                        </button>
                                    )}
                                    {lastRequest && state.finishedStatus && (
                                        <button
                                            onClick={() => submitJob(lastRequest)}
                                            className="flex items-center justify-center gap-2 w-full px-3 py-1.5 text-xs text-gray-200 bg-gray-700 rounded hover:bg-gray-600 transition-colors"
                                        >
                                            <RotateCcw size={12} />
                                            {t(CONFIG_GEN_I18N_KEYS.rerun)}
                                        </button>
                                    )}
                                </div>
                            ) : (
                                <button onClick={cancel} className="flex items-center justify-center gap-2 w-full px-3 py-1.5 text-xs text-red-300 border border-red-700 rounded hover:bg-red-900/30 transition-colors">
                                    <Square size={12} />
                                    {t(CONFIG_GEN_I18N_KEYS.cancel)}
                                </button>
                            )}

                        </div>

                        {/* 右カラム: AIの作業経過 */}
                        <div className="w-80 shrink-0 flex flex-col overflow-hidden">
                            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 shrink-0">
                                <span className="text-xs text-gray-400">{t(CONFIG_GEN_I18N_KEYS.progressTitle)}</span>
                                {(running || state.progress.length > 0) && (
                                    <span className="text-xs text-green-300 font-mono">{formatElapsed(state.elapsedSeconds)}</span>
                                )}
                            </div>
                            <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-1.5">
                                {state.progress.map(entry => (
                                    <div key={entry.seq} className="flex items-start gap-1.5">
                                        {progressIcon(entry.kind)}
                                        <span className="text-xs text-gray-300 leading-relaxed break-all whitespace-pre-wrap">
                                            {resolveProgress(entry.text, entry.textKey, entry.args)}
                                        </span>
                                    </div>
                                ))}
                                {/* エラーは作業経過の一部としてここに表示する（実行欄には出さない） */}
                                {errorText && !running && (
                                    <div className="flex items-start gap-1.5">
                                        <AlertCircle size={12} className="text-red-400 shrink-0 mt-0.5" />
                                        <span className="text-xs text-red-400 leading-relaxed break-all whitespace-pre-wrap">{errorText}</span>
                                    </div>
                                )}
                                <div ref={progressEndRef} />
                            </div>
                        </div>
                    </div>
                )}

                {/* トースト */}
                {toast && (
                    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-gray-800 text-gray-200 text-sm px-4 py-2 rounded shadow-lg border border-gray-600 pointer-events-none">
                        {toast}
                    </div>
                )}
            </div>

            {/* 調査メモ選択モーダル */}
            <ResearchPickerModal
                isOpen={isPickerOpen}
                onClose={() => setIsPickerOpen(false)}
                uiCatalog={uiCatalog}
                memos={memoList}
                onSelect={handleOpenMemo}
                onRequestDelete={memo => { setIsPickerOpen(false); setConfirm({ kind: 'deleteMemo', memo }); }}
            />

            {/* 確認ダイアログ */}
            {confirm && confirmMeta && (
                <ConfirmDialog
                    isOpen={true}
                    title={confirmMeta.title}
                    message={confirmMeta.message}
                    onYes={handleConfirmYes}
                    onNo={() => setConfirm(null)}
                    onCancel={() => setConfirm(null)}
                    uiCatalog={uiCatalog}
                />
            )}
        </div>
    );
};
