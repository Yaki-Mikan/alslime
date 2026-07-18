/**
 * IntegratedWorkflowSection.tsx - 統合設定画面用ワークフロー選択セクション
 *
 * テスト生成セクションから独立させたワークフロー（テンプレート）選択。
 * - 選択中ワークフローをデフォルトとして保存するボタン
 * - 選択中ワークフローの削除ボタン
 * - ワークフローJSONのインポート領域（開閉・デフォルト閉）
 */

import React, { useState, useRef, useCallback } from 'react';
import { Workflow, Save, Trash2, Upload, AlertCircle, CheckCircle, Loader2 } from 'lucide-react';
import {
    getComfyUIConfig,
    saveComfyUIConfig,
    addComfyUITemplate,
    deleteComfyUITemplate,
} from '../../../api/comfyui';
import type { TemplateInfo } from '../../../api/comfyui';
import { createComfyUIText, formatComfyText } from '../i18n';
import type { I18NCatalog } from '../../../api/i18n';
import { CollapsibleSection } from '../../settings/CollapsibleSection';

interface Props {
    backendUrl: string;
    templates: TemplateInfo[];
    selectedTemplate: string;
    onTemplateChange: (name: string) => void;
    // テンプレート追加・削除後に親側で一覧と選択状態を再取得する
    onTemplatesReload: () => Promise<void>;
    uiCatalog?: I18NCatalog | null;
}

export const IntegratedWorkflowSection: React.FC<Props> = ({
    backendUrl,
    templates,
    selectedTemplate,
    onTemplateChange,
    onTemplatesReload,
    uiCatalog = null,
}) => {
    const { SECTION_NAMES, COMMON } = createComfyUIText(uiCatalog);

    // デフォルト保存
    const [isSavingDefault, setIsSavingDefault] = useState(false);
    const [saveMessage, setSaveMessage] = useState<string | null>(null);
    const [saveError, setSaveError] = useState<string | null>(null);

    // インポート
    const [isDragOver, setIsDragOver] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [showNameInput, setShowNameInput] = useState(false);
    const [pendingWorkflow, setPendingWorkflow] = useState<unknown>(null);
    const [newTemplateName, setNewTemplateName] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    // 選択中ワークフローをデフォルトとして保存（config 全体を読み直して該当値だけ差し替えて PUT）
    const handleSaveDefault = useCallback(async () => {
        if (!selectedTemplate) return;
        setIsSavingDefault(true);
        setSaveMessage(null);
        setSaveError(null);
        try {
            const config = await getComfyUIConfig(backendUrl);
            await saveComfyUIConfig(backendUrl, { ...config, defaultTemplateId: selectedTemplate });
            setSaveMessage(COMMON.MESSAGES.DEFAULT_TEMPLATE_SAVED);
            window.setTimeout(() => setSaveMessage(null), 3000);
        } catch (error) {
            console.error('[IntegratedWorkflowSection] default template save failed:', error);
            setSaveError(COMMON.MESSAGES.SAVE_FAILED);
        } finally {
            setIsSavingDefault(false);
        }
    }, [backendUrl, selectedTemplate, COMMON.MESSAGES.DEFAULT_TEMPLATE_SAVED, COMMON.MESSAGES.SAVE_FAILED]);

    // 選択中ワークフローを削除
    const handleDelete = useCallback(async () => {
        if (!selectedTemplate) return;
        if (!confirm(formatComfyText(COMMON.MESSAGES.DELETE_TEMPLATE_CONFIRM, { name: selectedTemplate }))) return;
        try {
            await deleteComfyUITemplate(backendUrl, selectedTemplate);
            await onTemplatesReload();
        } catch (error) {
            console.error('[IntegratedWorkflowSection] template delete failed:', error);
        }
    }, [backendUrl, selectedTemplate, onTemplatesReload, COMMON.MESSAGES.DELETE_TEMPLATE_CONFIRM]);

    // ファイル処理（JSON読込 → 名前入力へ）
    const processFile = useCallback(async (file: File) => {
        if (!file.name.endsWith('.json')) {
            setUploadError(COMMON.MESSAGES.JSON_ONLY);
            return;
        }
        setUploadError(null);
        try {
            const text = await file.text();
            const json = JSON.parse(text);
            setPendingWorkflow(json);
            setNewTemplateName(file.name.replace('.json', ''));
            setShowNameInput(true);
        } catch {
            setUploadError(COMMON.MESSAGES.JSON_READ_FAILED);
        }
    }, [COMMON.MESSAGES.JSON_ONLY, COMMON.MESSAGES.JSON_READ_FAILED]);

    // テンプレート追加確定
    const handleConfirmUpload = useCallback(async () => {
        if (!pendingWorkflow || !newTemplateName.trim()) return;
        setIsUploading(true);
        setUploadError(null);
        try {
            const result = await addComfyUITemplate(backendUrl, newTemplateName.trim(), pendingWorkflow);
            if (!result.success) {
                setUploadError(result.error || COMMON.MESSAGES.ADD_FAILED);
            } else {
                setShowNameInput(false);
                setPendingWorkflow(null);
                setNewTemplateName('');
                await onTemplatesReload();
            }
        } catch (error) {
            const err = error as { response?: { data?: { error?: string } }; message?: string };
            const msg = err.response?.data?.error || err.message || COMMON.MESSAGES.ADD_FAILED;
            setUploadError(msg);
        } finally {
            setIsUploading(false);
        }
    }, [backendUrl, pendingWorkflow, newTemplateName, onTemplatesReload, COMMON.MESSAGES.ADD_FAILED]);

    // ドラッグ&ドロップ
    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(true);
    };
    const handleDragLeave = () => setIsDragOver(false);
    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(false);
        const file = e.dataTransfer.files[0];
        if (file) processFile(file);
    };

    // クリックでファイル選択
    const handleClickUpload = () => {
        if (showNameInput) return;
        fileInputRef.current?.click();
    };
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) processFile(file);
        // 同じファイルを連続で選べるようにリセット
        e.target.value = '';
    };

    return (
        <div className="border border-green-600/40 rounded-lg p-4 bg-gray-800/30 space-y-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-green-300">
                <Workflow size={16} className="text-green-400" />
                {SECTION_NAMES.WORKFLOW_SELECT}
            </h3>

            {/* ワークフロー選択 + 保存・削除 */}
            {templates.length > 0 ? (
                <div className="flex items-center gap-2">
                    <select
                        value={selectedTemplate}
                        onChange={e => onTemplateChange(e.target.value)}
                        className="flex-1 bg-gray-800 border border-green-600 rounded-lg px-3 py-2 text-sm text-gray-200 focus:border-green-400 outline-none"
                    >
                        {templates.map(t => (
                            <option key={t.name} value={t.name}>{t.name}</option>
                        ))}
                    </select>
                    <button
                        onClick={handleSaveDefault}
                        disabled={!selectedTemplate || isSavingDefault}
                        className="p-2 text-gray-500 hover:text-green-400 transition-colors disabled:opacity-30"
                        title={COMMON.MESSAGES.SAVE_DEFAULT_TEMPLATE_TOOLTIP}
                    >
                        {isSavingDefault ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                    </button>
                    <button
                        onClick={handleDelete}
                        disabled={!selectedTemplate}
                        className="p-2 text-gray-500 hover:text-red-400 transition-colors disabled:opacity-30"
                        title={COMMON.MESSAGES.DELETE_SELECTED_TEMPLATE_TOOLTIP}
                    >
                        <Trash2 size={16} />
                    </button>
                </div>
            ) : (
                <p className="text-xs text-gray-600 text-center py-2">
                    {COMMON.MESSAGES.NO_TEMPLATE}
                </p>
            )}
            <p className="text-xs text-gray-500">
                {COMMON.MESSAGES.WORKFLOW_SELECT_DESC}
            </p>

            {/* デフォルト保存の結果表示 */}
            {saveMessage && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-green-900/30 border border-green-700/50 text-green-300">
                    <CheckCircle size={14} />
                    {saveMessage}
                </div>
            )}
            {saveError && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-red-900/30 border border-red-700/50 text-red-300">
                    <AlertCircle size={14} />
                    {saveError}
                </div>
            )}

            {/* インポート領域（開閉・デフォルト閉） */}
            <CollapsibleSection
                title={
                    <>
                        <Upload size={16} className="text-green-400" />
                        {SECTION_NAMES.WORKFLOW_IMPORT}
                    </>
                }
            >
                {/* ドラッグ&ドロップ領域 */}
                <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={handleClickUpload}
                    className={`relative border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-all ${isDragOver
                        ? 'border-green-400 bg-green-900/20'
                        : 'border-gray-600 hover:border-green-500 hover:bg-gray-800/50'
                        }`}
                >
                    {showNameInput ? (
                        // テンプレート名入力
                        <div className="space-y-3" onClick={(e) => e.stopPropagation()}>
                            <p className="text-sm text-gray-300">{COMMON.MESSAGES.TEMPLATE_NAME_REQUIRED}</p>
                            <input
                                type="text"
                                value={newTemplateName}
                                onChange={(e) => setNewTemplateName(e.target.value)}
                                autoFocus
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                                        e.preventDefault();
                                        handleConfirmUpload();
                                    }
                                }}
                                className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-gray-200 outline-none focus:border-green-500"
                                placeholder={COMMON.MESSAGES.TEMPLATE_NAME_PLACEHOLDER}
                            />
                            <div className="flex justify-center gap-2">
                                <button
                                    onClick={() => {
                                        setShowNameInput(false);
                                        setPendingWorkflow(null);
                                    }}
                                    className="px-4 py-1.5 text-xs text-gray-400 hover:text-white transition-colors"
                                >
                                    {COMMON.BUTTONS.CANCEL}
                                </button>
                                <button
                                    onClick={handleConfirmUpload}
                                    disabled={isUploading || !newTemplateName.trim()}
                                    className="px-4 py-1.5 text-xs bg-green-600 hover:bg-green-500 text-white rounded transition-colors disabled:opacity-50 flex items-center gap-1"
                                >
                                    {isUploading && <Loader2 size={12} className="animate-spin" />}
                                    {COMMON.BUTTONS.ADD}
                                </button>
                            </div>
                        </div>
                    ) : (
                        // ドロップ領域
                        <div className="space-y-2">
                            <Upload size={24} className="mx-auto text-gray-500" />
                            <p className="text-sm text-gray-400">
                                {COMMON.MESSAGES.WORKFLOW_DROP_TEXT}<br />
                                {COMMON.MESSAGES.WORKFLOW_DROP_ACTION}
                            </p>
                            <p className="text-xs text-gray-600">
                                {COMMON.MESSAGES.WORKFLOW_DROP_HINT}
                            </p>
                        </div>
                    )}
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".json"
                        onChange={handleFileChange}
                        className="hidden"
                    />
                </div>

                {/* アップロードエラー */}
                {uploadError && (
                    <div className="flex items-start gap-2 px-3 py-2 rounded-lg text-sm bg-red-900/30 border border-red-700/50 text-red-300">
                        <AlertCircle size={14} className="mt-0.5 shrink-0" />
                        <span>{uploadError}</span>
                    </div>
                )}
            </CollapsibleSection>
        </div>
    );
};
