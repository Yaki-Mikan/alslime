import React, { useState, useEffect, useCallback } from 'react';
import { X, Save, Trash2, Plus, FilePlus, BookTemplate, FileDown } from 'lucide-react';
import { TemplateEditorModal } from './TemplateEditorModal';
import { ToggleSwitch } from '../common/ToggleSwitch';
import { ConfirmDialog } from '../ConfirmDialog';
import { SimpleCharacterForm, EMPTY_SIMPLE_CHARACTER, simpleCharacterToMarkdown } from './SimpleCharacterForm';
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
} from '../../api/config-editor';
import type { CategoryDef, ConfigFileEntry, ProviderInstruction } from '../../api/config-editor';
import { resolveMessage, type I18NCatalog } from '../../api/i18n';
import { COMMON_TEXT_FALLBACK_JA, CONFIG_EDITOR_I18N_KEYS, CONFIG_EDITOR_TEXT_FALLBACK_JA } from '../../constants/i18n';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    backendUrl: string;
    uiCatalog?: I18NCatalog | null;
    // タブ統合（設計 §9）: 画像生成統合設定とのタブ切り替え UI をヘッダーへ差し込む。
    // 未指定なら従来どおり単独モーダルとして表示する。
    headerTabs?: React.ReactNode;
}

type ConfirmKind =
    | { kind: 'newFile' }
    | { kind: 'toStandard' }
    | { kind: 'overwrite'; proceed: () => void }
    | { kind: 'delete' };

// AIプロバイダ指示ファイル種別の疑似カテゴリ ID（フロント内のみ。backend カテゴリとは別系統）。
const PROVIDER_CATEGORY_ID = '__provider__';

export const ConfigEditorModal: React.FC<Props> = ({ isOpen, onClose, backendUrl, uiCatalog = null, headerTabs }) => {
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

    // AIプロバイダ指示ファイル種別（固定ファイル・編集のみ）
    const [providerFiles, setProviderFiles] = useState<ProviderInstruction[]>([]);
    const [selectedProviderId, setSelectedProviderId] = useState('');

    // D&D 個別インポート
    const [isDragOver, setIsDragOver] = useState(false);

    const isProviderCategory = selectedCategoryId === PROVIDER_CATEGORY_ID;

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
            if (cats.length > 0 && !selectedCategoryId) {
                setSelectedCategoryId(cats[0].id);
            }
        }).catch(() => {});
    }, [isOpen, backendUrl]);

    // 種別変更時
    useEffect(() => {
        if (!selectedCategoryId) return;
        setSelectedExistingFile(null);
        setSelectedTemplate('');
        setSelectedProviderId('');
        setTitle('');
        setIsDirty(false);

        // AIプロバイダ指示種別: 固定ファイル一覧のみ取得（テンプレート・既存ファイル系は使わない）。
        if (selectedCategoryId === PROVIDER_CATEGORY_ID) {
            setExistingFiles([]);
            setTemplates([]);
            setContent('');
            setSimpleConfig({ ...EMPTY_SIMPLE_CHARACTER });
            setIsSimpleMode(false);
            listProviderInstructions(backendUrl).then(setProviderFiles).catch(() => {});
            return;
        }

        Promise.all([
            listConfigFiles(backendUrl, selectedCategoryId),
            listTemplates(backendUrl, selectedCategoryId),
            getInitialContent(backendUrl, selectedCategoryId),
        ]).then(([files, tmpl, initial]) => {
            setExistingFiles(files);
            setTemplates(tmpl);
            setContent(initial);
            setSimpleConfig({ ...EMPTY_SIMPLE_CHARACTER });
        }).catch(() => {});
    }, [selectedCategoryId, backendUrl]);

    const showToast = (msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(''), 2500);
    };

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
            const c = await getProviderInstruction(backendUrl, id);
            setContent(c);
            setIsDirty(false);
        } catch { showToast(t(CONFIG_EDITOR_I18N_KEYS.providerLoadFailed)); }
    };

    // AIプロバイダ指示ファイル保存（上書きのみ）
    const handleSaveProvider = async () => {
        if (!selectedProviderId) return;
        setIsSaving(true);
        try {
            await saveProviderInstruction(backendUrl, selectedProviderId, content);
            setIsDirty(false);
            // exists 表示の更新（初回保存後にファイルが生まれる）。
            listProviderInstructions(backendUrl).then(setProviderFiles).catch(() => {});
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

    if (!isOpen) return null;

    const confirmMeta = confirm ? {
        newFile:   { title: t(CONFIG_EDITOR_I18N_KEYS.confirmNewTitle),      message: t(CONFIG_EDITOR_I18N_KEYS.confirmNewMessage) },
        toStandard:{ title: t(CONFIG_EDITOR_I18N_KEYS.confirmStandardTitle), message: t(CONFIG_EDITOR_I18N_KEYS.confirmStandardMessage) },
        overwrite: { title: t(CONFIG_EDITOR_I18N_KEYS.confirmOverwriteTitle), message: formatText(t(CONFIG_EDITOR_I18N_KEYS.confirmOverwriteMessage), { name: title }) },
        delete:    { title: t(CONFIG_EDITOR_I18N_KEYS.confirmDeleteTitle),    message: formatText(t(CONFIG_EDITOR_I18N_KEYS.confirmDeleteFileMessage), { name: selectedExistingFile?.name || '' }) },
    }[confirm.kind] : null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-5xl h-[90vh] border border-green-700 flex flex-col overflow-hidden">

                {/* ヘッダー */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-green-800 bg-green-950 shrink-0">
                    <div className="flex items-center gap-4">
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
                            {t(CONFIG_EDITOR_I18N_KEYS.manageTemplate)}
                        </button>
                        <button onClick={onClose} className="text-green-400 hover:text-green-200 transition-colors">
                            <X size={18} />
                        </button>
                    </div>
                </div>

                {/* ボディ */}
                <div className="flex flex-1 overflow-hidden">
                    {/* 左パネル */}
                    <div className="flex flex-col flex-1 overflow-hidden border-r border-gray-700">
                        {/* タイトル入力（AIプロバイダ指示は固定名表示・編集不可） */}
                        <div className="px-4 py-3 border-b border-gray-700 shrink-0">
                            <input
                                type="text"
                                value={isProviderCategory
                                    ? (providerFiles.find(p => p.id === selectedProviderId)?.file ?? '')
                                    : title}
                                onChange={e => { setTitle(e.target.value); setIsDirty(true); }}
                                placeholder={t(CONFIG_EDITOR_I18N_KEYS.titlePlaceholder)}
                                disabled={isProviderCategory}
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
                                <textarea
                                    value={content}
                                    onChange={e => { setContent(e.target.value); setIsDirty(true); }}
                                    className="w-full h-full bg-transparent border-none text-sm text-gray-200 focus:outline-none resize-none font-mono"
                                    placeholder={t(CONFIG_EDITOR_I18N_KEYS.contentPlaceholder)}
                                />
                            )}
                        </div>
                    </div>

                    {/* 右パネル */}
                    <div className="w-64 shrink-0 flex flex-col gap-4 px-4 py-4 overflow-y-auto">
                        {/* 種別 */}
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">{t(CONFIG_EDITOR_I18N_KEYS.category)}</label>
                            <select
                                value={selectedCategoryId}
                                onChange={e => setSelectedCategoryId(e.target.value)}
                                className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-gray-500"
                            >
                                {categories.map(c => (
                                    <option key={c.id} value={c.id}>{c.label}</option>
                                ))}
                                <option value={PROVIDER_CATEGORY_ID}>{t(CONFIG_EDITOR_I18N_KEYS.providerCategory)}</option>
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
                                            <option key={p.id} value={p.id}>{p.label}</option>
                                        ))}
                                    </select>
                                    <p className="text-xs text-gray-500 mt-2">
                                        {t(CONFIG_EDITOR_I18N_KEYS.providerDescription)}
                                    </p>
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

                                {/* 既存ファイル */}
                                <div>
                                    <label className="block text-xs text-gray-400 mb-1">{t(CONFIG_EDITOR_I18N_KEYS.openExistingFile)}</label>
                                    <select
                                        value={selectedExistingFile ? `${selectedExistingFile.dirName}|||${selectedExistingFile.name}` : ''}
                                        onChange={e => handleSelectExistingFile(e.target.value)}
                                        className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-gray-500"
                                    >
                                        <option value="">{t(CONFIG_EDITOR_I18N_KEYS.selectFile)}</option>
                                        {existingFiles.map(f => (
                                            <option key={`${f.dirName}|||${f.name}`} value={`${f.dirName}|||${f.name}`}>{f.name}</option>
                                        ))}
                                    </select>
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

                        {/* 新規作成（AIプロバイダ指示では不可） */}
                        {!isProviderCategory && (
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
                                    handleSave(
                                        saveMode === 'new'
                                            ? { kind: 'new', name: title }
                                            : { kind: 'overwrite', entry: selectedExistingFile! }
                                    );
                                }}
                                disabled={isSaving || (isProviderCategory && !selectedProviderId)}
                                className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-white bg-blue-700 rounded hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <Save size={14} />
                                {isProviderCategory || saveMode !== 'new'
                                    ? t(CONFIG_EDITOR_I18N_KEYS.overwriteSave)
                                    : t(CONFIG_EDITOR_I18N_KEYS.newSave)}
                            </button>

                            {/* 別ファイルとして保存（タイトル変更時のみ） */}
                            {!isProviderCategory && saveMode === 'both' && (
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
                        </div>
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
