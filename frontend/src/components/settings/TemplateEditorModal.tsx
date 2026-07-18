import React, { useState, useEffect, useCallback } from 'react';
import { X, Save, Trash2, Plus, FilePlus, Star } from 'lucide-react';
import { ConfirmDialog } from '../ConfirmDialog';
import {
    getCategories,
    listTemplates,
    getTemplate,
    saveTemplate,
    deleteTemplate,
    checkTemplateExists,
    getDefaultTemplates,
    setDefaultTemplate,
} from '../../api/config-editor';
import type { CategoryDef } from '../../api/config-editor';
import { resolveMessage, type I18NCatalog } from '../../api/i18n';
import { COMMON_TEXT_FALLBACK_JA, CONFIG_EDITOR_I18N_KEYS, CONFIG_EDITOR_TEXT_FALLBACK_JA } from '../../constants/i18n';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    backendUrl: string;
    uiCatalog?: I18NCatalog | null;
}

type ConfirmKind =
    | { kind: 'newFile' }
    | { kind: 'overwrite'; proceed: () => void }
    | { kind: 'delete' };

export const TemplateEditorModal: React.FC<Props> = ({ isOpen, onClose, backendUrl, uiCatalog = null }) => {
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
    const [existingTemplates, setExistingTemplates] = useState<string[]>([]);
    const [defaultTemplates, setDefaultTemplates] = useState<Record<string, string>>({});

    const [title, setTitle] = useState('');
    const [selectedExistingTemplate, setSelectedExistingTemplate] = useState<string | null>(null);
    const [content, setContent] = useState('');
    const [isDirty, setIsDirty] = useState(false);

    const [confirm, setConfirm] = useState<ConfirmKind | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [isSettingDefault, setIsSettingDefault] = useState(false);
    const [toast, setToast] = useState('');

    const isTitleChanged = selectedExistingTemplate !== null && title !== selectedExistingTemplate;

    const saveMode: 'new' | 'overwrite' | 'both' =
        selectedExistingTemplate === null ? 'new'
        : isTitleChanged ? 'both'
        : 'overwrite';

    const currentDefault = defaultTemplates[selectedCategoryId] ?? '';
    const isCurrentDefault = !!selectedExistingTemplate && selectedExistingTemplate === currentDefault;

    // 初期データ取得
    useEffect(() => {
        if (!isOpen) return;
        getCategories(backendUrl).then(cats => {
            setCategories(cats);
            if (cats.length > 0 && !selectedCategoryId) {
                setSelectedCategoryId(cats[0].id);
            }
        }).catch(() => {});
        getDefaultTemplates(backendUrl).then(setDefaultTemplates).catch(() => {});
    }, [isOpen, backendUrl]);

    // 種別変更時
    useEffect(() => {
        if (!selectedCategoryId) return;
        setSelectedExistingTemplate(null);
        setTitle('');
        setContent('');
        setIsDirty(false);

        listTemplates(backendUrl, selectedCategoryId).then(setExistingTemplates).catch(() => {});
    }, [selectedCategoryId, backendUrl]);

    const showToast = (msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(''), 2500);
    };

    // 既存テンプレート選択
    const handleSelectExistingTemplate = async (name: string) => {
        if (!name) {
            setSelectedExistingTemplate(null);
            setTitle('');
            setContent('');
            return;
        }
        try {
            const c = await getTemplate(backendUrl, selectedCategoryId, name);
            setSelectedExistingTemplate(name);
            setTitle(name);
            setContent(c);
            setIsDirty(false);
        } catch { showToast(t(CONFIG_EDITOR_I18N_KEYS.templateLoadFailed)); }
    };

    // 新規作成
    const handleNewFile = () => {
        if (isDirty) { setConfirm({ kind: 'newFile' }); return; }
        doNewFile();
    };
    const doNewFile = () => {
        setSelectedExistingTemplate(null);
        setTitle('');
        setContent('');
        setIsDirty(false);
    };

    // 保存（共通）
    const doSave = useCallback(async (saveName: string) => {
        setIsSaving(true);
        try {
            await saveTemplate(backendUrl, selectedCategoryId, saveName, content);
            setSelectedExistingTemplate(saveName);
            setTitle(saveName);
            setIsDirty(false);
            const tmpl = await listTemplates(backendUrl, selectedCategoryId);
            setExistingTemplates(tmpl);
            showToast(t(CONFIG_EDITOR_I18N_KEYS.saved));
        } catch { showToast(t(CONFIG_EDITOR_I18N_KEYS.saveFailed)); }
        finally { setIsSaving(false); }
    }, [backendUrl, selectedCategoryId, content]);

    // 保存前の重複チェック
    const handleSave = async (saveName: string) => {
        if (!saveName.trim()) { showToast(t(CONFIG_EDITOR_I18N_KEYS.titleRequired)); return; }
        const isNew = saveName !== selectedExistingTemplate;
        if (isNew) {
            const exists = await checkTemplateExists(backendUrl, selectedCategoryId, saveName).catch(() => false);
            if (exists) {
                setConfirm({ kind: 'overwrite', proceed: () => doSave(saveName) });
                return;
            }
        }
        doSave(saveName);
    };

    // 削除
    const handleDelete = () => setConfirm({ kind: 'delete' });
    const doDelete = async () => {
        if (!selectedExistingTemplate) return;
        setIsDeleting(true);
        try {
            await deleteTemplate(backendUrl, selectedCategoryId, selectedExistingTemplate);
            const tmpl = await listTemplates(backendUrl, selectedCategoryId);
            setExistingTemplates(tmpl);
            // デフォルトが削除対象だったら解除
            if (currentDefault === selectedExistingTemplate) {
                const updated = await getDefaultTemplates(backendUrl);
                setDefaultTemplates(updated);
            }
            doNewFile();
            showToast(t(CONFIG_EDITOR_I18N_KEYS.deleted));
        } catch { showToast(t(CONFIG_EDITOR_I18N_KEYS.deleteFailed)); }
        finally { setIsDeleting(false); }
    };

    // デフォルト設定
    const handleSetDefault = async () => {
        if (!selectedExistingTemplate) return;
        setIsSettingDefault(true);
        try {
            await setDefaultTemplate(backendUrl, selectedCategoryId, selectedExistingTemplate);
            const updated = await getDefaultTemplates(backendUrl);
            setDefaultTemplates(updated);
            showToast(formatText(t(CONFIG_EDITOR_I18N_KEYS.defaultSetToast), { name: selectedExistingTemplate }));
        } catch { showToast(t(CONFIG_EDITOR_I18N_KEYS.defaultSetFailed)); }
        finally { setIsSettingDefault(false); }
    };

    // 確認ダイアログの応答
    const handleConfirmYes = () => {
        const c = confirm;
        setConfirm(null);
        if (!c) return;
        if (c.kind === 'newFile') doNewFile();
        else if (c.kind === 'overwrite') c.proceed();
        else if (c.kind === 'delete') doDelete();
    };

    if (!isOpen) return null;

    const confirmMeta = confirm ? {
        newFile:   { title: t(CONFIG_EDITOR_I18N_KEYS.confirmNewTitle), message: t(CONFIG_EDITOR_I18N_KEYS.confirmNewMessage) },
        overwrite: { title: t(CONFIG_EDITOR_I18N_KEYS.confirmOverwriteTitle), message: formatText(t(CONFIG_EDITOR_I18N_KEYS.confirmOverwriteMessage), { name: title }) },
        delete:    { title: t(CONFIG_EDITOR_I18N_KEYS.confirmDeleteTitle), message: formatText(t(CONFIG_EDITOR_I18N_KEYS.confirmDeleteTemplateMessage), { name: selectedExistingTemplate || '' }) },
    }[confirm.kind] : null;

    return (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-5xl h-[90vh] border border-purple-600 flex flex-col overflow-hidden">

                {/* ヘッダー */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-purple-800 bg-purple-950 shrink-0">
                    <h2 className="text-base font-semibold text-purple-200">{t(CONFIG_EDITOR_I18N_KEYS.templateTitle)}</h2>
                    <button onClick={onClose} className="text-purple-400 hover:text-purple-200 transition-colors">
                        <X size={18} />
                    </button>
                </div>

                {/* ボディ */}
                <div className="flex flex-1 overflow-hidden">
                    {/* 左パネル */}
                    <div className="flex flex-col flex-1 overflow-hidden border-r border-gray-700">
                        {/* タイトル入力 */}
                        <div className="px-4 py-3 border-b border-gray-700 shrink-0">
                            <input
                                type="text"
                                value={title}
                                onChange={e => { setTitle(e.target.value); setIsDirty(true); }}
                                placeholder={t(CONFIG_EDITOR_I18N_KEYS.templateNamePlaceholder)}
                                className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-gray-500"
                            />
                        </div>

                        {/* 本文エリア */}
                        <div className="flex-1 overflow-y-auto px-4 py-3">
                            <textarea
                                value={content}
                                onChange={e => { setContent(e.target.value); setIsDirty(true); }}
                                className="w-full h-full bg-transparent border-none text-sm text-gray-200 focus:outline-none resize-none font-mono"
                                placeholder={t(CONFIG_EDITOR_I18N_KEYS.templateContentPlaceholder)}
                            />
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
                            </select>
                        </div>

                        <hr className="border-gray-700" />

                        {/* 既存テンプレートを開く */}
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">{t(CONFIG_EDITOR_I18N_KEYS.openExistingTemplate)}</label>
                            <select
                                value={selectedExistingTemplate ?? ''}
                                onChange={e => handleSelectExistingTemplate(e.target.value)}
                                className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-gray-500"
                            >
                                <option value="">{t(CONFIG_EDITOR_I18N_KEYS.selectTemplate)}</option>
                                {existingTemplates.map(t => (
                                    <option key={t} value={t}>
                                        {t}{t === currentDefault ? ' ★' : ''}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* デフォルト設定 */}
                        <div>
                            <button
                                onClick={handleSetDefault}
                                disabled={!selectedExistingTemplate || isSettingDefault || isCurrentDefault}
                                className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-yellow-400 border border-yellow-700 rounded hover:bg-yellow-900/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                <Star size={14} />
                                {isCurrentDefault ? t(CONFIG_EDITOR_I18N_KEYS.defaultSet) : t(CONFIG_EDITOR_I18N_KEYS.setDefault)}
                            </button>
                            {currentDefault && (
                                <p className="text-xs text-gray-500 mt-1">
                                    {formatText(t(CONFIG_EDITOR_I18N_KEYS.currentDefault), { name: currentDefault })}
                                </p>
                            )}
                        </div>

                        {/* 削除 */}
                        <button
                            onClick={handleDelete}
                            disabled={!selectedExistingTemplate || isDeleting}
                            className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-red-400 border border-red-700 rounded hover:bg-red-900/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            <Trash2 size={14} />
                            {t(CONFIG_EDITOR_I18N_KEYS.deleteSelectedTemplate)}
                        </button>

                        <hr className="border-gray-700" />

                        {/* 新規作成 */}
                        <button
                            onClick={handleNewFile}
                            className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-gray-300 border border-gray-600 rounded hover:bg-gray-700 transition-colors"
                        >
                            <Plus size={14} />
                            {t(CONFIG_EDITOR_I18N_KEYS.newFile)}
                        </button>

                        <hr className="border-gray-700" />

                        {/* 保存ボタン群 */}
                        <div className="flex flex-col gap-2">
                            <button
                                onClick={() => handleSave(saveMode === 'both' ? selectedExistingTemplate! : title)}
                                disabled={isSaving}
                                className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-white bg-blue-700 rounded hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <Save size={14} />
                                {saveMode === 'new' ? t(CONFIG_EDITOR_I18N_KEYS.newSave) : t(CONFIG_EDITOR_I18N_KEYS.overwriteSave)}
                            </button>

                            {saveMode === 'both' && (
                                <button
                                    onClick={() => handleSave(title)}
                                    disabled={isSaving}
                                    className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-gray-200 bg-gray-700 rounded hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <FilePlus size={14} />
                                    {t(CONFIG_EDITOR_I18N_KEYS.saveAsDifferentFile)}
                                </button>
                            )}

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
        </div>
    );
};
