/**
 * ApiProvidersModal.tsx - openai_compat 接続先管理モーダル
 *
 * - キー値は画面に一切出さない（hasApiKey の「設定済み／未設定」のみ）
 * - APIキーは「未変更／上書き入力中／削除予定」の3状態機械で管理し、保存時に1回だけ送る
 * - 接続テストはサーバー採番済みIDが必要なため「テスト押下時に自動保存」方式
 * - モデルピッカーの保存は全置換 API（/api/models/user）への保存直前取得＋差分マージ
 */

import React, { useEffect, useMemo, useState } from 'react';
import { X, Plug, Plus, Loader2, Trash2, Pencil, Radio, Power } from 'lucide-react';
import { BACKEND_URL } from '../../api/base-url';
import { formatSlashPair, resolveMessage, type I18NCatalog } from '../../api/i18n';
import {
    API_PROVIDERS_I18N_KEYS as K,
    API_PROVIDERS_TEXT_FALLBACK_JA,
} from '../../constants/i18n';
import {
    createApiProvider,
    deleteApiProvider,
    dryRunDeleteApiProvider,
    fetchApiProviderPresets,
    fetchApiProviders,
    testApiProvider,
    updateApiProvider,
    type ApiProviderConnection,
    type ApiProviderDeleteResult,
    type ApiProviderPreset,
    type ApiProviderSaveRequest,
    type ApiProviderInstructionTarget,
    type ApiProviderTestModel,
    type ApiProviderTestResult,
} from '../../api/api-providers';
import { fetchUserModels, saveUserModels, type UserModel } from '../../api/user-models';
import {
    apiKeyPayload,
    apiKeyStateAfterInput,
    buildExtraParams,
    mergeApiProviderModels,
    type ApiKeyState,
    type ExtraParamRowValue,
} from './apiProviderForm';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    uiCatalog?: I18NCatalog | null;
    /** モデル登録の保存後に親がモデル一覧（/api/models）を再取得するためのフック */
    onModelsChanged?: () => void;
    /** 接続先に対応する基本指示ファイルを設定ファイルエディタで直接開く。 */
    onOpenInstruction?: (target: ApiProviderInstructionTarget) => void;
}

/** APIキー入力の3状態（状態が排他のため clear と新キーの同時送信は構造的に発生しない） */
interface FormState {
    preset: string;
    label: string;
    baseUrl: string;
    authScheme: string;
    enabled: boolean;
    forceNonStreaming: boolean;
    extraParams: ExtraParamRowValue[];
    keyState: ApiKeyState;
    keyInput: string;
}

const emptyForm = (preset: ApiProviderPreset | null): FormState => ({
    preset: preset?.id ?? 'openrouter',
    label: '',
    baseUrl: preset?.baseUrl ?? '',
    authScheme: preset?.authScheme ?? 'bearer',
    enabled: true,
    forceNonStreaming: false,
    extraParams: [],
    keyState: 'unchanged',
    keyInput: '',
});

const AUTH_SCHEMES = ['bearer', 'api-key-header', 'x-api-key-header', 'none'] as const;

export const ApiProvidersModal: React.FC<Props> = ({ isOpen, onClose, uiCatalog = null, onModelsChanged, onOpenInstruction }) => {
    const t = (key: string) => resolveMessage(uiCatalog, key, API_PROVIDERS_TEXT_FALLBACK_JA[key] || key);
    // ApiProvidersModal は既存画面の慣行に従いローカルの formatText を実装する。
    const formatText = (template: string, values: Record<string, string | number>) =>
        Object.entries(values).reduce((text, [key, value]) => text.split(`{{${key}}}`).join(String(value)), template);

    const [connections, setConnections] = useState<ApiProviderConnection[]>([]);
    const [presets, setPresets] = useState<ApiProviderPreset[]>([]);
    const [userModels, setUserModels] = useState<UserModel[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // 編集ビュー
    const [view, setView] = useState<'list' | 'edit'>('list');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState<FormState>(emptyForm(null));
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);
    const [extraParamError, setExtraParamError] = useState<{ row: number; message: string } | null>(null);
    const [keyClearConfirmOpen, setKeyClearConfirmOpen] = useState(false);

    // 接続テスト・モデルピッカー
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<ApiProviderTestResult | null>(null);
    const [pickerModels, setPickerModels] = useState<ApiProviderTestModel[]>([]);
    const [pickerChecked, setPickerChecked] = useState<Set<string>>(new Set());
    const [pickerDirty, setPickerDirty] = useState(false);
    const [pickerSearch, setPickerSearch] = useState('');
    const [pickerManualId, setPickerManualId] = useState('');
    const [pickerSaving, setPickerSaving] = useState(false);
    const [pickerError, setPickerError] = useState<string | null>(null);

    // 削除確認
    const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string; dryRun: ApiProviderDeleteResult } | null>(null);
    const [deleting, setDeleting] = useState(false);

    const reload = async () => {
        setLoading(true);
        setError(null);
        try {
            const [conns, ps, um] = await Promise.all([
                fetchApiProviders(BACKEND_URL),
                fetchApiProviderPresets(BACKEND_URL),
                fetchUserModels(BACKEND_URL),
            ]);
            setConnections(conns);
            setPresets(ps);
            setUserModels(um.added);
        } catch {
            setError(t('apiProviders.error.loadFailed'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!isOpen) return;
        setView('list');
        setTestResult(null);
        setPickerModels([]);
        setPickerChecked(new Set());
        setPickerDirty(false);
        setPickerError(null);
        setDeleteTarget(null);
        reload();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    const currentPreset = useMemo(
        () => presets.find(p => p.id === form.preset) ?? null,
        [presets, form.preset]
    );
    const savedInstructionPreset = editingId
        ? connections.find(connection => connection.id === editingId)?.preset ?? form.preset
        : form.preset;

    const modelCountOf = (connectionId: string) =>
        userModels.filter(m => m.connectionId === connectionId).length;

    const resolveApiError = (err: unknown, fallbackKey: string): string => {
        const messageKey = (err as { response?: { data?: { messageKey?: string } } })?.response?.data?.messageKey;
        return t(messageKey || fallbackKey);
    };

    // ---- 編集フォーム ----

    const openCreate = () => {
        const preset = presets.find(p => p.id === 'openrouter') ?? presets[0] ?? null;
        setEditingId(null);
        setForm(emptyForm(preset));
        setFormError(null);
        setExtraParamError(null);
        setTestResult(null);
        setPickerModels([]);
        setPickerChecked(new Set());
        setPickerDirty(false);
        setPickerError(null);
        setView('edit');
    };

    const openEdit = (conn: ApiProviderConnection) => {
        setEditingId(conn.id);
        setForm({
            preset: conn.preset,
            label: conn.label,
            baseUrl: conn.baseUrl,
            authScheme: conn.authScheme,
            enabled: conn.enabled,
            forceNonStreaming: !!conn.forceNonStreaming,
            extraParams: Object.entries(conn.extraParams ?? {}).map(([key, value]) => ({
                key,
                value: JSON.stringify(value),
            })),
            // フォームを開き直したら常に未変更へリセット（削除予定を持ち越さない）
            keyState: 'unchanged',
            keyInput: '',
        });
        setFormError(null);
        setExtraParamError(null);
        setTestResult(null);
        const registeredModels = userModels.filter(model => model.connectionId === conn.id);
        setPickerModels(registeredModels.flatMap(model => (
            model.remoteModelId
                ? [{ id: model.remoteModelId, name: model.name || model.description }]
                : []
        )));
        setPickerChecked(new Set(registeredModels.flatMap(model => model.remoteModelId ? [model.remoteModelId] : [])));
        setPickerDirty(false);
        setPickerError(null);
        setPickerSearch('');
        setPickerManualId('');
        setView('edit');
    };

    const applyPreset = (presetId: string) => {
        const preset = presets.find(p => p.id === presetId);
        setForm(prev => ({
            ...prev,
            preset: presetId,
            baseUrl: preset?.baseUrl || prev.baseUrl,
            authScheme: preset?.authScheme || prev.authScheme,
        }));
    };

    /** フォーム内容を保存し、保存後の接続（採番済みID込み）を返す。失敗は null。 */
    const saveForm = async (): Promise<ApiProviderConnection | null> => {
        const extra = buildExtraParams(form.extraParams);
        if (extra.errorKey) {
            if (extra.errorRow !== undefined) {
                setExtraParamError({ row: extra.errorRow, message: t(extra.errorKey) });
            } else {
                setFormError(t(extra.errorKey));
            }
            return null;
        }
        setExtraParamError(null);
        const payload: ApiProviderSaveRequest = {
            preset: form.preset,
            label: form.label,
            baseUrl: form.baseUrl,
            authScheme: form.authScheme,
            enabled: form.enabled,
            forceNonStreaming: form.forceNonStreaming,
            extraParams: extra.params,
        };
        // 送信規則: 未変更=省略／上書き入力中=非空 apiKey／削除予定=clearApiKey
        Object.assign(payload, apiKeyPayload(form.keyState, form.keyInput));
        setSaving(true);
        setFormError(null);
        try {
            const saved = editingId
                ? await updateApiProvider(BACKEND_URL, editingId, payload)
                : await createApiProvider(BACKEND_URL, payload);
            setEditingId(saved.id);
            setForm(prev => ({ ...prev, keyState: 'unchanged', keyInput: '' }));
            await reload();
            return saved;
        } catch (err) {
            setFormError(resolveApiError(err, 'apiProviders.error.saveFailed'));
            return null;
        } finally {
            setSaving(false);
        }
    };

    const handleSaveAndBack = async () => {
        const saved = await saveForm();
        if (!saved) return;
        if (pickerDirty && !(await savePickerModels(saved.id))) return;
        setView('list');
        setTestResult(null);
    };

    // ---- 接続テスト（自動保存方式） ----

    const handleTest = async () => {
        setTesting(true);
        setTestResult(null);
        try {
            const saved = await saveForm();
            if (!saved) {
                setTestResult({
                    success: false,
                    models: [],
                    supportsModelsApi: false,
                    messageKey: 'apiProviders.testSaveFailed',
                    failureKind: 'save_failed',
                });
                return;
            }
            const result = await testApiProvider(BACKEND_URL, saved.id);
            setTestResult(result);
            if (result.success) {
                // 登録済みモデルを初期チェック状態へ反映する。
                const registeredModels = userModels.filter(model => model.connectionId === saved.id);
                const registered = new Set(registeredModels.map(model => model.remoteModelId ?? ''));
                const mergedModels = new Map<string, ApiProviderTestModel>();
                for (const model of registeredModels) {
                    if (model.remoteModelId) {
                        mergedModels.set(model.remoteModelId, {
                            id: model.remoteModelId,
                            name: model.name || model.description,
                        });
                    }
                }
                for (const model of result.models) mergedModels.set(model.id, model);
                setPickerModels([...mergedModels.values()]);
                setPickerChecked(new Set([...registered].filter(Boolean)));
                setPickerDirty(false);
                setPickerSearch('');
                setPickerManualId('');
            }
        } catch (err) {
            setTestResult({
                success: false,
                models: [],
                supportsModelsApi: false,
                messageKey: 'apiProviders.testFailedOther',
                failureKind: 'invalid_response',
                details: undefined,
            });
            void err;
        } finally {
            setTesting(false);
        }
    };

    // ---- モデルピッカー保存（全置換APIへのマージ手順） ----

    const savePickerModels = async (connectionId: string): Promise<boolean> => {
        setPickerSaving(true);
        setPickerError(null);
        try {
            // 1) 保存直前に最新の added / hidden を取得（開きっぱなし競合の緩和）。
            //    ModelListEditorModal と同時編集した場合は「後勝ち」（全置換APIの性質。
            //    フェーズ1ではこれ以上の排他はしない）。
            const latest = await fetchUserModels(BACKEND_URL);
            // 2) 対象 ConnectionID の行集合だけを今回のチェック状態で差分更新。
            const merged = mergeApiProviderModels(latest, connectionId, pickerChecked);
            // 3) 他 ConnectionID・他 provider の added と既存 hidden は不変更のまま
            // 4) 全体 POST → 5) 正規化済みレスポンスで状態更新
            const result = await saveUserModels(BACKEND_URL, {
                added: merged.added,
                hidden: merged.hidden,
            });
            setUserModels(result.added);
            setPickerDirty(false);
            onModelsChanged?.();
            return true;
        } catch (err) {
            setPickerError(resolveApiError(err, 'apiProviders.error.saveFailed'));
            return false;
        } finally {
            setPickerSaving(false);
        }
    };

    // ---- 有効/無効・削除 ----

    const handleToggleEnabled = async (conn: ApiProviderConnection) => {
        try {
            await updateApiProvider(BACKEND_URL, conn.id, {
                preset: conn.preset,
                label: conn.label,
                baseUrl: conn.baseUrl,
                authScheme: conn.authScheme,
                enabled: !conn.enabled,
                forceNonStreaming: conn.forceNonStreaming,
                extraParams: conn.extraParams,
            });
            await reload();
        } catch (err) {
            setError(resolveApiError(err, 'apiProviders.error.saveFailed'));
        }
    };

    const handleDeleteRequest = async (conn: ApiProviderConnection) => {
        try {
            const dryRun = await dryRunDeleteApiProvider(BACKEND_URL, conn.id);
            setDeleteTarget({ id: conn.id, label: conn.label, dryRun });
        } catch {
            // dryRun 取得失敗時はエラー表示し、削除へ進ませない。
            setError(t('apiProviders.error.dryRunFailed'));
        }
    };

    const handleDeleteExecute = async () => {
        if (!deleteTarget) return;
        setDeleting(true);
        try {
            await deleteApiProvider(BACKEND_URL, deleteTarget.id);
            setDeleteTarget(null);
            await reload();
            onModelsChanged?.();
        } catch (err) {
            const data = (err as { response?: { data?: { messageKey?: string; details?: { step?: number; total?: number } } } })?.response?.data;
            let deleteError: string;
            if (data?.messageKey === 'apiProviders.error.cascadeStepFailed' && data.details) {
                deleteError = formatText(t('apiProviders.error.cascadeStepFailed'), {
                    step: data.details.step ?? 0,
                    total: data.details.total ?? 0,
                });
            } else {
                deleteError = resolveApiError(err, 'apiProviders.error.deleteFailed');
            }
            setDeleteTarget(null);
            await reload();
            // reload は一覧取得開始時に旧エラーを消すため、削除診断は再読込後に表示する。
            setError(deleteError);
        } finally {
            setDeleting(false);
        }
    };

    if (!isOpen) return null;

    const noticeKeys = currentPreset?.noticeKeys ?? [];

    const renderModelPicker = () => (
        <div className="border border-line-strong rounded-lg p-3 space-y-2">
            <h4 className="text-sm text-fg">{t(K.pickerTitle)}</h4>
            {pickerError && (
                <p className="text-sm text-danger bg-danger/10 border border-danger/40 rounded px-3 py-2" role="alert">
                    {pickerError}
                </p>
            )}
            {pickerModels.length > 0 && (
                <input
                    type="text"
                    value={pickerSearch}
                    onChange={e => setPickerSearch(e.target.value)}
                    placeholder={t(K.pickerSearch)}
                    className="w-full bg-surface border border-line-strong rounded px-2 py-1.5 text-xs text-fg outline-none focus:border-accent"
                />
            )}
            <div className="max-h-48 overflow-y-auto custom-scrollbar space-y-0.5">
                {pickerModels
                    .filter(m => pickerSearch === '' || m.id.toLowerCase().includes(pickerSearch.toLowerCase()))
                    .map(m => (
                        <label key={m.id} className="flex items-center gap-2 text-xs text-fg-muted cursor-pointer hover:bg-surface rounded px-1 py-0.5">
                            <input
                                type="checkbox"
                                checked={pickerChecked.has(m.id)}
                                onChange={e => setPickerChecked(prev => {
                                    const next = new Set(prev);
                                    if (e.target.checked) next.add(m.id); else next.delete(m.id);
                                    setPickerError(null);
                                    setPickerDirty(true);
                                    return next;
                                })}
                            />
                            <span className="font-mono break-all">{m.id}</span>
                            {m.name && <span className="text-fg-muted">{m.name}</span>}
                            {userModels.some(um => um.connectionId === editingId && um.remoteModelId === m.id) && (
                                <span className="text-xs text-ok">{t(K.pickerRegistered)}</span>
                            )}
                        </label>
                    ))}
            </div>
            <div className="flex items-center gap-2">
                <input
                    type="text"
                    value={pickerManualId}
                    onChange={e => setPickerManualId(e.target.value)}
                    placeholder={t(K.pickerManual)}
                    className="flex-1 bg-surface border border-line-strong rounded px-2 py-1.5 text-xs text-fg outline-none focus:border-accent font-mono"
                />
                <button
                    onClick={() => {
                        const id = pickerManualId.trim();
                        if (id === '') return;
                        setPickerChecked(prev => new Set(prev).add(id));
                        setPickerError(null);
                        setPickerModels(prev => prev.some(model => model.id === id)
                            ? prev
                            : [...prev, { id }]);
                        setPickerDirty(true);
                        setPickerManualId('');
                    }}
                    className="px-2 py-1.5 text-xs bg-surface-2 hover:bg-surface-2 rounded text-fg shrink-0"
                >
                    {t(K.pickerManualAdd)}
                </button>
            </div>
            <p className="text-xs text-fg-muted">{t('apiProviders.saveHint')}</p>
        </div>
    );

    return (
        <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="bg-surface-solid rounded-xl shadow-2xl w-full max-w-2xl border border-line-strong overflow-hidden flex flex-col max-h-[85vh]">
                {/* ヘッダー */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-line-strong bg-surface shrink-0">
                    <div className="flex items-center gap-2">
                        <Plug size={18} className="text-accent" />
                        <h3 className="font-semibold text-fg text-base">{t(K.title)}</h3>
                    </div>
                    <button
                        onClick={onClose}
                        aria-label={t(K.closeAria)}
                        className="p-1.5 hover:bg-surface-2 rounded text-fg-muted hover:text-fg transition-colors"
                    >
                        <X size={18} />
                    </button>
                </div>

                <div className="p-5 space-y-4 overflow-y-auto custom-scrollbar">
                    {error && (
                        <p className="text-sm text-danger bg-danger/10 border border-danger/40 rounded px-3 py-2">{error}</p>
                    )}

                    {view === 'list' && (
                        <>
                            <button
                                onClick={openCreate}
                                className="flex items-center gap-2 px-3 py-2 bg-accent hover:brightness-110 rounded-lg text-sm text-on-accent transition-colors"
                            >
                                <Plus size={16} />
                                {t(K.add)}
                            </button>

                            {loading && (
                                <p className="text-sm text-fg-muted flex items-center gap-2">
                                    <Loader2 size={14} className="animate-spin" />{t(K.loading)}
                                </p>
                            )}
                            {!loading && connections.length === 0 && (
                                <p className="text-sm text-fg-muted">{t(K.emptyState)}</p>
                            )}

                            {connections.map(conn => (
                                <div
                                    key={conn.id}
                                    className={`border rounded-lg p-3 space-y-1 ${conn.enabled ? 'border-line-strong bg-surface' : 'border-line bg-surface opacity-60'}`}
                                >
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-medium text-fg">{conn.label}</span>
                                        <span className="text-xs text-fg-muted">{conn.preset}</span>
                                        {!conn.enabled && (
                                            <span className="text-xs px-1.5 py-0.5 rounded bg-surface-2 text-fg-muted">{t(K.disabledBadge)}</span>
                                        )}
                                    </div>
                                    <p className="text-xs text-fg-muted break-all">{conn.baseUrl}</p>
                                    <p className="text-xs text-fg-muted">
                                        {formatSlashPair(uiCatalog, conn.hasApiKey ? t(K.keyStatusSet) : t(K.keyStatusUnset), formatText(t(K.modelCount), { n: modelCountOf(conn.id) }))}
                                    </p>
                                    <div className="flex flex-wrap gap-2 pt-1">
                                        <button onClick={() => openEdit(conn)} className="flex items-center gap-1 px-2 py-1 text-xs bg-surface-2 hover:bg-surface-2 rounded text-fg">
                                            <Pencil size={12} />{t(K.edit)}
                                        </button>
                                        <button onClick={() => handleToggleEnabled(conn)} className="flex items-center gap-1 px-2 py-1 text-xs bg-surface-2 hover:bg-surface-2 rounded text-fg">
                                            <Power size={12} />{conn.enabled ? t(K.disable) : t(K.enable)}
                                        </button>
                                        <button onClick={() => handleDeleteRequest(conn)} className="flex items-center gap-1 px-2 py-1 text-xs bg-danger/10 hover:brightness-110 rounded text-danger">
                                            <Trash2 size={12} />{t(K.delete)}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </>
                    )}

                    {view === 'edit' && (
                        <div className="space-y-4">
                            {formError && (
                                <p className="text-sm text-danger bg-danger/10 border border-danger/40 rounded px-3 py-2">{formError}</p>
                            )}

                            {/* プリセット */}
                            <div>
                                <label className="text-xs text-fg-muted block mb-1">{t(K.preset)}</label>
                                <select
                                    value={form.preset}
                                    onChange={e => applyPreset(e.target.value)}
                                    className="w-full bg-surface border border-line-strong rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-accent"
                                >
                                    {presets.map(p => (
                                        <option key={p.id} value={p.id}>{t(p.labelKey)}</option>
                                    ))}
                                </select>
                            </div>

                            {/* 表示名・ベースURL・認証方式 */}
                            <div>
                                <label className="text-xs text-fg-muted block mb-1">{t(K.label)}</label>
                                <input
                                    type="text"
                                    value={form.label}
                                    onChange={e => setForm(prev => ({ ...prev, label: e.target.value }))}
                                    className="w-full bg-surface border border-line-strong rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-accent"
                                />
                            </div>
                            <div>
                                <label className="text-xs text-fg-muted block mb-1">{t(K.baseUrl)}</label>
                                <input
                                    type="text"
                                    value={form.baseUrl}
                                    onChange={e => setForm(prev => ({ ...prev, baseUrl: e.target.value }))}
                                    className="w-full bg-surface border border-line-strong rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-accent font-mono"
                                />
                            </div>
                            <div>
                                <label className="text-xs text-fg-muted block mb-1">{t(K.authScheme)}</label>
                                <select
                                    value={form.authScheme}
                                    onChange={e => setForm(prev => ({ ...prev, authScheme: e.target.value }))}
                                    className="w-full bg-surface border border-line-strong rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-accent"
                                >
                                    {AUTH_SCHEMES.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                            </div>

                            {/* APIキー（3状態機械） */}
                            <div>
                                <label className="text-xs text-fg-muted block mb-1">{t(K.apiKey)}</label>
                                <div className="flex items-center gap-2">
                                    <div className="flex-1 min-w-0">
                                        {form.keyState === 'clearPending' ? (
                                            <div className="flex items-center gap-2 min-h-10">
                                                <span className="text-xs text-warn">{t(K.apiKeyClearPending)}</span>
                                                <button
                                                    onClick={() => setForm(prev => ({ ...prev, keyState: 'entering', keyInput: '' }))}
                                                    className="text-xs text-accent hover:underline"
                                                >
                                                    {t(K.apiKeyReenter)}
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="password"
                                                    value={form.keyInput}
                                                    placeholder={connections.find(c => c.id === editingId)?.hasApiKey
                                                        ? t(K.apiKeyPlaceholderSet)
                                                        : t(K.apiKeyPlaceholderNew)}
                                                    onChange={e => setForm(prev => ({
                                                        ...prev,
                                                        keyInput: e.target.value,
                                                        keyState: apiKeyStateAfterInput(e.target.value),
                                                    }))}
                                                    className="flex-1 min-w-0 bg-surface border border-line-strong rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-accent font-mono"
                                                />
                                                {connections.find(c => c.id === editingId)?.hasApiKey && (
                                                    <button
                                                        onClick={() => setKeyClearConfirmOpen(true)}
                                                        className="px-2 py-1.5 text-xs bg-danger/10 hover:brightness-110 rounded text-danger shrink-0"
                                                    >
                                                        {t(K.apiKeyClear)}
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                    <button
                                        onClick={handleTest}
                                        disabled={testing || saving}
                                        className="flex items-center gap-1 px-3 py-2 text-sm bg-accent hover:brightness-110 rounded-lg text-on-accent disabled:opacity-50 shrink-0"
                                    >
                                        {testing ? <Loader2 size={14} className="animate-spin" /> : <Radio size={14} />}
                                        {t(K.test)}
                                    </button>
                                </div>
                                <p className="text-xs text-fg-muted mt-1">{t(K.apiKeyNote)}</p>
                                <p className="text-xs text-fg-muted mt-1">{t(K.testAutoSaveNote)}</p>
                            </div>

                            {/* APIキーの直下で疎通結果と利用モデルを確認・選択する。 */}
                            {testResult && !testResult.success && (
                                <div className="text-sm text-danger bg-danger/10 border border-danger/40 rounded px-3 py-2 space-y-1">
                                    <p>{t(testResult.messageKey || 'apiProviders.testFailedOther')}</p>
                                    {testResult.details && (
                                        <p className="text-xs text-danger/80 break-all">{testResult.details}</p>
                                    )}
                                </div>
                            )}
                            {testResult?.success && (
                                <p className="text-sm text-ok">{t(K.testSuccess)}</p>
                            )}
                            {editingId && (
                                pickerModels.length > 0
                                || testResult?.success
                                || testResult?.failureKind === 'models_unavailable'
                            ) && renderModelPicker()}
                            {testResult && !testResult.success && testResult.failureKind === 'models_unavailable' && (
                                <p className="text-xs text-fg-muted">{t(K.testModelsUnavailable)}</p>
                            )}

                            {/* SSE無効 */}
                            <label className="flex items-center gap-2 text-sm text-fg-muted cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={form.forceNonStreaming}
                                    onChange={e => setForm(prev => ({ ...prev, forceNonStreaming: e.target.checked }))}
                                />
                                {t(K.forceNonStreaming)}
                            </label>
                            <p className="text-xs text-fg-muted -mt-2">{t(K.forceNonStreamingNote)}</p>

                            {/* 拡張パラメータ（JSON値入力） */}
                            <div>
                                <label className="text-xs text-fg-muted block mb-1">{t(K.extraParams)}</label>
                                <p className="text-xs text-fg-muted mb-1">{t(K.extraParamsNote)}</p>
                                {form.extraParams.map((row, i) => (
                                    <React.Fragment key={i}>
                                    <div className="flex items-center gap-2 mb-1">
                                        <input
                                            type="text"
                                            value={row.key}
                                            onChange={e => setForm(prev => {
                                                const rows = [...prev.extraParams];
                                                rows[i] = { ...rows[i], key: e.target.value };
                                                return { ...prev, extraParams: rows };
                                            })}
                                            onInput={() => { if (extraParamError?.row === i) setExtraParamError(null); }}
                                            className="w-1/3 bg-surface border border-line-strong rounded px-2 py-1.5 text-xs text-fg outline-none focus:border-accent font-mono"
                                        />
                                        <input
                                            type="text"
                                            value={row.value}
                                            onChange={e => setForm(prev => {
                                                const rows = [...prev.extraParams];
                                                rows[i] = { ...rows[i], value: e.target.value };
                                                return { ...prev, extraParams: rows };
                                            })}
                                            onInput={() => { if (extraParamError?.row === i) setExtraParamError(null); }}
                                            className="flex-1 bg-surface border border-line-strong rounded px-2 py-1.5 text-xs text-fg outline-none focus:border-accent font-mono"
                                        />
                                        <button
                                            onClick={() => setForm(prev => ({
                                                ...prev,
                                                extraParams: prev.extraParams.filter((_, idx) => idx !== i),
                                            }))}
                                            className="text-xs text-fg-muted hover:text-danger shrink-0"
                                        >
                                            {t(K.extraParamsRemoveRow)}
                                        </button>
                                    </div>
                                    {extraParamError?.row === i && (
                                        <p className="text-xs text-danger mb-1" role="alert">{extraParamError.message}</p>
                                    )}
                                    </React.Fragment>
                                ))}
                                <button
                                    onClick={() => setForm(prev => ({ ...prev, extraParams: [...prev.extraParams, { key: '', value: '' }] }))}
                                    className="text-xs text-accent hover:underline"
                                >
                                    {t(K.extraParamsAddRow)}
                                </button>
                            </div>

                            {/* API基本指示は設定ファイルエディタで編集する。 */}
                            <div className="border-t border-line-strong pt-3">
                                <label className="text-xs text-fg-muted block mb-1">{t(K.systemPrompt)}</label>
                                {!editingId ? (
                                    <p className="text-xs text-fg-muted">{t(K.systemPromptSaveFirst)}</p>
                                ) : (
                                    <div className="space-y-2">
                                        <p className="text-xs text-fg-muted">{t(K.systemPromptEditorNote)}</p>
                                        <div className="flex flex-wrap gap-2">
                                            <button
                                                onClick={() => onOpenInstruction?.({ connectionId: editingId, preset: savedInstructionPreset, locale: 'ja' })}
                                                className="px-2 py-1.5 text-xs bg-surface-2 hover:bg-surface-2 rounded text-fg"
                                            >
                                                {t(K.systemPromptOpenJa)}
                                            </button>
                                            <button
                                                onClick={() => onOpenInstruction?.({ connectionId: editingId, preset: savedInstructionPreset, locale: 'en' })}
                                                className="px-2 py-1.5 text-xs bg-surface-2 hover:bg-surface-2 rounded text-fg"
                                            >
                                                {t(K.systemPromptOpenEn)}
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* 注意書き（NoticeKeys。常時表示） */}
                            <div className="space-y-1">
                                {noticeKeys.map(key => (
                                    <p key={key} className="text-xs text-warn/80 bg-warn/10 border border-warn/40 rounded px-2 py-1.5">
                                        {t(key)}
                                    </p>
                                ))}
                            </div>

                            {/* 保存 */}
                            <div className="flex flex-wrap gap-2">
                                <button
                                    onClick={handleSaveAndBack}
                                    disabled={saving || pickerSaving}
                                    className="flex items-center gap-1 px-3 py-2 text-sm bg-accent hover:brightness-110 rounded-lg text-on-accent disabled:opacity-50"
                                >
                                    {saving || pickerSaving ? <Loader2 size={14} className="animate-spin" /> : null}
                                    {saving || pickerSaving ? t(K.saving) : t(K.save)}
                                </button>
                                <button
                                    onClick={() => { setView('list'); setTestResult(null); }}
                                    className="px-3 py-2 text-sm bg-surface-2 hover:bg-surface-2 rounded-lg text-fg"
                                >
                                    {t(K.cancel)}
                                </button>
                            </div>

                        </div>
                    )}
                </div>
            </div>

            {/* APIキー削除確認（破壊的操作は確認ダイアログ必須） */}
            {keyClearConfirmOpen && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
                    <div className="bg-surface rounded-xl border border-line-strong p-5 w-full max-w-sm space-y-3">
                        <h4 className="text-sm font-semibold text-fg">{t(K.keyClearConfirmTitle)}</h4>
                        <p className="text-sm text-fg-muted">{t(K.keyClearConfirmBody)}</p>
                        <div className="flex justify-end gap-2">
                            <button
                                onClick={() => setKeyClearConfirmOpen(false)}
                                className="px-3 py-1.5 text-sm bg-surface-2 hover:bg-surface-2 rounded text-fg"
                            >
                                {t(K.cancel)}
                            </button>
                            <button
                                onClick={() => {
                                    // 上書き入力中でも入力値を破棄して削除予定へ遷移する。
                                    setForm(prev => ({ ...prev, keyState: 'clearPending', keyInput: '' }));
                                    setKeyClearConfirmOpen(false);
                                }}
                                className="px-3 py-1.5 text-sm bg-danger hover:brightness-110 rounded text-danger"
                            >
                                {t(K.apiKeyClear)}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 削除確認（dryRun 連動） */}
            {deleteTarget && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
                    <div className="bg-surface rounded-xl border border-line-strong p-5 w-full max-w-md space-y-3">
                        <h4 className="text-sm font-semibold text-fg">{t(K.deleteConfirmTitle)}</h4>
                        <p className="text-sm text-fg-muted">{deleteTarget.label}</p>
                        <p className="text-sm text-fg-muted">{t(K.deleteConfirmBody)}</p>
                        <ul className="text-xs text-fg-muted list-disc pl-5 space-y-1">
                            {deleteTarget.dryRun.userModels.length > 0 && (
                                <li>
                                    {t(K.deleteConfirmModels)}:
                                    <ul className="pl-3 pt-0.5 space-y-0.5">
                                        {deleteTarget.dryRun.userModels.map(id => (
                                            <li key={id} className="font-mono break-all">{id}</li>
                                        ))}
                                    </ul>
                                </li>
                            )}
                            {deleteTarget.dryRun.isDefaultModel && <li>{t(K.deleteConfirmDefault)}</li>}
                            {deleteTarget.dryRun.deletesConnectionPrompts && <li>{t(K.deleteConfirmSystemPrompt)}</li>}
                        </ul>
                        <div className="flex justify-end gap-2">
                            <button
                                onClick={() => setDeleteTarget(null)}
                                className="px-3 py-1.5 text-sm bg-surface-2 hover:bg-surface-2 rounded text-fg"
                            >
                                {t(K.cancel)}
                            </button>
                            <button
                                onClick={handleDeleteExecute}
                                disabled={deleting}
                                className="flex items-center gap-1 px-3 py-1.5 text-sm bg-danger hover:brightness-110 rounded text-danger disabled:opacity-50"
                            >
                                {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                                {t(K.deleteExecute)}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
