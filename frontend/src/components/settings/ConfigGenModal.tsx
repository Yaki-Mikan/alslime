import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CodeEditor } from '../common/CodeEditor';
import { X, Play, Square, Save, Wrench, CheckCircle2, AlertCircle, MessageSquare, Trash2, FolderOpen, RotateCcw, Bot, FileText, Send, Plus, Download } from 'lucide-react';
import axios from '../../lib/axios';
import { ConfirmDialog } from '../ConfirmDialog';
import { ResearchPickerModal } from './ResearchPickerModal';
import { DialogFilePickerModal } from './DialogFilePickerModal';
import { useConfigGenJob } from '../../hooks/useConfigGenJob';
import { useIsWideScreen } from '../../hooks/useIsWideScreen';
import { invalidateSSRPOptionsCache } from '../SSRP/RolePlaySettings';
import { CollapsibleSectionHeader } from '../common/CollapsibleSectionHeader';
import {
    getResearchMemo,
    saveResearchMemo,
    deleteResearchMemo,
    listResearchMemos,
    getCLIStatus,
    startConfigGenDialog,
    sendConfigGenDialog,
    getConfigGenDialog,
    contentHash,
    type ConfigGenResultFile,
    type ConfigGenSubmitRequest,
    type ResearchMemoEntry,
    type CLIStatusEntry,
    type ConfigGenDialogSession,
    type ConfigGenDialogMessage,
} from '../../api/config-gen';
import {
    getConfigFile,
    checkConfigFileExists,
    saveConfigFile,
    listConfigFiles,
    getCategories,
    getInitialContent,
    getConfigGenInstruction,
    configGenInstructionId,
    listConfigGenTemplates,
    getConfigGenTemplate,
    getConfigGenTemplateDefaults,
    configGenTemplateDefaultName,
    normalizeConfigGenInstructionLocale,
    listTemplates,
    getTemplate,
    getDefaultTemplates,
} from '../../api/config-editor';
import type { CategoryDef, ConfigFileEntry, ConfigGenTemplateDefaults } from '../../api/config-editor';
import { getGlobalSettings, updateGlobalSettings } from '../../api/global-settings';
import { downloadTemplatePack } from '../../api/settings-pack';
import { pingModel } from '../../api/user-models';
import { resolveMessage, type I18NCatalog } from '../../api/i18n';
import { CONFIG_GEN_I18N_KEYS, CONFIG_GEN_TEXT_FALLBACK_JA, CLAUDE_EFFORT_I18N_KEY_BY_VALUE, ANTIGRAVITY_THINKING_I18N_KEY_BY_VALUE, COMMON_I18N_KEYS, COMMON_TEXT_FALLBACK_JA } from '../../constants/i18n';
import { CLAUDE_EFFORT_VALUES } from '../../constants/claude';
import {
    DEFAULT_ANTIGRAVITY_THINKING,
    antigravityThinkingLevelsOf,
    normalizeAntigravityThinking,
    type AntigravityThinking,
} from '../../constants/antigravity';
import type { Model, ModelProvider } from '../../hooks/useChat';
import { modelProviderOf } from '../../hooks/useChat';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    backendUrl: string;
    uiCatalog?: I18NCatalog | null;
    headerTabs?: React.ReactNode;
    /**
     * 生成済み設定ファイルを設定ファイルタブで開く（Hub がタブ切替と選択状態の受け渡しを行う）。
     * content は左エディタで編集中の本文（サーバー上の内容と異なれば設定ファイルタブ側で未保存扱いになる）。
     */
    onOpenInEditor?: (file: ConfigGenResultFile, content: string) => void;
    /** 入力項目テンプレートを設定ファイルタブ（設定自動生成指示種別）で開く。引数は指示ファイル ID。 */
    onOpenInstructionInEditor?: (instructionId: string) => void;
}

interface ResearchTarget {
    dirName: string;
    characterName: string;
}

type Mode = 'research' | 'dialog';

type ConfirmKind =
    | { kind: 'deleteMemo'; memo: ResearchMemoEntry }
    | { kind: 'overwrite'; name: string; messageKey: string; proceed: () => void }
    | { kind: 'closeWhileRunning' }
    | { kind: 'unsavedSend'; message: string }
    | { kind: 'newDialog' }
    | { kind: 'templateSwitch'; apply: () => void };

const DEFAULT_TIMEOUT_MINUTES = 20;
const PROVIDERS: ModelProvider[] = ['antigravity', 'claude', 'gemini'];
const SETTINGS_HIDDEN_STORAGE_KEY = 'alslime.configGen.settingsHidden';

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

const readSettingsHidden = (): boolean => {
    try { return localStorage.getItem(SETTINGS_HIDDEN_STORAGE_KEY) === '1'; } catch { return false; }
};

export const ConfigGenModal: React.FC<Props> = ({ isOpen, onClose, backendUrl, uiCatalog = null, headerTabs, onOpenInEditor, onOpenInstructionInEditor }) => {
    const t = (key: string) => resolveMessage(uiCatalog, key, CONFIG_GEN_TEXT_FALLBACK_JA[key] || COMMON_TEXT_FALLBACK_JA[key] || key);
    const formatText = (template: string, values: Record<string, string>) =>
        Object.entries(values).reduce((text, [key, value]) => text.split(`{{${key}}}`).join(value), template);
    const resolveProgress = (text?: string, textKey?: string, args?: string[]): string => {
        if (!textKey) return text || '';
        let resolved = t(textKey);
        (args || []).forEach((arg, i) => { resolved = resolved.split(`{${i}}`).join(arg); });
        return resolved;
    };
    const locale = uiCatalog?.lang || 'ja';
    const normalizedLocale = normalizeConfigGenInstructionLocale(locale);

    const { state, start, attachJob, attach, cancel } = useConfigGenJob(backendUrl);

    // 画面幅（PC推奨）
    const isWideScreen = useIsWideScreen();
    // 狭画面時の各エリア開閉状態（縦積み表示でのみ使用）
    const [editorOpen, setEditorOpen] = useState(true);
    const [settingsOpen, setSettingsOpen] = useState(true);
    const [progressOpen, setProgressOpen] = useState(false);
    // 広画面での生成設定欄の表示／非表示（縦長トグルボタン）
    const [settingsHidden, setSettingsHidden] = useState(readSettingsHidden);
    useEffect(() => {
        try { localStorage.setItem(SETTINGS_HIDDEN_STORAGE_KEY, settingsHidden ? '1' : '0'); } catch { /* 記憶できなくても機能に影響なし */ }
    }, [settingsHidden]);
    // 狭画面で実行が始まったら作業経過エリアを自動で開く
    useEffect(() => {
        if (state.running) setProgressOpen(true);
    }, [state.running]);

    // 入力欄
    const [categories, setCategories] = useState<CategoryDef[]>([]);
    const [categoryId, setCategoryId] = useState('character');
    const [mode, setMode] = useState<Mode>('research');
    const [method, setMethod] = useState<'two_step' | 'one_shot'>('two_step');
    const [characterName, setCharacterName] = useState('');
    const [workTitle, setWorkTitle] = useState('');
    const [notes, setNotes] = useState('');
    const [provider, setProvider] = useState<ModelProvider>('antigravity');
    const [model, setModel] = useState('');
    const [effort, setEffort] = useState('');
    const [antigravityThinking, setAntigravityThinking] = useState<AntigravityThinking>(DEFAULT_ANTIGRAVITY_THINKING);
    const [timeoutMinutes, setTimeoutMinutes] = useState(DEFAULT_TIMEOUT_MINUTES);
    const [models, setModels] = useState<Model[]>([]);

    // エディタ・調査メモ・設定ファイル
    const [content, setContent] = useState('');
    // 最後にサーバーから読み込んだ（または保存した）本文。content との差が未保存編集。
    const [loadedContent, setLoadedContent] = useState('');
    const [researchTarget, setResearchTarget] = useState<ResearchTarget | null>(null);
    // 生成済み・対話中の設定ファイル（表示中）。「設定ファイルを編集」ボタンと保存の対象。
    const [generatedSetting, setGeneratedSetting] = useState<ConfigGenResultFile | null>(null);
    const [memoList, setMemoList] = useState<ResearchMemoEntry[]>([]);
    const [fileList, setFileList] = useState<ConfigFileEntry[]>([]);
    const [isPickerOpen, setIsPickerOpen] = useState(false);
    const [isFilePickerOpen, setIsFilePickerOpen] = useState(false);

    // 対話作成
    const [dialog, setDialog] = useState<ConfigGenDialogSession | null>(null);
    const [dialogInput, setDialogInput] = useState('');

    // テンプレートパック
    const [templatePackOverwrite, setTemplatePackOverwrite] = useState(false);
    const [templatePackRunning, setTemplatePackRunning] = useState(false);
    // 新規作成ボタン押下後は、同名の既存セッションがあっても引き継がず新しいセッションで始める。
    const startFresh = useRef(false);

    // テンプレート（入力項目・設定ファイルは AI 向け。手動作成向けは対話の新規作成の下書き）
    const [searchTemplates, setSearchTemplates] = useState<string[]>([]);
    const [settingTemplates, setSettingTemplates] = useState<string[]>([]);
    const [manualTemplates, setManualTemplates] = useState<string[]>([]);
    const [selectedSearchTemplate, setSelectedSearchTemplate] = useState('');
    const [selectedSettingTemplate, setSelectedSettingTemplate] = useState('');
    const [selectedManualTemplate, setSelectedManualTemplate] = useState('');
    // 最後に正常反映したテンプレート読込コンテキスト（backendUrl・対象・UI言語）。
    // null は未読込または読込失敗（次の表示で再試行する）。
    const templateLoadContext = useRef<string | null>(null);
    // テンプレート読込の世代番号。古い HTTP 応答が新しい状態を上書きしないよう照合する。
    const templateLoadGeneration = useRef(0);

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

    const currentCategory = categories.find(c => c.id === categoryId);
    const isCharacter = currentCategory ? currentCategory.isCharacter : categoryId === 'character';
    const isDialogMode = mode === 'dialog';
    const editorDirty = content !== loadedContent;
    const running = state.running;

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

    const refreshFileList = useCallback((cat: string) => {
        listConfigFiles(backendUrl, cat).then(setFileList).catch(() => setFileList([]));
    }, [backendUrl]);

    useEffect(() => {
        progressEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, [state.progress.length, dialog?.messages.length]);

    // プロバイダの利用可否（CLI検出）。
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
    // Antigravity の Thinking 選択肢は選択中モデルの thinkingLevels（サーバ正本）から出し、
    // 選べないレベルは Low へ落とす。
    const antigravityThinkingLevels = useMemo(
        () => (provider === 'antigravity' ? antigravityThinkingLevelsOf(providerModels.find(m => m.id === model)) : []),
        [provider, providerModels, model]
    );
    useEffect(() => {
        if (antigravityThinkingLevels.length > 0 && !antigravityThinkingLevels.includes(antigravityThinking)) {
            setAntigravityThinking(normalizeAntigravityThinking(antigravityThinking, antigravityThinkingLevels));
        }
    }, [antigravityThinkingLevels, antigravityThinking]);

    // 入力項目テンプレートの本文（名前指定 → 無ければ同梱の固定ファイル）。
    const readSearchTemplate = useCallback(async (cat: string, name: string): Promise<string> => {
        try {
            if (name) return await getConfigGenTemplate(backendUrl, cat, locale, 'search', name);
            return await getConfigGenInstruction(backendUrl, configGenInstructionId(cat, 'search_template', locale));
        } catch {
            return '';
        }
    }, [backendUrl, locale]);

    // 手動作成向けテンプレートの本文（名前指定 → 無ければ既定解決の初期本文）。
    const readManualTemplate = useCallback(async (cat: string, name: string): Promise<string> => {
        try {
            if (name) return await getTemplate(backendUrl, cat, name);
            return await getInitialContent(backendUrl, cat);
        } catch {
            return '';
        }
    }, [backendUrl]);

    // テンプレート一覧と既定を一括取得する。一部だけ成功した状態を反映しないよう、
    // 個別の失敗も全体の失敗として呼び出し側へ伝える。
    const fetchTemplateLists = useCallback(async (cat: string) => {
        const [search, setting, manual, defaults, mDefaults] = await Promise.all([
            listConfigGenTemplates(backendUrl, cat, locale, 'search'),
            listConfigGenTemplates(backendUrl, cat, locale, 'setting'),
            listTemplates(backendUrl, cat),
            getConfigGenTemplateDefaults(backendUrl),
            getDefaultTemplates(backendUrl),
        ]);
        return { search, setting, manual, defaults: defaults as ConfigGenTemplateDefaults, mDefaults };
    }, [backendUrl, locale]);

    // 左エディタの初期表示（種別・モード・方式に応じたテンプレート）。
    // 一括作成は入力項目テンプレート、対話作成の新規は手動作成向けテンプレート、二段階は空。
    const loadInitialEditor = useCallback(async (cat: string, m: Mode, meth: 'two_step' | 'one_shot', charCat: boolean, names: { searchName: string; manualName: string }) => {
        let initial = '';
        if (m === 'dialog') {
            initial = await readManualTemplate(cat, names.manualName);
        } else if (!charCat || meth === 'one_shot') {
            initial = await readSearchTemplate(cat, names.searchName);
        }
        setContent(initial);
        setLoadedContent(initial);
    }, [readManualTemplate, readSearchTemplate]);

    // テンプレート情報を現在のコンテキスト（接続先・対象・UI言語）で読み直して反映する。
    // replaceContent が真の場合のみ左エディタ本文も初期表示へ差し替える。
    // 古い応答は世代番号の照合で捨て、失敗したコンテキストは読込済みとして記録しない。
    const reloadTemplates = useCallback(async (cat: string, m: Mode, meth: 'two_step' | 'one_shot', charCat: boolean, replaceContent: boolean) => {
        const gen = ++templateLoadGeneration.current;
        const ctx = `${backendUrl} ${cat} ${normalizedLocale}`;
        try {
            const r = await fetchTemplateLists(cat);
            if (gen !== templateLoadGeneration.current) return;
            setSearchTemplates(r.search);
            setSettingTemplates(r.setting);
            setManualTemplates(r.manual);
            const pick = (names: string[], def: string) => names.includes(def) ? def : (names.length === 1 ? names[0] : '');
            const searchName = pick(r.search, configGenTemplateDefaultName(r.defaults, cat, locale, 'search'));
            const settingName = pick(r.setting, configGenTemplateDefaultName(r.defaults, cat, locale, 'setting'));
            const manualName = pick(r.manual, r.mDefaults[cat] ?? '');
            setSelectedSearchTemplate(searchName);
            setSelectedSettingTemplate(settingName);
            setSelectedManualTemplate(manualName);
            if (replaceContent) {
                await loadInitialEditor(cat, m, meth, charCat, { searchName, manualName });
                if (gen !== templateLoadGeneration.current) return;
            }
            templateLoadContext.current = ctx;
        } catch {
            templateLoadContext.current = null;
            showToast(t(CONFIG_GEN_I18N_KEYS.templateLoadFailed));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [backendUrl, normalizedLocale, locale, fetchTemplateLists, loadInitialEditor]);

    // 画面を開いた時と表示中の両方で、コンテキスト（接続先・対象・UI言語）が
    // 最後に正常反映したものと異なれば読み直す。左エディタが初期表示状態の場合のみ
    // 本文も差し替え、手編集・調査メモ・生成済み設定・対話中・実行中は本文を保持する。
    useEffect(() => {
        if (!isOpen) return;
        const ctx = `${backendUrl} ${categoryId} ${normalizedLocale}`;
        if (templateLoadContext.current === ctx) return;
        const c = categories.find(x => x.id === categoryId);
        const charCat = c ? c.isCharacter : categoryId === 'character';
        const pristine = content === loadedContent && !researchTarget && !generatedSetting && !dialog && !running;
        reloadTemplates(categoryId, mode, method, charCat, pristine);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, backendUrl, categoryId, normalizedLocale, categories, reloadTemplates]);

    // 種別・モード・方式の変更時は選択を解除して初期表示に戻す（実行中は変えられない）。
    const resetEditorForSelection = useCallback((cat: string, m: Mode, meth: 'two_step' | 'one_shot') => {
        const c = categories.find(x => x.id === cat);
        const charCat = c ? c.isCharacter : cat === 'character';
        setResearchTarget(null);
        setGeneratedSetting(null);
        setDialog(null);
        setDialogInput('');
        if (!charCat && meth === 'two_step') {
            setMethod('one_shot');
            meth = 'one_shot';
        }
        reloadTemplates(cat, m, meth, charCat, true);
        if (m === 'dialog') refreshFileList(cat);
    }, [categories, reloadTemplates, refreshFileList]);

    const handleCategoryChange = (cat: string) => {
        setCategoryId(cat);
        resetEditorForSelection(cat, mode, method);
    };
    const handleModeChange = (m: Mode) => {
        setMode(m);
        resetEditorForSelection(categoryId, m, method);
    };
    const handleMethodChange = (meth: 'two_step' | 'one_shot') => {
        setMethod(meth);
        if (mode === 'research') resetEditorForSelection(categoryId, mode, meth);
    };

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

    // 実行時の値をデフォルトとして自動保存。
    const persistDefaults = async () => {
        const saved = await currentSaved();
        updateGlobalSettings(backendUrl, {
            configGen: { ...saved, provider, model, effort, timeoutMinutes, method },
        }).catch(() => {});
    };

    // 完了通知。
    const notify = (ok: boolean) => {
        const body = ok ? t(CONFIG_GEN_I18N_KEYS.notifyDone) : t(CONFIG_GEN_I18N_KEYS.notifyFailed);
        if (typeof Notification !== 'undefined') {
            if (Notification.permission === 'granted') {
                try { new Notification('AlSlime', { body }); } catch { /* 通知不可でも機能に影響なし */ }
            }
        }
        showToast(body);
    };

    // 対話セッションをサーバーから読み直す（応答の追記・失敗の記録を反映）。
    const refreshDialog = async (sessionId: string) => {
        try {
            const fresh = await getConfigGenDialog(backendUrl, sessionId);
            setDialog(fresh);
            return fresh;
        } catch {
            return null;
        }
    };

    const handleFinished = (status: string) => {
        if (status === 'completed') return; // 成功時は handleComplete 側でメモ読込等と併せて通知する
        if (dialog?.sessionId) refreshDialog(dialog.sessionId);
        notify(false);
    };

    const handleComplete = async (result: ConfigGenResultFile) => {
        if (result.kind === 'tempCharacter') {
            // セッションからの一時キャラクター取り込み（同じジョブ種別）は会話設定へ登録済みで、
            // 設定ファイルは無い。実行中ジョブへの再接続で拾った場合はここでは何もしない。
            return;
        }
        if (result.kind === 'research') {
            try {
                const memo = await getResearchMemo(backendUrl, result.categoryId, result.dirName, result.fileName.replace(/_設定作成前メモ$/, ''));
                if (memo.exists) {
                    setContent(memo.content || '');
                    setLoadedContent(memo.content || '');
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
        // 会話設定メニューの選択肢キャッシュを破棄する（生成したファイルが即座に一覧へ出るように）。
        invalidateSSRPOptionsCache();
        try {
            const c = await getConfigFile(backendUrl, result.categoryId, result.dirName, result.fileName);
            setContent(c);
            setLoadedContent(c);
            setResearchTarget(null);
            setGeneratedSetting(result);
            if (result.sessionId) {
                await refreshDialog(result.sessionId);
            }
        } catch {
            showToast(t(CONFIG_GEN_I18N_KEYS.resultLoadFailed));
        }
        notify(true);
    };

    // 実行（上書き保護込み）。
    const submitJob = async (req: ConfigGenSubmitRequest) => {
        setLastRequest(req);
        persistDefaults();
        const res = await start(req, handleComplete, handleFinished);
        if (!res.ok) {
            showToast(resolveMessage(uiCatalog, res.errorKey || '', CONFIG_GEN_TEXT_FALLBACK_JA[res.errorKey || ''] || t(CONFIG_GEN_I18N_KEYS.submitFailed)));
        }
    };

    const buildRequest = (step?: number, target?: ResearchTarget): ConfigGenSubmitRequest => {
        const name = target ? target.characterName : characterName.trim();
        const dirName = target ? target.dirName : name;
        const effectiveMethod = isCharacter ? method : 'one_shot';
        // 一括作成では左エディタの内容（入力項目）を指示文へ差し込む。
        const editorContent = effectiveMethod === 'one_shot' && !researchTarget && !generatedSetting ? content : undefined;
        return {
            categoryId,
            method: effectiveMethod,
            step: effectiveMethod === 'two_step' ? step : undefined,
            characterName: name,
            fileName: name,
            workTitle: workTitle.trim(),
            dirName,
            model,
            claudeEffort: provider === 'claude' ? effort : undefined,
            antigravityThinking: provider === 'antigravity' ? antigravityThinking : undefined,
            timeoutMinutes,
            locale,
            notes: notes.trim() || undefined,
            editorContent: editorContent && editorContent.trim() ? editorContent : undefined,
            searchTemplate: selectedSearchTemplate || undefined,
            settingTemplate: selectedSettingTemplate || undefined,
        };
    };

    const runStep1OrOneShot = async (step?: number) => {
        if (!characterName.trim() || (isCharacter && !workTitle.trim())) {
            showToast(isCharacter ? t(CONFIG_GEN_I18N_KEYS.inputRequired) : t(CONFIG_GEN_I18N_KEYS.fileNameRequired));
            return;
        }
        const req = buildRequest(step);
        // 上書き保護: 出力先の実在チェック（設定ファイルはキャラクターではキャラクター名基準）。
        const isResearch = req.method === 'two_step' && step === 1;
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
            setLoadedContent(content);
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

    // ---- 対話作成 ----

    // 対話セッションの開始（新規 or 既存ファイル）。
    const startDialog = async (fileName: string, dirName?: string, reset = false): Promise<ConfigGenDialogSession | null> => {
        try {
            const session = await startConfigGenDialog(backendUrl, {
                categoryId,
                dirName,
                fileName,
                provider,
                model,
                locale,
                editorContent: content,
                reset,
            });
            setDialog(session);
            setResearchTarget(null);
            setGeneratedSetting({
                kind: 'setting',
                categoryId: session.categoryId,
                dirName: session.dirName,
                fileName: session.fileName,
                relPath: '',
                sessionId: session.sessionId,
                fileHash: session.fileHash,
            });
            setCharacterName(session.fileName);
            if (!session.isNew || session.fileContent) {
                setContent(session.fileContent);
                setLoadedContent(session.fileContent);
            }
            return session;
        } catch (error: any) {
            const key = error?.response?.data?.messageKey || error?.response?.data?.error || '';
            showToast(resolveMessage(uiCatalog, key, CONFIG_GEN_TEXT_FALLBACK_JA[key] || t(CONFIG_GEN_I18N_KEYS.submitFailed)));
            return null;
        }
    };

    // 既存設定ファイルを対話の対象として開く。
    const handleOpenFile = async (file: ConfigFileEntry) => {
        setIsFilePickerOpen(false);
        startFresh.current = false;
        await startDialog(file.name, file.dirName);
    };

    // 送信本体（未保存確認の後に呼ばれる）。
    const sendDialog = async (message: string, editorContent: string) => {
        let session = dialog;
        if (!session) {
            const name = characterName.trim();
            if (!name) {
                showToast(t(CONFIG_GEN_I18N_KEYS.fileNameRequired));
                return;
            }
            session = await startDialog(name, undefined, startFresh.current);
            if (!session) return;
            startFresh.current = false;
        }
        persistDefaults();
        const hash = await contentHash(editorContent);
        // 楽観的に発言を追加（サーバー側にも追記される。完了時に読み直す）。
        const optimistic: ConfigGenDialogMessage = { role: 'user', content: message, timestamp: new Date().toISOString() };
        setDialog(prev => prev ? { ...prev, messages: [...prev.messages, optimistic] } : prev);
        setDialogInput('');
        try {
            const { jobId } = await sendConfigGenDialog(backendUrl, {
                sessionId: session.sessionId,
                message,
                editorContent,
                editorHash: hash,
                model,
                claudeEffort: provider === 'claude' ? effort : undefined,
                antigravityThinking: provider === 'antigravity' ? antigravityThinking : undefined,
                timeoutMinutes,
                locale,
            });
            setLoadedContent(editorContent);
            setContent(editorContent);
            attachJob(jobId, timeoutMinutes, handleComplete, handleFinished);
        } catch (error: any) {
            const key = error?.response?.data?.messageKey || error?.response?.data?.error || '';
            showToast(resolveMessage(uiCatalog, key, CONFIG_GEN_TEXT_FALLBACK_JA[key] || t(CONFIG_GEN_I18N_KEYS.submitFailed)));
            refreshDialog(session.sessionId);
        }
    };

    const handleSend = () => {
        const message = dialogInput.trim();
        if (!message || running) {
            if (!message) showToast(t(CONFIG_GEN_I18N_KEYS.messageRequired));
            return;
        }
        // 既存ファイルの対話中に未保存の編集があれば、保存して送るか破棄して送るかを確認する。
        if (dialog && !dialog.isNew && editorDirty) {
            setConfirm({ kind: 'unsavedSend', message });
            return;
        }
        sendDialog(message, content);
    };

    const handleNewDialog = async () => {
        const name = dialog?.fileName || characterName.trim();
        if (!name) {
            showToast(t(CONFIG_GEN_I18N_KEYS.fileNameRequired));
            return;
        }
        const wasNew = dialog?.isNew ?? true;
        if (wasNew) {
            await loadInitialEditor(categoryId, 'dialog', method, isCharacter, { searchName: selectedSearchTemplate, manualName: selectedManualTemplate });
        }
        await startDialog(name, dialog?.dirName, true);
    };

    // ---- 調査メモ ----

    const handleOpenMemo = async (memo: ResearchMemoEntry) => {
        setIsPickerOpen(false);
        try {
            const res = await getResearchMemo(backendUrl, categoryId, memo.dirName, memo.characterName);
            if (res.exists) {
                setContent(res.content || '');
                setLoadedContent(res.content || '');
                setResearchTarget({ dirName: memo.dirName, characterName: memo.characterName });
                setGeneratedSetting(null);
                setCharacterName(memo.characterName);
                if (res.workTitle) setWorkTitle(res.workTitle);
            }
        } catch {
            showToast(t(CONFIG_GEN_I18N_KEYS.resultLoadFailed));
        }
    };

    const doDeleteMemo = async (memo: ResearchMemoEntry) => {
        try {
            await deleteResearchMemo(backendUrl, categoryId, memo.dirName, memo.characterName);
            if (researchTarget && researchTarget.dirName === memo.dirName && researchTarget.characterName === memo.characterName) {
                setResearchTarget(null);
                setContent('');
                setLoadedContent('');
            }
            refreshMemoList();
            showToast(t(CONFIG_GEN_I18N_KEYS.deleted));
        } catch {
            showToast(t(CONFIG_GEN_I18N_KEYS.deleteFailed));
        }
    };

    // ---- 保存（保存ボタン・Ctrl+S 共通） ----

    const handleSave = async () => {
        if (researchTarget) {
            try {
                await saveResearchMemo(backendUrl, categoryId, researchTarget.dirName, researchTarget.characterName, content);
                setLoadedContent(content);
                showToast(t(CONFIG_GEN_I18N_KEYS.researchSaved));
            } catch {
                showToast(t(CONFIG_GEN_I18N_KEYS.researchSaveFailed));
            }
            return;
        }
        if (generatedSetting) {
            try {
                await saveConfigFile(backendUrl, generatedSetting.categoryId, generatedSetting.dirName, generatedSetting.fileName, content);
                invalidateSSRPOptionsCache();
                setLoadedContent(content);
                if (dialog) {
                    const hash = await contentHash(content);
                    setDialog(prev => prev ? { ...prev, isNew: false, fileHash: hash || prev.fileHash } : prev);
                }
                showToast(t(CONFIG_GEN_I18N_KEYS.saved));
            } catch {
                showToast(t(CONFIG_GEN_I18N_KEYS.saveFailed));
            }
            return;
        }
        // 対話モードで対象未選択（新規）のときは、ファイル名で設定ファイルとして保存する。
        const name = characterName.trim();
        if (isDialogMode && name) {
            try {
                await saveConfigFile(backendUrl, categoryId, name, name, content);
                invalidateSSRPOptionsCache();
                setLoadedContent(content);
                setGeneratedSetting({ kind: 'setting', categoryId, dirName: name, fileName: name, relPath: '' });
                showToast(t(CONFIG_GEN_I18N_KEYS.saved));
            } catch {
                showToast(t(CONFIG_GEN_I18N_KEYS.saveFailed));
            }
            return;
        }
        showToast(t(CONFIG_GEN_I18N_KEYS.noSaveTarget));
    };

    // 左上プルダウンでテンプレートを切り替える（未保存編集があれば確認）。
    const applyTemplateSwitch = (kind: 'search' | 'manual', name: string) => {
        const apply = async () => {
            if (kind === 'search') {
                setSelectedSearchTemplate(name);
                const c = await readSearchTemplate(categoryId, name);
                setContent(c);
                setLoadedContent(c);
            } else {
                setSelectedManualTemplate(name);
                const c = await readManualTemplate(categoryId, name);
                setContent(c);
                setLoadedContent(c);
            }
        };
        if (editorDirty) {
            setConfirm({ kind: 'templateSwitch', apply: () => { void apply(); } });
            return;
        }
        void apply();
    };

    // 新規作成: ファイル名を空にし、エディタを初期表示（テンプレート。無ければ空欄）へ戻す。
    const handleNew = () => {
        setCharacterName('');
        startFresh.current = true;
        resetEditorForSelection(categoryId, mode, method);
    };

    // 入力項目テンプレート（利用者が編集する主対象）を現在の UI 言語版で設定ファイルタブに開く。
    const handleOpenInstruction = () => {
        onOpenInstructionInEditor?.(configGenInstructionId(categoryId, 'search_template', locale));
    };

    // テンプレートパックの取り込み。
    const handleTemplatePack = async () => {
        if (templatePackRunning) return;
        setTemplatePackRunning(true);
        try {
            const lang = locale.toLowerCase().startsWith('en') ? 'en' : 'ja';
            const result = await downloadTemplatePack(backendUrl, lang, templatePackOverwrite ? 'overwrite' : 'skip');
            showToast(formatText(t(CONFIG_GEN_I18N_KEYS.templatePackDone), { count: String(result.written.length) }));
            // 取り込んだテンプレートを選択欄へ即時反映する（本文は差し替えない）。
            templateLoadContext.current = null;
            await reloadTemplates(categoryId, mode, method, isCharacter, false);
        } catch (error: any) {
            const key = error?.response?.data?.messageKey || 'settingsPack.templates.errorDownloadFailed';
            showToast(resolveMessage(uiCatalog, key, CONFIG_GEN_TEXT_FALLBACK_JA[key] || key));
        } finally {
            setTemplatePackRunning(false);
        }
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
        else if (c.kind === 'unsavedSend') sendDialog(c.message, content);
        else if (c.kind === 'newDialog') handleNewDialog();
        else if (c.kind === 'templateSwitch') c.apply();
    };

    const handleConfirmNo = () => {
        const c = confirm;
        setConfirm(null);
        if (!c) return;
        // 未保存確認の「いいえ」は編集を破棄して送信。
        if (c.kind === 'unsavedSend') {
            setContent(loadedContent);
            sendDialog(c.message, loadedContent);
        }
    };

    if (!isOpen) return null;

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
                : confirm.kind === 'unsavedSend'
                    ? { title: t(CONFIG_GEN_I18N_KEYS.unsavedSendTitle), message: t(CONFIG_GEN_I18N_KEYS.unsavedSendMessage) }
                    : confirm.kind === 'newDialog'
                        ? { title: t(CONFIG_GEN_I18N_KEYS.newDialog), message: t(CONFIG_GEN_I18N_KEYS.newDialogConfirm) }
                        : confirm.kind === 'templateSwitch'
                            ? { title: t(CONFIG_GEN_I18N_KEYS.templateSwitchTitle), message: t(CONFIG_GEN_I18N_KEYS.templateSwitchMessage) }
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

    const showEditor = isWideScreen || editorOpen;
    // 設定欄の非表示は対話モードのみ有効。調査／一括モードでは切替バーが無いので常に表示する
    const showSettings = isWideScreen ? !(isDialogMode && settingsHidden) : settingsOpen;
    const showProgress = isWideScreen || progressOpen;

    // 右カラム: 対話モードでは履歴（吹き出し）と実行中の経過を続けて表示する。
    const renderProgressEntries = () => (
        <>
            {state.progress.map(entry => (
                <div key={entry.seq} className="flex items-start gap-1.5">
                    {progressIcon(entry.kind)}
                    <span className={`text-xs leading-relaxed break-all whitespace-pre-wrap ${entry.kind === 'tool' ? 'text-gray-500' : 'text-gray-300'}`}>
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
        </>
    );

    const renderDialogMessages = () => {
        if (!dialog) return null;
        // 実行中の最後の user 発言は経過（progress）の直前に表示し、応答は完了後の読み直しで入る。
        return dialog.messages.map((m, i) => {
            if (m.role === 'user') {
                return (
                    <div key={`u-${i}`} className="self-end max-w-[90%] bg-purple-900/40 border border-purple-800 rounded px-3 py-1.5">
                        <span className="text-xs text-purple-100 leading-relaxed break-words whitespace-pre-wrap">{m.content}</span>
                    </div>
                );
            }
            if (m.canceled) return null;
            return (
                <div key={`a-${i}`} className="self-start max-w-[95%] bg-gray-800/70 border border-gray-700 rounded px-3 py-1.5">
                    <span className="text-xs text-gray-200 leading-relaxed break-words whitespace-pre-wrap">{m.content}</span>
                </div>
            );
        });
    };

    const progressTitle = isDialogMode ? t(CONFIG_GEN_I18N_KEYS.dialogTitle) : t(CONFIG_GEN_I18N_KEYS.progressTitle);
    const elapsedBadge = (running || state.progress.length > 0)
        ? <span className="text-xs text-green-300 font-mono">{formatElapsed(state.elapsedSeconds)}</span>
        : null;

    const dialogInputArea = (
        <div className="flex items-end gap-2 px-4 py-3 border-t border-gray-700 shrink-0 bg-gray-900">
            <textarea
                value={dialogInput}
                onChange={e => setDialogInput(e.target.value)}
                onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); handleSend(); } }}
                placeholder={t(CONFIG_GEN_I18N_KEYS.dialogPlaceholder)}
                rows={5}
                maxLength={4000}
                disabled={running}
                className={`${inputCls} resize-y min-h-[6rem] text-sm`}
            />
            <button
                onClick={handleSend}
                disabled={running || !dialogInput.trim()}
                className="flex items-center gap-1.5 px-3 py-2 text-xs text-white bg-purple-700 rounded hover:bg-purple-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            >
                <Send size={12} />
                {t(CONFIG_GEN_I18N_KEYS.send)}
            </button>
        </div>
    );

    const settingsPanel = (
        <div className="flex flex-col gap-3 px-4 py-4">
            <p className="text-xs text-orange-400/90 leading-relaxed">{t(CONFIG_GEN_I18N_KEYS.disclaimer)}</p>

            <div>
                <label className={labelCls}>{t(CONFIG_GEN_I18N_KEYS.category)}</label>
                <select value={categoryId} disabled={running} onChange={e => handleCategoryChange(e.target.value)} className={inputCls}>
                    {categories.map(c => (
                        <option key={c.id} value={c.id}>{resolveMessage(uiCatalog, `configEditor.category.${c.id}`, c.label)}</option>
                    ))}
                </select>
            </div>

            <div>
                <label className={labelCls}>{t(CONFIG_GEN_I18N_KEYS.mode)}</label>
                <select value={mode} disabled={running} onChange={e => handleModeChange(e.target.value as Mode)} className={inputCls}>
                    <option value="research">{isCharacter ? t(CONFIG_GEN_I18N_KEYS.modeResearch) : t(CONFIG_GEN_I18N_KEYS.modeBatch)}</option>
                    <option value="dialog">{t(CONFIG_GEN_I18N_KEYS.modeDialog)}</option>
                </select>
            </div>

            {isCharacter && (
                <>
                    <div>
                        <label className={labelCls}>{t(CONFIG_GEN_I18N_KEYS.characterName)}</label>
                        <input type="text" value={characterName} disabled={running || !!dialog} onChange={e => setCharacterName(e.target.value)} className={inputCls} />
                    </div>
                    <div>
                        <label className={labelCls}>{t(CONFIG_GEN_I18N_KEYS.workTitle)}</label>
                        <input type="text" value={workTitle} disabled={running} onChange={e => setWorkTitle(e.target.value)} className={inputCls} />
                    </div>
                </>
            )}

            {!isDialogMode && (
                <div>
                    {isCharacter && (
                        <>
                            <label className={labelCls}>{t(CONFIG_GEN_I18N_KEYS.method)}</label>
                            <select value={method} disabled={running} onChange={e => handleMethodChange(e.target.value as 'two_step' | 'one_shot')} className={inputCls}>
                                <option value="two_step">{t(CONFIG_GEN_I18N_KEYS.methodTwoStep)}</option>
                                <option value="one_shot">{t(CONFIG_GEN_I18N_KEYS.methodOneShot)}</option>
                            </select>
                        </>
                    )}
                    {onOpenInstructionInEditor && (
                        <button
                            type="button"
                            onClick={handleOpenInstruction}
                            className="mt-1 flex items-center gap-1.5 text-xs text-purple-300 hover:text-purple-200 underline decoration-dotted"
                        >
                            <FileText size={12} />
                            {isCharacter ? t(CONFIG_GEN_I18N_KEYS.researchTemplateSettings) : t(CONFIG_GEN_I18N_KEYS.inputTemplateSettings)}
                        </button>
                    )}
                </div>
            )}

            {!isDialogMode && (
                <div>
                    <label className={labelCls}>{t(CONFIG_GEN_I18N_KEYS.settingTemplate)}</label>
                    <select value={selectedSettingTemplate} disabled={running} onChange={e => setSelectedSettingTemplate(e.target.value)} className={inputCls}>
                        <option value="">{t(CONFIG_GEN_I18N_KEYS.templateDefaultOption)}</option>
                        {settingTemplates.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                </div>
            )}

            {/* テンプレートパック（手動作成向けテンプレート）の取り込み。対話作成でのみ表示 */}
            {isDialogMode && (
                <div className="flex flex-col gap-1">
                    <button
                        type="button"
                        onClick={handleTemplatePack}
                        disabled={running || templatePackRunning}
                        className="flex items-center gap-1.5 text-xs text-purple-300 hover:text-purple-200 underline decoration-dotted disabled:opacity-40"
                    >
                        <Download size={12} />
                        {t(CONFIG_GEN_I18N_KEYS.templatePack)}
                    </button>
                    <label className="flex items-center gap-1.5 text-xs text-gray-500">
                        <input type="checkbox" checked={templatePackOverwrite} onChange={e => setTemplatePackOverwrite(e.target.checked)} disabled={templatePackRunning} />
                        {t(CONFIG_GEN_I18N_KEYS.templatePackOverwrite)}
                    </label>
                </div>
            )}

            {!isDialogMode && (
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
            )}

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

            {/* Thinking（Antigravity のみ。選択肢はモデルごと） */}
            {provider === 'antigravity' && antigravityThinkingLevels.length > 0 && (
                <div>
                    <label className={labelCls}>{t(CONFIG_GEN_I18N_KEYS.antigravityThinking)}</label>
                    <select value={antigravityThinking} disabled={running} onChange={e => setAntigravityThinking(e.target.value as AntigravityThinking)} className={inputCls}>
                        {antigravityThinkingLevels.map(v => (
                            <option key={v} value={v}>
                                {resolveMessage(uiCatalog, ANTIGRAVITY_THINKING_I18N_KEY_BY_VALUE[v], v)}
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

            {/* 実行ボタン群（対話モードでは送信欄が実行口になるため中止のみ） */}
            {!running ? (
                !isDialogMode && (
                    <div className="flex flex-col gap-2">
                        {isCharacter && method === 'two_step' ? (
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
                )
            ) : (
                <button onClick={cancel} className="flex items-center justify-center gap-2 w-full px-3 py-1.5 text-xs text-red-300 border border-red-700 rounded hover:bg-red-900/30 transition-colors">
                    <Square size={12} />
                    {t(CONFIG_GEN_I18N_KEYS.cancel)}
                </button>
            )}
        </div>
    );

    const editorPanel = (
        <>
            <div className="flex flex-col gap-2 px-4 py-3 border-b border-gray-700 shrink-0">
                {isDialogMode ? (
                    <button
                        onClick={() => { refreshFileList(categoryId); setIsFilePickerOpen(true); }}
                        disabled={running}
                        className="flex items-center gap-2 w-full bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-sm text-gray-300 hover:border-purple-500 transition-colors text-left disabled:opacity-60"
                    >
                        <FolderOpen size={14} className="text-purple-400 shrink-0" />
                        <span className="truncate">
                            {dialog ? `${dialog.fileName}${dialog.isNew ? `（${t(CONFIG_GEN_I18N_KEYS.dialogNewFile)}）` : ''}` : t(CONFIG_GEN_I18N_KEYS.pickFile)}
                        </span>
                    </button>
                ) : isCharacter ? (
                    <div className="flex items-center gap-2">
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
                            onClick={() => { if (currentMemo) setConfirm({ kind: 'deleteMemo', memo: currentMemo }); }}
                            disabled={!currentMemo}
                            className="p-1.5 text-gray-500 hover:text-red-400 border border-gray-700 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                            title={t(CONFIG_GEN_I18N_KEYS.deleteResearchTitle)}
                        >
                            <Trash2 size={14} />
                        </button>
                    </div>
                ) : null}
                {/* テンプレート選択: 一括・二段階は入力項目テンプレート、対話の新規作成は手動作成向けテンプレート */}
                {!isDialogMode && !researchTarget && !generatedSetting && (
                    <div className="flex items-center gap-2">
                        <label className="text-xs text-gray-400 shrink-0">{t(CONFIG_GEN_I18N_KEYS.searchTemplate)}</label>
                        <select value={selectedSearchTemplate} disabled={running} onChange={e => applyTemplateSwitch('search', e.target.value)} className={inputCls}>
                            <option value="">{t(CONFIG_GEN_I18N_KEYS.templateDefaultOption)}</option>
                            {searchTemplates.map(n => <option key={n} value={n}>{n}</option>)}
                        </select>
                    </div>
                )}
                {isDialogMode && (!dialog || dialog.isNew) && (
                    <div className="flex items-center gap-2">
                        <label className="text-xs text-gray-400 shrink-0">{t(CONFIG_GEN_I18N_KEYS.manualTemplate)}</label>
                        <select value={selectedManualTemplate} disabled={running} onChange={e => applyTemplateSwitch('manual', e.target.value)} className={inputCls}>
                            <option value="">{t(CONFIG_GEN_I18N_KEYS.templateDefaultOption)}</option>
                            {manualTemplates.map(n => <option key={n} value={n}>{n}</option>)}
                        </select>
                    </div>
                )}
                {/* ファイル名（キャラクター以外はここが唯一の入力口。キャラクターは設定欄のキャラクター名と同じ値） */}
                <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-400 shrink-0">{isCharacter ? t(CONFIG_GEN_I18N_KEYS.characterName) : t(CONFIG_GEN_I18N_KEYS.fileName)}</label>
                    <input
                        type="text"
                        value={characterName}
                        disabled={running || !!dialog || !!researchTarget}
                        onChange={e => setCharacterName(e.target.value)}
                        className={inputCls}
                    />
                </div>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3">
                <CodeEditor
                    value={content}
                    onChange={setContent}
                    onSave={handleSave}
                    uiCatalog={uiCatalog}
                />
            </div>
            {/* 下部バー: 状態表示＋新規作成・保存（調査メモ・設定ファイル・対話のいずれでも同じ場所） */}
            <div className={`flex items-center justify-between gap-3 px-4 py-2 border-t shrink-0 ${researchTarget ? 'border-purple-800 bg-purple-950/30' : generatedSetting ? 'border-green-800 bg-green-950/30' : 'border-gray-700 bg-gray-900'}`}>
                <span className={`text-xs truncate ${researchTarget ? 'text-purple-300' : generatedSetting ? 'text-green-300' : 'text-gray-500'}`}>
                    {researchTarget
                        ? `${t(CONFIG_GEN_I18N_KEYS.researchEditing)}：${researchTarget.characterName}`
                        : generatedSetting
                            ? `${dialog ? `${t(CONFIG_GEN_I18N_KEYS.dialogEditing)}：` : ''}${generatedSetting.fileName}`
                            : t(CONFIG_GEN_I18N_KEYS.sectionEditor)}
                    {editorDirty ? ' *' : ''}
                </span>
                <div className="flex items-center gap-2 shrink-0">
                    {!researchTarget && generatedSetting && !(dialog && dialog.isNew) && (
                        <button
                            onClick={() => onOpenInEditor?.(generatedSetting, content)}
                            className="flex items-center gap-1.5 px-3 py-1 text-xs text-white bg-green-700 rounded hover:bg-green-600 transition-colors"
                        >
                            <FolderOpen size={12} />
                            {t(CONFIG_GEN_I18N_KEYS.openInEditor)}
                        </button>
                    )}
                    <button
                        onClick={handleNew}
                        disabled={running}
                        className="flex items-center gap-1.5 px-3 py-1 text-xs text-gray-200 bg-gray-700 rounded hover:bg-gray-600 transition-colors disabled:opacity-40"
                    >
                        <Plus size={12} />
                        {t(CONFIG_GEN_I18N_KEYS.dialogNewFile)}
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={running}
                        className="flex items-center gap-1.5 px-3 py-1 text-xs text-white bg-purple-700 rounded hover:bg-purple-600 transition-colors disabled:opacity-40"
                    >
                        <Save size={12} />
                        {researchTarget ? t(CONFIG_GEN_I18N_KEYS.saveResearch) : t(COMMON_I18N_KEYS.save)}
                    </button>
                </div>
            </div>
        </>
    );

    const progressBody = (
        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-1.5">
            {isDialogMode && renderDialogMessages()}
            {renderProgressEntries()}
            <div ref={progressEndRef} />
        </div>
    );

    const newDialogButton = isDialogMode ? (
        <button
            onClick={() => setConfirm({ kind: 'newDialog' })}
            disabled={running}
            className="flex items-center gap-1 text-xs text-purple-300 hover:text-purple-200 disabled:opacity-40"
            title={t(CONFIG_GEN_I18N_KEYS.newDialog)}
        >
            <Plus size={12} />
            {t(CONFIG_GEN_I18N_KEYS.newDialog)}
        </button>
    ) : null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-7xl h-[90vh] border border-green-700 flex flex-col overflow-hidden relative">
                {/* ヘッダー */}
                <div className={`flex justify-between gap-3 px-5 py-3 border-b border-green-800 bg-green-950 shrink-0 ${isWideScreen ? 'items-center' : 'items-start'}`}>
                    <div className={isWideScreen ? 'flex items-center gap-4' : 'flex flex-col gap-2 flex-1 min-w-0'}>
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

                {isWideScreen ? (
                    <div className="flex flex-1 overflow-hidden">
                        {/* 左カラム: エディタ */}
                        <div className="flex flex-col flex-1 overflow-hidden border-r border-gray-700">
                            {editorPanel}
                        </div>

                        {/* 右側: 上段（生成設定 ｜ トグル ｜ 対話／作業経過）＋下段（対話入力） */}
                        {/* 設定欄を隠しても右枠の幅は保ち、対話／作業経過欄を広げる */}
                        <div className="flex flex-col shrink-0 overflow-hidden" style={{ width: '38rem' }}>
                            <div className="flex flex-1 overflow-hidden">
                                {showSettings && (
                                    <div className="w-72 shrink-0 flex flex-col overflow-y-auto border-r border-gray-700">
                                        {settingsPanel}
                                    </div>
                                )}
                                {isDialogMode && (
                                    <button
                                        onClick={() => setSettingsHidden(v => !v)}
                                        className="w-2 shrink-0 bg-purple-500 hover:bg-purple-400 transition-colors cursor-pointer"
                                        aria-label={t(CONFIG_GEN_I18N_KEYS.toggleSettings)}
                                        title={t(CONFIG_GEN_I18N_KEYS.toggleSettings)}
                                    />
                                )}
                                <div className="flex-1 flex flex-col overflow-hidden">
                                    <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-700 shrink-0">
                                        <span className="text-xs text-gray-400">{progressTitle}</span>
                                        <div className="flex items-center gap-3">
                                            {newDialogButton}
                                            {elapsedBadge}
                                        </div>
                                    </div>
                                    {progressBody}
                                </div>
                            </div>
                            {isDialogMode && dialogInputArea}
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col flex-1 overflow-y-auto">
                        {/* 左（上）: エディタ */}
                        <div className={`flex flex-col shrink-0 border-b border-gray-700 ${editorOpen ? 'h-[60vh]' : ''}`}>
                            <CollapsibleSectionHeader label={t(CONFIG_GEN_I18N_KEYS.sectionEditor)} open={editorOpen} onToggle={() => setEditorOpen(v => !v)} />
                            {showEditor && editorPanel}
                        </div>
                        {/* 中: 生成設定 */}
                        <div className="flex flex-col shrink-0 border-b border-gray-700">
                            <CollapsibleSectionHeader label={t(CONFIG_GEN_I18N_KEYS.sectionSettings)} open={settingsOpen} onToggle={() => setSettingsOpen(v => !v)} />
                            {showSettings && settingsPanel}
                        </div>
                        {/* 右（下）: 対話／作業経過 */}
                        <div className={`flex flex-col shrink-0 ${progressOpen ? 'min-h-[40vh]' : ''}`}>
                            <CollapsibleSectionHeader
                                label={progressTitle}
                                open={progressOpen}
                                onToggle={() => setProgressOpen(v => !v)}
                                extra={<div className="flex items-center gap-3">{newDialogButton}{elapsedBadge}</div>}
                            />
                            {showProgress && progressBody}
                            {showProgress && isDialogMode && dialogInputArea}
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

            {/* 対話作成専用: 既存設定ファイル選択モーダル */}
            <DialogFilePickerModal
                isOpen={isFilePickerOpen}
                onClose={() => setIsFilePickerOpen(false)}
                uiCatalog={uiCatalog}
                files={fileList}
                onSelect={handleOpenFile}
            />

            {/* 確認ダイアログ */}
            {confirm && confirmMeta && (
                <ConfirmDialog
                    isOpen={true}
                    title={confirmMeta.title}
                    message={confirmMeta.message}
                    onYes={handleConfirmYes}
                    onNo={handleConfirmNo}
                    onCancel={() => setConfirm(null)}
                    uiCatalog={uiCatalog}
                />
            )}
        </div>
    );
};
