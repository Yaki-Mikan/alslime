/**
 * ComfyUISettingsModal.tsx - ComfyUI画像生成設定モーダル
 *
 * ComfyUIとの接続設定・ワークフローテンプレート管理を行う。
 * - 接続先URL入力 + テストボタン
 * - ワークフローJSONのドラッグ&ドロップ / クリック選択アップロード
 * - 保存済みテンプレート一覧（デフォルト選択・削除）
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from '../../lib/axios';
import { X, Wifi, WifiOff, Upload, Download, Trash2, CheckCircle, AlertCircle, Loader2, Users, FolderOpen, Tag, Palette, FileText, Save, Workflow } from 'lucide-react';
import { ToggleSwitch } from '../common/ToggleSwitch';
import { CollapsibleSection } from '../settings/CollapsibleSection';
import { BackgroundImageSettings } from '../settings/BackgroundImageSettings';
import type { Settings } from '../../types/Settings';
import { ComfyUICharacterSettingsModal } from './ComfyUICharacterSettingsModal';
import { ComfyUILoraDirModal } from './ComfyUILoraDirModal';
import { ComfyUITagMappingModal } from './ComfyUITagMappingModal';
import { ComfyUIGenerateTestModal } from './ComfyUIGenerateTestModal';
import { createComfyUIText, formatComfyText } from './i18n';
import { resolveMessage, type I18NCatalog } from '../../api/i18n';
import { CLAUDE_EFFORT_VALUES, normalizeClaudeEffort, type ClaudeEffort } from '../../constants/claude';
import {
    getComfyUIConfig,
    saveComfyUIConfig,
    testComfyUIConnection,
    listComfyUITemplates,
    addComfyUITemplate,
    deleteComfyUITemplate,
    downloadComfyUITemplate,
    testGenerateComfyUI,
} from '../../api/comfyui';
import type {
    AntigravityTagJudgeModel,
    ClaudeTagJudgeModel,
    ComfyUIConfig,
    ConnectionTestResult,
    DanbooruTagFormat,
    TriggerWordFormat,
    DirectiveMode,
    GeminiTagJudgeModel,
    LightweightImageFormat,
    TagJudgeProvider,
    TemplateInfo,
} from '../../api/comfyui';

interface ComfyUISettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    backendUrl: string;
    uiCatalog?: I18NCatalog | null;
    // セッション内背景画像設定（アプリ設定）。渡された場合のみセクションを表示し、
    // 保存ボタンで ComfyUI 設定と一緒に保存する（設定メニュー整理で基本チャット設定から移動）。
    appSettings?: Settings;
    onAppSettingsSave?: (settings: Settings) => Promise<void>;
    // 画像生成統合設定を開く（ConfigEditorHub のタブ付き表示への中継。
    // 呼ぶ前にこのモーダル自身は閉じる。未指定なら統合設定の導線は表示しない）。
    onOpenIntegrated?: () => void;
}

// モデルオプションはAPIから動的取得（下記 useEffect 参照）

export const ComfyUISettingsModal: React.FC<ComfyUISettingsModalProps> = ({
    isOpen,
    onClose,
    backendUrl,
    uiCatalog = null,
    appSettings,
    onAppSettingsSave,
    onOpenIntegrated,
}) => {
    const { COMMON, DIRECTIVE_MODE_OPTIONS, GENERATE_TEST, INTEGRATED, SECTION_NAMES } = createComfyUIText(uiCatalog);
    const claudeEffortLabels: Record<ClaudeEffort, string> = {
        '': COMMON.BUTTONS.CLAUDE_EFFORT_DEFAULT,
        low: COMMON.BUTTONS.CLAUDE_EFFORT_LOW,
        medium: COMMON.BUTTONS.CLAUDE_EFFORT_MEDIUM,
        high: COMMON.BUTTONS.CLAUDE_EFFORT_HIGH,
        xhigh: COMMON.BUTTONS.CLAUDE_EFFORT_XHIGH,
        max: COMMON.BUTTONS.CLAUDE_EFFORT_MAX,
    };
    // 接続設定
    const [connectionUrl, setConnectionUrl] = useState('http://127.0.0.1:8188');
    const [defaultTemplateId, setDefaultTemplateId] = useState('');
    const [lightweightImageSaveEnabled, setLightweightImageSaveEnabled] = useState(false);
    const [lightweightImageFormat, setLightweightImageFormat] = useState<LightweightImageFormat>('avif');
    const [lightweightImageQuality, setLightweightImageQuality] = useState(92);
    const [lightweightImageLossless, setLightweightImageLossless] = useState(false);
    const [lightweightImageEffort, setLightweightImageEffort] = useState(4);
    const [directiveMode, setDirectiveMode] = useState<DirectiveMode>('danbooru_only');
    // 形式（directiveMode）ごとの使用ワークフロー名。キー未登録・空値は共通（defaultTemplateId）
    const [workflowByDirectiveMode, setWorkflowByDirectiveMode] = useState<Record<string, string>>({});
    const [danbooruTagFormat, setDanbooruTagFormat] = useState<DanbooruTagFormat>('underscore');
    const [triggerWordFormat, setTriggerWordFormat] = useState<TriggerWordFormat>('raw');
    const [tagJudgeProvider, setTagJudgeProvider] = useState<TagJudgeProvider>('gemini');
    const [tagJudgeGeminiModel, setTagJudgeGeminiModel] = useState<GeminiTagJudgeModel>('gemini-3-flash-preview');
    const [tagJudgeClaudeModel, setTagJudgeClaudeModel] = useState<ClaudeTagJudgeModel>('claude-sonnet-4-6');
    const [tagJudgeClaudeEffort, setTagJudgeClaudeEffort] = useState<ClaudeEffort>('');
    const [tagJudgeAntigravityModel, setTagJudgeAntigravityModel] = useState<AntigravityTagJudgeModel>('antigravity');
    const [tagJudgeTimeoutSeconds, setTagJudgeTimeoutSeconds] = useState(180);

    // モデルオプション（APIから動的取得）
    const [geminiModelOptions, setGeminiModelOptions] = useState<{ value: GeminiTagJudgeModel; label: string }[]>([]);
    const [claudeModelOptions, setClaudeModelOptions] = useState<{ value: ClaudeTagJudgeModel; label: string }[]>([]);
    const [antigravityModelOptions, setAntigravityModelOptions] = useState<{ value: AntigravityTagJudgeModel; label: string }[]>([]);

    // テスト結果
    const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
    const [isTesting, setIsTesting] = useState(false);

    // テンプレート
    const [templates, setTemplates] = useState<TemplateInfo[]>([]);

    // アップロード
    const [isDragOver, setIsDragOver] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [showNameInput, setShowNameInput] = useState(false);
    const [pendingWorkflow, setPendingWorkflow] = useState<any>(null);
    const [newTemplateName, setNewTemplateName] = useState('');
    const [isDownloadingTemplate, setIsDownloadingTemplate] = useState(false);
    const [downloadError, setDownloadError] = useState<string | null>(null);

    // テスト生成
    const [isGenerating, setIsGenerating] = useState(false);
    const [generatedImage, setGeneratedImage] = useState<string | null>(null); // data:URI
    const [generateError, setGenerateError] = useState<string | null>(null);

    // キャラ設定モーダル
    const [isCharacterSettingsOpen, setIsCharacterSettingsOpen] = useState(false);
    // LoRAディレクトリ設定モーダル
    const [isLoraDirOpen, setIsLoraDirOpen] = useState(false);
    // タグマッピング設定モーダル
    const [isTagMappingOpen, setIsTagMappingOpen] = useState(false);
    // 画像生成テストモーダル
    const [isGenerateTestOpen, setIsGenerateTestOpen] = useState(false);
    // 画像生成統合設定は ConfigEditorHub のタブ付き表示で開く（このモーダルは閉じて中継する）
    const openIntegrated = onOpenIntegrated
        ? () => {
            onClose();
            onOpenIntegrated();
        }
        : undefined;
    const [isWideScreen, setIsWideScreen] = useState(false);

    // 保存中
    const [isSaving, setIsSaving] = useState(false);

    // セッション内背景画像設定（アプリ設定）の編集用ローカルコピー
    const [localAppSettings, setLocalAppSettings] = useState<Settings | undefined>(appSettings);

    const fileInputRef = useRef<HTMLInputElement>(null);

    // /api/models からGemini・Claudeモデルリストを取得（モーダルを開くたびに再取得）
    useEffect(() => {
        if (!isOpen) return;
        const fetchModels = async () => {
            try {
                const res = await axios.get(`${backendUrl}/api/models`);
                const models: { id: string; name: string; description: string }[] = res.data.models ?? [];
                setGeminiModelOptions(
                    models
                        .filter(m => m.id.startsWith('gemini-') || m.id.startsWith('flash-thinking-'))
                        .map(m => ({ value: m.id, label: m.description }))
                );
                setClaudeModelOptions(
                    models
                        .filter(m => m.id.startsWith('claude-'))
                        .map(m => ({ value: m.id, label: m.description }))
                );
                setAntigravityModelOptions(
                    models
                        .filter(m => m.id === 'antigravity' || m.id.startsWith('antigravity:'))
                        .map(m => ({ value: m.id, label: m.description }))
                );
            } catch (e) {
                // モデルリストの正本はサーバの AVAILABLE_MODELS (/api/models)。
                // 取得失敗時はベタ書きフォールバックを持たず、選択肢を空のままにする。
                console.error('[ComfyUISettingsModal] /api/models fetch failed; model options stay empty:', e);
                setGeminiModelOptions([]);
                setClaudeModelOptions([]);
                setAntigravityModelOptions([]);
            }
        };
        fetchModels();
    }, [backendUrl, isOpen]);

    // 画面幅の検出（統合設定ボタン表示判定用）
    useEffect(() => {
        const checkWidth = () => setIsWideScreen(window.innerWidth >= INTEGRATED.MIN_SCREEN_WIDTH);
        checkWidth();
        window.addEventListener('resize', checkWidth);
        return () => window.removeEventListener('resize', checkWidth);
    }, []);

    // データ読み込み
    const loadData = useCallback(async () => {
        try {
            const [config, templateList] = await Promise.all([
                getComfyUIConfig(backendUrl),
                listComfyUITemplates(backendUrl),
            ]);
            setConnectionUrl(config.connectionUrl || 'http://127.0.0.1:8188');
            setDirectiveMode(config.directiveMode || 'danbooru_only');
            setWorkflowByDirectiveMode(config.workflowByDirectiveMode || {});
            setDanbooruTagFormat(config.danbooruTagFormat || 'underscore');
            setTriggerWordFormat(config.triggerWordFormat || 'raw');
            setTagJudgeProvider(config.tagJudgeProvider || 'gemini');
            setTagJudgeGeminiModel(config.tagJudgeGeminiModel || 'gemini-3-flash-preview');
            setTagJudgeClaudeModel(config.tagJudgeClaudeModel || 'claude-sonnet-4-6');
            setTagJudgeClaudeEffort(normalizeClaudeEffort(config.tagJudgeClaudeEffort));
            setTagJudgeAntigravityModel(config.tagJudgeAntigravityModel || 'antigravity');
            setTagJudgeTimeoutSeconds(config.tagJudgeTimeoutSeconds ?? 180);
            setLightweightImageSaveEnabled(config.lightweightImageSave?.enabled || false);
            setLightweightImageFormat(config.lightweightImageSave?.format || 'avif');
            setLightweightImageQuality(config.lightweightImageSave?.quality || 92);
            setLightweightImageLossless(config.lightweightImageSave?.lossless || false);
            setLightweightImageEffort(config.lightweightImageSave?.effort ?? 4);
            setTemplates(templateList);
            // デフォルト選択: 保存済みの値があればそれ、なければ先頭を自動選択
            const savedDefault = config.defaultTemplateId || '';
            if (savedDefault && templateList.some(t => t.name === savedDefault)) {
                setDefaultTemplateId(savedDefault);
            } else if (templateList.length > 0) {
                setDefaultTemplateId(templateList[0].name);
            } else {
                setDefaultTemplateId('');
            }
        } catch (error) {
            console.error('[ComfyUISettingsModal] config load failed:', error);
        }
    }, [backendUrl]);

    useEffect(() => {
        if (isOpen) {
            loadData();
            setTestResult(null);
            setUploadError(null);
            setDownloadError(null);
            setShowNameInput(false);
            setPendingWorkflow(null);
            setGeneratedImage(null);
            setGenerateError(null);
            setLocalAppSettings(appSettings);
        }
    }, [isOpen, loadData, appSettings]);

    // 接続テスト
    const handleTestConnection = async () => {
        setIsTesting(true);
        setTestResult(null);
        try {
            const result = await testComfyUIConnection(backendUrl, connectionUrl);
            setTestResult(result);
        } catch (error: any) {
            setTestResult({ success: false, message: error.message || COMMON.MESSAGES.CONNECTION_TEST_FAILED });
        } finally {
            setIsTesting(false);
        }
    };

    // ファイル処理
    const processFile = async (file: File) => {
        if (!file.name.endsWith('.json')) {
            setUploadError(COMMON.MESSAGES.JSON_ONLY);
            return;
        }

        setUploadError(null);
        try {
            const text = await file.text();
            const json = JSON.parse(text);

            // 名前入力へ遷移
            setPendingWorkflow(json);
            setNewTemplateName(file.name.replace('.json', ''));
            setShowNameInput(true);
        } catch {
            setUploadError(COMMON.MESSAGES.JSON_READ_FAILED);
        }
    };

    // テンプレート追加確定
    const handleConfirmUpload = async () => {
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
                // テンプレート一覧を再読み込み
                const templateList = await listComfyUITemplates(backendUrl);
                setTemplates(templateList);
                // デフォルト未設定なら最初のテンプレートをデフォルトに
                if (!defaultTemplateId && templateList.length > 0) {
                    setDefaultTemplateId(templateList[0].name);
                }
            }
        } catch (error: any) {
            // axios 400 レスポンスの場合
            const msg = error.response?.data?.error || error.message || COMMON.MESSAGES.ADD_FAILED;
            setUploadError(msg);
        } finally {
            setIsUploading(false);
        }
    };

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

    // テンプレート削除
    const handleDeleteTemplate = async (name: string) => {
        if (!confirm(formatComfyText(COMMON.MESSAGES.DELETE_TEMPLATE_CONFIRM, { name }))) return;
        try {
            await deleteComfyUITemplate(backendUrl, name);
            const templateList = await listComfyUITemplates(backendUrl);
            setTemplates(templateList);
            if (defaultTemplateId === name) {
                setDefaultTemplateId(templateList.length > 0 ? templateList[0].name : '');
            }
        } catch (error) {
            console.error('[ComfyUISettingsModal] template delete failed:', error);
        }
    };

    // 選択中ワークフローをブラウザへダウンロード
    const handleDownloadTemplate = async () => {
        if (!defaultTemplateId || isDownloadingTemplate) return;
        setIsDownloadingTemplate(true);
        setDownloadError(null);
        try {
            await downloadComfyUITemplate(backendUrl, defaultTemplateId);
        } catch (error) {
            console.error('[ComfyUISettingsModal] template download failed:', error);
            setDownloadError(COMMON.MESSAGES.DOWNLOAD_WORKFLOW_FAILED);
        } finally {
            setIsDownloadingTemplate(false);
        }
    };

    // テスト生成
    // テスト生成で使うワークフロー: 選択中形式の紐づけ（実在するもの）→ 共通。
    // 実行時（image_job）の形式マップ解決と同じ結果を確認できるようにする。
    const resolvedTestTemplateId = (() => {
        const mapped = workflowByDirectiveMode[directiveMode];
        if (mapped && templates.some(t => t.name === mapped && t.hasWorkflow)) return mapped;
        return defaultTemplateId;
    })();

    const handleTestGenerate = async () => {
        if (!resolvedTestTemplateId || !connectionUrl) return;
        setIsGenerating(true);
        setGeneratedImage(null);
        setGenerateError(null);
        try {
            const result = await testGenerateComfyUI(backendUrl, resolvedTestTemplateId, connectionUrl, {
                enabled: lightweightImageSaveEnabled,
                format: lightweightImageFormat,
                quality: lightweightImageQuality,
                lossless: lightweightImageLossless,
                effort: lightweightImageEffort,
            });
            if (result.success && result.imageBase64) {
                setGeneratedImage(`data:${result.mimeType || 'image/png'};base64,${result.imageBase64}`);
            } else {
                setGenerateError(result.error || GENERATE_TEST.MESSAGES.GENERATE_FAILED);
            }
        } catch (error: any) {
            const msg = error.response?.data?.error || error.message || GENERATE_TEST.MESSAGES.GENERATE_FAILED;
            setGenerateError(msg);
        } finally {
            setIsGenerating(false);
        }
    };

    // 保存
    const handleSave = async () => {
        setIsSaving(true);
        try {
            const config: ComfyUIConfig = {
                version: 1,
                connectionUrl,
                defaultTemplateId,
                directiveMode,
                workflowByDirectiveMode,
                danbooruTagFormat,
                triggerWordFormat,
                tagJudgeProvider,
                tagJudgeGeminiModel,
                tagJudgeClaudeModel,
                tagJudgeClaudeEffort,
                tagJudgeAntigravityModel,
                tagJudgeTimeoutSeconds,
                lightweightImageSave: {
                    enabled: lightweightImageSaveEnabled,
                    format: lightweightImageFormat,
                    quality: lightweightImageQuality,
                    lossless: lightweightImageLossless,
                    effort: lightweightImageEffort,
                },
            };
            await saveComfyUIConfig(backendUrl, config);
            // セッション内背景画像設定（アプリ設定）も一緒に保存する
            if (localAppSettings && onAppSettingsSave) {
                await onAppSettingsSave(localAppSettings);
            }
            onClose();
        } catch (error) {
            console.error('[ComfyUISettingsModal] config save failed:', error);
        } finally {
            setIsSaving(false);
        }
    };

    // バックドロップクリック
    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) onClose();
    };

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
            onClick={handleBackdropClick}
        >
            <div className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-xl border border-gray-700 overflow-hidden">
                {/* ヘッダー */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 bg-gray-800">
                    <div className="flex items-center gap-2">
                        <Palette size={20} className="text-green-400" />
                        <h3 className="font-semibold text-gray-100 text-lg">{SECTION_NAMES.SETTINGS}</h3>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 hover:bg-gray-700 rounded text-gray-400 hover:text-gray-200 transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* 本体 */}
                <div className="p-5 space-y-6 max-h-[60vh] overflow-y-auto custom-scrollbar">
                    {/* 接続設定 */}
                    <div className="space-y-3">
                        <h4 className="flex items-center gap-2 text-sm font-medium text-gray-400">
                            <Wifi size={16} className="text-green-400" />
                            {SECTION_NAMES.CONNECTION_SETTINGS}
                        </h4>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={connectionUrl}
                                onChange={(e) => {
                                    setConnectionUrl(e.target.value);
                                    setTestResult(null);
                                }}
                                placeholder="http://127.0.0.1:8188"
                                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-green-500 transition-colors"
                            />
                            <button
                                onClick={handleTestConnection}
                                disabled={isTesting || !connectionUrl.trim()}
                                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-green-600 rounded-lg text-sm text-green-400 hover:text-green-300 transition-colors disabled:opacity-50 flex items-center gap-1.5 whitespace-nowrap"
                            >
                                {isTesting ? (
                                    <Loader2 size={14} className="animate-spin" />
                                ) : (
                                    <Wifi size={14} />
                                )}
                                {COMMON.BUTTONS.TEST}
                            </button>
                        </div>
                        {/* テスト結果 */}
                        {testResult && (
                            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${testResult.success
                                ? 'bg-green-900/30 border border-green-700/50 text-green-300'
                                : 'bg-red-900/30 border border-red-700/50 text-red-300'
                                }`}>
                                {testResult.success ? (
                                    <CheckCircle size={14} />
                                ) : (
                                    <WifiOff size={14} />
                                )}
                                {resolveMessage(uiCatalog, testResult.message, testResult.message)}
                            </div>
                        )}
                        <p className="text-xs text-gray-500">
                            {COMMON.MESSAGES.DEFAULT_PORT_DESC}
                        </p>
                    </div>

                    {/* タグ判定・ワークフロー設定（開閉・デフォルト閉）:
                        分析AI / 形式×ワークフロー対応表 / 共通ワークフロー / DD領域 / 生成テスト / 軽量画像保存 */}
                    <div className="pt-4 border-t border-gray-700">
                        <CollapsibleSection
                            title={
                                <>
                                    <FileText size={16} className="text-green-400" />
                                    {SECTION_NAMES.TAG_JUDGE_WORKFLOW_SETTINGS}
                                </>
                            }
                        >
                        <label className="space-y-1 block">
                            <span className="text-xs text-gray-500">{COMMON.BUTTONS.ANALYSIS_AI}</span>
                            <select
                                value={tagJudgeProvider}
                                onChange={(e) => setTagJudgeProvider(e.target.value as TagJudgeProvider)}
                                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-green-500 transition-colors"
                            >
                                <option value="gemini">Gemini CLI</option>
                                <option value="claude">Claude Code CLI</option>
                                <option value="antigravity">Antigravity CLI</option>
                            </select>
                        </label>
                        <div className={`grid grid-cols-1 gap-3 ${tagJudgeProvider === 'claude' ? 'sm:grid-cols-2' : ''}`}>
                            <label className="space-y-1 block">
                                <span className="text-xs text-gray-500">{COMMON.BUTTONS.ANALYSIS_MODEL}</span>
                                <select
                                    value={
                                        tagJudgeProvider === 'claude' ? tagJudgeClaudeModel
                                            : tagJudgeProvider === 'antigravity' ? tagJudgeAntigravityModel
                                                : tagJudgeGeminiModel
                                    }
                                    onChange={(e) => {
                                        if (tagJudgeProvider === 'claude') {
                                            setTagJudgeClaudeModel(e.target.value as ClaudeTagJudgeModel);
                                        } else if (tagJudgeProvider === 'antigravity') {
                                            setTagJudgeAntigravityModel(e.target.value as AntigravityTagJudgeModel);
                                        } else {
                                            setTagJudgeGeminiModel(e.target.value as GeminiTagJudgeModel);
                                        }
                                    }}
                                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-green-500 transition-colors"
                                >
                                    {(
                                        tagJudgeProvider === 'claude' ? claudeModelOptions
                                            : tagJudgeProvider === 'antigravity' ? antigravityModelOptions
                                                : geminiModelOptions
                                    ).map((option) => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                </select>
                            </label>
                            {tagJudgeProvider === 'claude' && (
                                <label className="space-y-1 block">
                                    <span className="text-xs text-gray-500">{COMMON.BUTTONS.CLAUDE_EFFORT}</span>
                                    <select
                                        value={tagJudgeClaudeEffort}
                                        onChange={(e) => setTagJudgeClaudeEffort(e.target.value as ClaudeEffort)}
                                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-green-500 transition-colors"
                                    >
                                        {CLAUDE_EFFORT_VALUES.map((effort) => (
                                            <option key={effort || 'default'} value={effort}>{claudeEffortLabels[effort]}</option>
                                        ))}
                                    </select>
                                </label>
                            )}
                        </div>
                        <p className="text-xs text-gray-500">
                            {COMMON.MESSAGES.TAG_JUDGE_DESC}
                        </p>
                        <label className="space-y-1 block">
                            <span className="text-xs text-gray-500">{COMMON.BUTTONS.TAG_JUDGE_TIMEOUT_SECONDS}</span>
                            <input
                                type="number"
                                min={30}
                                max={1800}
                                step={10}
                                value={tagJudgeTimeoutSeconds}
                                onChange={(e) => {
                                    const value = Number(e.target.value);
                                    setTagJudgeTimeoutSeconds(Number.isFinite(value) ? value : 180);
                                }}
                                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-green-500 transition-colors"
                            />
                        </label>

                        {/* 形式×ワークフロー対応表: ラジオが使用形式（directiveMode）、
                            各行のセレクトがその形式に紐づくワークフロー */}
                        <div className="space-y-2 pt-3 border-t border-gray-700">
                            <h4 className="flex items-center gap-2 text-sm font-medium text-gray-400">
                                <Workflow size={16} className="text-green-400" />
                                {COMMON.MESSAGES.FORMAT_WORKFLOW_HEADING}
                            </h4>
                            <p className="text-xs text-gray-500">{COMMON.MESSAGES.FORMAT_WORKFLOW_DESC}</p>
                            <p className="text-xs text-gray-500">{COMMON.MESSAGES.DIRECTIVE_MODE_DESC}</p>
                            {([
                                { value: 'natural_language', label: DIRECTIVE_MODE_OPTIONS.NATURAL_LANGUAGE },
                                { value: 'natural_language_short', label: DIRECTIVE_MODE_OPTIONS.NATURAL_SHORT },
                                { value: 'natural_language_third_person', label: DIRECTIVE_MODE_OPTIONS.NATURAL_THIRD },
                                { value: 'natural_language_third_person_short', label: DIRECTIVE_MODE_OPTIONS.NATURAL_THIRD_SHORT },
                                { value: 'danbooru_only', label: DIRECTIVE_MODE_OPTIONS.DANBOORU_ONLY },
                                { value: 'danbooru_third_person', label: DIRECTIVE_MODE_OPTIONS.DANBOORU_THIRD },
                            ] as { value: DirectiveMode; label: string }[]).map((row) => {
                                const mappedName = workflowByDirectiveMode[row.value] ?? '';
                                const templateNames = templates.filter(t => t.hasWorkflow).map(t => t.name);
                                // 保存済みの紐づけ先が一覧から消えている場合（削除済み等）も選択肢に
                                // 出して選択状態を維持する（実行時はバックエンドが共通へフォールバック）。
                                const rowOptions = mappedName && !templateNames.includes(mappedName)
                                    ? [...templateNames, mappedName]
                                    : templateNames;
                                return (
                                    <div key={row.value} className="flex items-center gap-2">
                                        <label className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
                                            <input
                                                type="radio"
                                                name="directiveMode"
                                                checked={directiveMode === row.value}
                                                onChange={() => setDirectiveMode(row.value)}
                                                className="accent-green-500 shrink-0"
                                            />
                                            <span className="text-sm text-gray-300">{row.label}</span>
                                        </label>
                                        <select
                                            value={mappedName}
                                            onChange={(e) => {
                                                const next = { ...workflowByDirectiveMode };
                                                if (e.target.value === '') {
                                                    delete next[row.value];
                                                } else {
                                                    next[row.value] = e.target.value;
                                                }
                                                setWorkflowByDirectiveMode(next);
                                            }}
                                            className="w-40 shrink-0 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-gray-200 outline-none focus:border-green-500 transition-colors"
                                        >
                                            <option value="">{COMMON.MESSAGES.COMMON_WORKFLOW_OPTION}</option>
                                            {rowOptions.map(name => (
                                                <option key={name} value={name}>{name}</option>
                                            ))}
                                        </select>
                                    </div>
                                );
                            })}

                            {/* 共通ワークフロー（「共通」を選んだ形式が使う既定。DL/削除の対象） */}
                            {templates.length > 0 ? (
                                <div className="space-y-2 pt-1">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs text-gray-400 shrink-0">{COMMON.MESSAGES.COMMON_WORKFLOW_LABEL}</span>
                                        <select
                                            value={defaultTemplateId}
                                            onChange={(e) => setDefaultTemplateId(e.target.value)}
                                            className="flex-1 bg-gray-800 border border-green-600 rounded-lg px-3 py-2 text-sm text-gray-200 focus:border-green-400 outline-none"
                                        >
                                            {templates.map((t) => (
                                                <option key={t.name} value={t.name}>{t.name}</option>
                                            ))}
                                        </select>
                                        <button
                                            onClick={handleDownloadTemplate}
                                            disabled={
                                                !defaultTemplateId
                                                || isDownloadingTemplate
                                                || !templates.some(t => t.name === defaultTemplateId && t.hasWorkflow)
                                            }
                                            className="p-2 text-gray-500 hover:text-blue-400 transition-colors disabled:opacity-30"
                                            title={COMMON.MESSAGES.DOWNLOAD_SELECTED_WORKFLOW_TOOLTIP}
                                            aria-label={COMMON.MESSAGES.DOWNLOAD_SELECTED_WORKFLOW_TOOLTIP}
                                        >
                                            {isDownloadingTemplate
                                                ? <Loader2 size={16} className="animate-spin" />
                                                : <Download size={16} />}
                                        </button>
                                        <button
                                            onClick={() => defaultTemplateId && handleDeleteTemplate(defaultTemplateId)}
                                            disabled={!defaultTemplateId}
                                            className="p-2 text-gray-500 hover:text-red-400 transition-colors disabled:opacity-30"
                                            title={COMMON.MESSAGES.DELETE_SELECTED_TEMPLATE_TOOLTIP}
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                    <p className="text-xs text-gray-500">
                                        {COMMON.MESSAGES.TEMPLATE_SELECT_DESC}
                                    </p>
                                    {downloadError && (
                                        <div className="flex items-start gap-2 px-3 py-2 rounded-lg text-sm bg-red-900/30 border border-red-700/50 text-red-300">
                                            <AlertCircle size={14} className="mt-0.5 shrink-0" />
                                            <span>{downloadError}</span>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <p className="text-xs text-gray-600 text-center py-2">
                                    {COMMON.MESSAGES.NO_TEMPLATE}
                                </p>
                            )}
                        </div>

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

                        {/* テスト生成（テンプレート登録済みのときのみ。
                            選択中形式に解決されるワークフローで実行する） */}
                        {templates.length > 0 && (
                            <div className="space-y-2">
                                <button
                                    onClick={handleTestGenerate}
                                    disabled={isGenerating || !resolvedTestTemplateId || !connectionUrl}
                                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-green-600/50 rounded-lg text-sm text-green-400 hover:text-green-300 transition-colors disabled:opacity-40"
                                >
                                    {isGenerating ? (
                                        <>
                                            <Loader2 size={14} className="animate-spin" />
                                            {GENERATE_TEST.MESSAGES.GENERATING}
                                        </>
                                    ) : (
                                        <>
                                            <Palette size={14} />
                                            {SECTION_NAMES.GENERATE_TEST}
                                        </>
                                    )}
                                </button>

                                {/* テスト生成エラー */}
                                {generateError && (
                                    <div className="flex items-start gap-2 px-3 py-2 rounded-lg text-sm bg-red-900/30 border border-red-700/50 text-red-300">
                                        <AlertCircle size={14} className="mt-0.5 shrink-0" />
                                        <span>{generateError}</span>
                                    </div>
                                )}

                                {/* テスト生成結果 */}
                                {generatedImage && (
                                    <div className="space-y-2">
                                        <p className="text-xs text-green-400">{GENERATE_TEST.MESSAGES.TEST_DONE}</p>
                                        <img
                                            src={generatedImage}
                                            alt={GENERATE_TEST.MESSAGES.TEST_RESULT_ALT}
                                            className="w-full rounded-lg border border-gray-700 cursor-pointer hover:border-green-500 transition-colors"
                                            onClick={() => window.open(generatedImage, '_blank')}
                                            title={GENERATE_TEST.MESSAGES.CLICK_TO_ZOOM_DISPLAY}
                                        />
                                    </div>
                                )}
                            </div>
                        )}

                        {/* 軽量画像保存ノード設定 */}
                        <div className="space-y-3 pt-3 border-t border-gray-700">
                            <h4 className="flex items-center gap-2 text-sm font-medium text-gray-400">
                                <Save size={16} className="text-green-400" />
                                {SECTION_NAMES.LIGHTWEIGHT_SAVE}
                            </h4>
                            <ToggleSwitch
                                checked={lightweightImageSaveEnabled}
                                onChange={setLightweightImageSaveEnabled}
                                label={COMMON.MESSAGES.LIGHTWEIGHT_SAVE_LABEL}
                                labelPosition="right"
                                labelClassName="text-sm text-gray-300"
                                accent="green"
                                size="sm"
                            />
                            <div className={lightweightImageSaveEnabled ? 'space-y-3' : 'space-y-3 opacity-50 pointer-events-none'}>
                                <div className="grid grid-cols-2 gap-3">
                                    <label className="space-y-1">
                                        <span className="text-xs text-gray-500">{COMMON.BUTTONS.FORMAT}</span>
                                        <select
                                            value={lightweightImageFormat}
                                            onChange={(e) => setLightweightImageFormat(e.target.value as LightweightImageFormat)}
                                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-green-500"
                                        >
                                            <option value="avif">AVIF</option>
                                            <option value="webp">WebP</option>
                                            <option value="png">PNG</option>
                                        </select>
                                    </label>
                                    <label className="space-y-1">
                                        <span className="text-xs text-gray-500">effort</span>
                                        <input
                                            type="number"
                                            min={0}
                                            max={10}
                                            value={lightweightImageEffort}
                                            onChange={(e) => setLightweightImageEffort(Number(e.target.value))}
                                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-green-500"
                                        />
                                    </label>
                                </div>
                                <label className="space-y-1 block">
                                    <span className="text-xs text-gray-500">quality: {lightweightImageQuality}</span>
                                    <input
                                        type="range"
                                        min={1}
                                        max={100}
                                        value={lightweightImageQuality}
                                        onChange={(e) => setLightweightImageQuality(Number(e.target.value))}
                                        className="w-full accent-green-500"
                                    />
                                </label>
                                <ToggleSwitch
                                    checked={lightweightImageLossless}
                                    onChange={setLightweightImageLossless}
                                    label="lossless"
                                    labelPosition="right"
                                    labelClassName="text-sm text-gray-300"
                                    accent="green"
                                    size="sm"
                                />
                                <p className="text-xs text-gray-500">
                                    {COMMON.MESSAGES.LIGHTWEIGHT_SAVE_DESC}
                                </p>
                            </div>
                        </div>
                        </CollapsibleSection>
                    </div>

                    {/* 画像生成設定（統合設定・PC幅以上のみ表示） */}
                    {isWideScreen && openIntegrated && (
                        <div className="pt-4 border-t border-gray-700">
                            <button
                                onClick={openIntegrated}
                                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gray-800 hover:bg-gray-700 border border-purple-600 rounded-lg text-sm text-gray-300 transition-colors"
                            >
                                <Palette size={16} className="text-purple-400" />
                                {INTEGRATED.OPEN_BUTTON_LABEL}
                            </button>
                            <p className="text-xs text-gray-500 mt-2 text-center">
                                {COMMON.MESSAGES.INTEGRATED_SETTINGS_DESC}
                            </p>
                        </div>
                    )}

                    {/* 各画像生成設定ボタン（統合設定ボタンが表示される場合は非表示） */}
                    {!isWideScreen && (
                    <>
                    {/* キャラクター画像生成設定ボタン */}
                    <div className="pt-4 border-t border-gray-700">
                        <button
                            onClick={() => setIsCharacterSettingsOpen(true)}
                            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gray-800 hover:bg-gray-700 border border-pink-600 rounded-lg text-sm text-gray-300 transition-colors"
                        >
                            <Users size={16} className="text-pink-400" />
                            {SECTION_NAMES.CHARACTER_SETTINGS}
                        </button>
                        <p className="text-xs text-gray-500 mt-2 text-center">
                            {COMMON.MESSAGES.CHARACTER_SETTINGS_DESC}
                        </p>
                    </div>

                    {/* その他画像生成設定ボタン */}
                    <div className="pt-4 border-t border-gray-700">
                        <button
                            onClick={() => setIsTagMappingOpen(true)}
                            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gray-800 hover:bg-gray-700 border border-cyan-600 rounded-lg text-sm text-gray-300 transition-colors"
                        >
                            <Tag size={16} className="text-cyan-400" />
                            {SECTION_NAMES.OTHER_IMAGE_SETTINGS}
                        </button>
                        <p className="text-xs text-gray-500 mt-2 text-center">
                            {COMMON.MESSAGES.OTHER_IMAGE_SETTINGS_DESC}
                        </p>
                    </div>

                    {/* LoRAディレクトリ設定ボタン */}
                    <div className="pt-4 border-t border-gray-700">
                        <button
                            onClick={() => setIsLoraDirOpen(true)}
                            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gray-800 hover:bg-gray-700 border border-yellow-600 rounded-lg text-sm text-gray-300 transition-colors"
                        >
                            <FolderOpen size={16} className="text-yellow-400" />
                            {SECTION_NAMES.LORA_DIR_SETTINGS}
                        </button>
                        <p className="text-xs text-gray-500 mt-2 text-center">
                            {COMMON.MESSAGES.LORA_DIR_SETTINGS_DESC}
                        </p>
                    </div>

                    {/* 画像生成テストボタン */}
                    <div className="pt-4 border-t border-gray-700">
                        <button
                            onClick={() => setIsGenerateTestOpen(true)}
                            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gray-800 hover:bg-gray-700 border border-purple-600 rounded-lg text-sm text-gray-300 transition-colors"
                        >
                            <Palette size={16} className="text-purple-400" />
                            {SECTION_NAMES.GENERATE_TEST}
                        </button>
                        <p className="text-xs text-gray-500 mt-2 text-center">
                            {COMMON.MESSAGES.GENERATE_TEST_DESC}
                        </p>
                    </div>
                    </>
                    )}

                    {/* Danbooruタグ取得形式 */}
                    <div className="space-y-3 pt-4 border-t border-gray-700">
                        <h4 className="flex items-center gap-2 text-sm font-medium text-gray-400">
                            <Tag size={16} className="text-green-400" />
                            {SECTION_NAMES.DANBOORU_FORMAT}
                        </h4>
                        <div className="inline-flex rounded-lg border border-gray-700 bg-gray-800 p-1">
                            <button
                                type="button"
                                onClick={() => setDanbooruTagFormat('underscore')}
                                className={`px-3 py-1.5 text-sm rounded transition-colors ${
                                    danbooruTagFormat === 'underscore'
                                        ? 'bg-green-700 text-white'
                                        : 'text-gray-300 hover:bg-gray-700'
                                }`}
                            >
                                {COMMON.MESSAGES.UNDERSCORE}
                            </button>
                            <button
                                type="button"
                                onClick={() => setDanbooruTagFormat('space')}
                                className={`px-3 py-1.5 text-sm rounded transition-colors ${
                                    danbooruTagFormat === 'space'
                                        ? 'bg-green-700 text-white'
                                        : 'text-gray-300 hover:bg-gray-700'
                                }`}
                            >
                                {COMMON.MESSAGES.SPACE}
                            </button>
                        </div>
                        <p className="text-xs text-gray-500">
                            {COMMON.MESSAGES.DANBOORU_FORMAT_DESC}
                        </p>
                    </div>

                    {/* トリガーワード取得形式 */}
                    <div className="space-y-3 pt-4 border-t border-gray-700">
                        <h4 className="flex items-center gap-2 text-sm font-medium text-gray-400">
                            <Tag size={16} className="text-cyan-400" />
                            {SECTION_NAMES.TRIGGER_FORMAT}
                        </h4>
                        <div className="inline-flex rounded-lg border border-gray-700 bg-gray-800 p-1">
                            <button
                                type="button"
                                onClick={() => setTriggerWordFormat('raw')}
                                className={`px-3 py-1.5 text-sm rounded transition-colors ${
                                    triggerWordFormat === 'raw'
                                        ? 'bg-cyan-700 text-white'
                                        : 'text-gray-300 hover:bg-gray-700'
                                }`}
                            >
                                {COMMON.MESSAGES.RAW}
                            </button>
                            <button
                                type="button"
                                onClick={() => setTriggerWordFormat('underscore')}
                                className={`px-3 py-1.5 text-sm rounded transition-colors ${
                                    triggerWordFormat === 'underscore'
                                        ? 'bg-cyan-700 text-white'
                                        : 'text-gray-300 hover:bg-gray-700'
                                }`}
                            >
                                {COMMON.MESSAGES.UNDERSCORE}
                            </button>
                            <button
                                type="button"
                                onClick={() => setTriggerWordFormat('space')}
                                className={`px-3 py-1.5 text-sm rounded transition-colors ${
                                    triggerWordFormat === 'space'
                                        ? 'bg-cyan-700 text-white'
                                        : 'text-gray-300 hover:bg-gray-700'
                                }`}
                            >
                                {COMMON.MESSAGES.SPACE}
                            </button>
                        </div>
                        <p className="text-xs text-gray-500">
                            {COMMON.MESSAGES.TRIGGER_FORMAT_DESC}
                        </p>
                    </div>

                    {/* セッション内背景画像（アプリ設定。基本チャット設定から移動） */}
                    {localAppSettings && (
                        <div className="pt-4 border-t border-gray-700">
                            <BackgroundImageSettings
                                settings={localAppSettings}
                                onChange={setLocalAppSettings}
                                uiCatalog={uiCatalog}
                            />
                        </div>
                    )}
                </div>

                {/* フッター */}
                <div className="flex justify-end gap-3 px-5 py-4 border-t border-gray-700 bg-gray-800/50">
                    <button
                        onClick={onClose}
                        className="px-5 py-2 text-sm text-gray-300 hover:text-gray-100 hover:bg-gray-700 rounded-lg transition-colors"
                    >
                        {COMMON.BUTTONS.CANCEL}
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="px-5 py-2 text-sm text-white bg-green-600 hover:bg-green-500 disabled:opacity-50 rounded-lg transition-colors"
                    >
                        {isSaving ? COMMON.BUTTONS.SAVING : COMMON.BUTTONS.SAVE}
                    </button>
                </div>
            </div>
            {/* キャラクター画像生成設定モーダル */}
            <ComfyUICharacterSettingsModal
                isOpen={isCharacterSettingsOpen}
                onClose={() => setIsCharacterSettingsOpen(false)}
                backendUrl={backendUrl}
                danbooruTagFormat={danbooruTagFormat}
                onOpenIntegrated={isWideScreen ? openIntegrated : undefined}
                uiCatalog={uiCatalog}
            />

            {/* タグマッピング設定モーダル */}
            <ComfyUITagMappingModal
                isOpen={isTagMappingOpen}
                onClose={() => setIsTagMappingOpen(false)}
                backendUrl={backendUrl}
                danbooruTagFormat={danbooruTagFormat}
                onOpenIntegrated={isWideScreen ? openIntegrated : undefined}
                uiCatalog={uiCatalog}
            />

            {/* LoRAディレクトリ設定モーダル */}
            <ComfyUILoraDirModal
                isOpen={isLoraDirOpen}
                onClose={() => setIsLoraDirOpen(false)}
                backendUrl={backendUrl}
                uiCatalog={uiCatalog}
            />

            {/* 画像生成テストモーダル */}
            <ComfyUIGenerateTestModal
                isOpen={isGenerateTestOpen}
                onClose={() => setIsGenerateTestOpen(false)}
                backendUrl={backendUrl}
                onOpenIntegrated={isWideScreen ? openIntegrated : undefined}
                uiCatalog={uiCatalog}
            />

        </div>
    );
};
