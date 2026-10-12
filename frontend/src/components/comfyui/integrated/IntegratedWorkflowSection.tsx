/**
 * IntegratedWorkflowSection.tsx - ワークフロー選択（表情画像の生成の窓で使う）
 *
 * テスト生成セクションから独立させたワークフロー（テンプレート）選択。
 * - 選択中ワークフローをデフォルトとして保存するボタン
 * - 選択中ワークフローのダウンロードボタン
 * - 選択中ワークフローの削除ボタン
 * - ワークフローJSONのインポート領域（開閉・デフォルト閉）
 */

import React, { useState, useRef, useCallback } from 'react';
import { Workflow, Save, Trash2, Upload, Download, AlertCircle, CheckCircle, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import {
    getComfyUIConfig,
    saveComfyUIConfig,
    addComfyUITemplate,
    deleteComfyUITemplate,
    downloadComfyUITemplate,
} from '../../../api/comfyui';
import type { TemplateInfo } from '../../../api/comfyui';
import { createComfyUIText, formatComfyText } from '../i18n';
import type { I18NCatalog } from '../../../api/i18n';
import { CollapsibleSection } from '../../settings/CollapsibleSection';
import { useIsWideScreen } from '../../../hooks/useIsWideScreen';

interface Props {
    backendUrl: string;
    templates: TemplateInfo[];
    selectedTemplate: string;
    onTemplateChange: (name: string) => void;
    // テンプレート追加・削除後に親側で一覧と選択状態を再取得する
    onTemplatesReload: () => Promise<void>;
    uiCatalog?: I18NCatalog | null;
    // 見出し文言の差し替え（未指定なら「テスト生成用ワークフロー」）。表情画像生成では「ワークフロー設定」
    title?: string;
    // 「デフォルト保存」の保存先を差し替える（未指定なら会話の画像の既定 defaultTemplateId へ保存）。
    // 表情画像生成は自分の設定へ保存するために使う
    onSaveDefault?: () => Promise<void>;
}

export const IntegratedWorkflowSection: React.FC<Props> = ({
    backendUrl,
    templates,
    selectedTemplate,
    onTemplateChange,
    onTemplatesReload,
    uiCatalog = null,
    title,
    onSaveDefault,
}) => {
    const { SECTION_NAMES, COMMON } = createComfyUIText(uiCatalog);
    const isWideScreen = useIsWideScreen();

    // セクション開閉（テスト生成の主要設定のためデフォルト開）
    const [isSectionOpen, setIsSectionOpen] = useState(true);

    // デフォルト保存
    const [isSavingDefault, setIsSavingDefault] = useState(false);
    const [saveMessage, setSaveMessage] = useState<string | null>(null);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [isDownloading, setIsDownloading] = useState(false);
    const [downloadError, setDownloadError] = useState<string | null>(null);

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
            if (onSaveDefault) {
                // 保存先の差し替え（表情画像生成など、会話の画像の既定とは別に持つ画面）
                await onSaveDefault();
            } else {
                const config = await getComfyUIConfig(backendUrl);
                await saveComfyUIConfig(backendUrl, { ...config, defaultTemplateId: selectedTemplate });
            }
            setSaveMessage(COMMON.MESSAGES.DEFAULT_TEMPLATE_SAVED);
            window.setTimeout(() => setSaveMessage(null), 3000);
        } catch (error) {
            console.error('[IntegratedWorkflowSection] default template save failed:', error);
            setSaveError(COMMON.MESSAGES.SAVE_FAILED);
        } finally {
            setIsSavingDefault(false);
        }
    }, [backendUrl, selectedTemplate, onSaveDefault, COMMON.MESSAGES.DEFAULT_TEMPLATE_SAVED, COMMON.MESSAGES.SAVE_FAILED]);

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

    // 選択中ワークフローをブラウザへダウンロード
    const handleDownload = useCallback(async () => {
        if (!selectedTemplate || isDownloading) return;
        setIsDownloading(true);
        setDownloadError(null);
        try {
            await downloadComfyUITemplate(backendUrl, selectedTemplate);
        } catch (error) {
            console.error('[IntegratedWorkflowSection] template download failed:', error);
            setDownloadError(COMMON.MESSAGES.DOWNLOAD_WORKFLOW_FAILED);
        } finally {
            setIsDownloading(false);
        }
    }, [backendUrl, selectedTemplate, isDownloading, COMMON.MESSAGES.DOWNLOAD_WORKFLOW_FAILED]);

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

    const selectedTemplateHasWorkflow = templates.some(
        template => template.name === selectedTemplate && template.hasWorkflow
    );

    return (
        <div className="border border-line-strong rounded-lg overflow-hidden bg-surface">
            {/* 他セクションと同じ開閉ヘッダー（デフォルト開） */}
            <button
                onClick={() => setIsSectionOpen(!isSectionOpen)}
                className="w-full flex items-center gap-2 px-4 py-3 bg-surface hover:bg-surface text-sm font-semibold text-fg transition-colors"
            >
                {isSectionOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                <Workflow size={16} className="text-accent" />
                {title || SECTION_NAMES.TEST_WORKFLOW_SELECT}
            </button>
            {isSectionOpen && (
            <div className="p-4 space-y-3">

            {/* ワークフロー選択 + 保存・削除 */}
            {templates.length > 0 ? (
                <div className={isWideScreen ? 'flex items-center gap-2' : 'flex flex-col gap-2'}>
                    <select
                        value={selectedTemplate}
                        onChange={e => onTemplateChange(e.target.value)}
                        className="flex-1 w-full min-w-0 bg-surface border border-accent rounded-lg px-3 py-2 text-sm text-fg focus:border-accent outline-none"
                    >
                        {templates.map(t => (
                            <option key={t.name} value={t.name}>{t.name}</option>
                        ))}
                    </select>
                    {/* 狭画面ではアイコン群をプルダウンの下の行に置く */}
                    <div className="flex items-center gap-2">
                    <button
                        onClick={handleSaveDefault}
                        disabled={!selectedTemplate || isSavingDefault}
                        className="p-2 text-fg-muted hover:text-ok transition-colors disabled:opacity-30"
                        title={COMMON.MESSAGES.SAVE_DEFAULT_TEMPLATE_TOOLTIP}
                    >
                        {isSavingDefault ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                    </button>
                    <button
                        onClick={handleDownload}
                        disabled={!selectedTemplateHasWorkflow || isDownloading}
                        className="p-2 text-fg-muted hover:text-accent transition-colors disabled:opacity-30"
                        title={COMMON.MESSAGES.DOWNLOAD_SELECTED_WORKFLOW_TOOLTIP}
                        aria-label={COMMON.MESSAGES.DOWNLOAD_SELECTED_WORKFLOW_TOOLTIP}
                    >
                        {isDownloading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                    </button>
                    <button
                        onClick={handleDelete}
                        disabled={!selectedTemplate}
                        className="p-2 text-fg-muted hover:text-danger transition-colors disabled:opacity-30"
                        title={COMMON.MESSAGES.DELETE_SELECTED_TEMPLATE_TOOLTIP}
                    >
                        <Trash2 size={16} />
                    </button>
                    </div>
                </div>
            ) : (
                <p className="text-xs text-fg-muted text-center py-2">
                    {COMMON.MESSAGES.NO_TEMPLATE}
                </p>
            )}
            <p className="text-xs text-fg-muted">
                {COMMON.MESSAGES.WORKFLOW_SELECT_DESC}
            </p>

            {/* デフォルト保存の結果表示 */}
            {saveMessage && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-ok/10 border border-line-strong text-ok">
                    <CheckCircle size={14} />
                    {saveMessage}
                </div>
            )}
            {saveError && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-danger/10 border border-danger/40 text-danger">
                    <AlertCircle size={14} />
                    {saveError}
                </div>
            )}
            {downloadError && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-danger/10 border border-danger/40 text-danger">
                    <AlertCircle size={14} />
                    {downloadError}
                </div>
            )}

            {/* インポート領域（開閉・デフォルト閉） */}
            <CollapsibleSection
                title={
                    <>
                        <Upload size={16} className="text-accent" />
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
                        ? 'border-accent bg-ok/10'
                        : 'border-line-strong hover:border-accent hover:bg-surface'
                        }`}
                >
                    {showNameInput ? (
                        // テンプレート名入力
                        <div className="space-y-3" onClick={(e) => e.stopPropagation()}>
                            <p className="text-sm text-fg-muted">{COMMON.MESSAGES.TEMPLATE_NAME_REQUIRED}</p>
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
                                className="w-full bg-surface border border-line-strong rounded px-3 py-2 text-sm text-fg outline-none focus:border-accent"
                                placeholder={COMMON.MESSAGES.TEMPLATE_NAME_PLACEHOLDER}
                            />
                            <div className="flex justify-center gap-2">
                                <button
                                    onClick={() => {
                                        setShowNameInput(false);
                                        setPendingWorkflow(null);
                                    }}
                                    className="px-4 py-1.5 text-xs text-fg-muted hover:text-fg transition-colors"
                                >
                                    {COMMON.BUTTONS.CANCEL}
                                </button>
                                <button
                                    onClick={handleConfirmUpload}
                                    disabled={isUploading || !newTemplateName.trim()}
                                    className="px-4 py-1.5 text-xs bg-accent hover:brightness-110 text-on-accent rounded transition-colors disabled:opacity-50 flex items-center gap-1"
                                >
                                    {isUploading && <Loader2 size={12} className="animate-spin" />}
                                    {COMMON.BUTTONS.ADD}
                                </button>
                            </div>
                        </div>
                    ) : (
                        // ドロップ領域
                        <div className="space-y-2">
                            <Upload size={24} className="mx-auto text-fg-muted" />
                            <p className="text-sm text-fg-muted">
                                {COMMON.MESSAGES.WORKFLOW_DROP_TEXT}<br />
                                {COMMON.MESSAGES.WORKFLOW_DROP_ACTION}
                            </p>
                            <p className="text-xs text-fg-muted">
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
                    <div className="flex items-start gap-2 px-3 py-2 rounded-lg text-sm bg-danger/10 border border-danger/40 text-danger">
                        <AlertCircle size={14} className="mt-0.5 shrink-0" />
                        <span>{uploadError}</span>
                    </div>
                )}
            </CollapsibleSection>
            </div>
            )}
        </div>
    );
};
