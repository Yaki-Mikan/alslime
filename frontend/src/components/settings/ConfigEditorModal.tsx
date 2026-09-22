import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X, Save, Trash2, Plus, FilePlus, BookTemplate, FileDown, Search, RotateCcw } from 'lucide-react';
import { SearchPickerModal } from '../common/SearchPickerModal';
import { CodeEditor } from '../common/CodeEditor';
import { TemplateEditorModal } from './TemplateEditorModal';
import { ToggleSwitch } from '../common/ToggleSwitch';
import { CollapsibleSectionHeader } from '../common/CollapsibleSectionHeader';
import { useIsWideScreen } from '../../hooks/useIsWideScreen';
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
import { ConfirmDialog } from '../ConfirmDialog';
import { SimpleCharacterForm, EMPTY_SIMPLE_CHARACTER, simpleCharacterToMarkdown } from './SimpleCharacterForm';
import { CharacterAuxPanel } from './character/CharacterAuxPanel';
import { CharacterTagsEditor } from './character/CharacterTagsEditor';
import type { AppearancePromptHandle } from '../../hooks/useAppearancePromptGen';
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
import { resolveMessage, type I18NCatalog } from '../../api/i18n';
import {
    API_PROVIDERS_I18N_KEYS,
    API_PROVIDERS_TEXT_FALLBACK_JA,
    COMMON_TEXT_FALLBACK_JA,
    CONFIG_EDITOR_I18N_KEYS,
    CONFIG_EDITOR_TEXT_FALLBACK_JA,
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
    isOpen: boolean;
    onClose: () => void;
    backendUrl: string;
    uiCatalog?: I18NCatalog | null;
    // タブ統合（設計 §9）: 画像生成統合設定とのタブ切り替え UI をヘッダーへ差し込む。
    // 未指定なら従来どおり単独モーダルとして表示する。
    headerTabs?: React.ReactNode;
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
}

type ConfirmKind =
    | { kind: 'newFile' }
    | { kind: 'toStandard' }
    | { kind: 'overwrite'; proceed: () => void }
    | { kind: 'delete' };

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

// キャラクター種別（広画面）の列幅。
// 広いうちは中央（付随設定）が基準幅 CHARACTER_AUX_MAX_WIDTH のまま、左（本体エディタ）だけが
// ウィンドウ幅に追従する（左だけ flex-grow）。左が基準幅 CHARACTER_EDITOR_BASE_WIDTH を割り込む
// 幅からは、縮み分を左 3：中 7 の比で分け合う。flex-shrink は「係数 × 基準幅」に比例して配分され、
// かつ係数の合計が 1 未満だとはみ出し分の一部しか縮めないため、係数は「左 3 × 中央基準幅」
// 「中 7 × 左基準幅」として渡す（配分は 3：7 のまま、合計は 1 を大きく超える）。中央は CHARACTER_AUX_MIN_WIDTH で止まり、
// それより狭い画面は縦積み（狭画面レイアウト）に切り替わる。
// 左の基準幅は中央の上限より大きくし、縮み始めの時点から常に左が中央より広い状態にする。
const CHARACTER_EDITOR_BASE_WIDTH = 800;
const CHARACTER_EDITOR_SHRINK = 3;
const CHARACTER_AUX_SHRINK = 7;
const CHARACTER_AUX_MAX_WIDTH = 720;
const CHARACTER_AUX_MIN_WIDTH = 360;

const apiPresetInstructionID = (preset: string, locale: ApiProviderInstructionLocale) => (
    `openai-compat-${preset}-${locale}`
);

export const ConfigEditorModal: React.FC<Props> = ({
    isOpen,
    onClose,
    backendUrl,
    uiCatalog = null,
    headerTabs,
    openFileRequest = null,
    onOpenFileRequestConsumed,
    openApiProviderInstruction = null,
    onOpenApiProviderInstructionConsumed,
    comfyDirectiveVisible = false,
    imageGenEnabled = false,
    ttsEnabled = false,
    appearancePrompt,
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
    const [selectedTemplate, setSelectedTemplate] = useState('');
    const [content, setContent] = useState('');
    const [simpleConfig, setSimpleConfig] = useState<SimpleCharacterConfig>({ ...EMPTY_SIMPLE_CHARACTER });
    const [isSimpleMode, setIsSimpleMode] = useState(false);
    const [isDirty, setIsDirty] = useState(false);

    const [isTemplateEditorOpen, setIsTemplateEditorOpen] = useState(false);

    const [confirm, setConfirm] = useState<ConfirmKind | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
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

    // 既存ファイルの検索選択モーダル
    const [isFilePickerOpen, setIsFilePickerOpen] = useState(false);

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
        if (!openFileRequest) return;
        if (selectedCategoryId !== openFileRequest.categoryId) {
            setSelectedCategoryId(openFileRequest.categoryId);
            return;
        }
        // 画像生成分析指示（固定ファイル種別）は fileName に directive ID が入る。
        // 通常ファイルの getConfigFile 経路とは別に、専用の選択処理で本文を読み込む。
        if (openFileRequest.categoryId === COMFY_DIRECTIVE_CATEGORY_ID) {
            void handleSelectComfyDirective(openFileRequest.fileName);
            onOpenFileRequestConsumed?.();
            return;
        }
        // 設定自動生成指示（固定ファイル種別）も fileName に instruction ID が入る。
        // 一覧取得（対象プルダウンの初期化）と並行して本文を読み、対象は ID から確定する。
        if (openFileRequest.categoryId === CONFIG_GEN_INSTRUCTION_CATEGORY_ID) {
            void handleSelectConfigGenInstruction(openFileRequest.fileName);
            onOpenFileRequestConsumed?.();
            return;
        }
        (async () => {
            // 先行しているカテゴリ初期化を無効化し、その完了結果による本文上書きを防ぐ。
            const loadVersion = ++contentLoadVersion.current;
            const entry: ConfigFileEntry = {
                dirName: openFileRequest.dirName,
                name: openFileRequest.fileName,
            };
            // 開き元の編集中本文（設定自動生成タブの左エディタ）。指定があれば優先表示する。
            const carried = openFileRequest.content;
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
                onOpenFileRequestConsumed?.();
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
                onOpenFileRequestConsumed?.();
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
    }, [openFileRequest, selectedCategoryId]);

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
            await loadConfigGenTemplates(selectedConfigGenTarget, configGenTemplateKind, name);
            showToast(t(CONFIG_EDITOR_I18N_KEYS.saved));
        } catch { showToast(t(CONFIG_EDITOR_I18N_KEYS.saveFailed)); }
        finally { setIsSaving(false); }
    };

    const handleSetDefaultConfigGenTemplate = async () => {
        if (!configGenTemplateKind || !selectedConfigGenTemplateName) return;
        try {
            await setConfigGenTemplateDefault(backendUrl, selectedConfigGenTarget, configGenLocale, configGenTemplateKind, selectedConfigGenTemplateName);
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

    // 新規作成
    const handleNewFile = () => {
        if (isDirty) { setConfirm({ kind: 'newFile' }); return; }
        doNewFile();
    };
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
    const handleToStandardMode = () => {
        setConfirm({ kind: 'toStandard' });
    };
    const doToStandardMode = () => {
        const md = simpleCharacterToMarkdown(simpleConfig, title, uiCatalog);
        setContent(md);
        setIsSimpleMode(false);
        setSimpleConfig({ ...EMPTY_SIMPLE_CHARACTER });
    };

    type SaveTarget =
        | { kind: 'overwrite'; entry: ConfigFileEntry }
        | { kind: 'new'; name: string };

    // 保存（共通）
    const doSave = useCallback(async (target: SaveTarget) => {
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
        } catch { showToast(t(CONFIG_EDITOR_I18N_KEYS.saveFailed)); }
        finally { setIsSaving(false); }
    }, [backendUrl, selectedCategoryId, content, isSimpleMode, simpleConfig, uiCatalog]);

    // 保存��の重複チェック
    const handleSave = async (target: SaveTarget) => {
        const saveName = target.kind === 'new' ? target.name : target.entry.name;
        if (!saveName.trim()) { showToast(t(CONFIG_EDITOR_I18N_KEYS.titleRequired)); return; }
        if (target.kind === 'new') {
            const exists = await checkConfigFileExists(backendUrl, selectedCategoryId, target.name, target.name).catch(() => false);
            if (exists) {
                setConfirm({ kind: 'overwrite', proceed: () => doSave(target) });
                return;
            }
        }
        doSave(target);
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
    };

    // 画面幅（狭画面では本文と設定パネルを縦積みにする）
    const isWideScreen = useIsWideScreen();
    const [editorOpen, setEditorOpen] = useState(true);
    const [panelOpen, setPanelOpen] = useState(true);
    // キャラクター付随設定（中央エリア）。狭画面では既定で畳む
    const [auxOpen, setAuxOpen] = useState(false);
    const showEditor = isWideScreen || editorOpen;
    const showPanel = isWideScreen || panelOpen;
    const showAux = isWideScreen || auxOpen;
    // キャラクター種別のときだけ 3 カラム（左：本体、中：付随設定、右：選択欄＋タグ設定）
    const isCharacter = isCharacterCategory();
    // 中央エリアと右下タグ設定の保存先。本体 .md を保存していない新規キャラクターでは無い
    const characterDirName = isCharacter ? (selectedExistingFile?.dirName ?? null) : null;

    if (!isOpen) return null;

    const confirmMeta = confirm ? {
        newFile:   { title: t(CONFIG_EDITOR_I18N_KEYS.confirmNewTitle),      message: t(CONFIG_EDITOR_I18N_KEYS.confirmNewMessage) },
        toStandard:{ title: t(CONFIG_EDITOR_I18N_KEYS.confirmStandardTitle), message: t(CONFIG_EDITOR_I18N_KEYS.confirmStandardMessage) },
        overwrite: { title: t(CONFIG_EDITOR_I18N_KEYS.confirmOverwriteTitle), message: formatText(t(CONFIG_EDITOR_I18N_KEYS.confirmOverwriteMessage), { name: title }) },
        delete:    { title: t(CONFIG_EDITOR_I18N_KEYS.confirmDeleteTitle),    message: formatText(t(CONFIG_EDITOR_I18N_KEYS.confirmDeleteFileMessage), { name: selectedExistingFile?.name || '' }) },
    }[confirm.kind] : null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            {/* 幅は Hub 内の画像生成統合設定・TTS 統合設定と揃える（タブ切替で外形が動かないよう種別に依らず固定） */}
            <div className="bg-gray-900 rounded-xl shadow-2xl border border-green-700 flex flex-col overflow-hidden" style={{ width: '90vw', height: '90vh' }}>

                {/* ヘッダー */}
                <div className={`flex justify-between gap-3 px-5 py-3 border-b border-green-800 bg-green-950 shrink-0 ${isWideScreen ? 'items-center' : 'items-start'}`}>
                    <div className={isWideScreen ? 'flex items-center gap-4' : 'flex flex-col gap-2 flex-1 min-w-0'}>
                        <h2 className="text-base font-semibold text-green-200">{t(CONFIG_EDITOR_I18N_KEYS.configTitle)}</h2>
                        {headerTabs}
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setIsTemplateEditorOpen(true)}
                            className="flex items-center gap-1.5 text-xs text-green-300 hover:text-purple-300 border border-green-700 hover:border-purple-500 rounded px-2 py-1 transition-colors"
                            title={t(CONFIG_EDITOR_I18N_KEYS.manageTemplate)}
                        >
                            <BookTemplate size={14} />
                            {isWideScreen && t(CONFIG_EDITOR_I18N_KEYS.manageTemplate)}
                        </button>
                        <button onClick={onClose} className="text-green-400 hover:text-green-200 transition-colors">
                            <X size={18} />
                        </button>
                    </div>
                </div>

                {/* ボディ */}
                <div className={isWideScreen ? 'flex flex-1 overflow-hidden' : 'flex flex-col flex-1 overflow-y-auto'}>
                    {/* 左パネル */}
                    {/* キャラクター種別では左 3：中 7 で分け合い、中央が上限幅に達した後は左だけが伸縮する */}
                    <div
                        className={isWideScreen ? `flex flex-col min-w-0 overflow-hidden border-r border-gray-700 ${isCharacter ? '' : 'flex-1'}` : `flex flex-col shrink-0 border-b border-gray-700 ${editorOpen ? 'h-[60vh]' : ''}`}
                        style={isWideScreen && isCharacter ? { flex: `1 ${CHARACTER_EDITOR_SHRINK * CHARACTER_AUX_MAX_WIDTH} ${CHARACTER_EDITOR_BASE_WIDTH}px` } : undefined}
                    >
                        {!isWideScreen && <CollapsibleSectionHeader label={t(CONFIG_EDITOR_I18N_KEYS.sectionEditor)} open={editorOpen} onToggle={() => setEditorOpen(v => !v)} />}
                        {showEditor && (<>
                        {/* タイトル入力（AIプロバイダ指示・画像生成分析指示は固定名表示・編集不可） */}
                        <div className="px-4 py-3 border-b border-gray-700 shrink-0">
                            <input
                                type="text"
                                value={isProviderCategory
                                    ? (providerFiles.find(p => p.id === selectedProviderId)?.file ?? '')
                                    : isComfyDirectiveCategory
                                        ? (comfyDirectiveFiles.find(d => d.id === selectedComfyDirectiveId)?.file ?? '')
                                        : isConfigGenInstructionCategory
                                            ? (configGenInstructionFiles.find(d => d.id === selectedConfigGenInstructionId)?.file ?? '')
                                            : title}
                                onChange={e => { setTitle(e.target.value); setIsDirty(true); }}
                                placeholder={t(CONFIG_EDITOR_I18N_KEYS.titlePlaceholder)}
                                disabled={isFixedFileCategory}
                                className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-gray-500 disabled:opacity-60"
                            />
                        </div>

                        {/* 本文エリア */}
                        <div className="flex-1 overflow-y-auto px-4 py-3">
                            {isSimpleMode && isCharacterCategory() ? (
                                <SimpleCharacterForm
                                    value={simpleConfig}
                                    onChange={v => { setSimpleConfig(v); setIsDirty(true); }}
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
                        </>)}
                    </div>

                    {/* 中央パネル（キャラクター種別のみ）：表情画像／画像生成設定／音声紐づけ／設定紐づけ */}
                    {isCharacter && (
                        <div
                            className={isWideScreen ? 'flex flex-col min-w-0 overflow-hidden border-r border-gray-700' : `flex flex-col shrink-0 border-b border-gray-700 ${auxOpen ? 'h-[60vh]' : ''}`}
                            style={isWideScreen ? { flex: `0 ${CHARACTER_AUX_SHRINK * CHARACTER_EDITOR_BASE_WIDTH} ${CHARACTER_AUX_MAX_WIDTH}px`, maxWidth: CHARACTER_AUX_MAX_WIDTH, minWidth: CHARACTER_AUX_MIN_WIDTH } : undefined}
                        >
                            {!isWideScreen && <CollapsibleSectionHeader label={t(CONFIG_EDITOR_I18N_KEYS.characterSectionAux)} open={auxOpen} onToggle={() => setAuxOpen(v => !v)} />}
                            {showAux && (
                                <CharacterAuxPanel
                                    backendUrl={backendUrl}
                                    dirName={characterDirName}
                                    fileName={characterDirName ? (selectedExistingFile?.name ?? null) : null}
                                    imageGenEnabled={imageGenEnabled}
                                    ttsEnabled={ttsEnabled}
                                    uiCatalog={uiCatalog}
                                    appearancePrompt={appearancePrompt}
                                />
                            )}
                        </div>
                    )}

                    {/* 右パネル */}
                    <div className={isWideScreen ? 'w-64 shrink-0 flex flex-col overflow-y-auto' : 'flex flex-col shrink-0'}>
                        {!isWideScreen && <CollapsibleSectionHeader label={t(CONFIG_EDITOR_I18N_KEYS.sectionSettings)} open={panelOpen} onToggle={() => setPanelOpen(v => !v)} />}
                        {showPanel && (<div className="flex flex-col gap-4 px-4 py-4">
                        {/* 種別 */}
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">{t(CONFIG_EDITOR_I18N_KEYS.category)}</label>
                            <select
                                value={selectedCategoryId}
                                onChange={e => setSelectedCategoryId(e.target.value)}
                                className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-gray-500"
                            >
                                {categories.map(c => (
                                    <option key={c.id} value={c.id}>{resolveMessage(uiCatalog, `configEditor.category.${c.id}`, c.label)}</option>
                                ))}
                                <option value={PROVIDER_CATEGORY_ID}>{t(CONFIG_EDITOR_I18N_KEYS.providerCategory)}</option>
                                <option value={CONFIG_GEN_INSTRUCTION_CATEGORY_ID}>{t(CONFIG_EDITOR_I18N_KEYS.configGenInstructionCategory)}</option>
                                {comfyDirectiveVisible && (
                                    <option value={COMFY_DIRECTIVE_CATEGORY_ID}>{t(CONFIG_EDITOR_I18N_KEYS.comfyDirectiveCategory)}</option>
                                )}
                            </select>
                        </div>

                        {isProviderCategory ? (
                            <>
                                {/* AIプロバイダ指示ファイル（編集のみ。テンプレート・新規・削除なし） */}
                                <div>
                                    <label className="block text-xs text-gray-400 mb-1">{t(CONFIG_EDITOR_I18N_KEYS.providerCategory)}</label>
                                    <select
                                        value={selectedProviderId}
                                        onChange={e => handleSelectProvider(e.target.value)}
                                        className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-gray-500"
                                    >
                                        <option value="">{t(CONFIG_EDITOR_I18N_KEYS.providerSelect)}</option>
                                        {providerFiles.map(p => (
                                            <option key={p.id} value={p.id}>{resolveMessage(uiCatalog, `configEditor.providerInstruction.${p.id}`, p.label)}</option>
                                        ))}
                                    </select>
                                    <p className="text-xs text-gray-500 mt-2">
                                        {t(CONFIG_EDITOR_I18N_KEYS.providerDescription)}
                                    </p>
                                </div>

                                <hr className="border-gray-700" />
                            </>
                        ) : isComfyDirectiveCategory ? (
                            <>
                                {/* 画像生成分析指示（4ファイルのプルダウン選択のみ。テンプレート・新規・削除・D&Dなし） */}
                                <div>
                                    <label className="block text-xs text-gray-400 mb-1">{t(CONFIG_EDITOR_I18N_KEYS.comfyDirectiveCategory)}</label>
                                    <select
                                        value={selectedComfyDirectiveId}
                                        onChange={e => handleSelectComfyDirective(e.target.value)}
                                        className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-gray-500"
                                    >
                                        <option value="">{t(CONFIG_EDITOR_I18N_KEYS.comfyDirectiveSelect)}</option>
                                        {comfyDirectiveFiles.map(d => (
                                            <option key={d.id} value={d.id}>{resolveMessage(uiCatalog, `configEditor.comfyDirective.file.${d.id}`, d.label)}</option>
                                        ))}
                                    </select>
                                    <p className="text-xs text-gray-500 mt-2">
                                        {t(CONFIG_EDITOR_I18N_KEYS.comfyDirectiveDescription)}
                                    </p>
                                </div>

                                <hr className="border-gray-700" />
                            </>
                        ) : isConfigGenInstructionCategory ? (
                            <>
                                {/* 設定自動生成指示（対象 → 指示ファイルの2段プルダウンのみ。テンプレート・新規・削除・D&Dなし） */}
                                <div>
                                    <label className="block text-xs text-gray-400 mb-1">{t(CONFIG_EDITOR_I18N_KEYS.configGenInstructionTarget)}</label>
                                    <select
                                        value={selectedConfigGenTarget}
                                        onChange={e => {
                                            const target = e.target.value;
                                            setSelectedConfigGenTarget(target);
                                            if (configGenTemplateKind) { void loadConfigGenTemplates(target, configGenTemplateKind); }
                                            else { void handleSelectConfigGenInstruction(''); }
                                        }}
                                        className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-gray-500"
                                    >
                                        {Array.from(new Set(visibleConfigGenInstructionFiles.map(f => f.target))).map(target => (
                                            <option key={target} value={target}>
                                                {resolveMessage(uiCatalog, `configEditor.category.${target}`, categories.find(c => c.id === target)?.label ?? target)}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs text-gray-400 mb-1">{t(CONFIG_EDITOR_I18N_KEYS.configGenInstructionCategory)}</label>
                                    <select
                                        value={selectedConfigGenInstructionId}
                                        onChange={e => handleSelectConfigGenInstruction(e.target.value)}
                                        className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-gray-500"
                                    >
                                        <option value="">{t(CONFIG_EDITOR_I18N_KEYS.configGenInstructionSelect)}</option>
                                        <option value={`${CONFIG_GEN_TEMPLATE_ID_PREFIX}search`}>{t(CONFIG_EDITOR_I18N_KEYS.configGenTemplateSearch)}</option>
                                        <option value={`${CONFIG_GEN_TEMPLATE_ID_PREFIX}setting`}>{t(CONFIG_EDITOR_I18N_KEYS.configGenTemplateSetting)}</option>
                                        {visibleConfigGenInstructionFiles.filter(f => f.target === selectedConfigGenTarget).map(f => (
                                            // 作成指示（編集非推奨）はオレンジ字で警告する
                                            <option key={f.id} value={f.id} className={f.kind === 'instruction' ? 'text-orange-400' : undefined}>
                                                {configGenMethodLabel(f)}
                                            </option>
                                        ))}
                                    </select>
                                    {configGenTemplateKind ? (
                                        <div className="mt-3 flex flex-col gap-2">
                                            <label className="block text-xs text-gray-400">{t(CONFIG_EDITOR_I18N_KEYS.configGenTemplateName)}</label>
                                            <select
                                                value={selectedConfigGenTemplateName}
                                                onChange={e => handleSelectConfigGenTemplateName(selectedConfigGenTarget, configGenTemplateKind, e.target.value)}
                                                className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-gray-500"
                                            >
                                                <option value="">{t(CONFIG_EDITOR_I18N_KEYS.configGenTemplateSelect)}</option>
                                                {configGenTemplateNames.map(name => (
                                                    <option key={name} value={name}>
                                                        {name}{configGenTemplateDefaultName(configGenTemplateDefaults, selectedConfigGenTarget, configGenLocale, configGenTemplateKind) === name ? t(CONFIG_EDITOR_I18N_KEYS.configGenTemplateDefaultMark) : ''}
                                                    </option>
                                                ))}
                                            </select>
                                            {!selectedConfigGenTemplateName && (
                                                <input
                                                    type="text"
                                                    value={configGenTemplateNewName}
                                                    onChange={e => setConfigGenTemplateNewName(e.target.value)}
                                                    placeholder={t(CONFIG_EDITOR_I18N_KEYS.configGenTemplateNewName)}
                                                    className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-gray-500"
                                                />
                                            )}
                                            <div className="flex flex-wrap gap-2">
                                                <button
                                                    type="button"
                                                    onClick={handleNewConfigGenTemplate}
                                                    className="flex items-center gap-1 px-2 py-1 text-xs text-gray-200 bg-gray-700 rounded hover:bg-gray-600 transition-colors"
                                                >
                                                    <FilePlus size={12} />
                                                    {t(CONFIG_EDITOR_I18N_KEYS.configGenTemplateNew)}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={handleSetDefaultConfigGenTemplate}
                                                    disabled={!selectedConfigGenTemplateName}
                                                    className="px-2 py-1 text-xs text-gray-200 bg-gray-700 rounded hover:bg-gray-600 transition-colors disabled:opacity-40"
                                                >
                                                    {t(CONFIG_EDITOR_I18N_KEYS.configGenTemplateSetDefault)}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={handleDeleteConfigGenTemplate}
                                                    disabled={!selectedConfigGenTemplateName}
                                                    className="flex items-center gap-1 px-2 py-1 text-xs text-red-300 border border-red-700 rounded hover:bg-red-900/30 transition-colors disabled:opacity-40"
                                                >
                                                    <Trash2 size={12} />
                                                    {t(CONFIG_EDITOR_I18N_KEYS.configGenTemplateDelete)}
                                                </button>
                                            </div>
                                            <p className="text-xs text-gray-500">
                                                {t(CONFIG_EDITOR_I18N_KEYS.configGenTemplateDescription)}
                                            </p>
                                        </div>
                                    ) : (
                                        <p className="text-xs text-gray-500 mt-2">
                                            {t(CONFIG_EDITOR_I18N_KEYS.configGenInstructionDescription)}
                                        </p>
                                    )}
                                    {selectedConfigGenInstruction?.kind === 'instruction' && (
                                        <p className="text-xs text-orange-400 mt-2">
                                            {t(CONFIG_EDITOR_I18N_KEYS.configGenInstructionEditNotRecommended)}
                                        </p>
                                    )}
                                </div>

                                <hr className="border-gray-700" />
                            </>
                        ) : (
                            <>
                                {/* テンプレート */}
                                <div>
                                    <label className="block text-xs text-gray-400 mb-1">{t(CONFIG_EDITOR_I18N_KEYS.template)}</label>
                                    <select
                                        value={selectedTemplate}
                                        onChange={e => handleSelectTemplate(e.target.value)}
                                        className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-gray-500"
                                    >
                                        <option value="">{t(CONFIG_EDITOR_I18N_KEYS.selectTemplate)}</option>
                                        {templates.map(t => (
                                            <option key={t} value={t}>{t}</option>
                                        ))}
                                    </select>
                                </div>

                                <hr className="border-gray-700" />

                                {/* 既存ファイル（押下で検索・選択モーダルを開く。会話設定メニューと同調） */}
                                <div>
                                    <label className="block text-xs text-gray-400 mb-1">{t(CONFIG_EDITOR_I18N_KEYS.openExistingFile)}</label>
                                    <button
                                        onClick={() => setIsFilePickerOpen(true)}
                                        className="flex items-center gap-2 w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-200 hover:border-green-500 transition-colors text-left"
                                    >
                                        <Search size={14} className="text-green-400 shrink-0" />
                                        <span className="truncate flex-1">
                                            {selectedExistingFile ? selectedExistingFile.name : t(CONFIG_EDITOR_I18N_KEYS.selectFile)}
                                        </span>
                                    </button>
                                </div>

                                {/* 削除 */}
                                <button
                                    onClick={handleDelete}
                                    disabled={selectedExistingFile === null || isDeleting}
                                    className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-red-400 border border-red-700 rounded hover:bg-red-900/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    <Trash2 size={14} />
                                    {t(CONFIG_EDITOR_I18N_KEYS.deleteSelectedFile)}
                                </button>

                                {/* D&D 個別インポート（確認モーダルなし・同名は自動リネーム） */}
                                <div
                                    onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
                                    onDragLeave={() => setIsDragOver(false)}
                                    onDrop={e => {
                                        e.preventDefault();
                                        setIsDragOver(false);
                                        if (e.dataTransfer.files.length > 0) handleDropFiles(e.dataTransfer.files);
                                    }}
                                    className={`flex flex-col items-center justify-center gap-1 px-3 py-4 border-2 border-dashed rounded text-xs transition-colors ${isDragOver
                                        ? 'border-green-500 bg-green-900/20 text-green-300'
                                        : 'border-gray-600 text-gray-500'}`}
                                >
                                    <FileDown size={16} />
                                    {t(CONFIG_EDITOR_I18N_KEYS.dropZoneLabel)}
                                </div>

                                <hr className="border-gray-700" />
                            </>
                        )}

                        {/* 標準/簡単 トグル（キャラクターのみ） */}
                        {isCharacterCategory() && (
                            <div>
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-gray-400">{t(CONFIG_EDITOR_I18N_KEYS.simpleSettings)}</span>
                                    <ToggleSwitch
                                        checked={isSimpleMode}
                                        onChange={v => {
                                            if (v) { setIsSimpleMode(true); }
                                            else { handleToStandardMode(); }
                                        }}
                                        accent="pink"
                                        size="sm"
                                    />
                                </div>
                                <p className="text-xs text-gray-500 mt-1">
                                    {isSimpleMode ? t(CONFIG_EDITOR_I18N_KEYS.simpleMode) : t(CONFIG_EDITOR_I18N_KEYS.standardMode)}
                                </p>
                            </div>
                        )}

                        {/* 新規作成（固定ファイル種別では不可） */}
                        {!isFixedFileCategory && (
                            <>
                                <button
                                    onClick={handleNewFile}
                                    className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-gray-300 border border-gray-600 rounded hover:bg-gray-700 transition-colors"
                                >
                                    <Plus size={14} />
                                    {t(CONFIG_EDITOR_I18N_KEYS.newFile)}
                                </button>

                                <hr className="border-gray-700" />
                            </>
                        )}

                        {/* 保存ボタン群 */}
                        <div className="flex flex-col gap-2">
                            {/* 上書き保存 or 新規保存（AIプロバイダ指示は上書きのみ） */}
                            <button
                                onClick={() => {
                                    if (isProviderCategory) { handleSaveProvider(); return; }
                                    if (isComfyDirectiveCategory) { handleSaveComfyDirective(); return; }
                                    if (isConfigGenInstructionCategory) { if (configGenTemplateKind) handleSaveConfigGenTemplate(); else handleSaveConfigGenInstruction(); return; }
                                    handleSave(
                                        saveMode === 'new'
                                            ? { kind: 'new', name: title }
                                            : { kind: 'overwrite', entry: selectedExistingFile! }
                                    );
                                }}
                                disabled={isSaving || (isProviderCategory && !selectedProviderId) || (isComfyDirectiveCategory && !selectedComfyDirectiveId) || (isConfigGenInstructionCategory && !configGenTemplateKind && !selectedConfigGenInstructionId)}
                                className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-white bg-blue-700 rounded hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <Save size={14} />
                                {isFixedFileCategory || saveMode !== 'new'
                                    ? t(CONFIG_EDITOR_I18N_KEYS.overwriteSave)
                                    : t(CONFIG_EDITOR_I18N_KEYS.newSave)}
                            </button>

                            {/* デフォルトに戻す（画像生成分析指示のみ。同梱デフォルトで上書き） */}
                            {isComfyDirectiveCategory && (
                                <button
                                    onClick={handleResetComfyDirective}
                                    disabled={isSaving || !selectedComfyDirectiveId}
                                    className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-gray-200 bg-gray-700 rounded hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <RotateCcw size={14} />
                                    {t(CONFIG_EDITOR_I18N_KEYS.comfyDirectiveReset)}
                                </button>
                            )}

                            {/* デフォルトに戻す（設定自動生成指示。同梱デフォルトで上書き） */}
                            {isConfigGenInstructionCategory && !configGenTemplateKind && (
                                <button
                                    onClick={handleResetConfigGenInstruction}
                                    disabled={isSaving || !selectedConfigGenInstructionId}
                                    className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-gray-200 bg-gray-700 rounded hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <RotateCcw size={14} />
                                    {t(CONFIG_EDITOR_I18N_KEYS.comfyDirectiveReset)}
                                </button>
                            )}

                            {/* 別ファイルとして保存（タイトル変更時のみ） */}
                            {!isFixedFileCategory && saveMode === 'both' && (
                                <button
                                    onClick={() => handleSave({ kind: 'new', name: title })}
                                    disabled={isSaving}
                                    className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-gray-200 bg-gray-700 rounded hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <FilePlus size={14} />
                                    {t(CONFIG_EDITOR_I18N_KEYS.saveAsDifferentFile)}
                                </button>
                            )}

                            {/* キャンセル */}
                            <button
                                onClick={onClose}
                                className="w-full px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200 hover:bg-gray-800 rounded transition-colors"
                            >
                                {t(CONFIG_EDITOR_I18N_KEYS.close)}
                            </button>
                            {/* タグ設定（キャラクター種別のみ。作品・タグは tags.json へ保存しマスタを再構築） */}
                            {isCharacter && (
                                <CharacterTagsEditor
                                    backendUrl={backendUrl}
                                    dirName={characterDirName}
                                    uiCatalog={uiCatalog}
                                />
                            )}
                        </div>
                        </div>)}
                    </div>
                </div>

                {/* トースト */}
                {toast && (
                    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-gray-800 text-gray-200 text-sm px-4 py-2 rounded shadow-lg border border-gray-600 pointer-events-none">
                        {toast}
                    </div>
                )}
            </div>

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

            {/* 既存ファイルの検索選択モーダル */}
            <SearchPickerModal
                isOpen={isFilePickerOpen}
                onClose={() => setIsFilePickerOpen(false)}
                title={t(CONFIG_EDITOR_I18N_KEYS.filePickerTitle)}
                searchPlaceholder={t(CONFIG_EDITOR_I18N_KEYS.filePickerSearch)}
                emptyText={t(CONFIG_EDITOR_I18N_KEYS.filePickerEmpty)}
                items={existingFiles.map(f => ({ key: `${f.dirName}|||${f.name}`, label: f.name }))}
                onSelect={key => { setIsFilePickerOpen(false); handleSelectExistingFile(key); }}
            />

            {/* テンプレートエディタ */}
            <TemplateEditorModal
                isOpen={isTemplateEditorOpen}
                onClose={() => {
                    setIsTemplateEditorOpen(false);
                    // 閉じた後にテンプレート一覧を最新化
                    if (selectedCategoryId) {
                        listTemplates(backendUrl, selectedCategoryId).then(setTemplates).catch(() => {});
                    }
                }}
                backendUrl={backendUrl}
                uiCatalog={uiCatalog}
            />
        </div>
    );
};
