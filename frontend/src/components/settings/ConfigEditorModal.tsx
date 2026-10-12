import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Save, Trash2, Plus, FilePlus, BookTemplate, RotateCcw, Upload, Download, Star, MoreHorizontal, List, FileText, ChevronDown, ChevronRight, Rows3 } from 'lucide-react';
import { CodeEditor } from '../common/CodeEditor';
import { Button, Chip, IconButton, Modal, Segmented, TextField, cn } from '../ui';
import { DialogEditPanel } from '../material/files/DialogEditPanel';
import {
    listConfigGenTemplates,
    getConfigGenTemplate,
    saveConfigGenTemplate,
    deleteConfigGenTemplate,
    getConfigGenTemplateDefaults,
    setConfigGenTemplateDefault,
    configGenTemplateDefaultName,
    type ConfigGenTemplateKind,
    type ConfigGenTemplateDefaults,
} from '../../api/config-editor';
import { invalidateSSRPOptionsCache } from '../SSRP/RolePlaySettings';
import { directiveModeForDirectiveId } from '../SSRP/ImageGenerationSettings';
import { getComfyUIConfig } from '../../api/comfyui';
import { subscribeConfigFilesChanged } from '../../lib/configFilesChanged';
import { notifyConfigGenTemplatesChanged } from '../../lib/configGenTemplatesChanged';
import { ConfirmDialog } from '../ConfirmDialog';
import { SimpleCharacterForm, EMPTY_SIMPLE_CHARACTER, simpleCharacterToMarkdown } from './SimpleCharacterForm';
import { CharacterTagsEditor, type SaveHandle } from './character/CharacterTagsEditor';
import { EmotionImageTab } from './character/EmotionImageTab';
import { ImageGenTab } from './character/ImageGenTab';
import { VoiceTab } from './character/VoiceTab';
import { LinkedSettingsTab } from './character/LinkedSettingsTab';
import type { AppearancePromptHandle } from '../../hooks/useAppearancePromptGen';
import { useIsWideScreen } from '../../hooks/useIsWideScreen';
import type { SimpleCharacterConfig } from './SimpleCharacterForm';
import {
    getCategories,
    listConfigFiles,
    getConfigFile,
    checkConfigFileExists,
    saveConfigFile,
    deleteConfigFile,
    listTemplates,
    getTemplate,
    saveTemplate,
    deleteTemplate,
    getDefaultTemplates,
    setDefaultTemplate,
    getInitialContent,
    saveConfigFileUnique,
    listProviderInstructions,
    getProviderInstruction,
    saveProviderInstruction,
    listComfyDirectives,
    getComfyDirective,
    saveComfyDirective,
    resetComfyDirective,
    listConfigGenInstructions,
    getConfigGenInstruction,
    saveConfigGenInstruction,
    resetConfigGenInstruction,
    normalizeConfigGenInstructionLocale,
} from '../../api/config-editor';
import type { CategoryDef, ConfigFileEntry, ProviderInstruction, ComfyDirective, ConfigGenInstruction } from '../../api/config-editor';
import {
    fetchApiProviders,
    fetchApiProviderSystemPrompt,
    saveApiProviderSystemPrompt,
    type ApiProviderInstructionTarget,
    type ApiProviderInstructionLocale,
} from '../../api/api-providers';
import { formatLabelValue, formatWithNote, resolveMessage, type I18NCatalog } from '../../api/i18n';
import { downloadTemplatePack } from '../../api/settings-pack';
import {
    API_PROVIDERS_I18N_KEYS,
    API_PROVIDERS_TEXT_FALLBACK_JA,
    COMMON_I18N_KEYS,
    COMMON_TEXT_FALLBACK_JA,
    CONFIG_EDITOR_I18N_KEYS,
    CONFIG_GEN_I18N_KEYS,
    CONFIG_GEN_TEXT_FALLBACK_JA,
    CONFIG_EDITOR_TEXT_FALLBACK_JA,
    MATERIAL_I18N_KEYS,
    MATERIAL_TEXT_FALLBACK_JA,
} from '../../constants/i18n';

// OpenFileRequest は他タブ（設定自動生成）からの「このファイルを開いて」要求。
export interface OpenFileRequest {
    categoryId: string;
    dirName: string;
    fileName: string;
    // 開き元で編集中だった本文。指定があればサーバー上の内容の代わりにこれを表示し、
    // サーバー上の内容と異なれば未保存扱いにする（設定自動生成タブの編集内容を捨てないため）。
    content?: string;
}

interface Props {
    /** 設定ファイルのタブを見せているか（隠している間は描かないが、編集中の state は残す） */
    isOpen: boolean;
    backendUrl: string;
    uiCatalog?: I18NCatalog | null;
    // 設定自動生成タブからの「生成済みファイルを開く」要求（消費したら通知して null に戻してもらう）。
    openFileRequest?: OpenFileRequest | null;
    onOpenFileRequestConsumed?: () => void;
    openApiProviderInstruction?: ApiProviderInstructionTarget | null;
    onOpenApiProviderInstructionConsumed?: () => void;
    /**
     * 種別「画像生成分析指示」の表示可否。判定（ComfyUI機能が有効な支援レベル
     * かつ ComfyUI連携モジュール連携済み）は呼び出し側で行い結果だけを受け取る。
     */
    comfyDirectiveVisible?: boolean;
    /**
     * キャラクター種別の中央エリアに画像生成設定タブを出すか（支援者 Tier 充足 AND 画像生成サイドカー active）。
     * 判定は Hub 側で済ませた結果だけを受け取る。
     */
    imageGenEnabled?: boolean;
    /** 同上。音声紐づけタブ（TTS）の表示可否。 */
    ttsEnabled?: boolean;
    /** キャラクター容姿プロンプト作成の小窓の状態（Hub が持つ。画像生成設定区画へ流す） */
    appearancePrompt?: AppearancePromptHandle;
    /** 一覧の「新規作成」の隣に並べる操作（素材づくりの「AI で作る」） */
    headerActions?: React.ReactNode;
}

type ConfirmKind =
    | { kind: 'newFile' }
    | { kind: 'toStandard' }
    // name：上書きを確かめる名前（無ければタイトル欄の名前）
    | { kind: 'overwrite'; proceed: () => void; name?: string }
    | { kind: 'delete' }
    | { kind: 'deleteTemplate'; name: string };

// AIプロバイダ指示ファイル種別の疑似カテゴリ ID（フロント内のみ。backend カテゴリとは別系統）。
const PROVIDER_CATEGORY_ID = '__provider__';
// 画像生成分析指示種別の疑似カテゴリ ID（同上。4ファイルのプルダウン選択と上書き保存のみ）。
// openFileRequest でこの種別を開く場合は fileName に directive ID を渡す（Hub の中継用に公開）。
export const COMFY_DIRECTIVE_CATEGORY_ID = '__comfyDirective__';
// 設定自動生成指示種別の疑似カテゴリ ID（同上。対象→指示ファイルの2段プルダウンと上書き保存のみ）。
// openFileRequest でこの種別を開く場合は fileName に instruction ID を渡す（Hub の中継用に公開）。
export const CONFIG_GEN_INSTRUCTION_CATEGORY_ID = '__configGenInstruction__';
const API_CONNECTION_INSTRUCTION_PREFIX = 'openai-compat-connection:';

interface EditableProviderInstruction extends ProviderInstruction {
    connectionId?: string;
    locale?: ApiProviderInstructionLocale;
}

const apiConnectionInstructionID = (connectionId: string, locale: ApiProviderInstructionLocale) => (
    `${API_CONNECTION_INSTRUCTION_PREFIX}${connectionId}:${locale}`
);


// 種別の6つのまとまり（素材づくりの一覧の切り替え）
type KindGroupId = 'character' | 'scene' | 'individual' | 'user' | 'style' | 'ai';
const KIND_GROUPS: { id: KindGroupId; labelKey: string; categories: string[] }[] = [
    { id: 'character', labelKey: MATERIAL_I18N_KEYS.kindCharacter, categories: ['character'] },
    { id: 'scene', labelKey: MATERIAL_I18N_KEYS.kindScene, categories: ['worldview', 'stage', 'situation'] },
    { id: 'individual', labelKey: MATERIAL_I18N_KEYS.kindIndividual, categories: ['personality', 'outfit', 'background'] },
    { id: 'user', labelKey: MATERIAL_I18N_KEYS.kindUser, categories: ['user', 'occupation'] },
    { id: 'style', labelKey: MATERIAL_I18N_KEYS.kindStyle, categories: ['writingStyle'] },
    { id: 'ai', labelKey: MATERIAL_I18N_KEYS.kindAi, categories: ['__provider__', '__configGenInstruction__', '__comfyDirective__'] },
];

// 右の付属のタブ
type AuxTab = 'info' | 'dialog' | 'faces' | 'imageGen' | 'voice' | 'linked';
// 狭い画面では本文の入力欄もタブの一つとして並べる
type PaneTab = AuxTab | 'body';
// 付属の欄の表示の形：タブで一つずつ（既定）か、開け閉めできる区画を縦に並べるか
type AuxLayout = 'tabs' | 'stack';

// 広い画面の列の幅。付属の欄はドラッグで広げられ、最小は刷新時の固定幅。本文には少なくとも BODY_MIN_WIDTH を残す。
// 幅は表示の形ごとに別に覚える
const LIST_WIDTH = 260;
const AUX_MIN_WIDTH = 400;
const BODY_MIN_WIDTH = 360;
// 縦に並べる形の既定は、付属の欄の中身の入れ物（余白込み）が 540px になる幅（欄の左の枠線 1px を足す）
const AUX_DEFAULT_WIDTH: Record<AuxLayout, number> = { tabs: AUX_MIN_WIDTH, stack: 541 };
const AUX_WIDTH_STORAGE_KEY: Record<AuxLayout, string> = {
    tabs: 'alslime.configEditor.auxWidth',
    stack: 'alslime.configEditor.auxWidthStack',
};
const AUX_LAYOUT_STORAGE_KEY = 'alslime.configEditor.auxLayout';
const AUX_OPEN_STORAGE_KEY = 'alslime.configEditor.auxOpen';
// 縦に並べる形で、初めに開いている区画
const DEFAULT_AUX_OPEN: Record<AuxTab, boolean> = { info: false, dialog: false, faces: true, imageGen: false, voice: false, linked: false };

const readStored = (key: string): string | null => {
    try { return localStorage.getItem(key); } catch { return null; }
};
const writeStored = (key: string, value: string) => {
    try { localStorage.setItem(key, value); } catch { /* 覚えられなくても表示は使える */ }
};
const loadAuxWidths = (): Record<AuxLayout, number> => {
    const load = (layout: AuxLayout) => {
        const raw = readStored(AUX_WIDTH_STORAGE_KEY[layout]);
        const stored = raw === null ? NaN : Number(raw);
        return Number.isFinite(stored) && stored >= AUX_MIN_WIDTH ? stored : AUX_DEFAULT_WIDTH[layout];
    };
    return { tabs: load('tabs'), stack: load('stack') };
};
const loadAuxOpen = (): Record<AuxTab, boolean> => {
    try {
        const parsed: unknown = JSON.parse(readStored(AUX_OPEN_STORAGE_KEY) ?? 'null');
        if (!parsed || typeof parsed !== 'object') return DEFAULT_AUX_OPEN;
        const next = { ...DEFAULT_AUX_OPEN };
        for (const tab of Object.keys(next) as AuxTab[]) {
            const value = (parsed as Record<string, unknown>)[tab];
            if (typeof value === 'boolean') next[tab] = value;
        }
        return next;
    } catch {
        return DEFAULT_AUX_OPEN;
    }
};

const apiPresetInstructionID = (preset: string, locale: ApiProviderInstructionLocale) => (
    `openai-compat-${preset}-${locale}`
);

export const ConfigEditorModal: React.FC<Props> = ({
    isOpen,
    backendUrl,
    uiCatalog = null,
    openFileRequest = null,
    onOpenFileRequestConsumed,
    openApiProviderInstruction = null,
    onOpenApiProviderInstructionConsumed,
    comfyDirectiveVisible = false,
    imageGenEnabled = false,
    ttsEnabled = false,
    appearancePrompt,
    headerActions,
}) => {
    const t = (key: string) => resolveMessage(
        uiCatalog,
        key,
        CONFIG_EDITOR_TEXT_FALLBACK_JA[key] || COMMON_TEXT_FALLBACK_JA[key] || key
    );
    const formatText = (template: string, values: Record<string, string | number>) => {
        return Object.entries(values).reduce((text, [key, value]) => {
            return text.split(`{{${key}}}`).join(String(value));
        }, template);
    };
    const ta = (key: string) => resolveMessage(
        uiCatalog,
        key,
        API_PROVIDERS_TEXT_FALLBACK_JA[key] || key
    );
    const [categories, setCategories] = useState<CategoryDef[]>([]);
    const [selectedCategoryId, setSelectedCategoryId] = useState('');
    const [existingFiles, setExistingFiles] = useState<ConfigFileEntry[]>([]);
    const [templates, setTemplates] = useState<string[]>([]);

    const [title, setTitle] = useState('');
    const [selectedExistingFile, setSelectedExistingFile] = useState<ConfigFileEntry | null>(null);
    // テンプレートから作り直したときの名前（今は書き込むだけ）
    const [, setSelectedTemplate] = useState('');
    const [content, setContent] = useState('');
    const [simpleConfig, setSimpleConfig] = useState<SimpleCharacterConfig>({ ...EMPTY_SIMPLE_CHARACTER });
    const [isSimpleMode, setIsSimpleMode] = useState(false);
    const [isDirty, setIsDirty] = useState(false);

    const [confirm, setConfirm] = useState<ConfirmKind | null>(null);
    // 別の名前で保存するときに小窓へ入れている名前（null のときは小窓を閉じている）
    const [saveAsName, setSaveAsName] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [, setIsDeleting] = useState(false);
    const [toast, setToast] = useState('');

    // AIプロバイダ指示ファイル種別（固定ファイル＋API接続別ファイル。編集のみ）
    const [providerFiles, setProviderFiles] = useState<EditableProviderInstruction[]>([]);
    const [selectedProviderId, setSelectedProviderId] = useState('');

    // 画像生成分析指示種別（固定4ファイル。プルダウン選択と上書き保存のみ）
    const [comfyDirectiveFiles, setComfyDirectiveFiles] = useState<ComfyDirective[]>([]);
    const [selectedComfyDirectiveId, setSelectedComfyDirectiveId] = useState('');

    // 設定自動生成指示種別（固定ファイル。対象→指示ファイルの2段プルダウンと上書き保存のみ）
    const [configGenInstructionFiles, setConfigGenInstructionFiles] = useState<ConfigGenInstruction[]>([]);
    const [selectedConfigGenTarget, setSelectedConfigGenTarget] = useState('');
    const [selectedConfigGenInstructionId, setSelectedConfigGenInstructionId] = useState('');
    // 設定自動生成テンプレート（入力項目／設定ファイル。対象 → 言語 → 種類 → 名前の複数管理）
    const [configGenTemplateKind, setConfigGenTemplateKind] = useState<'' | ConfigGenTemplateKind>('');
    const [configGenTemplateNames, setConfigGenTemplateNames] = useState<string[]>([]);
    const [selectedConfigGenTemplateName, setSelectedConfigGenTemplateName] = useState('');
    const [configGenTemplateNewName, setConfigGenTemplateNewName] = useState('');
    const [configGenTemplateDefaults, setConfigGenTemplateDefaults] = useState<ConfigGenTemplateDefaults>({});

    // D&D 個別インポート
    const [isDragOver, setIsDragOver] = useState(false);

    // 一覧から別の種別のファイルを開くときの依頼（外からの openFileRequest と同じ流れで開く）
    const [localOpenRequest, setLocalOpenRequest] = useState<OpenFileRequest | null>(null);
    const activeOpenRequest = openFileRequest ?? localOpenRequest;
    const consumeOpenRequest = () => {
        if (openFileRequest) onOpenFileRequestConsumed?.();
        else setLocalOpenRequest(null);
    };

    // カテゴリ初期化と外部からのファイル読込が競合したとき、
    // 後から完了した古い初期化結果で本文を上書きしないための世代番号。
    const contentLoadVersion = useRef(0);
    const consumedApiProviderInstructionRef = useRef('');

    const isProviderCategory = selectedCategoryId === PROVIDER_CATEGORY_ID;
    const isComfyDirectiveCategory = selectedCategoryId === COMFY_DIRECTIVE_CATEGORY_ID;
    const isConfigGenInstructionCategory = selectedCategoryId === CONFIG_GEN_INSTRUCTION_CATEGORY_ID;
    // 設定自動生成指示は現在の UI 言語のファイルだけを見せる（実行時も同じ言語のファイルが使われる）。
    const configGenLocale = normalizeConfigGenInstructionLocale(uiCatalog?.lang || 'ja');
    const visibleConfigGenInstructionFiles = configGenInstructionFiles.filter(f => f.locale === configGenLocale && f.kind === 'instruction');
    const selectedConfigGenInstruction = configGenInstructionFiles.find(f => f.id === selectedConfigGenInstructionId) ?? null;
    // 方式ラベルはフロントの i18n を優先し、無ければ API の label（日本語）を使う。
    const configGenMethodLabel = (file: ConfigGenInstruction) => {
        const key = `configEditor.configGenInstruction.method.${file.method}`;
        return resolveMessage(uiCatalog, key, CONFIG_EDITOR_TEXT_FALLBACK_JA[key] || file.label);
    };
    // 固定ファイル種別（新規作成・削除・リネーム・テンプレート・D&D を持たず、上書き保存のみ）
    const isFixedFileCategory = isProviderCategory || isComfyDirectiveCategory || isConfigGenInstructionCategory;

    const loadProviderFiles = useCallback(async () => {
        const [fixedFiles, connections] = await Promise.all([
            listProviderInstructions(backendUrl),
            fetchApiProviders(backendUrl),
        ]);
        const connectionFiles: EditableProviderInstruction[] = connections.flatMap(connection => (
            (['ja', 'en'] as const).flatMap(locale => {
                // 固定3プリセットは共有の基本指示ファイルを使う。接続別ファイルを
                // 一覧へ重複表示するのは openai / custom の空ファイルだけにする。
                if (fixedFiles.some(file => file.id === apiPresetInstructionID(connection.preset, locale))) {
                    return [];
                }
                return [{
                id: apiConnectionInstructionID(connection.id, locale),
                label: formatText(ta(API_PROVIDERS_I18N_KEYS.systemPromptFileLabel), {
                    label: connection.label,
                    locale: locale === 'ja'
                        ? ta(API_PROVIDERS_I18N_KEYS.systemPromptJa)
                        : ta(API_PROVIDERS_I18N_KEYS.systemPromptEn),
                }),
                file: '',
                exists: true,
                connectionId: connection.id,
                locale,
                }];
            })
        ));
        const merged = [...fixedFiles, ...connectionFiles];
        setProviderFiles(previous => merged.map(file => {
            const loadedFile = previous.find(existing => existing.id === file.id)?.file;
            return loadedFile ? { ...file, file: loadedFile } : file;
        }));
        return merged;
    }, [backendUrl, uiCatalog]);

    const isCharacterCategory = useCallback(() => {
        return categories.find(c => c.id === selectedCategoryId)?.isCharacter ?? false;
    }, [categories, selectedCategoryId]);

    // タイトルが既存ファイルから変わったかどうか
    const isTitleChanged = selectedExistingFile !== null && title !== selectedExistingFile.name;

    // 保存ボタン種別
    const saveMode: 'new' | 'overwrite' | 'both' =
        selectedExistingFile === null ? 'new'
        : isTitleChanged ? 'both'
        : 'overwrite';

    // 初期データ取得
    useEffect(() => {
        if (!isOpen) return;
        getCategories(backendUrl).then(cats => {
            setCategories(cats);
            // 開いた時点のクロージャ値でなく最新の選択状態で判定する（開くと同時に
            // openFileRequest が種別を確定させた場合、ここで先頭種別へ上書きしない）。
            if (cats.length > 0) {
                setSelectedCategoryId(prev => prev || cats[0].id);
            }
        }).catch(() => {});
    }, [isOpen, backendUrl]);

    // 種別変更時
    useEffect(() => {
        if (!selectedCategoryId) return;
        const loadVersion = ++contentLoadVersion.current;
        setSelectedExistingFile(null);
        setSelectedTemplate('');
        setSelectedProviderId('');
        setSelectedComfyDirectiveId('');
        setSelectedConfigGenInstructionId('');
        setTitle('');
        setIsDirty(false);

        // AIプロバイダ指示種別: 固定ファイルとAPI接続別ファイルを取得する。
        // テンプレート・通常の既存ファイル系は使わない。
        if (selectedCategoryId === PROVIDER_CATEGORY_ID) {
            setExistingFiles([]);
            setTemplates([]);
            setContent('');
            setSimpleConfig({ ...EMPTY_SIMPLE_CHARACTER });
            setIsSimpleMode(false);
            loadProviderFiles().catch(() => {});
            return;
        }

        // 画像生成分析指示種別: 固定4ファイルのプルダウン選択と上書き保存のみ。
        if (selectedCategoryId === COMFY_DIRECTIVE_CATEGORY_ID) {
            setExistingFiles([]);
            setTemplates([]);
            setContent('');
            setSimpleConfig({ ...EMPTY_SIMPLE_CHARACTER });
            setIsSimpleMode(false);
            listComfyDirectives(backendUrl).then(setComfyDirectiveFiles).catch(() => {});
            return;
        }

        // 設定自動生成指示種別: 固定ファイルの一覧を取得し、対象は先頭を初期選択する。
        if (selectedCategoryId === CONFIG_GEN_INSTRUCTION_CATEGORY_ID) {
            setExistingFiles([]);
            setTemplates([]);
            setContent('');
            setSimpleConfig({ ...EMPTY_SIMPLE_CHARACTER });
            setIsSimpleMode(false);
            listConfigGenInstructions(backendUrl).then(files => {
                setConfigGenInstructionFiles(files);
                setSelectedConfigGenTarget(prev => (prev && files.some(f => f.target === prev)) ? prev : (files[0]?.target ?? ''));
            }).catch(() => {});
            return;
        }

        Promise.all([
            listConfigFiles(backendUrl, selectedCategoryId),
            listTemplates(backendUrl, selectedCategoryId),
            getInitialContent(backendUrl, selectedCategoryId),
        ]).then(([files, tmpl, initial]) => {
            if (loadVersion !== contentLoadVersion.current) return;
            setExistingFiles(files);
            setTemplates(tmpl);
            setContent(initial);
            setSimpleConfig({ ...EMPTY_SIMPLE_CHARACTER });
        }).catch(() => {});
    }, [selectedCategoryId, backendUrl, loadProviderFiles]);

    const showToast = (msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(''), 2500);
    };

    // モーダルを開き直したとき、ファイル一覧・テンプレート一覧を最新化する
    // （設定自動生成タブや別画面で増えたファイルを取りこぼさない。編集中の本文は保持）。
    useEffect(() => {
        if (!isOpen || !selectedCategoryId || isFixedFileCategory) return;
        listConfigFiles(backendUrl, selectedCategoryId).then(setExistingFiles).catch(() => {});
        listTemplates(backendUrl, selectedCategoryId).then(setTemplates).catch(() => {});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    // 設定自動生成タブからの「生成済みファイルを開く」要求（レビュー追加要望）。
    // 種別を合わせたうえで、受け取った識別情報から該当ファイルを直接開く。
    // 一覧の更新は行うが、生成直後の一覧反映状況をファイル読込の前提にはしない。
    useEffect(() => {
        if (!activeOpenRequest) return;
        if (selectedCategoryId !== activeOpenRequest.categoryId) {
            setSelectedCategoryId(activeOpenRequest.categoryId);
            return;
        }
        // AIプロバイダ指示（固定ファイル種別）は fileName に指示ファイルの ID が入る。
        if (activeOpenRequest.categoryId === PROVIDER_CATEGORY_ID) {
            void handleSelectProvider(activeOpenRequest.fileName);
            consumeOpenRequest();
            return;
        }
        // 画像生成分析指示（固定ファイル種別）は fileName に directive ID が入る。
        // 通常ファイルの getConfigFile 経路とは別に、専用の選択処理で本文を読み込む。
        if (activeOpenRequest.categoryId === COMFY_DIRECTIVE_CATEGORY_ID) {
            void handleSelectComfyDirective(activeOpenRequest.fileName);
            consumeOpenRequest();
            return;
        }
        // 設定自動生成指示（固定ファイル種別）も fileName に instruction ID が入る。
        // 一覧取得（対象プルダウンの初期化）と並行して本文を読み、対象は ID から確定する。
        if (activeOpenRequest.categoryId === CONFIG_GEN_INSTRUCTION_CATEGORY_ID) {
            void handleSelectConfigGenInstruction(activeOpenRequest.fileName);
            consumeOpenRequest();
            return;
        }
        (async () => {
            // 先行しているカテゴリ初期化を無効化し、その完了結果による本文上書きを防ぐ。
            const loadVersion = ++contentLoadVersion.current;
            const entry: ConfigFileEntry = {
                dirName: activeOpenRequest.dirName,
                name: activeOpenRequest.fileName,
            };
            // 開き元の編集中本文（設定自動生成タブの左エディタ）。指定があれば優先表示する。
            const carried = activeOpenRequest.content;
            const filesPromise = listConfigFiles(backendUrl, selectedCategoryId).catch(() => null);
            const templatesPromise = listTemplates(backendUrl, selectedCategoryId).catch(() => null);
            try {
                const c = await getConfigFile(backendUrl, selectedCategoryId, entry.dirName, entry.name);
                if (loadVersion !== contentLoadVersion.current) return;
                setSelectedExistingFile(entry);
                setTitle(entry.name);
                setContent(carried ?? c);
                setSimpleConfig({ ...EMPTY_SIMPLE_CHARACTER });
                setIsSimpleMode(false);
                setSelectedTemplate('');
                // 持ち込み本文がサーバー上の内容と異なる＝未保存の編集がある。
                setIsDirty(carried !== undefined && carried !== c);
                consumeOpenRequest();
            } catch {
                if (carried !== undefined && loadVersion === contentLoadVersion.current) {
                    // サーバーから読めなくても、持ち込んだ本文は捨てずに未保存として見せる。
                    setSelectedExistingFile(entry);
                    setTitle(entry.name);
                    setContent(carried);
                    setSimpleConfig({ ...EMPTY_SIMPLE_CHARACTER });
                    setIsSimpleMode(false);
                    setSelectedTemplate('');
                    setIsDirty(true);
                }
                showToast(t(CONFIG_EDITOR_I18N_KEYS.fileLoadFailed));
                consumeOpenRequest();
                return;
            }
            const [files, tmpl] = await Promise.all([filesPromise, templatesPromise]);
            if (files && loadVersion === contentLoadVersion.current) {
                setExistingFiles(files);
            }
            if (tmpl && loadVersion === contentLoadVersion.current) {
                setTemplates(tmpl);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeOpenRequest, selectedCategoryId]);

    // 既存ファイル選択
    const handleSelectExistingFile = async (key: string) => {
        if (!key) {
            setSelectedExistingFile(null);
            setTitle('');
            return;
        }
        const entry = existingFiles.find(f => `${f.dirName}|||${f.name}` === key);
        if (!entry) return;
        try {
            const c = await getConfigFile(backendUrl, selectedCategoryId, entry.dirName, entry.name);
            setSelectedExistingFile(entry);
            setTitle(entry.name);
            setContent(c);
            setSimpleConfig({ ...EMPTY_SIMPLE_CHARACTER });
            setIsSimpleMode(false);
            setSelectedTemplate('');
            setIsDirty(false);
        } catch { showToast(t(CONFIG_EDITOR_I18N_KEYS.fileLoadFailed)); }
    };

    // テンプレート選択
    const handleSelectTemplate = async (name: string) => {
        if (!name) { setSelectedTemplate(''); return; }
        try {
            const c = await getTemplate(backendUrl, selectedCategoryId, name);
            setSelectedTemplate(name);
            setSelectedExistingFile(null);
            setContent(c);
            setSimpleConfig({ ...EMPTY_SIMPLE_CHARACTER });
            setIsSimpleMode(false);
            setIsDirty(true);
        } catch { showToast(t(CONFIG_EDITOR_I18N_KEYS.templateLoadFailed)); }
    };

    // AIプロバイダ指示ファイル選択（編集のみ。未作成は空から書き始める）
    const handleSelectProvider = async (id: string) => {
        setSelectedProviderId(id);
        if (!id) { setContent(''); setIsDirty(false); return; }
        try {
            const selected = providerFiles.find(file => file.id === id);
            if (selected?.connectionId && selected.locale) {
                const response = await fetchApiProviderSystemPrompt(backendUrl, selected.connectionId, selected.locale);
                setProviderFiles(previous => previous.map(file => (
                    file.id === id ? { ...file, file: response.file } : file
                )));
                setContent(response.content);
            } else {
                setContent(await getProviderInstruction(backendUrl, id));
            }
            setIsDirty(false);
        } catch { showToast(t(CONFIG_EDITOR_I18N_KEYS.providerLoadFailed)); }
    };

    // API接続先管理から指定された接続・言語の指示ファイルを直接開く。
    useEffect(() => {
        if (!openApiProviderInstruction) {
            consumedApiProviderInstructionRef.current = '';
            return;
        }
        if (!isOpen) return;
        const presetKey = apiPresetInstructionID(
            openApiProviderInstruction.preset,
            openApiProviderInstruction.locale
        );
        const requestKey = providerFiles.some(file => file.id === presetKey)
            ? presetKey
            : apiConnectionInstructionID(
                openApiProviderInstruction.connectionId,
                openApiProviderInstruction.locale
            );
        if (consumedApiProviderInstructionRef.current === requestKey) return;
        if (selectedCategoryId !== PROVIDER_CATEGORY_ID) {
            setSelectedCategoryId(PROVIDER_CATEGORY_ID);
            return;
        }
        if (!providerFiles.some(file => file.id === requestKey)) {
            loadProviderFiles().catch(() => {
                showToast(t(CONFIG_EDITOR_I18N_KEYS.providerLoadFailed));
                onOpenApiProviderInstructionConsumed?.();
            });
            return;
        }
        consumedApiProviderInstructionRef.current = requestKey;
        void handleSelectProvider(requestKey);
        onOpenApiProviderInstructionConsumed?.();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, openApiProviderInstruction, selectedCategoryId, providerFiles]);

    // 画像生成分析指示ファイル選択（編集のみ。未作成は空から書き始める）
    const handleSelectComfyDirective = async (id: string) => {
        setSelectedComfyDirectiveId(id);
        if (!id) { setContent(''); setIsDirty(false); return; }
        try {
            setContent(await getComfyDirective(backendUrl, id));
            setIsDirty(false);
        } catch { showToast(t(CONFIG_EDITOR_I18N_KEYS.fileLoadFailed)); }
    };

    // 画像生成分析指示ファイル保存（上書きのみ）
    const handleSaveComfyDirective = async () => {
        if (!selectedComfyDirectiveId) return;
        setIsSaving(true);
        try {
            await saveComfyDirective(backendUrl, selectedComfyDirectiveId, content);
            setIsDirty(false);
            showToast(t(CONFIG_EDITOR_I18N_KEYS.saved));
        } catch { showToast(t(CONFIG_EDITOR_I18N_KEYS.saveFailed)); }
        finally { setIsSaving(false); }
    };

    // 画像生成分析指示ファイルを同梱デフォルトへ戻す（編集内容破棄のため確認を挟む）
    const handleResetComfyDirective = async () => {
        if (!selectedComfyDirectiveId) return;
        if (!window.confirm(t(CONFIG_EDITOR_I18N_KEYS.comfyDirectiveResetConfirm))) return;
        setIsSaving(true);
        try {
            const restored = await resetComfyDirective(backendUrl, selectedComfyDirectiveId);
            setContent(restored);
            setIsDirty(false);
            showToast(t(CONFIG_EDITOR_I18N_KEYS.comfyDirectiveResetDone));
        } catch { showToast(t(CONFIG_EDITOR_I18N_KEYS.comfyDirectiveResetFailed)); }
        finally { setIsSaving(false); }
    };

    // 設定自動生成指示ファイル選択（編集のみ。未作成時はサーバーが同梱デフォルトを返す）
    // 対象プルダウンは選択 ID から逆引きして同期する（他タブからの直接遷移でも一致させる）。
    const CONFIG_GEN_TEMPLATE_ID_PREFIX = 'template:';

    // テンプレート一覧と既定を読み込み、既定（無ければ先頭）を選択して本文を表示する。
    const loadConfigGenTemplates = async (target: string, kind: ConfigGenTemplateKind, preferName?: string) => {
        try {
            const [names, defaults] = await Promise.all([
                listConfigGenTemplates(backendUrl, target, configGenLocale, kind),
                getConfigGenTemplateDefaults(backendUrl),
            ]);
            setConfigGenTemplateNames(names);
            setConfigGenTemplateDefaults(defaults);
            const def = configGenTemplateDefaultName(defaults, target, configGenLocale, kind);
            const pick = preferName && names.includes(preferName) ? preferName : (names.includes(def) ? def : (names[0] ?? ''));
            await handleSelectConfigGenTemplateName(target, kind, pick);
        } catch { showToast(t(CONFIG_EDITOR_I18N_KEYS.fileLoadFailed)); }
    };

    const handleSelectConfigGenTemplateName = async (target: string, kind: ConfigGenTemplateKind, name: string) => {
        setSelectedConfigGenTemplateName(name);
        setConfigGenTemplateNewName('');
        if (!name) { setContent(''); setIsDirty(false); return; }
        try {
            setContent(await getConfigGenTemplate(backendUrl, target, configGenLocale, kind, name));
            setIsDirty(false);
        } catch { showToast(t(CONFIG_EDITOR_I18N_KEYS.fileLoadFailed)); }
    };

    const handleSelectConfigGenInstruction = async (id: string) => {
        // 旧 ID 形式（<target>-search_template-<locale> 等）はテンプレート種類へ読み替える（設定自動生成タブからの遷移用）。
        const legacy = id.match(/^(.+)-(search|setting)_template-[a-z]+$/);
        if (legacy) {
            setSelectedConfigGenTarget(legacy[1]);
            id = CONFIG_GEN_TEMPLATE_ID_PREFIX + legacy[2];
            setSelectedConfigGenInstructionId(id);
            const kind = legacy[2] as ConfigGenTemplateKind;
            setConfigGenTemplateKind(kind);
            await loadConfigGenTemplates(legacy[1], kind);
            return;
        }
        setSelectedConfigGenInstructionId(id);
        if (id.startsWith(CONFIG_GEN_TEMPLATE_ID_PREFIX)) {
            const kind = id.slice(CONFIG_GEN_TEMPLATE_ID_PREFIX.length) as ConfigGenTemplateKind;
            setConfigGenTemplateKind(kind);
            await loadConfigGenTemplates(selectedConfigGenTarget, kind);
            return;
        }
        setConfigGenTemplateKind('');
        setConfigGenTemplateNames([]);
        setSelectedConfigGenTemplateName('');
        if (!id) { setContent(''); setIsDirty(false); return; }
        const target = id.split('-')[0];
        if (target) setSelectedConfigGenTarget(target);
        try {
            setContent(await getConfigGenInstruction(backendUrl, id));
            setIsDirty(false);
        } catch { showToast(t(CONFIG_EDITOR_I18N_KEYS.fileLoadFailed)); }
    };

    // 新規テンプレート: 選択を外し本文を空にする（名前を入力して保存すると作成される）。
    const handleNewConfigGenTemplate = () => {
        setSelectedConfigGenTemplateName('');
        setConfigGenTemplateNewName('');
        setContent('');
        setIsDirty(false);
    };

    const handleSaveConfigGenTemplate = async () => {
        if (!configGenTemplateKind) return;
        const name = (selectedConfigGenTemplateName || configGenTemplateNewName).trim();
        if (!name) { showToast(t(CONFIG_EDITOR_I18N_KEYS.configGenTemplateNameRequired)); return; }
        setIsSaving(true);
        try {
            await saveConfigGenTemplate(backendUrl, selectedConfigGenTarget, configGenLocale, configGenTemplateKind, name, content);
            setIsDirty(false);
            notifyConfigGenTemplatesChanged();
            await loadConfigGenTemplates(selectedConfigGenTarget, configGenTemplateKind, name);
            showToast(t(CONFIG_EDITOR_I18N_KEYS.saved));
        } catch { showToast(t(CONFIG_EDITOR_I18N_KEYS.saveFailed)); }
        finally { setIsSaving(false); }
    };

    const handleSetDefaultConfigGenTemplate = async () => {
        if (!configGenTemplateKind || !selectedConfigGenTemplateName) return;
        try {
            await setConfigGenTemplateDefault(backendUrl, selectedConfigGenTarget, configGenLocale, configGenTemplateKind, selectedConfigGenTemplateName);
            notifyConfigGenTemplatesChanged();
            setConfigGenTemplateDefaults(await getConfigGenTemplateDefaults(backendUrl));
            showToast(t(CONFIG_EDITOR_I18N_KEYS.saved));
        } catch { showToast(t(CONFIG_EDITOR_I18N_KEYS.saveFailed)); }
    };

    const handleDeleteConfigGenTemplate = async () => {
        if (!configGenTemplateKind || !selectedConfigGenTemplateName) return;
        const msg = t(CONFIG_EDITOR_I18N_KEYS.configGenTemplateDeleteConfirm).split('{{name}}').join(selectedConfigGenTemplateName);
        if (!window.confirm(msg)) return;
        try {
            await deleteConfigGenTemplate(backendUrl, selectedConfigGenTarget, configGenLocale, configGenTemplateKind, selectedConfigGenTemplateName);
            notifyConfigGenTemplatesChanged();
            await loadConfigGenTemplates(selectedConfigGenTarget, configGenTemplateKind);
            showToast(t(CONFIG_EDITOR_I18N_KEYS.deleted));
        } catch { showToast(t(CONFIG_EDITOR_I18N_KEYS.deleteFailed)); }
    };

    // 設定自動生成指示ファイル保存（上書きのみ）
    const handleSaveConfigGenInstruction = async () => {
        if (!selectedConfigGenInstructionId) return;
        setIsSaving(true);
        try {
            await saveConfigGenInstruction(backendUrl, selectedConfigGenInstructionId, content);
            setIsDirty(false);
            // exists 表示の更新（初回保存後にファイルが生まれる）。
            listConfigGenInstructions(backendUrl).then(setConfigGenInstructionFiles).catch(() => {});
            showToast(t(CONFIG_EDITOR_I18N_KEYS.saved));
        } catch { showToast(t(CONFIG_EDITOR_I18N_KEYS.saveFailed)); }
        finally { setIsSaving(false); }
    };

    // 設定自動生成指示ファイルを同梱デフォルトへ戻す（編集内容破棄のため確認を挟む）
    const handleResetConfigGenInstruction = async () => {
        if (!selectedConfigGenInstructionId) return;
        if (!window.confirm(t(CONFIG_EDITOR_I18N_KEYS.comfyDirectiveResetConfirm))) return;
        setIsSaving(true);
        try {
            const restored = await resetConfigGenInstruction(backendUrl, selectedConfigGenInstructionId);
            setContent(restored);
            setIsDirty(false);
            showToast(t(CONFIG_EDITOR_I18N_KEYS.comfyDirectiveResetDone));
        } catch { showToast(t(CONFIG_EDITOR_I18N_KEYS.comfyDirectiveResetFailed)); }
        finally { setIsSaving(false); }
    };

    // AIプロバイダ指示ファイル保存（上書きのみ）
    const handleSaveProvider = async () => {
        if (!selectedProviderId) return;
        setIsSaving(true);
        try {
            const selected = providerFiles.find(file => file.id === selectedProviderId);
            if (selected?.connectionId && selected.locale) {
                await saveApiProviderSystemPrompt(backendUrl, selected.connectionId, selected.locale, content);
            } else {
                await saveProviderInstruction(backendUrl, selectedProviderId, content);
            }
            setIsDirty(false);
            // exists 表示の更新（初回保存後にファイルが生まれる）。
            loadProviderFiles().catch(() => {});
            showToast(t(CONFIG_EDITOR_I18N_KEYS.saved));
        } catch { showToast(t(CONFIG_EDITOR_I18N_KEYS.saveFailed)); }
        finally { setIsSaving(false); }
    };

    // D&D 個別インポート（設計 §7）: .md を現在の種別へ即保存。
    // 確認モーダルは出さず、同名は「名前 (2)」形式で自動リネームして追加する。
    const handleDropFiles = async (files: FileList) => {
        const mdFiles = Array.from(files).filter(f => f.name.toLowerCase().endsWith('.md'));
        if (mdFiles.length === 0) {
            showToast(t(CONFIG_EDITOR_I18N_KEYS.dropZoneInvalid));
            return;
        }
        let added = 0;
        try {
            for (const file of mdFiles) {
                const text = await file.text();
                const baseName = file.name.replace(/\.md$/i, '');
                await saveConfigFileUnique(backendUrl, selectedCategoryId, baseName, text);
                added += 1;
            }
            if (added > 0) invalidateSSRPOptionsCache();
        } catch {
            showToast(t(CONFIG_EDITOR_I18N_KEYS.dropZoneFailed));
        }
        if (added > 0) {
            const list = await listConfigFiles(backendUrl, selectedCategoryId).catch(() => null);
            if (list) setExistingFiles(list);
            showToast(formatText(t(CONFIG_EDITOR_I18N_KEYS.dropZoneAdded), { count: added }));
        }
    };

    // 新規作成（保存していない変更の確認は、呼び出し側の guard で行う）
    const doNewFile = async () => {
        setSelectedExistingFile(null);
        setSelectedTemplate('');
        setTitle('');
        setSimpleConfig({ ...EMPTY_SIMPLE_CHARACTER });
        setIsSimpleMode(false);
        setIsDirty(false);
        const initial = await getInitialContent(backendUrl, selectedCategoryId).catch(() => '');
        setContent(initial);
    };

    // 簡単設定→標準設定切り替え
    // 「項目で入力」タブへ切り替える前の未保存の印（反映せずに切り替えたときに戻す）
    const dirtyBeforeFormRef = useRef(false);
    // 「項目で入力」タブへ切り替えてから何か入力したか
    const formEditedRef = useRef(false);
    const handleToFormMode = () => {
        dirtyBeforeFormRef.current = isDirty;
        formEditedRef.current = false;
        setIsSimpleMode(true);
    };
    const handleToStandardMode = () => {
        // 何も入力していなければ反映するものが無いので、確認を出さずに戻る
        if (!formEditedRef.current) {
            discardFormAndBackToText();
            return;
        }
        setConfirm({ kind: 'toStandard' });
    };
    // はい：反映してから切り替える
    const doToStandardMode = () => {
        const md = simpleCharacterToMarkdown(simpleConfig, title, uiCatalog);
        setContent(md);
        setIsSimpleMode(false);
        setSimpleConfig({ ...EMPTY_SIMPLE_CHARACTER });
    };
    // いいえ：反映せずに切り替える（入力欄で編集した内容は破棄する）
    const discardFormAndBackToText = () => {
        setIsSimpleMode(false);
        setSimpleConfig({ ...EMPTY_SIMPLE_CHARACTER });
        setIsDirty(dirtyBeforeFormRef.current);
    };

    type SaveTarget =
        | { kind: 'overwrite'; entry: ConfigFileEntry }
        | { kind: 'new'; name: string };

    // 保存（共通）
    const doSave = useCallback(async (target: SaveTarget): Promise<boolean> => {
        setIsSaving(true);
        try {
            const fileName = target.kind === 'overwrite' ? target.entry.name : target.name;
            const dirName  = target.kind === 'overwrite' ? target.entry.dirName : target.name;
            const saveContent = isSimpleMode
                ? simpleCharacterToMarkdown(simpleConfig, fileName, uiCatalog)
                : content;
            await saveConfigFile(backendUrl, selectedCategoryId, dirName, fileName, saveContent);
            // 会話設定メニューの選択肢キャッシュを破棄する（新規ファイルが即座に一覧へ出るように）。
            invalidateSSRPOptionsCache();
            const newEntry: ConfigFileEntry = { name: fileName, dirName };
            setSelectedExistingFile(newEntry);
            setTitle(fileName);
            setIsDirty(false);
            const files = await listConfigFiles(backendUrl, selectedCategoryId);
            setExistingFiles(files);
            showToast(t(CONFIG_EDITOR_I18N_KEYS.saved));
            return true;
        } catch {
            showToast(t(CONFIG_EDITOR_I18N_KEYS.saveFailed));
            return false;
        }
        finally { setIsSaving(false); }
    }, [backendUrl, selectedCategoryId, content, isSimpleMode, simpleConfig, uiCatalog]);

    // 保存��の重複チェック
    // 保存できたら true、できなかったら false、同じ名前の上書きを確かめているときは 'pending'
    const handleSave = async (target: SaveTarget): Promise<boolean | 'pending'> => {
        const saveName = target.kind === 'new' ? target.name : target.entry.name;
        if (!saveName.trim()) { showToast(t(CONFIG_EDITOR_I18N_KEYS.titleRequired)); return false; }
        if (target.kind === 'new') {
            const exists = await checkConfigFileExists(backendUrl, selectedCategoryId, target.name, target.name).catch(() => false);
            if (exists) {
                setConfirm({ kind: 'overwrite', name: target.name, proceed: () => { void doSave(target); } });
                return 'pending';
            }
        }
        return doSave(target);
    };

    // 削除
    const handleDelete = () => setConfirm({ kind: 'delete' });
    const doDelete = async () => {
        if (!selectedExistingFile) return;
        setIsDeleting(true);
        try {
            await deleteConfigFile(backendUrl, selectedCategoryId, selectedExistingFile.dirName, selectedExistingFile.name);
            invalidateSSRPOptionsCache();
            const files = await listConfigFiles(backendUrl, selectedCategoryId);
            setExistingFiles(files);
            doNewFile();
            showToast(t(CONFIG_EDITOR_I18N_KEYS.deleted));
        } catch { showToast(t(CONFIG_EDITOR_I18N_KEYS.deleteFailed)); }
        finally { setIsDeleting(false); }
    };

    // 確認ダイアログの応答
    const handleConfirmYes = () => {
        const c = confirm;
        setConfirm(null);
        if (!c) return;
        if (c.kind === 'newFile') doNewFile();
        else if (c.kind === 'toStandard') doToStandardMode();
        else if (c.kind === 'overwrite') c.proceed();
        else if (c.kind === 'delete') doDelete();
        else if (c.kind === 'deleteTemplate') void doDeleteTemplate(c.name);
    };

    // ---- 素材づくりの設定ファイル（左に一覧、真ん中に本文、右に付属のタブ） ----

    const tm = (key: string) => resolveMessage(uiCatalog, key, MATERIAL_TEXT_FALLBACK_JA[key] || key);
    const [searchQuery, setSearchQuery] = useState('');
    // 一覧をテンプレートに切り替えて、同じ画面でテンプレートを編集する
    const [templateMode, setTemplateMode] = useState(false);
    // 編集しているテンプレートの名前（新しいテンプレートは ''、テンプレートを開いていなければ null）
    const [editingTemplate, setEditingTemplate] = useState<string | null>(null);
    const [defaultTemplates, setDefaultTemplates] = useState<Record<string, string>>({});
    // テンプレートパック（配布しているテンプレートの詰め合わせ）の取り込み
    const [templatePackOverwrite, setTemplatePackOverwrite] = useState(false);
    const [templatePackRunning, setTemplatePackRunning] = useState(false);
    // 表示しているまとまりの種別ごとのファイル一覧
    const [groupFiles, setGroupFiles] = useState<Record<string, ConfigFileEntry[]>>({});
    // 全体の設定で使っている画像生成分析指示の形式（「使用中」の印に使う）
    const [activeDirectiveModes, setActiveDirectiveModes] = useState<{ comfyui: string; api: string } | null>(null);
    const [auxTab, setAuxTab] = useState<AuxTab>('info');
    // 狭い画面で本文の入力欄を表示しているか（false なら付属のタブの中身を表示）
    const [narrowBody, setNarrowBody] = useState(true);
    // 付属の欄の表示の形・幅・縦に並べたときに開いている区画。ブラウザに覚えさせ、形を切り替えても幅はそのまま
    const [auxLayout, setAuxLayout] = useState<AuxLayout>(() => (readStored(AUX_LAYOUT_STORAGE_KEY) === 'stack' ? 'stack' : 'tabs'));
    const [auxWidths, setAuxWidths] = useState<Record<AuxLayout, number>>(loadAuxWidths);
    const [auxOpenSections, setAuxOpenSections] = useState<Record<AuxTab, boolean>>(loadAuxOpen);
    const rootRef = useRef<HTMLDivElement>(null);
    const auxAsideRef = useRef<HTMLElement>(null);
    const isWideScreen = useIsWideScreen();
    const [menuOpen, setMenuOpen] = useState(false);
    // 保存していない変更があるまま移ろうとしたときの、移る先の操作
    const [leaveAction, setLeaveAction] = useState<{ run: () => void } | null>(null);
    const [auxDirty, setAuxDirty] = useState<Record<'tags' | 'imageGen' | 'linked', boolean>>({ tags: false, imageGen: false, linked: false });
    const [listOpenNarrow, setListOpenNarrow] = useState(false);
    const tagsRef = useRef<SaveHandle>(null);
    const imageGenRef = useRef<SaveHandle>(null);
    const linkedRef = useRef<SaveHandle>(null);
    const importInputRef = useRef<HTMLInputElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    // AI で作ったファイルなどを外から開くときは、前に使っていた一覧の表示状態を持ち越さない。
    // 検索やテンプレート表示が残ると、読み込んだファイルが一覧に現れず、開けていないように見える。
    useEffect(() => {
        if (!openFileRequest) return;
        setSearchQuery('');
        setTemplateMode(false);
        setEditingTemplate(null);
        setNarrowBody(true);
        setListOpenNarrow(false);
    }, [openFileRequest]);

    const markAuxDirty = useCallback((key: 'tags' | 'imageGen' | 'linked') => (dirty: boolean) => {
        setAuxDirty(prev => (prev[key] === dirty ? prev : { ...prev, [key]: dirty }));
    }, []);
    const markTagsDirty = useMemo(() => markAuxDirty('tags'), [markAuxDirty]);
    const markImageGenDirty = useMemo(() => markAuxDirty('imageGen'), [markAuxDirty]);
    const markLinkedDirty = useMemo(() => markAuxDirty('linked'), [markAuxDirty]);

    const anyDirty = isDirty || auxDirty.tags || auxDirty.imageGen || auxDirty.linked;
    const isCharacter = isCharacterCategory();
    // 付随設定の保存先。本体 .md を保存していない新規キャラクターでは無い
    const characterDirName = isCharacter && !templateMode ? (selectedExistingFile?.dirName ?? null) : null;

    // 種別を見本の6つのまとまりに分ける（本体に無い種別は出さない。どこにも当たらない種別は文体の後ろへ）
    const kindGroups = useMemo(() => {
        const known = new Set(KIND_GROUPS.flatMap(g => g.categories));
        const extra = categories.map(c => c.id).filter(id => !known.has(id));
        return KIND_GROUPS.map(group => {
            if (group.id === 'ai') {
                return { ...group, categories: group.categories.filter(id => id !== COMFY_DIRECTIVE_CATEGORY_ID || comfyDirectiveVisible) };
            }
            const cats = group.categories.filter(id => categories.some(c => c.id === id));
            return { ...group, categories: group.id === 'style' ? [...cats, ...extra] : cats };
        }).filter(group => group.categories.length > 0);
    }, [categories, comfyDirectiveVisible]);
    const currentGroup = kindGroups.find(group => group.categories.includes(selectedCategoryId)) ?? kindGroups[0];
    const isAiGroup = currentGroup?.id === 'ai';
    const categoryLabel = (id: string) => {
        if (id === PROVIDER_CATEGORY_ID) return t(CONFIG_EDITOR_I18N_KEYS.providerCategory);
        if (id === COMFY_DIRECTIVE_CATEGORY_ID) return t(CONFIG_EDITOR_I18N_KEYS.comfyDirectiveCategory);
        if (id === CONFIG_GEN_INSTRUCTION_CATEGORY_ID) return t(CONFIG_EDITOR_I18N_KEYS.configGenInstructionCategory);
        return resolveMessage(uiCatalog, `configEditor.category.${id}`, categories.find(c => c.id === id)?.label ?? id);
    };

    // まとまりの中の種別ごとのファイル一覧を読む
    useEffect(() => {
        if (!isOpen || !currentGroup) return;
        if (currentGroup.id === 'ai') {
            loadProviderFiles().catch(() => {});
            listConfigGenInstructions(backendUrl).then(setConfigGenInstructionFiles).catch(() => {});
            if (comfyDirectiveVisible) {
                listComfyDirectives(backendUrl).then(setComfyDirectiveFiles).catch(() => {});
                // 全体の設定で使っている形式（「使用中」の印に使う。ComfyUI 用と APIサービス用で別）
                getComfyUIConfig(backendUrl)
                    .then(cfg => setActiveDirectiveModes({ comfyui: cfg.directiveMode, api: cfg.apiDirectiveMode || 'danbooru_only' }))
                    .catch(() => {});
            }
            return;
        }
        let cancelled = false;
        Promise.all(currentGroup.categories.map(id => listConfigFiles(backendUrl, id).then(files => [id, files] as const).catch(() => [id, []] as const)))
            .then(entries => { if (!cancelled) setGroupFiles(Object.fromEntries(entries)); });
        return () => { cancelled = true; };
        // まとまりが変わったときだけ読み直す（保存・削除のあとは下の同期で足りる）
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, currentGroup?.id, backendUrl, categories.length]);

    // 設定ファイルが増えた・消えた・書き換わったら（AI で作ったときなど）、今の種別とまとまりの一覧を読み直す。
    // 素材づくりは一度開いたら隠すだけなので、読み直さないとページを読み直すまで一覧に出ない
    useEffect(() => subscribeConfigFilesChanged(() => {
        if (!selectedCategoryId || isFixedFileCategory) return;
        listConfigFiles(backendUrl, selectedCategoryId).then(setExistingFiles).catch(() => {});
        if (!currentGroup || currentGroup.id === 'ai') return;
        Promise.all(currentGroup.categories.map(id => listConfigFiles(backendUrl, id).then(files => [id, files] as const).catch(() => [id, []] as const)))
            .then(entries => setGroupFiles(prev => ({ ...prev, ...Object.fromEntries(entries) })));
    }), [backendUrl, selectedCategoryId, isFixedFileCategory, currentGroup]);

    // 選んでいる種別の一覧（保存・削除で更新される）をまとまりの一覧へ写す
    useEffect(() => {
        if (!selectedCategoryId || isFixedFileCategory) return;
        setGroupFiles(prev => ({ ...prev, [selectedCategoryId]: existingFiles }));
    }, [existingFiles, selectedCategoryId, isFixedFileCategory]);

    // テンプレートに切り替えたら既定のテンプレートを読む
    useEffect(() => {
        if (!templateMode) return;
        getDefaultTemplates(backendUrl).then(setDefaultTemplates).catch(() => {});
    }, [templateMode, backendUrl, selectedCategoryId]);

    // 「…」の外を押したら閉じる
    useEffect(() => {
        if (!menuOpen) return;
        const close = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
        };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, [menuOpen]);

    // 保存していない変更があれば確かめてから移る
    const guard = (run: () => void) => {
        if (anyDirty) {
            setLeaveAction({ run });
            return;
        }
        run();
    };

    const resetAuxDirty = () => setAuxDirty({ tags: false, imageGen: false, linked: false });

    const selectGroup = (groupId: KindGroupId) => {
        const group = kindGroups.find(g => g.id === groupId);
        if (!group || group.id === currentGroup?.id) return;
        guard(() => {
            resetAuxDirty();
            setEditingTemplate(null);
            if (group.id === 'ai') setTemplateMode(false);
            setSelectedCategoryId(group.categories[0]);
        });
    };

    const openEntry = (categoryId: string, entry: ConfigFileEntry) => {
        guard(() => {
            resetAuxDirty();
            setTemplateMode(false);
            setEditingTemplate(null);
            setListOpenNarrow(false);
            if (categoryId === selectedCategoryId) {
                void handleSelectExistingFile(`${entry.dirName}|||${entry.name}`);
            } else {
                setLocalOpenRequest({ categoryId, dirName: entry.dirName, fileName: entry.name });
            }
        });
    };

    const openFixedItem = (categoryId: string, id: string) => {
        guard(() => {
            resetAuxDirty();
            setListOpenNarrow(false);
            setLocalOpenRequest({ categoryId, dirName: '', fileName: id });
        });
    };

    const startNewFile = () => {
        guard(() => {
            resetAuxDirty();
            setListOpenNarrow(false);
            if (templateMode) {
                setEditingTemplate('');
                setSelectedExistingFile(null);
                setTitle('');
                setContent('');
                setIsSimpleMode(false);
                setIsDirty(false);
                return;
            }
            setEditingTemplate(null);
            void doNewFile();
        });
    };

    // 一覧の種別の見出しの「新規作成」：その種別を選び、新しいファイルを作る状態にする。
    // まとまりの先頭以外の種別も、ファイルが無くても選べるようにする（選んだ種別がテンプレート・取り込みの対象になる）
    const startNewFileIn = (categoryId: string) => {
        if (categoryId === selectedCategoryId) {
            startNewFile();
            return;
        }
        guard(() => {
            resetAuxDirty();
            setEditingTemplate(null);
            setListOpenNarrow(false);
            setSelectedCategoryId(categoryId);
        });
    };

    const handleTemplatePack = async () => {
        if (templatePackRunning) return;
        const tg = (key: string) => resolveMessage(uiCatalog, key, CONFIG_GEN_TEXT_FALLBACK_JA[key] || key);
        setTemplatePackRunning(true);
        try {
            const lang = (uiCatalog?.lang || 'ja').toLowerCase().startsWith('en') ? 'en' : 'ja';
            const result = await downloadTemplatePack(backendUrl, lang, templatePackOverwrite ? 'overwrite' : 'skip');
            showToast(formatText(tg(CONFIG_GEN_I18N_KEYS.templatePackDone), { count: result.written.length }));
            listTemplates(backendUrl, selectedCategoryId).then(setTemplates).catch(() => {});
        } catch (error) {
            const messageKey = (error as { response?: { data?: { messageKey?: string } } })?.response?.data?.messageKey;
            showToast(tg(messageKey || 'settingsPack.templates.errorDownloadFailed'));
        } finally {
            setTemplatePackRunning(false);
        }
    };

    const toggleTemplateMode = () => {
        guard(() => {
            resetAuxDirty();
            setEditingTemplate(null);
            const next = !templateMode;
            setTemplateMode(next);
            if (next) {
                setSelectedExistingFile(null);
                setTitle('');
                setContent('');
                setIsSimpleMode(false);
                setIsDirty(false);
                listTemplates(backendUrl, selectedCategoryId).then(setTemplates).catch(() => {});
            } else {
                void doNewFile();
            }
        });
    };

    const openTemplate = (name: string) => {
        guard(async () => {
            setListOpenNarrow(false);
            try {
                const c = await getTemplate(backendUrl, selectedCategoryId, name);
                setEditingTemplate(name);
                setSelectedExistingFile(null);
                setTitle(name);
                setContent(c);
                setIsSimpleMode(false);
                setIsDirty(false);
            } catch { showToast(t(CONFIG_EDITOR_I18N_KEYS.templateLoadFailed)); }
        });
    };

    // テンプレートを保存する。名前を渡したときはその名前で（別の名前で保存）、渡さないときは開いているテンプレートへ
    // （新しいテンプレートのときはタイトル欄の名前で）保存する。開いているもの以外に同じ名前があれば、上書きを確かめる
    const saveTemplateNow = async (nameArg?: string, confirmed = false): Promise<boolean> => {
        const name = (nameArg ?? (editingTemplate || title)).trim();
        if (!name) { showToast(t(CONFIG_EDITOR_I18N_KEYS.titleRequired)); return false; }
        if (!confirmed && name !== editingTemplate && templates.includes(name)) {
            setConfirm({ kind: 'overwrite', name, proceed: () => { void saveTemplateNow(name, true); } });
            return false;
        }
        setIsSaving(true);
        try {
            await saveTemplate(backendUrl, selectedCategoryId, name, content);
            setEditingTemplate(name);
            setTitle(name);
            setIsDirty(false);
            setTemplates(await listTemplates(backendUrl, selectedCategoryId));
            showToast(t(CONFIG_EDITOR_I18N_KEYS.saved));
            return true;
        } catch {
            showToast(t(CONFIG_EDITOR_I18N_KEYS.saveFailed));
            return false;
        } finally {
            setIsSaving(false);
        }
    };

    // 削除は画面の確認窓で確かめてから行う
    const deleteTemplateNow = () => {
        if (!editingTemplate) return;
        setConfirm({ kind: 'deleteTemplate', name: editingTemplate });
    };
    // 消したあと、一覧と既定の表示を読み直す（既定だったものを消したときに印が残らないように）
    const doDeleteTemplate = async (name: string) => {
        try {
            await deleteTemplate(backendUrl, selectedCategoryId, name);
            setTemplates(await listTemplates(backendUrl, selectedCategoryId));
            setDefaultTemplates(await getDefaultTemplates(backendUrl));
            setEditingTemplate(null);
            setTitle('');
            setContent('');
            setIsDirty(false);
            showToast(t(CONFIG_EDITOR_I18N_KEYS.deleted));
        } catch { showToast(t(CONFIG_EDITOR_I18N_KEYS.deleteFailed)); }
    };

    const makeDefaultTemplate = async () => {
        if (!editingTemplate) return;
        try {
            await setDefaultTemplate(backendUrl, selectedCategoryId, editingTemplate);
            setDefaultTemplates(await getDefaultTemplates(backendUrl));
            showToast(t(CONFIG_EDITOR_I18N_KEYS.saved));
        } catch { showToast(t(CONFIG_EDITOR_I18N_KEYS.saveFailed)); }
    };

    // 上の帯の「保存」：本文と、変更のあった付属の欄（作品・タグ、画像生成、紐づけ）をまとめて保存する
    const saveAll = async (): Promise<boolean> => {
        if (templateMode) return saveTemplateNow();
        if (isProviderCategory) { await handleSaveProvider(); return true; }
        if (isComfyDirectiveCategory) { await handleSaveComfyDirective(); return true; }
        if (isConfigGenInstructionCategory) {
            if (configGenTemplateKind) await handleSaveConfigGenTemplate();
            else await handleSaveConfigGenInstruction();
            return true;
        }
        if (isDirty || selectedExistingFile === null) {
            const result = await handleSave(
                saveMode === 'new' ? { kind: 'new', name: title } : { kind: 'overwrite', entry: selectedExistingFile! },
            );
            // 同じ名前のファイルがあるときは上書きの確認を出しているので、ここでは移らない
            if (result !== true) return false;
        }
        const results = await Promise.all([tagsRef.current?.save(), imageGenRef.current?.save(), linkedRef.current?.save()]);
        if (results.some(ok => ok === false)) {
            showToast(tm(MATERIAL_I18N_KEYS.saveFailedSome));
            return false;
        }
        if (!isDirty && (auxDirty.tags || auxDirty.imageGen || auxDirty.linked)) showToast(tm(MATERIAL_I18N_KEYS.savedAll));
        return true;
    };

    const exportContent = () => {
        const body = isSimpleMode && isCharacter ? simpleCharacterToMarkdown(simpleConfig, title, uiCatalog) : content;
        const blob = new Blob([body], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${(title || tm(MATERIAL_I18N_KEYS.newName)).replace(/[\\/:*?"<>|]/g, '_')}.md`;
        a.click();
        URL.revokeObjectURL(url);
    };

    if (!isOpen) return null;

    const confirmMeta = confirm ? {
        newFile:   { title: t(CONFIG_EDITOR_I18N_KEYS.confirmNewTitle),      message: t(CONFIG_EDITOR_I18N_KEYS.confirmNewMessage) },
        toStandard:{ title: t(CONFIG_EDITOR_I18N_KEYS.confirmStandardTitle), message: t(CONFIG_EDITOR_I18N_KEYS.confirmStandardMessage) },
        overwrite: { title: t(CONFIG_EDITOR_I18N_KEYS.confirmOverwriteTitle), message: formatText(t(CONFIG_EDITOR_I18N_KEYS.confirmOverwriteMessage), { name: (confirm.kind === 'overwrite' && confirm.name) || title }) },
        delete:    { title: t(CONFIG_EDITOR_I18N_KEYS.confirmDeleteTitle),    message: formatText(t(CONFIG_EDITOR_I18N_KEYS.confirmDeleteFileMessage), { name: selectedExistingFile?.name || '' }) },
        deleteTemplate: { title: t(CONFIG_EDITOR_I18N_KEYS.confirmDeleteTitle), message: formatText(t(CONFIG_EDITOR_I18N_KEYS.confirmDeleteFileMessage), { name: confirm.kind === 'deleteTemplate' ? confirm.name : '' }) },
    }[confirm.kind] : null;

    const query = searchQuery.trim().toLowerCase();
    const matches = (label: string) => !query || label.toLowerCase().includes(query);
    const selectedFixedLabel = isProviderCategory
        ? (providerFiles.find(p => p.id === selectedProviderId)?.file ?? '')
        : isComfyDirectiveCategory
            ? (comfyDirectiveFiles.find(d => d.id === selectedComfyDirectiveId)?.file ?? '')
            : isConfigGenInstructionCategory
                ? (configGenTemplateKind
                    ? selectedConfigGenTemplateName
                    : (configGenInstructionFiles.find(d => d.id === selectedConfigGenInstructionId)?.file ?? ''))
                : '';
    const hasFixedSelection = (isProviderCategory && !!selectedProviderId)
        || (isComfyDirectiveCategory && !!selectedComfyDirectiveId)
        || (isConfigGenInstructionCategory && (!!configGenTemplateKind || !!selectedConfigGenInstructionId));
    const isSavedState = !anyDirty && (templateMode ? editingTemplate !== null && editingTemplate !== '' : isFixedFileCategory ? hasFixedSelection : selectedExistingFile !== null);
    const showAux = !templateMode && !isFixedFileCategory;
    const hasSavedFile = selectedExistingFile !== null;
    const auxTabs: { value: AuxTab; label: string }[] = isCharacter
        ? [
            { value: 'info', label: tm(MATERIAL_I18N_KEYS.auxInfo) },
            { value: 'dialog', label: tm(MATERIAL_I18N_KEYS.dialogTab) },
            { value: 'faces', label: tm(MATERIAL_I18N_KEYS.auxFaces) },
            ...(imageGenEnabled ? [{ value: 'imageGen' as const, label: tm(MATERIAL_I18N_KEYS.auxImageGen) }] : []),
            ...(ttsEnabled ? [{ value: 'voice' as const, label: tm(MATERIAL_I18N_KEYS.auxVoice) }] : []),
            { value: 'linked', label: tm(MATERIAL_I18N_KEYS.auxLinked) },
        ]
        : [{ value: 'dialog', label: tm(MATERIAL_I18N_KEYS.dialogTab) }];
    const visibleAuxTab: AuxTab = auxTabs.some(tab => tab.value === auxTab) ? auxTab : auxTabs[0].value;
    // 縦に並べる形は、付属が複数あるキャラのときだけ使う
    const stackAux = auxLayout === 'stack' && auxTabs.length > 1;
    // 狭い画面では本文と付属のタブを縦に並べると付属側が見切れるため、本文もタブにして一つずつ表示する。
    // 縦に並べる形のときは「本文」と「付属」の二つのタブにし、付属の中を縦に並べる
    const narrowTabs = !isWideScreen && showAux;
    const showBodyPane = !narrowTabs || narrowBody;
    const showAuxPane = !narrowTabs || !narrowBody;
    const paneTabs: { value: PaneTab; label: string }[] = narrowTabs
        ? [
            { value: 'body', label: tm(MATERIAL_I18N_KEYS.auxBody) },
            ...(stackAux ? [{ value: auxTabs[0].value, label: tm(MATERIAL_I18N_KEYS.auxAll) }] : auxTabs),
        ]
        : auxTabs;
    const visiblePaneTab: PaneTab = narrowTabs && narrowBody ? 'body' : narrowTabs && stackAux ? auxTabs[0].value : visibleAuxTab;
    // タブごとの保存していない変更（本文・作品とタグ・画像生成・紐づけ）
    const paneTabDirty = (value: PaneTab): boolean =>
        value === 'body' ? isDirty
            : value === 'info' ? auxDirty.tags
                : value === 'imageGen' ? auxDirty.imageGen
                    : value === 'linked' ? auxDirty.linked
                        : false;
    const auxAnyDirty = auxDirty.tags || auxDirty.imageGen || auxDirty.linked;
    const selectPaneTab = (value: PaneTab) => {
        if (value === 'body') {
            setNarrowBody(true);
            return;
        }
        setNarrowBody(false);
        if (!stackAux) setAuxTab(value);
    };
    // 付属の区画を見せているか（タブなら選んでいる一つ、縦に並べる形なら開いているもの）
    const auxShown = (tab: AuxTab): boolean => {
        if (!stackAux) return visibleAuxTab === tab;
        return auxOpenSections[tab] && (hasSavedFile || tab === 'info');
    };
    const changeAuxLayout = (next: AuxLayout) => {
        setAuxLayout(next);
        writeStored(AUX_LAYOUT_STORAGE_KEY, next);
    };
    const toggleAuxSection = (tab: AuxTab) => {
        const next = { ...auxOpenSections, [tab]: !auxOpenSections[tab] };
        setAuxOpenSections(next);
        writeStored(AUX_OPEN_STORAGE_KEY, JSON.stringify(next));
    };
    // 今の表示の形で使う幅（付属が一つだけのときはタブの形の幅）
    const widthLayout: AuxLayout = stackAux ? 'stack' : 'tabs';
    const auxWidth = auxWidths[widthLayout];
    const setAuxWidth = (width: number) => setAuxWidths(prev => ({ ...prev, [widthLayout]: width }));
    const storeAuxWidth = (width: number) => writeStored(AUX_WIDTH_STORAGE_KEY[widthLayout], String(Math.round(width)));
    // 付属の欄の幅は最小幅から、本文に BODY_MIN_WIDTH を残せる幅までに収める
    const clampAuxWidth = (width: number): number => {
        const total = rootRef.current?.clientWidth ?? 0;
        const max = Math.max(AUX_MIN_WIDTH, total - LIST_WIDTH - BODY_MIN_WIDTH);
        return Math.round(Math.min(Math.max(width, AUX_MIN_WIDTH), max));
    };
    // 画面が狭まって覚えている幅より細く表示されていることがあるため、動かし始めは表示している幅から数える
    const shownAuxWidth = () => auxAsideRef.current?.getBoundingClientRect().width ?? auxWidth;
    const startAuxResize = (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const handle = e.currentTarget;
        handle.setPointerCapture(e.pointerId);
        const startX = e.clientX;
        const startWidth = shownAuxWidth();
        let latest = startWidth;
        const onMove = (ev: PointerEvent) => {
            latest = clampAuxWidth(startWidth + startX - ev.clientX);
            setAuxWidth(latest);
        };
        const onEnd = () => {
            handle.removeEventListener('pointermove', onMove);
            handle.removeEventListener('pointerup', onEnd);
            handle.removeEventListener('pointercancel', onEnd);
            storeAuxWidth(latest);
        };
        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', onEnd);
        handle.addEventListener('pointercancel', onEnd);
    };
    // キーボードでも幅を変えられるようにする（← で広げ、→ で狭める）
    const handleAuxResizeKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const next = clampAuxWidth(shownAuxWidth() + (e.key === 'ArrowLeft' ? 16 : -16));
        setAuxWidth(next);
        storeAuxWidth(next);
    };
    const fileKey = `${selectedCategoryId}|${selectedExistingFile?.dirName ?? ''}|${selectedExistingFile?.name ?? ''}`;

    // 別の名前で保存：テンプレートと、ファイル名を自由に付けられる種別で出す（中身が決まった一つのファイルの種別と、
    // AI への指示のように決まった名前で保存する種別では出さない）
    const canSaveAs = templateMode
        || (!isFixedFileCategory && !isProviderCategory && !isComfyDirectiveCategory && !isConfigGenInstructionCategory);
    // 小窓で決めた名前で本文を保存し、その名前のファイル（テンプレート）を開いた状態にする。同じ名前があれば上書きを確かめる
    const submitSaveAs = () => {
        const name = (saveAsName ?? '').trim();
        if (!name) { showToast(t(CONFIG_EDITOR_I18N_KEYS.titleRequired)); return; }
        setSaveAsName(null);
        if (templateMode) {
            // 同じ名前がほかにあれば、保存の中で上書きを確かめる
            void saveTemplateNow(name);
            return;
        }
        void handleSave({ kind: 'new', name });
    };

    const menuItems: { key: string; label: string; icon: React.ReactNode; onClick: () => void; danger?: boolean }[] = [];
    if (!templateMode && !isFixedFileCategory) {
        templates.forEach(name => menuItems.push({
            key: `tmpl-${name}`,
            label: formatText(tm(MATERIAL_I18N_KEYS.rebuildFromTemplate), { name }),
            icon: <BookTemplate size={14} />,
            onClick: () => { void handleSelectTemplate(name); },
        }));
        // 取り込み先の種別を添える（まとまりに種別が複数あるとき、どこへ入るかが分かるように）
        menuItems.push({ key: 'import', label: formatWithNote(uiCatalog, tm(MATERIAL_I18N_KEYS.importMd), categoryLabel(selectedCategoryId)), icon: <Upload size={14} />, onClick: () => importInputRef.current?.click() });
    }
    menuItems.push({ key: 'export', label: tm(MATERIAL_I18N_KEYS.export), icon: <Download size={14} />, onClick: exportContent });
    if (templateMode && editingTemplate) {
        menuItems.push({ key: 'default', label: tm(MATERIAL_I18N_KEYS.makeDefault), icon: <Star size={14} />, onClick: () => { void makeDefaultTemplate(); } });
        menuItems.push({ key: 'deleteTemplate', label: tm(MATERIAL_I18N_KEYS.deleteTemplate), icon: <Trash2 size={14} />, onClick: () => { void deleteTemplateNow(); }, danger: true });
    }
    if (isComfyDirectiveCategory && selectedComfyDirectiveId) {
        menuItems.push({ key: 'reset', label: tm(MATERIAL_I18N_KEYS.resetDefault), icon: <RotateCcw size={14} />, onClick: () => { void handleResetComfyDirective(); } });
    }
    if (isConfigGenInstructionCategory && !configGenTemplateKind && selectedConfigGenInstructionId) {
        menuItems.push({ key: 'reset', label: tm(MATERIAL_I18N_KEYS.resetDefault), icon: <RotateCcw size={14} />, onClick: () => { void handleResetConfigGenInstruction(); } });
    }
    if (!templateMode && !isFixedFileCategory && selectedExistingFile) {
        menuItems.push({ key: 'delete', label: tm(MATERIAL_I18N_KEYS.deleteFile), icon: <Trash2 size={14} />, onClick: handleDelete, danger: true });
    }

    // 一覧の1行
    // 画像生成分析指示のうち、全体の設定で使っている形式のもの（APIサービス用は「api_」で始まる）
    const directiveInUse = (id: string): boolean => {
        if (!activeDirectiveModes) return false;
        const mode = id.startsWith('api_') ? activeDirectiveModes.api : activeDirectiveModes.comfyui;
        return directiveModeForDirectiveId(id) === mode;
    };

    // warn：編集をすすめない行（設定自動生成の作成指示）を警告の色にする
    const listRow = (key: string, label: string, sub: string | null, selected: boolean, onClick: () => void, badge?: string, warn = false) => (
        <button
            key={key}
            type="button"
            onClick={onClick}
            className={cn(
                'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-ui text-left transition-colors',
                selected ? 'bg-accent-soft text-fg' : 'text-fg hover:bg-surface',
            )}
        >
            <FileText size={14} className="shrink-0 text-fg-muted" />
            <span className="min-w-0 flex-1">
                <span className={cn('block truncate text-[13px]', selected && 'font-semibold', warn && 'text-warn')}>{label}</span>
                {sub && <span className="block truncate text-xs text-fg-muted">{sub}</span>}
            </span>
            {badge && <span className="shrink-0 text-xs px-1.5 rounded-full bg-accent-soft text-fg">{badge}</span>}
        </button>
    );

    const listSections: React.ReactNode[] = [];
    if (templateMode) {
        const defaultName = defaultTemplates[selectedCategoryId];
        listSections.push(
            <section key="templates" className="mb-2">
                <h3 className="px-2.5 pt-3 pb-1 text-xs font-bold tracking-wider text-fg-muted">
                    {formatText(tm(MATERIAL_I18N_KEYS.templateOf), { kind: categoryLabel(selectedCategoryId) })}
                </h3>
                {templates.filter(matches).map(name => listRow(
                    `t-${name}`, name, null, editingTemplate === name, () => openTemplate(name),
                    defaultName === name ? tm(MATERIAL_I18N_KEYS.defaultBadge) : undefined,
                ))}
            </section>,
            <section key="template-pack" className="mx-2.5 mt-3 pt-3 border-t border-line space-y-1.5">
                <Button size="sm" variant="ghost" disabled={templatePackRunning} onClick={() => { void handleTemplatePack(); }}>
                    <Download size={14} />
                    {resolveMessage(uiCatalog, CONFIG_GEN_I18N_KEYS.templatePack, CONFIG_GEN_TEXT_FALLBACK_JA[CONFIG_GEN_I18N_KEYS.templatePack])}
                </Button>
                <label className="flex items-center gap-1.5 text-xs text-fg-muted">
                    <input type="checkbox" checked={templatePackOverwrite} disabled={templatePackRunning} onChange={e => setTemplatePackOverwrite(e.target.checked)} />
                    {resolveMessage(uiCatalog, CONFIG_GEN_I18N_KEYS.templatePackOverwrite, CONFIG_GEN_TEXT_FALLBACK_JA[CONFIG_GEN_I18N_KEYS.templatePackOverwrite])}
                </label>
            </section>,
        );
    } else if (isAiGroup) {
        const providerRows = providerFiles
            .map(p => ({ id: p.id, label: resolveMessage(uiCatalog, `configEditor.providerInstruction.${p.id}`, p.label) }))
            .filter(p => matches(p.label));
        listSections.push(
            <section key="provider" className="mb-2">
                <h3 className="px-2.5 pt-3 pb-1 text-xs font-bold tracking-wider text-fg-muted">{categoryLabel(PROVIDER_CATEGORY_ID)}</h3>
                {providerRows.map(p => listRow(`p-${p.id}`, p.label, null, isProviderCategory && selectedProviderId === p.id, () => openFixedItem(PROVIDER_CATEGORY_ID, p.id)))}
            </section>,
        );
        const targets = Array.from(new Set(visibleConfigGenInstructionFiles.map(f => f.target)));
        targets.forEach(target => {
            const rows = [
                { id: `${target}-search_template-${configGenLocale}`, match: `${CONFIG_GEN_TEMPLATE_ID_PREFIX}search`, label: t(CONFIG_EDITOR_I18N_KEYS.configGenTemplateSearch), warn: false },
                { id: `${target}-setting_template-${configGenLocale}`, match: `${CONFIG_GEN_TEMPLATE_ID_PREFIX}setting`, label: t(CONFIG_EDITOR_I18N_KEYS.configGenTemplateSetting), warn: false },
                // 作成指示は編集をすすめないので警告の色にする
                ...visibleConfigGenInstructionFiles.filter(f => f.target === target).map(f => ({ id: f.id, match: f.id, label: configGenMethodLabel(f), warn: true })),
            ].filter(row => matches(row.label));
            if (rows.length === 0) return;
            listSections.push(
                <section key={`cg-${target}`} className="mb-2">
                    <h3 className="px-2.5 pt-3 pb-1 text-xs font-bold tracking-wider text-fg-muted">
                        {formatLabelValue(uiCatalog, categoryLabel(CONFIG_GEN_INSTRUCTION_CATEGORY_ID), categoryLabel(target))}
                    </h3>
                    {rows.map(row => listRow(
                        `cg-${row.id}`, row.label, null,
                        isConfigGenInstructionCategory && selectedConfigGenTarget === target && selectedConfigGenInstructionId === row.match,
                        () => openFixedItem(CONFIG_GEN_INSTRUCTION_CATEGORY_ID, row.id),
                        undefined,
                        row.warn,
                    ))}
                </section>,
            );
        });
        if (comfyDirectiveVisible) {
            const rows = comfyDirectiveFiles
                .map(d => ({ id: d.id, label: resolveMessage(uiCatalog, `configEditor.comfyDirective.file.${d.id}`, d.label) }))
                .filter(d => matches(d.label));
            listSections.push(
                <section key="comfy" className="mb-2">
                    <h3 className="px-2.5 pt-3 pb-1 text-xs font-bold tracking-wider text-fg-muted">{categoryLabel(COMFY_DIRECTIVE_CATEGORY_ID)}</h3>
                    {rows.map(d => listRow(
                        `c-${d.id}`, d.label, null, isComfyDirectiveCategory && selectedComfyDirectiveId === d.id,
                        () => openFixedItem(COMFY_DIRECTIVE_CATEGORY_ID, d.id),
                        directiveInUse(d.id) ? t(CONFIG_EDITOR_I18N_KEYS.comfyDirectiveInUse) : undefined,
                    ))}
                </section>,
            );
        }
    } else if (currentGroup) {
        currentGroup.categories.forEach(categoryId => {
            const files = (groupFiles[categoryId] ?? []).filter(f => matches(f.name));
            listSections.push(
                <section key={categoryId} className="mb-2">
                    <h3 className="flex items-center justify-between gap-2 px-2.5 pt-2 pb-0.5 text-xs font-bold tracking-wider text-fg-muted">
                        {/* 選んでいる種別（新規作成・テンプレート・取り込みの対象）は差し色で示す */}
                        <span className={cn(selectedCategoryId === categoryId && 'text-accent')}>{categoryLabel(categoryId)}</span>
                        <span className="flex items-center gap-1">
                            <span>{(groupFiles[categoryId] ?? []).length}</span>
                            <IconButton size="sm" label={formatLabelValue(uiCatalog, categoryLabel(categoryId), tm(MATERIAL_I18N_KEYS.newFile))} onClick={() => startNewFileIn(categoryId)}>
                                <Plus size={13} />
                            </IconButton>
                        </span>
                    </h3>
                    {files.map(f => listRow(
                        `f-${categoryId}-${f.dirName}-${f.name}`,
                        f.name,
                        f.dirName !== f.name ? f.dirName : null,
                        selectedCategoryId === categoryId && selectedExistingFile?.name === f.name && selectedExistingFile?.dirName === f.dirName,
                        () => openEntry(categoryId, f),
                    ))}
                    {files.length === 0 && <p className="px-2.5 py-1 text-xs text-fg-muted">{tm(MATERIAL_I18N_KEYS.noFiles)}</p>}
                </section>,
            );
        });
    }

    // 付属の欄の表示の形の切り替え（付属が複数あるキャラのときだけ）。押すたびにタブと縦に並べる形を入れ替え、縦に並べる形のとき点灯する
    const auxLayoutSwitch = auxTabs.length > 1 && (
        <IconButton
            size="sm"
            label={tm(MATERIAL_I18N_KEYS.auxLayoutStack)}
            active={auxLayout === 'stack'}
            aria-pressed={auxLayout === 'stack'}
            onClick={() => changeAuxLayout(auxLayout === 'stack' ? 'tabs' : 'stack')}
        >
            <Rows3 size={15} />
        </IconButton>
    );

    const paneTabBar = (
        <div className="flex items-stretch border-b border-line shrink-0">
            <div className="flex-1 min-w-0 flex gap-0.5 px-2 overflow-x-auto overflow-y-hidden">
            {paneTabs.map(tab => {
                const disabled = !hasSavedFile && tab.value !== 'info' && tab.value !== 'body';
                // 狭い画面で縦に並べる形のときの「付属」のタブは、付属のどこかに変更があれば印を出す
                const dirty = narrowTabs && stackAux && tab.value !== 'body' ? auxAnyDirty : paneTabDirty(tab.value);
                return (
                    <button
                        key={tab.value}
                        type="button"
                        disabled={disabled}
                        onClick={() => selectPaneTab(tab.value)}
                        className={cn(
                            'px-2 py-2.5 -mb-px text-[12.5px] whitespace-nowrap border-b-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
                            visiblePaneTab === tab.value ? 'border-accent text-fg font-semibold' : 'border-transparent text-fg-muted hover:text-fg',
                        )}
                    >
                        {tab.label}
                        {/* そのタブに保存していない変更があるときの印 */}
                        {dirty && (
                            <span className="ml-1 text-warn" title={tm(MATERIAL_I18N_KEYS.unsaved)} aria-label={tm(MATERIAL_I18N_KEYS.unsaved)}>●</span>
                        )}
                    </button>
                );
            })}
            </div>
            {auxLayoutSwitch && <div className="shrink-0 flex items-center pr-1.5">{auxLayoutSwitch}</div>}
        </div>
    );

    // 付属の区画。タブの形では選んでいる一つだけを見せ、縦に並べる形では見出しを押して開け閉めする。
    // 形を切り替えても中の部品を作り直さない（編集中の内容を消さない）よう、どちらの形でも同じ入れ子・同じ並びにし、
    // 縦に並べる形で表情画像を一番上に出すのは表示の順（order）で行う
    const auxSection = (tab: AuxTab, body: React.ReactNode, tabsClass = '', stackClass = '') => {
        const label = auxTabs.find(x => x.value === tab)?.label ?? '';
        const disabled = !hasSavedFile && tab !== 'info';
        const open = auxShown(tab);
        return (
            <div className={stackAux ? cn('shrink-0 rounded-ui-lg border border-line', tab === 'faces' && 'order-first') : open ? tabsClass : 'hidden'}>
                {stackAux && (
                    <button
                        type="button"
                        disabled={disabled}
                        aria-expanded={open}
                        onClick={() => toggleAuxSection(tab)}
                        className="w-full flex items-center gap-1.5 px-3 py-2 text-left text-[12.5px] font-semibold text-fg disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        {label}
                        {paneTabDirty(tab) && (
                            <span className="text-warn" title={tm(MATERIAL_I18N_KEYS.unsaved)} aria-label={tm(MATERIAL_I18N_KEYS.unsaved)}>●</span>
                        )}
                    </button>
                )}
                <div className={stackAux ? (open ? cn('border-t border-line p-3', stackClass) : 'hidden') : 'contents'}>
                    {body}
                </div>
            </div>
        );
    };

    const auxPanel = showAux && (
        <aside
            ref={auxAsideRef}
            className={cn(
                'relative flex flex-col min-h-0 lg:border-l lg:border-t-0 border-line bg-panel',
                !narrowTabs && 'border-t',
                !showAuxPane && 'hidden',
            )}
        >
            {/* 広い画面では左端を掴んで幅を変える */}
            {isWideScreen && (
                <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={tm(MATERIAL_I18N_KEYS.auxResize)}
                    aria-valuenow={auxWidth}
                    aria-valuemin={AUX_MIN_WIDTH}
                    tabIndex={0}
                    onPointerDown={startAuxResize}
                    onKeyDown={handleAuxResizeKey}
                    className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize touch-none outline-none hover:bg-accent-soft focus-visible:bg-accent-soft"
                />
            )}
            {narrowTabs ? null : auxTabs.length > 1 && !stackAux ? paneTabBar : (
                <div className="flex items-center gap-2 pl-4 pr-1.5 border-b border-line shrink-0">
                    <h3 className="flex-1 py-2.5 text-[12.5px] font-semibold">{auxTabs.length > 1 ? tm(MATERIAL_I18N_KEYS.auxAll) : auxTabs[0].label}</h3>
                    {auxLayoutSwitch}
                </div>
            )}
            <div className={cn('flex-1 min-h-0 overflow-y-auto p-4', stackAux && 'flex flex-col gap-2')} key={fileKey}>
                {!hasSavedFile && (
                    <div className={cn('mb-4 rounded-ui-lg bg-accent-soft p-3 text-xs text-fg', stackAux && 'shrink-0 order-first')}>
                        {isCharacter ? tm(MATERIAL_I18N_KEYS.saveFirstAux) : tm(MATERIAL_I18N_KEYS.dialogSaveFirst)}
                    </div>
                )}
                {isCharacter && auxSection('info', (
                    <div className="space-y-3">
                        <CharacterTagsEditor ref={tagsRef} backendUrl={backendUrl} dirName={characterDirName} uiCatalog={uiCatalog} hideSaveButton onDirtyChange={markTagsDirty} />
                        <p className="text-xs text-fg-muted">{tm(MATERIAL_I18N_KEYS.infoHint)}</p>
                    </div>
                ))}
                {hasSavedFile && selectedExistingFile && auxSection('dialog', (
                        <DialogEditPanel
                            backendUrl={backendUrl}
                            uiCatalog={uiCatalog}
                            categoryId={selectedCategoryId}
                            dirName={selectedExistingFile.dirName}
                            fileName={selectedExistingFile.name}
                            content={isSimpleMode && isCharacter ? simpleCharacterToMarkdown(simpleConfig, title, uiCatalog) : content}
                            isDirty={isDirty}
                            active={auxShown('dialog') && showAuxPane}
                            onBodySaved={() => setIsDirty(false)}
                            onContentReplaced={next => {
                                setIsSimpleMode(false);
                                setContent(next);
                                setIsDirty(false);
                            }}
                            onToast={showToast}
                        />
                ), 'h-full min-h-[320px]', 'h-[60vh] min-h-[320px]')}
                {isCharacter && characterDirName && (
                    <>
                        {auxSection('faces', (
                            <EmotionImageTab backendUrl={backendUrl} dirName={characterDirName} uiCatalog={uiCatalog} imageGenEnabled={imageGenEnabled} />
                        ))}
                        {imageGenEnabled && auxSection('imageGen', (
                                <ImageGenTab
                                    ref={imageGenRef}
                                    backendUrl={backendUrl}
                                    dirName={characterDirName}
                                    fileName={selectedExistingFile?.name ?? null}
                                    active
                                    uiCatalog={uiCatalog}
                                    onDirtyChange={markImageGenDirty}
                                    appearancePrompt={appearancePrompt}
                                    hideSaveButton
                                />
                        ))}
                        {ttsEnabled && auxSection('voice', (
                            <VoiceTab backendUrl={backendUrl} dirName={characterDirName} uiCatalog={uiCatalog} />
                        ))}
                        {auxSection('linked', (
                            <LinkedSettingsTab ref={linkedRef} backendUrl={backendUrl} dirName={characterDirName} uiCatalog={uiCatalog} onDirtyChange={markLinkedDirty} hideSaveButton />
                        ))}
                    </>
                )}
            </div>
        </aside>
    );

    // Ctrl+S（Cmd+S）で上の帯の「保存」と同じ保存をする。本文の編集欄・項目で入力・付属の欄のどこで押しても効き、
    // ブラウザの「ページを保存」は出さない。保存中と、保存ボタンが押せないときは何もしない
    const handleSaveShortcut = (e: React.KeyboardEvent) => {
        if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 's') return;
        e.preventDefault();
        if (isSaving || (isFixedFileCategory && !hasFixedSelection)) return;
        void saveAll();
    };

    return (
        <div
            ref={rootRef}
            onKeyDown={handleSaveShortcut}
            // 付属の欄は覚えた幅で出す。画面が狭まったときは本文の最小幅を残すまで細くし、最小幅は下回らない
            style={showAux ? {
                '--config-editor-cols': `${LIST_WIDTH}px minmax(0,1fr) clamp(${AUX_MIN_WIDTH}px, ${auxWidth}px, calc(100% - ${LIST_WIDTH + BODY_MIN_WIDTH}px))`,
            } as React.CSSProperties : undefined}
            className={cn(
                'relative flex-1 min-h-0 grid grid-cols-1 overflow-hidden',
                showAux ? 'lg:grid-cols-[var(--config-editor-cols)]' : 'lg:grid-cols-[260px_minmax(0,1fr)]',
                // 狭い画面のタブ表示：付属のタブ表示中は「本文の見出しとタブ欄」と「付属の中身」の2段、本文表示中は1段
                narrowTabs && (showAuxPane ? 'grid-rows-[auto_minmax(0,1fr)]' : 'grid-rows-[minmax(0,1fr)]'),
            )}
        >
            {/* 一覧 */}
            <aside
                className={cn('flex-col min-h-0 border-r border-line lg:flex', listOpenNarrow ? 'flex absolute inset-0 z-20 bg-panel-solid lg:bg-none lg:bg-panel lg:static' : 'hidden')}
                onDragOver={e => { if (!isFixedFileCategory && !templateMode) { e.preventDefault(); setIsDragOver(true); } }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={e => {
                    e.preventDefault();
                    setIsDragOver(false);
                    if (!isFixedFileCategory && !templateMode && e.dataTransfer.files.length > 0) void handleDropFiles(e.dataTransfer.files);
                }}
            >
                <div className="p-3 space-y-2.5 border-b border-line shrink-0">
                    <div className="flex gap-1.5">
                        <Button size="sm" variant="secondary" className="flex-1" disabled={isAiGroup} onClick={startNewFile}>
                            <Plus size={14} />
                            {templateMode ? tm(MATERIAL_I18N_KEYS.newTemplate) : tm(MATERIAL_I18N_KEYS.newFile)}
                        </Button>
                        {headerActions}
                    </div>
                    <div className="flex flex-wrap gap-1">
                        {kindGroups.map(group => (
                            <Chip key={group.id} selected={group.id === currentGroup?.id} onClick={() => selectGroup(group.id)}>
                                {tm(group.labelKey)}
                            </Chip>
                        ))}
                    </div>
                    <div className="flex gap-1.5 items-center">
                        <TextField
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder={tm(MATERIAL_I18N_KEYS.search)}
                            className="h-8 text-xs"
                        />
                        {!isAiGroup && (
                            <Button size="sm" variant={templateMode ? 'primary' : 'ghost'} onClick={toggleTemplateMode}>
                                {tm(MATERIAL_I18N_KEYS.templates)}
                            </Button>
                        )}
                    </div>
                </div>
                {/* ファイルを重ねている間は、取り込み先の種別を出す */}
                {isDragOver && (
                    <p className="shrink-0 px-3 py-2 text-xs text-fg bg-accent-soft border-b border-line">
                        {formatLabelValue(uiCatalog, t(CONFIG_EDITOR_I18N_KEYS.dropZoneLabel), categoryLabel(selectedCategoryId))}
                    </p>
                )}
                <div className={cn('flex-1 min-h-0 overflow-y-auto px-2 pb-3', isDragOver && 'bg-accent-soft')}>
                    {listSections}
                </div>
                <input
                    ref={importInputRef}
                    type="file"
                    accept=".md"
                    multiple
                    className="hidden"
                    onChange={e => {
                        if (e.target.files && e.target.files.length > 0) void handleDropFiles(e.target.files);
                        e.target.value = '';
                    }}
                />
            </aside>

            {/* 本文 */}
            <section className={cn('flex flex-col min-w-0', narrowTabs ? 'min-h-0' : 'min-h-[60vh] lg:min-h-0')}>
                <div className="flex flex-wrap items-center gap-2 px-3 sm:px-4 py-2.5 border-b border-line shrink-0">
                    <IconButton label={tm(MATERIAL_I18N_KEYS.list)} className="lg:hidden" onClick={() => setListOpenNarrow(v => !v)}>
                        <List size={18} />
                    </IconButton>
                    <input
                        type="text"
                        value={isFixedFileCategory ? selectedFixedLabel : title}
                        onChange={e => { setTitle(e.target.value); setIsDirty(true); }}
                        placeholder={templateMode ? tm(MATERIAL_I18N_KEYS.templateBadge) : t(CONFIG_EDITOR_I18N_KEYS.titlePlaceholder)}
                        disabled={isFixedFileCategory}
                        className="flex-1 min-w-[8rem] bg-transparent border-0 outline-none font-head text-base font-bold text-fg placeholder:text-fg-muted disabled:opacity-80"
                    />
                    {templateMode && <span className="text-xs px-2 py-0.5 rounded-full bg-accent-soft text-fg">{tm(MATERIAL_I18N_KEYS.templateBadge)}</span>}
                    {anyDirty && <span className="text-xs px-2 py-0.5 rounded-full bg-accent-soft text-warn">{tm(MATERIAL_I18N_KEYS.unsaved)}</span>}
                    {isSavedState && <span className="text-xs px-2 py-0.5 rounded-full bg-accent-soft text-ok">{tm(MATERIAL_I18N_KEYS.saved)}</span>}
                    {isCharacter && !templateMode && (
                        <Segmented<'text' | 'form'>
                            label={tm(MATERIAL_I18N_KEYS.modeText)}
                            value={isSimpleMode ? 'form' : 'text'}
                            onChange={value => {
                                if (value === 'form') handleToFormMode();
                                else if (isSimpleMode) handleToStandardMode();
                            }}
                            options={[
                                { value: 'text', label: tm(MATERIAL_I18N_KEYS.modeText) },
                                { value: 'form', label: tm(MATERIAL_I18N_KEYS.modeForm) },
                            ]}
                        />
                    )}
                    <Button
                        size="sm"
                        variant="primary"
                        disabled={isSaving || (isFixedFileCategory && !hasFixedSelection)}
                        onClick={() => { void saveAll(); }}
                    >
                        <Save size={14} />
                        {tm(MATERIAL_I18N_KEYS.save)}
                    </Button>
                    {canSaveAs && (
                        <Button
                            size="sm"
                            variant="secondary"
                            disabled={isSaving}
                            onClick={() => setSaveAsName(title)}
                            title={tm(MATERIAL_I18N_KEYS.saveAs)}
                            aria-label={tm(MATERIAL_I18N_KEYS.saveAs)}
                        >
                            <FilePlus size={14} />
                            <span className="hidden sm:inline">{tm(MATERIAL_I18N_KEYS.saveAs)}</span>
                        </Button>
                    )}
                    {/* 折り返して行の左に来るとメニューが左へ見切れるため、常に行の右端へ寄せる */}
                    <div ref={menuRef} className="relative ml-auto">
                        <IconButton label={tm(MATERIAL_I18N_KEYS.more)} onClick={() => setMenuOpen(v => !v)}>
                            <MoreHorizontal size={18} />
                        </IconButton>
                        {menuOpen && (
                            <div className="absolute right-0 top-10 z-30 min-w-[240px] max-w-[calc(100vw-2rem)] max-h-[60vh] overflow-y-auto p-1.5 rounded-ui-lg border border-line-strong bg-[rgb(var(--c-bg-rgb))] shadow-2xl">
                                {menuItems.map(item => (
                                    <button
                                        key={item.key}
                                        type="button"
                                        onClick={() => { setMenuOpen(false); item.onClick(); }}
                                        className={cn(
                                            'w-full flex items-center gap-2 px-2.5 py-2 rounded-ui text-left text-[13px] hover:bg-surface',
                                            item.danger ? 'text-danger' : 'text-fg',
                                        )}
                                    >
                                        {item.icon}
                                        {item.label}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* 狭い画面のタブ欄（本文と付属のタブを切り替える） */}
                {narrowTabs && paneTabBar}

                {/* 設定自動生成のテンプレート（名前の選択・新規・既定・削除） */}
                {isConfigGenInstructionCategory && configGenTemplateKind && (
                    <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-line shrink-0">
                        <span className="text-xs text-fg-muted">{t(CONFIG_EDITOR_I18N_KEYS.configGenTemplateName)}</span>
                        <select
                            value={selectedConfigGenTemplateName}
                            onChange={e => handleSelectConfigGenTemplateName(selectedConfigGenTarget, configGenTemplateKind, e.target.value)}
                            className="h-8 px-2 rounded-ui bg-surface border border-line-strong text-fg text-xs outline-none focus:border-accent"
                        >
                            <option value="">{t(CONFIG_EDITOR_I18N_KEYS.configGenTemplateSelect)}</option>
                            {configGenTemplateNames.map(name => (
                                <option key={name} value={name}>
                                    {name}{configGenTemplateDefaultName(configGenTemplateDefaults, selectedConfigGenTarget, configGenLocale, configGenTemplateKind) === name ? t(CONFIG_EDITOR_I18N_KEYS.configGenTemplateDefaultMark) : ''}
                                </option>
                            ))}
                        </select>
                        {!selectedConfigGenTemplateName && (
                            <TextField
                                value={configGenTemplateNewName}
                                onChange={e => setConfigGenTemplateNewName(e.target.value)}
                                placeholder={t(CONFIG_EDITOR_I18N_KEYS.configGenTemplateNewName)}
                                className="h-8 w-48 text-xs"
                            />
                        )}
                        <Button size="sm" variant="ghost" onClick={handleNewConfigGenTemplate}>
                            <FilePlus size={12} />
                            {t(CONFIG_EDITOR_I18N_KEYS.configGenTemplateNew)}
                        </Button>
                        <Button size="sm" variant="ghost" disabled={!selectedConfigGenTemplateName} onClick={() => { void handleSetDefaultConfigGenTemplate(); }}>
                            {t(CONFIG_EDITOR_I18N_KEYS.configGenTemplateSetDefault)}
                        </Button>
                        <Button size="sm" variant="danger" disabled={!selectedConfigGenTemplateName} onClick={() => { void handleDeleteConfigGenTemplate(); }}>
                            <Trash2 size={12} />
                            {t(CONFIG_EDITOR_I18N_KEYS.configGenTemplateDelete)}
                        </Button>
                    </div>
                )}

                {/* 決まったファイル（AI への指示）の説明 */}
                {isFixedFileCategory && (
                    <p className={cn(
                        'px-4 py-2 border-b border-line text-xs shrink-0',
                        selectedConfigGenInstruction?.kind === 'instruction' ? 'text-warn' : 'text-fg-muted',
                    )}>
                        {isProviderCategory
                            ? t(CONFIG_EDITOR_I18N_KEYS.providerDescription)
                            : isComfyDirectiveCategory
                                ? t(CONFIG_EDITOR_I18N_KEYS.comfyDirectiveDescription)
                                : selectedConfigGenInstruction?.kind === 'instruction'
                                    ? t(CONFIG_EDITOR_I18N_KEYS.configGenInstructionEditNotRecommended)
                                    : configGenTemplateKind
                                        ? t(CONFIG_EDITOR_I18N_KEYS.configGenTemplateDescription)
                                        : t(CONFIG_EDITOR_I18N_KEYS.configGenInstructionDescription)}
                    </p>
                )}

                <div className={cn('flex-1 min-h-0 overflow-y-auto px-4 py-3', !showBodyPane && 'hidden')}>
                    {isSimpleMode && isCharacter && !templateMode ? (
                        <SimpleCharacterForm
                            value={simpleConfig}
                            onChange={v => { setSimpleConfig(v); setIsDirty(true); formEditedRef.current = true; }}
                            uiCatalog={uiCatalog}
                        />
                    ) : (
                        <CodeEditor
                            value={content}
                            onChange={v => { setContent(v); setIsDirty(true); }}
                            placeholder={t(CONFIG_EDITOR_I18N_KEYS.contentPlaceholder)}
                            uiCatalog={uiCatalog}
                        />
                    )}
                </div>
            </section>

            {/* 付属のタブ */}
            {auxPanel}

            {/* トースト */}
            {toast && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 bg-fg text-[rgb(var(--c-bg-rgb))] text-sm px-4 py-2 rounded-ui shadow-lg pointer-events-none">
                    {toast}
                </div>
            )}

            {/* 確認ダイアログ（同じ名前の上書き・削除・項目で入力から本文へ） */}
            {confirm && confirmMeta && (
                <ConfirmDialog
                    isOpen={true}
                    title={confirmMeta.title}
                    message={confirmMeta.message}
                    onYes={handleConfirmYes}
                    onNo={() => {
                        // 「本文で編集」タブへ切り替えるときの確認で「いいえ」なら、反映せずに切り替える。ほかの確認では閉じるだけ
                        const back = confirm.kind === 'toStandard';
                        setConfirm(null);
                        if (back) discardFormAndBackToText();
                    }}
                    onCancel={() => setConfirm(null)}
                    uiCatalog={uiCatalog}
                />
            )}

            {/* 保存していない変更があるまま移るとき */}
            <Modal
                open={leaveAction !== null}
                onClose={() => setLeaveAction(null)}
                title={tm(MATERIAL_I18N_KEYS.leaveTitle)}
                size="sm"
                closeLabel={tm(MATERIAL_I18N_KEYS.leaveBack)}
                footer={(
                    <div className="flex flex-wrap justify-end gap-2">
                        <Button variant="ghost" onClick={() => setLeaveAction(null)}>{tm(MATERIAL_I18N_KEYS.leaveBack)}</Button>
                        <Button
                            variant="secondary"
                            onClick={() => {
                                const action = leaveAction;
                                setLeaveAction(null);
                                setIsDirty(false);
                                resetAuxDirty();
                                action?.run();
                            }}
                        >
                            {tm(MATERIAL_I18N_KEYS.leaveDiscard)}
                        </Button>
                        <Button
                            variant="primary"
                            disabled={isSaving}
                            onClick={async () => {
                                const action = leaveAction;
                                setLeaveAction(null);
                                if (await saveAll()) {
                                    resetAuxDirty();
                                    action?.run();
                                }
                            }}
                        >
                            {tm(MATERIAL_I18N_KEYS.leaveSave)}
                        </Button>
                    </div>
                )}
            >
                <p className="p-5 text-sm text-fg-muted">
                    {formatText(tm(MATERIAL_I18N_KEYS.leaveMessage), { name: title || selectedFixedLabel || tm(MATERIAL_I18N_KEYS.newName) })}
                </p>
            </Modal>

            {/* 別の名前で保存：保存する名前を入れる */}
            <Modal
                open={saveAsName !== null}
                onClose={() => setSaveAsName(null)}
                title={tm(MATERIAL_I18N_KEYS.saveAs)}
                size="sm"
                closeLabel={t(COMMON_I18N_KEYS.cancel)}
                footer={(
                    <div className="flex flex-wrap justify-end gap-2">
                        <Button variant="ghost" onClick={() => setSaveAsName(null)}>{t(COMMON_I18N_KEYS.cancel)}</Button>
                        <Button variant="primary" disabled={isSaving || !(saveAsName ?? '').trim()} onClick={submitSaveAs}>
                            <Save size={14} />
                            {tm(MATERIAL_I18N_KEYS.save)}
                        </Button>
                    </div>
                )}
            >
                <form className="p-5" onSubmit={e => { e.preventDefault(); submitSaveAs(); }}>
                    <TextField
                        autoFocus
                        value={saveAsName ?? ''}
                        onChange={e => setSaveAsName(e.target.value)}
                        placeholder={templateMode ? tm(MATERIAL_I18N_KEYS.templateBadge) : t(CONFIG_EDITOR_I18N_KEYS.titlePlaceholder)}
                        aria-label={tm(MATERIAL_I18N_KEYS.saveAs)}
                    />
                </form>
            </Modal>
        </div>
    );
};
