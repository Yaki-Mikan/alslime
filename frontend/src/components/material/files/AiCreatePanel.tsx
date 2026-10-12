/**
 * AiCreatePanel.tsx - AI で作る（素材づくりの設定ファイル）
 *
 * ①条件 → ②調べる → ③設定を作る → ④確かめて保存 の手順で、AI に設定ファイルを作らせる。
 * キャラ以外の種別と「まとめて作る」は②を飛ばす。右には AI の作業経過を出す。
 * AI と話しながら作り込むのは設定ファイルの「対話で編集」タブで行い、ここでは扱わない。
 *
 * 呼び出し側は一度開いたら隠すだけにする（実行中のジョブの読み取りを続けるため）。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, FileText, Loader2, MessageSquare, Pencil, RotateCcw, Save, Square, Trash2, Wrench, X } from 'lucide-react';
import { CodeEditor } from '../../common/CodeEditor';
import { ConfirmDialog } from '../../ConfirmDialog';
import { ResearchPickerModal } from './ResearchPickerModal';
import { TemplateEditModal } from './TemplateEditModal';
import { Badge, Button, IconButton, Segmented, Select, TextArea, TextField, cn } from '../../ui';
import { useConfigGenJob } from '../../../hooks/useConfigGenJob';
import { invalidateSSRPOptionsCache } from '../../SSRP/RolePlaySettings';
import { subscribeConfigGenTemplatesChanged } from '../../../lib/configGenTemplatesChanged';
import {
    getResearchMemo,
    saveResearchMemo,
    deleteResearchMemo,
    listResearchMemos,
    type ConfigGenResultFile,
    type ConfigGenSubmitRequest,
    type ResearchMemoEntry,
} from '../../../api/config-gen';
import {
    getConfigFile,
    checkConfigFileExists,
    saveConfigFile,
    getCategories,
    getConfigGenInstruction,
    saveConfigGenInstruction,
    configGenInstructionId,
    listConfigGenTemplates,
    getConfigGenTemplate,
    saveConfigGenTemplate,
    getConfigGenTemplateDefaults,
    configGenTemplateDefaultName,
    normalizeConfigGenInstructionLocale,
} from '../../../api/config-editor';
import type { CategoryDef, ConfigGenTemplateDefaults } from '../../../api/config-editor';
import { formatLabelValue, resolveMessage, type I18NCatalog } from '../../../api/i18n';
import {
    CONFIG_GEN_I18N_KEYS,
    CONFIG_GEN_TEXT_FALLBACK_JA,
    COMMON_I18N_KEYS,
    COMMON_TEXT_FALLBACK_JA,
    MATERIAL_I18N_KEYS,
    MATERIAL_TEXT_FALLBACK_JA,
} from '../../../constants/i18n';
import { useConfigGenAi } from './useConfigGenAi';
import { ConfigGenAiPicker } from './ConfigGenAiPicker';

interface AiCreatePanelProps {
    /** 画面に出しているか（隠している間も実行中のジョブの読み取りは続く） */
    active: boolean;
    backendUrl: string;
    uiCatalog: I18NCatalog | null;
    /** やめる（設定ファイルの編集へ戻る） */
    onClose: () => void;
    /** できあがった設定ファイルを設定ファイルの編集で開く */
    onOpenInEditor: (file: ConfigGenResultFile, content: string) => void;
}

type Phase = 'conditions' | 'research' | 'setting' | 'review';
type Method = 'two_step' | 'one_shot';

interface ResearchTarget {
    dirName: string;
    characterName: string;
}

type ConfirmKind =
    | { kind: 'deleteMemo'; memo: ResearchMemoEntry }
    | { kind: 'overwrite'; name: string; messageKey: string; proceed: () => void }
    | { kind: 'templateSwitch'; apply: () => void }
    | { kind: 'memoSwitch'; apply: () => void };

const PHASE_LABEL_KEYS: Record<Phase, string> = {
    conditions: MATERIAL_I18N_KEYS.genStepConditions,
    research: MATERIAL_I18N_KEYS.genStepResearch,
    setting: MATERIAL_I18N_KEYS.genStepSetting,
    review: MATERIAL_I18N_KEYS.genStepReview,
};

const formatElapsed = (totalSeconds: number): string => {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const pad = (v: number) => String(v).padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
};

const labelCls = 'block text-xs text-fg-muted mb-1';

const Field: React.FC<{ label: string; className?: string; children: React.ReactNode }> = ({ label, className, children }) => (
    <div className={className}>
        <span className={labelCls}>{label}</span>
        {children}
    </div>
);

export const AiCreatePanel: React.FC<AiCreatePanelProps> = ({ active, backendUrl, uiCatalog, onClose, onOpenInEditor }) => {
    const t = (key: string) => resolveMessage(uiCatalog, key, CONFIG_GEN_TEXT_FALLBACK_JA[key] || MATERIAL_TEXT_FALLBACK_JA[key] || COMMON_TEXT_FALLBACK_JA[key] || key);
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

    const { state, start, attach, cancel } = useConfigGenJob(backendUrl);
    const running = state.running;

    const [phase, setPhase] = useState<Phase>('conditions');

    // ①条件
    const [categories, setCategories] = useState<CategoryDef[]>([]);
    const [categoryId, setCategoryId] = useState('character');
    const [method, setMethod] = useState<Method>('two_step');
    const [characterName, setCharacterName] = useState('');
    const [workTitle, setWorkTitle] = useState('');
    const [notes, setNotes] = useState('');

    // 使う AI（前回実行した値を既定として読む。作り方も前回の値を使う）
    const ai = useConfigGenAi(backendUrl, active, saved => {
        if (saved.method === 'two_step' || saved.method === 'one_shot') setMethod(saved.method);
    });

    // テンプレート（項目のテンプレートは①の中で開いて直せる）
    const [searchTemplates, setSearchTemplates] = useState<string[]>([]);
    const [settingTemplates, setSettingTemplates] = useState<string[]>([]);
    const [selectedSearchTemplate, setSelectedSearchTemplate] = useState('');
    const [selectedSettingTemplate, setSelectedSettingTemplate] = useState('');
    // 項目のテンプレート・使うテンプレートを直す小窓を開いているか
    const [itemsEditorOpen, setItemsEditorOpen] = useState(false);
    const [settingEditorOpen, setSettingEditorOpen] = useState(false);
    const [itemsContent, setItemsContent] = useState('');
    // 最後に読み込んだ（または保存した）項目の本文。itemsContent との差が保存していない変更。
    const [itemsLoaded, setItemsLoaded] = useState('');
    // 最後に正常に反映したテンプレートの読み込み条件（接続先・種別・UI の言語）。
    // null はまだ読んでいないか、読み込みに失敗した（次の表示で読み直す）。
    const templateLoadContext = useRef<string | null>(null);
    // テンプレート読み込みの世代番号。古い応答が新しい状態を上書きしないよう照らし合わせる。
    const templateLoadGeneration = useRef(0);

    // ②調べる
    const [memoList, setMemoList] = useState<ResearchMemoEntry[]>([]);
    const [researchTarget, setResearchTarget] = useState<ResearchTarget | null>(null);
    const [memoContent, setMemoContent] = useState('');
    const [memoLoaded, setMemoLoaded] = useState('');

    // ④確かめて保存
    const [resultFile, setResultFile] = useState<ConfigGenResultFile | null>(null);
    const [resultContent, setResultContent] = useState('');
    const [resultLoaded, setResultLoaded] = useState('');

    const [confirm, setConfirm] = useState<ConfirmKind | null>(null);
    const [toast, setToast] = useState('');
    const [lastRequest, setLastRequest] = useState<{ req: ConfigGenSubmitRequest; next: Phase } | null>(null);
    const attached = useRef(false);
    const progressEndRef = useRef<HTMLDivElement | null>(null);
    const [progressOpen, setProgressOpen] = useState(true);
    const [memoSaving, setMemoSaving] = useState(false);
    // 最後に保存できた調査メモの本文（今の本文と同じ間は「保存済み」を出す）
    const [memoSavedContent, setMemoSavedContent] = useState<string | null>(null);
    const [memoPickerOpen, setMemoPickerOpen] = useState(false);

    const showToast = (msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(''), 2500);
    };

    const currentCategory = categories.find(c => c.id === categoryId);
    const isCharacter = currentCategory ? currentCategory.isCharacter : categoryId === 'character';
    const effectiveMethod: Method = isCharacter ? method : 'one_shot';
    const twoStep = effectiveMethod === 'two_step';
    const steps: Phase[] = twoStep ? ['conditions', 'research', 'setting', 'review'] : ['conditions', 'setting', 'review'];
    const itemsDirty = itemsContent !== itemsLoaded;
    const memoDirty = memoContent !== memoLoaded;
    const failed = !running && !!state.finishedStatus && state.finishedStatus !== 'completed';

    const refreshMemoList = useCallback(() => {
        listResearchMemos(backendUrl, 'character').then(setMemoList).catch(() => {});
    }, [backendUrl]);

    // 出したとき：種別・調査メモの一覧・実行中のジョブへのつなぎ直し（使う AI の読み込みは useConfigGenAi が行う）
    useEffect(() => {
        if (!active) return;
        getCategories(backendUrl).then(setCategories).catch(() => {});
        refreshMemoList();
        if (!attached.current && !state.running) {
            attached.current = true;
            attach(handleComplete, handleFinished).catch(() => {});
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active, backendUrl]);

    // 経過が増えたときと、閉じていた欄を開いたときに、一番下の行まで送る
    useEffect(() => {
        progressEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, [state.progress.length, progressOpen]);

    // テンプレートの本文（名前の指定が無ければ同梱の固定ファイル）。読めなければ失敗を返す
    const loadTemplate = useCallback((cat: string, kind: 'search' | 'setting', name: string): Promise<string> => (
        name
            ? getConfigGenTemplate(backendUrl, cat, locale, kind, name)
            : getConfigGenInstruction(backendUrl, configGenInstructionId(cat, kind === 'search' ? 'search_template' : 'setting_template', locale))
    ), [backendUrl, locale]);

    // テンプレートへ保存する（名前の指定が無ければ同梱の固定ファイルへ）
    const saveTemplateContent = async (kind: 'search' | 'setting', name: string, content: string): Promise<void> => {
        if (name) await saveConfigGenTemplate(backendUrl, categoryId, locale, kind, name, content);
        else await saveConfigGenInstruction(backendUrl, configGenInstructionId(categoryId, kind === 'search' ? 'search_template' : 'setting_template', locale), content);
    };

    // 項目のテンプレートの本文。読めなければ空にする
    const readSearchTemplate = useCallback(async (cat: string, name: string): Promise<string> => {
        try {
            return await loadTemplate(cat, 'search', name);
        } catch {
            return '';
        }
    }, [loadTemplate]);

    // テンプレートの一覧と既定をまとめて取る。一部だけ成功した状態を反映しないよう、
    // どれかの失敗を全体の失敗として呼び出し側へ伝える。
    const fetchTemplateLists = useCallback(async (cat: string) => {
        const [search, setting, defaults] = await Promise.all([
            listConfigGenTemplates(backendUrl, cat, locale, 'search'),
            listConfigGenTemplates(backendUrl, cat, locale, 'setting'),
            getConfigGenTemplateDefaults(backendUrl),
        ]);
        return { search, setting, defaults: defaults as ConfigGenTemplateDefaults };
    }, [backendUrl, locale]);

    // テンプレートを今の条件（接続先・種別・UI の言語）で読み直す。replaceItems が真のときだけ項目の本文も差し替える。
    // 古い応答は世代番号で捨て、失敗した条件は読み込み済みとして残さない。
    const reloadTemplates = useCallback(async (cat: string, replaceItems: boolean) => {
        const gen = ++templateLoadGeneration.current;
        const ctx = `${backendUrl}${cat}${normalizedLocale}`;
        try {
            const r = await fetchTemplateLists(cat);
            if (gen !== templateLoadGeneration.current) return;
            setSearchTemplates(r.search);
            setSettingTemplates(r.setting);
            const pick = (names: string[], def: string) => names.includes(def) ? def : (names.length === 1 ? names[0] : '');
            const searchName = pick(r.search, configGenTemplateDefaultName(r.defaults, cat, locale, 'search'));
            const settingName = pick(r.setting, configGenTemplateDefaultName(r.defaults, cat, locale, 'setting'));
            setSelectedSearchTemplate(searchName);
            setSelectedSettingTemplate(settingName);
            if (replaceItems) {
                const items = await readSearchTemplate(cat, searchName);
                if (gen !== templateLoadGeneration.current) return;
                setItemsContent(items);
                setItemsLoaded(items);
            }
            templateLoadContext.current = ctx;
        } catch {
            templateLoadContext.current = null;
            showToast(t(CONFIG_GEN_I18N_KEYS.templateLoadFailed));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [backendUrl, normalizedLocale, locale, fetchTemplateLists, readSearchTemplate]);

    // 出したときと出している間の両方で、読み込み条件が最後に反映したものと違えば読み直す。
    // 項目の本文は直していないときだけ差し替え、直した本文は残す。
    useEffect(() => {
        if (!active) return;
        const ctx = `${backendUrl}${categoryId}${normalizedLocale}`;
        if (templateLoadContext.current === ctx) return;
        reloadTemplates(categoryId, itemsContent === itemsLoaded);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active, backendUrl, categoryId, normalizedLocale, reloadTemplates]);

    // 設定ファイルの「AI への指示」でテンプレートや既定が変わったら、一覧と既定を読み直して選択を既定に合わせる。
    // 隠している間に届いたときは読み込み済みの印だけ消し、次に出したときに上の処理で読み直す
    useEffect(() => subscribeConfigGenTemplatesChanged(() => {
        templateLoadContext.current = null;
        if (active) reloadTemplates(categoryId, itemsContent === itemsLoaded);
    }), [active, categoryId, itemsContent, itemsLoaded, reloadTemplates]);

    const handleCategoryChange = (cat: string) => {
        setCategoryId(cat);
        setResearchTarget(null);
        setMemoContent('');
        setMemoLoaded('');
        reloadTemplates(cat, true);
    };

    // 項目のテンプレートを切り替える（直した本文があれば確かめる）
    const applyTemplateSwitch = (name: string) => {
        const apply = async () => {
            setSelectedSearchTemplate(name);
            const c = await readSearchTemplate(categoryId, name);
            setItemsContent(c);
            setItemsLoaded(c);
        };
        if (itemsDirty) {
            setConfirm({ kind: 'templateSwitch', apply: () => { void apply(); } });
            return;
        }
        void apply();
    };

    // 直した項目をテンプレートへ保存する（名前の無い既定は同梱の固定ファイルへ）
    const saveItemsIfDirty = async (): Promise<boolean> => {
        if (!itemsDirty) return true;
        try {
            await saveTemplateContent('search', selectedSearchTemplate, itemsContent);
            setItemsLoaded(itemsContent);
            return true;
        } catch {
            showToast(t(MATERIAL_I18N_KEYS.genItemsSaveFailed));
            return false;
        }
    };

    // 小窓で直した項目のテンプレートを保存し、本文にも反映する（失敗は小窓の中で知らせる）
    const saveItemsTemplate = async (content: string): Promise<boolean> => {
        try {
            await saveTemplateContent('search', selectedSearchTemplate, content);
            setItemsContent(content);
            setItemsLoaded(content);
            showToast(t(CONFIG_GEN_I18N_KEYS.saved));
            return true;
        } catch {
            return false;
        }
    };

    // 小窓で直した使うテンプレートを保存する（失敗は小窓の中で知らせる）
    const saveSettingTemplate = async (content: string): Promise<boolean> => {
        try {
            await saveTemplateContent('setting', selectedSettingTemplate, content);
            showToast(t(CONFIG_GEN_I18N_KEYS.saved));
            return true;
        } catch {
            return false;
        }
    };

    const notify = (ok: boolean) => {
        const body = ok ? t(CONFIG_GEN_I18N_KEYS.notifyDone) : t(CONFIG_GEN_I18N_KEYS.notifyFailed);
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            try { new Notification('AlSlime', { body }); } catch { /* 通知できなくても機能に影響なし */ }
        }
        showToast(body);
    };

    const handleFinished = (status: string) => {
        if (status === 'completed') return; // 成功は handleComplete で知らせる
        notify(false);
    };

    const handleComplete = async (result: ConfigGenResultFile) => {
        // 会話からの一時キャラの取り込み（同じジョブの種類）は会話設定へ登録済みで、ここでは扱わない
        if (result.kind === 'tempCharacter') return;
        if (result.kind === 'research') {
            const name = result.fileName.replace(/_設定作成前メモ$/, '');
            try {
                const memo = await getResearchMemo(backendUrl, result.categoryId, result.dirName, name);
                if (memo.exists) {
                    setMemoContent(memo.content || '');
                    setMemoLoaded(memo.content || '');
                    setResearchTarget({ dirName: result.dirName, characterName: name });
                    setCharacterName(name);
                    if (memo.workTitle) setWorkTitle(memo.workTitle);
                }
                refreshMemoList();
            } catch {
                showToast(t(CONFIG_GEN_I18N_KEYS.resultLoadFailed));
            }
            setPhase('research');
            notify(true);
            return;
        }
        // 会話設定の選択肢の控えを捨てる（作ったファイルがすぐ一覧に出るように）
        invalidateSSRPOptionsCache();
        try {
            const c = await getConfigFile(backendUrl, result.categoryId, result.dirName, result.fileName);
            setResultContent(c);
            setResultLoaded(c);
            setResultFile(result);
            setPhase('review');
        } catch {
            showToast(t(CONFIG_GEN_I18N_KEYS.resultLoadFailed));
        }
        notify(true);
    };

    const submitJob = async (req: ConfigGenSubmitRequest, next: Phase) => {
        setLastRequest({ req, next });
        // 実行したときの値を次の既定として残す
        void ai.persist({ method });
        const res = await start(req, handleComplete, handleFinished);
        if (!res.ok) {
            showToast(resolveMessage(uiCatalog, res.errorKey || '', CONFIG_GEN_TEXT_FALLBACK_JA[res.errorKey || ''] || t(CONFIG_GEN_I18N_KEYS.submitFailed)));
            return;
        }
        setPhase(next);
    };

    const buildRequest = (step?: number, target?: ResearchTarget): ConfigGenSubmitRequest => {
        const name = target ? target.characterName : characterName.trim();
        const dirName = target ? target.dirName : name;
        return {
            categoryId,
            method: effectiveMethod,
            step: twoStep ? step : undefined,
            characterName: name,
            fileName: name,
            workTitle: workTitle.trim(),
            dirName,
            ...ai.requestFields(),
            locale,
            notes: notes.trim() || undefined,
            // まとめて作るときは項目の本文を指示へ差し込む
            editorContent: !twoStep && itemsContent.trim() ? itemsContent : undefined,
            searchTemplate: selectedSearchTemplate || undefined,
            settingTemplate: selectedSettingTemplate || undefined,
        };
    };

    // ①から始める：2段階なら調べ始め、まとめて作るなら設定を作る
    const runFromConditions = async () => {
        if (!characterName.trim() || (isCharacter && !workTitle.trim())) {
            showToast(isCharacter ? t(CONFIG_GEN_I18N_KEYS.inputRequired) : t(CONFIG_GEN_I18N_KEYS.fileNameRequired));
            return;
        }
        if (!(await saveItemsIfDirty())) return;
        const req = buildRequest(1);
        const next: Phase = twoStep ? 'research' : 'setting';
        // 上書きの確認：出力先が既にあるか（設定ファイルはキャラ名で置く）
        const exists = twoStep
            ? await getResearchMemo(backendUrl, categoryId, req.dirName, req.characterName).then(r => r.exists).catch(() => false)
            : await checkConfigFileExists(backendUrl, categoryId, req.characterName, req.characterName).catch(() => false);
        const proceed = () => {
            setResearchTarget(null);
            setMemoContent('');
            setMemoLoaded('');
            setResultFile(null);
            void submitJob(req, next);
        };
        if (exists) {
            setConfirm({
                kind: 'overwrite',
                name: req.characterName,
                messageKey: twoStep ? CONFIG_GEN_I18N_KEYS.overwriteResearch : CONFIG_GEN_I18N_KEYS.overwriteSetting,
                proceed,
            });
            return;
        }
        proceed();
    };

    const saveMemo = async (): Promise<boolean> => {
        if (!researchTarget) return false;
        setMemoSaving(true);
        try {
            await saveResearchMemo(backendUrl, categoryId, researchTarget.dirName, researchTarget.characterName, memoContent);
            setMemoLoaded(memoContent);
            setMemoSavedContent(memoContent);
            return true;
        } catch {
            showToast(t(CONFIG_GEN_I18N_KEYS.researchSaveFailed));
            return false;
        } finally {
            setMemoSaving(false);
        }
    };

    // ②から③へ：調査メモを保存してから設定を作る
    const runSetting = async () => {
        if (!researchTarget) return;
        if (!workTitle.trim()) {
            showToast(t(CONFIG_GEN_I18N_KEYS.inputRequired));
            return;
        }
        if (!(await saveMemo())) return;
        const req = buildRequest(2, researchTarget);
        const exists = await checkConfigFileExists(backendUrl, categoryId, req.characterName, req.characterName).catch(() => false);
        const proceed = () => {
            setResultFile(null);
            void submitJob(req, 'setting');
        };
        if (exists) {
            setConfirm({ kind: 'overwrite', name: req.characterName, messageKey: CONFIG_GEN_I18N_KEYS.overwriteSetting, proceed });
            return;
        }
        proceed();
    };

    const openMemo = (memo: ResearchMemoEntry) => {
        const apply = async () => {
            try {
                const res = await getResearchMemo(backendUrl, 'character', memo.dirName, memo.characterName);
                if (res.exists) {
                    setMemoContent(res.content || '');
                    setMemoLoaded(res.content || '');
                    setResearchTarget({ dirName: memo.dirName, characterName: memo.characterName });
                    setCharacterName(memo.characterName);
                    if (res.workTitle) setWorkTitle(res.workTitle);
                    setPhase('research');
                }
            } catch {
                showToast(t(CONFIG_GEN_I18N_KEYS.resultLoadFailed));
            }
        };
        if (memoDirty && researchTarget) {
            setConfirm({ kind: 'memoSwitch', apply: () => { void apply(); } });
            return;
        }
        void apply();
    };

    const doDeleteMemo = async (memo: ResearchMemoEntry) => {
        try {
            await deleteResearchMemo(backendUrl, 'character', memo.dirName, memo.characterName);
            if (researchTarget && researchTarget.dirName === memo.dirName && researchTarget.characterName === memo.characterName) {
                setResearchTarget(null);
                setMemoContent('');
                setMemoLoaded('');
            }
            refreshMemoList();
            showToast(t(CONFIG_GEN_I18N_KEYS.deleted));
        } catch {
            showToast(t(CONFIG_GEN_I18N_KEYS.deleteFailed));
        }
    };

    // ④設定ファイルとして開く（ファイルは AI が書き出し済み。④で直した内容があれば上書きしてから開く）
    const saveAndOpen = async () => {
        if (!resultFile) return;
        if (resultContent !== resultLoaded) {
            try {
                await saveConfigFile(backendUrl, resultFile.categoryId, resultFile.dirName, resultFile.fileName, resultContent);
                invalidateSSRPOptionsCache();
                setResultLoaded(resultContent);
            } catch {
                showToast(t(CONFIG_GEN_I18N_KEYS.saveFailed));
                return;
            }
        }
        onOpenInEditor(resultFile, resultContent);
        startOver();
    };

    // 最初から作る（種別・テンプレート・使う AI は残し、名前と結果を空にする）
    const startOver = () => {
        setPhase('conditions');
        setCharacterName('');
        setWorkTitle('');
        setNotes('');
        setResearchTarget(null);
        setMemoContent('');
        setMemoLoaded('');
        setResultFile(null);
        setResultContent('');
        setResultLoaded('');
        setLastRequest(null);
    };

    const goBack = () => {
        const i = steps.indexOf(phase);
        if (i > 0) setPhase(steps[i - 1]);
    };

    const handleConfirmYes = () => {
        const c = confirm;
        setConfirm(null);
        if (!c) return;
        if (c.kind === 'deleteMemo') void doDeleteMemo(c.memo);
        else if (c.kind === 'overwrite') c.proceed();
        else c.apply();
    };

    if (!active) return null;

    // 2段階の調べる段階（1段階目）で失敗し、メモが無いままか。設定を作れないので、代わりに再実行を出す
    //（保存済みのメモを選び直したときは、そのメモから設定を作れる）
    const researchFailed = failed && lastRequest?.next === 'research' && !researchTarget;

    const errorText = state.errorKey
        ? resolveMessage(uiCatalog, state.errorKey, CONFIG_GEN_TEXT_FALLBACK_JA[state.errorKey] || state.errorKey)
        : '';
    const currentMemo = researchTarget
        ? memoList.find(m => m.dirName === researchTarget.dirName && m.characterName === researchTarget.characterName)
        : undefined;
    const categoryLabel = (id: string) => resolveMessage(uiCatalog, `configEditor.category.${id}`, categories.find(c => c.id === id)?.label || id);
    const elapsedBadge = <Badge tone="warn">{formatText(t(MATERIAL_I18N_KEYS.genElapsed), { time: formatElapsed(state.elapsedSeconds) })}</Badge>;
    const phaseIndex = steps.indexOf(phase);

    const confirmMeta = confirm ? (
        confirm.kind === 'deleteMemo'
            ? { title: t(CONFIG_GEN_I18N_KEYS.deleteResearchTitle), message: formatText(t(CONFIG_GEN_I18N_KEYS.deleteResearchMessage), { name: confirm.memo.fileName }) }
            : confirm.kind === 'overwrite'
                ? { title: t(CONFIG_GEN_I18N_KEYS.overwriteTitle), message: formatText(t(confirm.messageKey), { name: confirm.name }) }
                : confirm.kind === 'templateSwitch'
                    ? { title: t(CONFIG_GEN_I18N_KEYS.templateSwitchTitle), message: t(CONFIG_GEN_I18N_KEYS.templateSwitchMessage) }
                    : { title: t(MATERIAL_I18N_KEYS.genMemo), message: t(MATERIAL_I18N_KEYS.genMemoSwitch) }
    ) : null;

    const progressIcon = (kind: string) => {
        switch (kind) {
            case 'tool': return <Wrench size={12} className="text-warn shrink-0 mt-0.5" />;
            case 'done': return <CheckCircle2 size={12} className="text-ok shrink-0 mt-0.5" />;
            case 'error': return <AlertCircle size={12} className="text-danger shrink-0 mt-0.5" />;
            default: return <MessageSquare size={12} className="text-accent shrink-0 mt-0.5" />;
        }
    };

    const cardCls = 'rounded-ui-lg border border-line bg-surface p-4 mb-3';

    const failedCard = failed && (
        <div className={cardCls}>
            <p className="text-sm text-danger">{t(MATERIAL_I18N_KEYS.genFailed)}</p>
            {errorText && <p className="mt-1 text-xs text-fg-muted whitespace-pre-wrap break-all">{errorText}</p>}
        </div>
    );

    const aiBox = (
        <ConfigGenAiPicker
            ai={ai}
            uiCatalog={uiCatalog}
            disabled={running}
            onPinged={ok => showToast(ok ? t(CONFIG_GEN_I18N_KEYS.pingOk) : t(CONFIG_GEN_I18N_KEYS.pingFailed))}
        />
    );

    // 設定を作るときに使うテンプレートの欄。条件の段階と調査メモの段階の両方に出し、同じ選択を変える
    const settingTemplateField = (
        <Field label={t(MATERIAL_I18N_KEYS.genTemplate)}>
            <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                    <Select
                        value={selectedSettingTemplate}
                        disabled={running}
                        onChange={setSelectedSettingTemplate}
                        options={[{ value: '', label: t(CONFIG_GEN_I18N_KEYS.templateDefaultOption) }, ...settingTemplates.map(n => ({ value: n, label: n }))]}
                    />
                </div>
                <Button size="sm" variant="secondary" className="shrink-0" disabled={running} onClick={() => setSettingEditorOpen(true)}>
                    <Pencil size={14} />
                    {t(MATERIAL_I18N_KEYS.genItemsOpen)}
                </Button>
            </div>
        </Field>
    );

    const conditionsBody = (
        <>
            <p className="text-xs text-fg-muted leading-relaxed mb-3">
                {t(MATERIAL_I18N_KEYS.genNotice)}
                <br />
                {t(MATERIAL_I18N_KEYS.genDialogHint)}
            </p>
            {running && (
                <div className={cn(cardCls, 'flex flex-wrap items-center gap-3')}>
                    <span className="text-sm">{t(MATERIAL_I18N_KEYS.genOtherRunning)}</span>
                    {elapsedBadge}
                </div>
            )}
            <div className={cn(cardCls, 'space-y-3')}>
                <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={t(CONFIG_GEN_I18N_KEYS.category)}>
                        <Select
                            value={categoryId}
                            disabled={running}
                            onChange={handleCategoryChange}
                            options={categories.map(c => ({ value: c.id, label: categoryLabel(c.id) }))}
                        />
                    </Field>
                    {settingTemplateField}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={isCharacter ? t(MATERIAL_I18N_KEYS.genName) : t(CONFIG_GEN_I18N_KEYS.fileName)}>
                        <TextField value={characterName} disabled={running} onChange={e => setCharacterName(e.target.value)} />
                    </Field>
                    {isCharacter && (
                        <Field label={t(CONFIG_GEN_I18N_KEYS.workTitle)}>
                            <TextField value={workTitle} disabled={running} onChange={e => setWorkTitle(e.target.value)} />
                        </Field>
                    )}
                </div>
                <Field label={t(MATERIAL_I18N_KEYS.genNotes)}>
                    <TextArea
                        value={notes}
                        disabled={running}
                        onChange={e => setNotes(e.target.value)}
                        placeholder={t(CONFIG_GEN_I18N_KEYS.notesPlaceholder)}
                        rows={3}
                        maxLength={2000}
                    />
                </Field>
                <div>
                    <span className="block text-xs text-fg-muted mb-1">{twoStep ? t(MATERIAL_I18N_KEYS.genItemsResearch) : t(MATERIAL_I18N_KEYS.genItemsInput)}</span>
                    <Field label={t(MATERIAL_I18N_KEYS.genItemsTemplate)}>
                        <div className="flex items-center gap-2">
                            <div className="flex-1 min-w-0">
                                <Select
                                    value={selectedSearchTemplate}
                                    disabled={running}
                                    onChange={applyTemplateSwitch}
                                    options={[{ value: '', label: t(CONFIG_GEN_I18N_KEYS.templateDefaultOption) }, ...searchTemplates.map(n => ({ value: n, label: n }))]}
                                />
                            </div>
                            <Button size="sm" variant="secondary" className="shrink-0" disabled={running} onClick={() => setItemsEditorOpen(true)}>
                                <Pencil size={14} />
                                {t(MATERIAL_I18N_KEYS.genItemsOpen)}
                            </Button>
                        </div>
                    </Field>
                </div>
                {isCharacter && (
                    <Field label={t(MATERIAL_I18N_KEYS.genMethod)}>
                        <Segmented<Method>
                            label={t(MATERIAL_I18N_KEYS.genMethod)}
                            value={method}
                            onChange={setMethod}
                            options={[
                                { value: 'two_step', label: t(MATERIAL_I18N_KEYS.genTwoStep) },
                                { value: 'one_shot', label: t(MATERIAL_I18N_KEYS.genOneShot) },
                            ]}
                        />
                    </Field>
                )}
                {aiBox}
            </div>
        </>
    );

    // 保存済みの調査メモを選ぶ欄。押すと検索できる小窓を開く
    const memoPicker = memoList.length > 0 && (
        <div className="flex items-center gap-2">
            <button
                type="button"
                disabled={running}
                aria-haspopup="dialog"
                onClick={() => setMemoPickerOpen(true)}
                className="flex-1 min-w-0 h-9 px-2.5 flex items-center gap-2 rounded-ui bg-surface border border-line-strong text-fg text-sm text-left outline-none focus:border-accent disabled:opacity-50"
            >
                <FileText size={14} className="shrink-0 text-fg-muted" />
                <span className={cn('flex-1 truncate', !currentMemo && 'text-fg-muted')}>
                    {currentMemo ? currentMemo.fileName : t(MATERIAL_I18N_KEYS.genMemoPick)}
                </span>
                <ChevronDown size={14} className="shrink-0 text-fg-muted" />
            </button>
            <IconButton
                label={t(CONFIG_GEN_I18N_KEYS.deleteResearchTitle)}
                disabled={!currentMemo || running}
                onClick={() => { if (currentMemo) setConfirm({ kind: 'deleteMemo', memo: currentMemo }); }}
            >
                <Trash2 size={16} />
            </IconButton>
        </div>
    );

    const researchBody = (
        <>
            {running && (
                <div className={cardCls}>
                    <div className="flex items-center gap-2 mb-2">
                        <span className="text-sm font-bold">{t(MATERIAL_I18N_KEYS.genResearching)}</span>
                        {elapsedBadge}
                    </div>
                    <p className="text-xs text-fg-muted">{t(MATERIAL_I18N_KEYS.genResearchHint)}</p>
                </div>
            )}
            {failedCard}
            {/* 調べる段階で失敗したら、使う AI を選び直して「再実行」できるようにする（メモが無いので設定は作れない） */}
            {researchFailed && <div className={cardCls}>{aiBox}</div>}
            <div className={cn(cardCls, 'space-y-3')}>
                {memoPicker}
                {researchTarget && (
                    <>
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-fg-muted">{formatLabelValue(uiCatalog, t(MATERIAL_I18N_KEYS.genMemo), researchTarget.characterName)}</span>
                            {memoDirty
                                ? <Badge tone="warn">{t(MATERIAL_I18N_KEYS.unsaved)}</Badge>
                                : memoSavedContent === memoContent && <Badge tone="ok">{t(MATERIAL_I18N_KEYS.saved)}</Badge>}
                            <Button size="sm" variant="secondary" className="ml-auto" disabled={running || memoSaving || !memoDirty} onClick={() => { void saveMemo().then(ok => { if (ok) showToast(t(CONFIG_GEN_I18N_KEYS.researchSaved)); }); }}>
                                {memoSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                                {memoSaving ? t(COMMON_I18N_KEYS.saving) : t(CONFIG_GEN_I18N_KEYS.saveResearch)}
                            </Button>
                        </div>
                        <div className="h-[50vh] min-h-64 border border-line rounded-ui overflow-hidden">
                            <CodeEditor value={memoContent} onChange={setMemoContent} onSave={() => { void saveMemo(); }} uiCatalog={uiCatalog} />
                        </div>
                        {/* 設定を作る前に、作る設定への要望・指示を書き足せるようにする。
                            条件の段階の備考と同じ値で、ここで直した内容を2段階目に送る */}
                        <Field label={t(CONFIG_GEN_I18N_KEYS.notes)}>
                            <TextArea
                                value={notes}
                                disabled={running}
                                onChange={e => setNotes(e.target.value)}
                                placeholder={t(CONFIG_GEN_I18N_KEYS.notesPlaceholder)}
                                rows={3}
                                maxLength={2000}
                            />
                        </Field>
                        {/* 設定を作る前に、使うテンプレートを選び直したり直したりできるようにする */}
                        {settingTemplateField}
                        {/* メモを直したあと、設定を作る前に使う AI を選び直せるようにする */}
                        {aiBox}
                    </>
                )}
            </div>
        </>
    );

    const settingBody = (
        <>
            {running && (
                <div className={cardCls}>
                    <div className="flex items-center gap-2 mb-2">
                        <span className="text-sm font-bold">{t(MATERIAL_I18N_KEYS.genMaking)}</span>
                        {elapsedBadge}
                    </div>
                    <p className="text-xs text-fg-muted">{t(MATERIAL_I18N_KEYS.genMakingHint)}</p>
                </div>
            )}
            {failedCard}
            {/* 失敗したら、使う AI を選び直して「再実行」できるようにする */}
            {failed && <div className={cardCls}>{aiBox}</div>}
        </>
    );

    const reviewBody = resultFile && (
        <>
            <div className={cardCls}>
                <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-bold">{t(MATERIAL_I18N_KEYS.genResult)}</span>
                    <Badge tone="ok">{t(MATERIAL_I18N_KEYS.genDone)}</Badge>
                    {resultContent !== resultLoaded && <Badge tone="warn">{t(MATERIAL_I18N_KEYS.unsaved)}</Badge>}
                </div>
                <div className="h-[50vh] min-h-64 border border-line rounded-ui overflow-hidden">
                    <CodeEditor value={resultContent} onChange={setResultContent} onSave={() => { void saveAndOpen(); }} uiCatalog={uiCatalog} />
                </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t(MATERIAL_I18N_KEYS.genSaveName)}>
                    <TextField value={resultFile.fileName} readOnly />
                </Field>
                <Field label={t(CONFIG_GEN_I18N_KEYS.category)}>
                    <TextField value={categoryLabel(resultFile.categoryId)} readOnly />
                </Field>
            </div>
        </>
    );

    // 下の帯：左にやめて閉じると戻る、右に次へ進むボタン（実行中は中止）。押せることが分かるよう、どのボタンにも枠を付ける。
    // 狭い画面では帯が縦に太らないよう、ボタンを一段小さくする
    const barButtonCls = 'max-sm:h-8 max-sm:px-2.5 max-sm:text-xs';
    // 失敗したジョブを、使う AI だけ今の選択に替えて同じ段階からやり直す
    const rerunButton = lastRequest && (
        <Button variant="secondary" className={barButtonCls} onClick={() => { void submitJob({ ...lastRequest.req, ...ai.requestFields() }, lastRequest.next); }}>
            <RotateCcw size={14} />
            {t(CONFIG_GEN_I18N_KEYS.rerun)}
        </Button>
    );
    const nextButton = running ? (
        <Button variant="danger" className={cn(barButtonCls, 'border border-danger')} onClick={() => { void cancel(); }}>
            <Square size={14} />
            {t(CONFIG_GEN_I18N_KEYS.cancel)}
        </Button>
    ) : phase === 'conditions' ? (
        <div className="flex flex-wrap gap-2 justify-end">
            {twoStep && memoList.length > 0 && (
                <Button variant="secondary" className={barButtonCls} onClick={() => setPhase('research')}>{t(MATERIAL_I18N_KEYS.genUseMemo)}</Button>
            )}
            <Button variant="primary" className={barButtonCls} onClick={() => { void runFromConditions(); }}>
                {twoStep ? t(MATERIAL_I18N_KEYS.genStartResearch) : t(MATERIAL_I18N_KEYS.genMakeSetting)}
            </Button>
        </div>
    ) : phase === 'research' ? (
        researchFailed ? rerunButton : (
            <Button variant="primary" className={barButtonCls} disabled={!researchTarget} onClick={() => { void runSetting(); }}>
                {t(MATERIAL_I18N_KEYS.genMakeSetting)}
            </Button>
        )
    ) : phase === 'setting' ? (
        failed ? rerunButton : null
    ) : (
        <Button variant="primary" className={barButtonCls} disabled={!resultFile} onClick={() => { void saveAndOpen(); }}>
            <FileText size={14} />
            {t(MATERIAL_I18N_KEYS.genSaveOpen)}
        </Button>
    );

    return (
        <div className={cn(
            'relative flex-1 min-h-0 grid grid-cols-1 overflow-hidden',
            progressOpen ? 'lg:grid-cols-[minmax(0,1fr)_360px]' : 'lg:grid-cols-[minmax(0,1fr)_auto]',
        )}>
            <section className="flex flex-col min-h-0 min-w-0">
                <div className="shrink-0 flex items-center gap-3 px-4 sm:px-5 py-2.5 border-b border-line">
                    <h2 className="font-head text-base font-bold">{t(MATERIAL_I18N_KEYS.aiCreate)}</h2>
                    {/* 下の帯の「やめて閉じる」と同じ働き。見出しの端でも見つけられるよう、枠付きの×を置く */}
                    <Button
                        variant="secondary"
                        className="ml-auto w-9 px-0"
                        aria-label={t(MATERIAL_I18N_KEYS.genClose)}
                        title={t(MATERIAL_I18N_KEYS.genClose)}
                        onClick={onClose}
                    >
                        <X size={18} />
                    </Button>
                </div>
                <ol className="shrink-0 flex gap-1.5 px-4 sm:px-5 py-3 border-b border-line overflow-x-auto">
                    {steps.map((s, i) => {
                        const done = i < phaseIndex;
                        const on = i === phaseIndex;
                        return (
                            <li
                                key={s}
                                aria-current={on ? 'step' : undefined}
                                className={cn(
                                    'flex-1 min-w-max flex items-center gap-2 px-2.5 py-2 rounded-ui border text-xs',
                                    on ? 'border-accent bg-accent-soft text-fg' : 'border-line text-fg-muted',
                                )}
                            >
                                <span className={cn(
                                    'w-5 h-5 shrink-0 rounded-full grid place-items-center font-bold',
                                    done || on ? 'bg-accent text-on-accent' : 'bg-surface-2 text-fg-muted',
                                )}>
                                    {done ? '✓' : i + 1}
                                </span>
                                {t(PHASE_LABEL_KEYS[s])}
                            </li>
                        );
                    })}
                </ol>
                <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-5 py-4">
                    {phase === 'conditions' && conditionsBody}
                    {phase === 'research' && researchBody}
                    {phase === 'setting' && settingBody}
                    {phase === 'review' && reviewBody}
                </div>
                <div className="shrink-0 flex items-center justify-between gap-2 px-4 sm:px-5 py-1.5 sm:py-2.5 border-t border-line">
                    {/* やめるボタンは戻るボタンの隣に置く。最初の段階では戻る先が無いので「戻る」は出さない（右のボタンが折り返しにくくなる） */}
                    <div className="flex items-center gap-2">
                        <Button variant="secondary" className={barButtonCls} onClick={onClose}>
                            <X size={14} />
                            {t(MATERIAL_I18N_KEYS.genClose)}
                        </Button>
                        {phase === 'review' ? (
                            <Button variant="secondary" className={barButtonCls} onClick={startOver}>{t(MATERIAL_I18N_KEYS.genStartOver)}</Button>
                        ) : phase !== 'conditions' && (
                            <Button variant="secondary" className={barButtonCls} disabled={running} onClick={goBack}>{t(MATERIAL_I18N_KEYS.genBack)}</Button>
                        )}
                    </div>
                    {nextButton}
                </div>
            </section>

            {/* AI の作業経過。見出しを押すと開け閉めする（閉じると広い画面では列が見出しの幅まで狭まり、狭い画面では見出しの一行だけになる） */}
            <aside className={cn(
                'flex flex-col min-h-0 border-t lg:border-t-0 lg:border-l border-line',
                progressOpen && 'max-h-[40vh] lg:max-h-none',
            )}>
                <button
                    type="button"
                    aria-expanded={progressOpen}
                    onClick={() => setProgressOpen(v => !v)}
                    className={cn(
                        'shrink-0 flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-surface transition-colors',
                        progressOpen && 'border-b border-line',
                    )}
                >
                    <span className="flex items-center gap-1.5 text-xs font-bold text-fg-muted">
                        {progressOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        {t(MATERIAL_I18N_KEYS.genProgress)}
                    </span>
                    {(running || state.progress.length > 0) && <span className="text-xs font-mono text-fg-muted">{formatElapsed(state.elapsedSeconds)}</span>}
                </button>
                {progressOpen && (
                <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 flex flex-col gap-1.5">
                    {state.progress.length === 0 && !errorText && (
                        <p className="text-xs text-fg-muted">{t(MATERIAL_I18N_KEYS.genProgressEmpty)}</p>
                    )}
                    {state.progress.map(entry => (
                        <div key={entry.seq} className="flex items-start gap-1.5">
                            {progressIcon(entry.kind)}
                            <span className={cn('text-xs leading-relaxed break-all whitespace-pre-wrap', entry.kind === 'tool' ? 'text-fg-muted' : 'text-fg')}>
                                {resolveProgress(entry.text, entry.textKey, entry.args)}
                            </span>
                        </div>
                    ))}
                    {errorText && !running && (
                        <div className="flex items-start gap-1.5">
                            <AlertCircle size={12} className="text-danger shrink-0 mt-0.5" />
                            <span className="text-xs text-danger leading-relaxed break-all whitespace-pre-wrap">{errorText}</span>
                        </div>
                    )}
                    <div ref={progressEndRef} />
                </div>
                )}
            </aside>

            {toast && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 bg-fg text-[rgb(var(--c-bg-rgb))] text-sm px-4 py-2 rounded-ui shadow-lg pointer-events-none">
                    {toast}
                </div>
            )}

            <TemplateEditModal
                open={itemsEditorOpen}
                title={formatLabelValue(uiCatalog, twoStep ? t(MATERIAL_I18N_KEYS.genItemsResearch) : t(MATERIAL_I18N_KEYS.genItemsInput), selectedSearchTemplate || t(CONFIG_GEN_I18N_KEYS.templateDefaultOption))}
                load={() => loadTemplate(categoryId, 'search', selectedSearchTemplate)}
                save={saveItemsTemplate}
                onClose={() => setItemsEditorOpen(false)}
                uiCatalog={uiCatalog}
            />
            <TemplateEditModal
                open={settingEditorOpen}
                title={formatLabelValue(uiCatalog, t(MATERIAL_I18N_KEYS.genTemplate), selectedSettingTemplate || t(CONFIG_GEN_I18N_KEYS.templateDefaultOption))}
                load={() => loadTemplate(categoryId, 'setting', selectedSettingTemplate)}
                save={saveSettingTemplate}
                onClose={() => setSettingEditorOpen(false)}
                uiCatalog={uiCatalog}
            />

            <ResearchPickerModal
                isOpen={memoPickerOpen}
                onClose={() => setMemoPickerOpen(false)}
                uiCatalog={uiCatalog}
                memos={memoList}
                current={currentMemo}
                onSelect={openMemo}
                onRequestDelete={memo => setConfirm({ kind: 'deleteMemo', memo })}
            />

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

export default AiCreatePanel;
