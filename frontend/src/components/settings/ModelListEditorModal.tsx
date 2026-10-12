/**
 * ModelListEditorModal.tsx - モデル一覧の編集モーダル
 *
 * モデル一覧の正本（内蔵デフォルト＋ユーザー設定のマージ）をプロバイダ毎に表示し、
 * ユーザーによるモデルIDの追加・削除（内蔵は非表示化）と疎通確認を行う。
 * Gemini系はThinkingエイリアス（ベースモデル＋Thinking Level）の追加に対応する。
 *
 * 変更は「保存」で確定（POST /api/models/user の全置換保存）。
 * 疎通確認はGemini Thinkingエイリアスの反映が保存後になるため、未保存変更があれば
 * 先に自動保存してから ping を投げる。
 */

import React, { useState, useEffect } from 'react';
import { X, ListPlus, Trash2, RotateCcw, Radio, Loader2 } from 'lucide-react';
import { fetchUserModels, saveUserModels, pingModel, type UserModel } from '../../api/user-models';
import { BACKEND_URL } from '../../api/base-url';
import { resolveMessage, type I18NCatalog } from '../../api/i18n';
import { API_PROVIDERS_TEXT_FALLBACK_JA, COMMON_I18N_KEYS, COMMON_TEXT_FALLBACK_JA, SETTINGS_I18N_KEYS, SETTINGS_TEXT_FALLBACK_JA } from '../../constants/i18n';
import { getModelProvider, modelProviderOf, type Model, type ModelProvider } from '../../hooks/useChat';
import { openAICompatLabel } from '../../constants/providers';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    uiCatalog?: I18NCatalog | null;
    /** 保存成功後に親がモデル一覧（/api/models）を再取得するためのフック */
    onSaved?: () => void;
}

const PROVIDER_SECTIONS: { provider: ModelProvider; label: string; color: string; hintKey?: string }[] = [
    { provider: 'antigravity', label: 'Antigravity', color: 'text-accent' },
    { provider: 'claude', label: 'Claude', color: 'text-accent' },
    { provider: 'gemini', label: 'Gemini', color: 'text-accent' },
    // openai_compat のモデル追加は接続先管理の接続テスト（ピッカー）から行う。
    // API の名前は製品名ではないので、表示時に表示言語の文言表から引く（label はその予備）
    { provider: 'openai_compat', label: 'API (OpenAI-compatible)', color: 'text-ok', hintKey: 'modelListEditor.openaiCompatHint' },
];

type PingState = { status: 'running' } | { status: 'success' | 'failure'; message: string };

export const ModelListEditorModal: React.FC<Props> = ({ isOpen, onClose, uiCatalog = null, onSaved }) => {
    const t = (key: string) => resolveMessage(
        uiCatalog,
        key,
        SETTINGS_TEXT_FALLBACK_JA[key] || COMMON_TEXT_FALLBACK_JA[key] || API_PROVIDERS_TEXT_FALLBACK_JA[key] || key
    );
    const providerSections = PROVIDER_SECTIONS.map(s => (
        s.provider === 'openai_compat' ? { ...s, label: openAICompatLabel(uiCatalog) } : s
    ));
    const formatText = (template: string, values: Record<string, string | number>) => {
        return Object.entries(values).reduce((text, [key, value]) => {
            return text.split(`{{${key}}}`).join(String(value));
        }, template);
    };

    const [builtin, setBuiltin] = useState<Model[]>([]);
    const [added, setAdded] = useState<UserModel[]>([]);
    const [hidden, setHidden] = useState<string[]>([]);
    const [isDirty, setIsDirty] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // 新規追加フォーム
    const [newId, setNewId] = useState('');
    const [newName, setNewName] = useState('');
    const [newDescription, setNewDescription] = useState('');
    const [newProvider, setNewProvider] = useState<'' | ModelProvider>('');
    const [thinkingBase, setThinkingBase] = useState('');
    const [thinkingLevel, setThinkingLevel] = useState<'' | 'high' | 'medium' | 'low'>('');

    // 疎通確認の状態（モデルID毎）
    const [pingStates, setPingStates] = useState<Record<string, PingState>>({});

    useEffect(() => {
        if (!isOpen) return;
        setError(null);
        setPingStates({});
        fetchUserModels(BACKEND_URL)
            .then(data => {
                setBuiltin(data.builtin || []);
                setAdded(data.added || []);
                setHidden(data.hidden || []);
                setIsDirty(false);
            })
            .catch(() => setError(t(SETTINGS_I18N_KEYS.modelEditorLoadError)));
    }, [isOpen]);

    // apierror 形式（{ error, messageKey }）を利用者向け文言へ解決する。
    const resolveApiError = (err: unknown, fallbackKey: string): string => {
        const data = (err as { response?: { data?: { error?: string; messageKey?: string } } })?.response?.data;
        const key = data?.messageKey || data?.error;
        if (key) return resolveMessage(uiCatalog, key, t(fallbackKey));
        return t(fallbackKey);
    };

    // 実効プロバイダ。明示選択を優先し、自動判定選択時はIDプレフィックスから推定する。
    const newIdProvider = newProvider || getModelProvider(newId.trim());

    const handleAdd = () => {
        const id = newId.trim();
        setError(null);
        if (!id) {
            setError(t(SETTINGS_I18N_KEYS.modelEditorIdRequired));
            return;
        }
        if (builtin.some(m => m.id === id) || added.some(m => m.id === id)) {
            setError(t(SETTINGS_I18N_KEYS.modelEditorDuplicateId));
            return;
        }
        const model: UserModel = { id };
        if (newName.trim()) model.name = newName.trim();
        if (newDescription.trim()) model.description = newDescription.trim();
        if (newProvider) model.provider = newProvider;
        if (newIdProvider === 'gemini' && thinkingBase.trim() && thinkingLevel) {
            model.geminiBase = thinkingBase.trim();
            model.thinkingLevel = thinkingLevel;
        }
        setAdded(prev => [...prev, model]);
        setIsDirty(true);
        setNewId('');
        setNewName('');
        setNewDescription('');
        setNewProvider('');
        setThinkingBase('');
        setThinkingLevel('');
    };

    const handleRemoveAdded = (id: string) => {
        setAdded(prev => prev.filter(m => m.id !== id));
        setIsDirty(true);
    };

    const handleHideBuiltin = (id: string) => {
        setHidden(prev => (prev.includes(id) ? prev : [...prev, id]));
        setIsDirty(true);
    };

    const handleRestoreBuiltin = (id: string) => {
        setHidden(prev => prev.filter(h => h !== id));
        setIsDirty(true);
    };

    // 保存本体。疎通確認前の自動保存と保存ボタンの両方から呼ぶ。
    const save = async (): Promise<boolean> => {
        setIsSaving(true);
        setError(null);
        try {
            const result = await saveUserModels(BACKEND_URL, { added, hidden });
            setAdded(result.added || []);
            setHidden(result.hidden || []);
            setIsDirty(false);
            onSaved?.();
            return true;
        } catch (err) {
            setError(resolveApiError(err, SETTINGS_I18N_KEYS.modelEditorSaveError));
            return false;
        } finally {
            setIsSaving(false);
        }
    };

    const handleSave = async () => {
        await save();
    };

    const handlePing = async (id: string) => {
        setError(null);
        // Gemini Thinkingエイリアスは保存後に反映されるため、未保存変更は先に確定する。
        if (isDirty && !(await save())) return;
        setPingStates(prev => ({ ...prev, [id]: { status: 'running' } }));
        try {
            const result = await pingModel(BACKEND_URL, id);
            if (result.success) {
                setPingStates(prev => ({
                    ...prev,
                    [id]: {
                        status: 'success',
                        message: formatText(t(SETTINGS_I18N_KEYS.modelEditorPingSuccess), {
                            elapsed: (result.elapsedMs / 1000).toFixed(1),
                            output: result.output || '',
                        }),
                    },
                }));
            } else {
                const reason = result.error ? resolveMessage(uiCatalog, result.error, result.error) : '';
                setPingStates(prev => ({
                    ...prev,
                    [id]: { status: 'failure', message: formatText(t(SETTINGS_I18N_KEYS.modelEditorPingFailure), { error: reason }) },
                }));
            }
        } catch (err) {
            const reason = resolveApiError(err, SETTINGS_I18N_KEYS.modelEditorLoadError);
            setPingStates(prev => ({
                ...prev,
                [id]: { status: 'failure', message: formatText(t(SETTINGS_I18N_KEYS.modelEditorPingFailure), { error: reason }) },
            }));
        }
    };

    if (!isOpen) return null;

    const anyPingRunning = Object.values(pingStates).some(s => s.status === 'running');

    const renderPingResult = (id: string) => {
        const state = pingStates[id];
        if (!state || state.status === 'running') return null;
        return (
            <p className={`text-xs mt-1 break-all ${state.status === 'success' ? 'text-ok' : 'text-danger'}`}>
                {state.message}
            </p>
        );
    };

    const renderPingButton = (id: string) => {
        const running = pingStates[id]?.status === 'running';
        return (
            <button
                onClick={() => handlePing(id)}
                disabled={anyPingRunning || isSaving}
                title={t(SETTINGS_I18N_KEYS.modelEditorPing)}
                className="p-1.5 rounded text-fg-muted hover:text-accent hover:bg-surface-2 disabled:opacity-40 transition-colors shrink-0"
            >
                {running ? <Loader2 size={15} className="animate-spin" /> : <Radio size={15} />}
            </button>
        );
    };

    return (
        <div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="bg-surface-solid rounded-xl shadow-2xl w-full max-w-lg border border-line-strong overflow-hidden flex flex-col max-h-[85vh]">
                {/* ヘッダー */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-line-strong bg-surface shrink-0">
                    <div className="flex items-center gap-2">
                        <ListPlus size={18} className="text-fg-muted" />
                        <h3 className="font-semibold text-fg text-base">{t(SETTINGS_I18N_KEYS.modelEditorTitle)}</h3>
                    </div>
                    <button onClick={onClose} className="p-1.5 hover:bg-surface-2 rounded text-fg-muted hover:text-fg transition-colors">
                        <X size={18} />
                    </button>
                </div>

                <div className="p-5 space-y-5 overflow-y-auto custom-scrollbar">
                    {error && (
                        <p className="text-sm text-danger bg-danger/10 border border-danger/40 rounded px-3 py-2">{error}</p>
                    )}

                    {/* プロバイダ毎の現在リスト */}
                    {providerSections.map(({ provider, label, color, hintKey }) => {
                        const builtinRows = builtin.filter(m => m.id !== '' && modelProviderOf(m) === provider);
                        const addedRows = added.filter(m => modelProviderOf(m) === provider);
                        return (
                            <div key={provider}>
                                <h4 className={`text-xs font-medium uppercase tracking-wide mb-2 ${color}`}>{label}</h4>
                                {hintKey && (
                                    <p className="text-xs text-fg-muted mb-2">{t(hintKey)}</p>
                                )}
                                <div className="space-y-1">
                                    {builtinRows.map(m => {
                                        const isHidden = hidden.includes(m.id);
                                        return (
                                            <div key={m.id} className={`rounded-lg border border-line-strong px-3 py-1.5 ${isHidden ? 'opacity-50 bg-surface' : 'bg-surface'}`}>
                                                <div className="flex items-center gap-2">
                                                    <div className="flex-1 min-w-0">
                                                        <span className="text-sm text-fg break-all">{m.description || m.id}</span>
                                                        <span className="text-xs text-fg-muted ml-2 break-all">{m.id}</span>
                                                    </div>
                                                    {isHidden && (
                                                        <span className="text-xs px-1.5 py-0.5 rounded bg-surface-2 text-fg-muted shrink-0">{t(SETTINGS_I18N_KEYS.modelEditorHiddenBadge)}</span>
                                                    )}
                                                    {renderPingButton(m.id)}
                                                    {isHidden ? (
                                                        <button
                                                            onClick={() => handleRestoreBuiltin(m.id)}
                                                            title={t(SETTINGS_I18N_KEYS.modelEditorRestore)}
                                                            className="p-1.5 rounded text-fg-muted hover:text-ok hover:bg-surface-2 transition-colors shrink-0"
                                                        >
                                                            <RotateCcw size={15} />
                                                        </button>
                                                    ) : (
                                                        <button
                                                            onClick={() => handleHideBuiltin(m.id)}
                                                            title={t(SETTINGS_I18N_KEYS.modelEditorDelete)}
                                                            className="p-1.5 rounded text-fg-muted hover:text-danger hover:bg-surface-2 transition-colors shrink-0"
                                                        >
                                                            <Trash2 size={15} />
                                                        </button>
                                                    )}
                                                </div>
                                                {renderPingResult(m.id)}
                                            </div>
                                        );
                                    })}
                                    {addedRows.map(m => (
                                        <div key={m.id} className="rounded-lg border border-line-strong bg-surface px-3 py-1.5">
                                            <div className="flex items-center gap-2">
                                                <div className="flex-1 min-w-0">
                                                    <span className="text-sm text-fg break-all">{m.name || m.id}</span>
                                                    <span className="text-xs text-fg-muted ml-2 break-all">{m.id}</span>
                                                    {m.geminiBase && (
                                                        <span className="text-xs text-accent/80 ml-2 break-all">{m.geminiBase} / {m.thinkingLevel}</span>
                                                    )}
                                                </div>
                                                <span className="text-xs px-1.5 py-0.5 rounded bg-accent-soft text-accent shrink-0">{t(SETTINGS_I18N_KEYS.modelEditorAddedBadge)}</span>
                                                {renderPingButton(m.id)}
                                                <button
                                                    onClick={() => handleRemoveAdded(m.id)}
                                                    title={t(SETTINGS_I18N_KEYS.modelEditorDelete)}
                                                    className="p-1.5 rounded text-fg-muted hover:text-danger hover:bg-surface-2 transition-colors shrink-0"
                                                >
                                                    <Trash2 size={15} />
                                                </button>
                                            </div>
                                            {renderPingResult(m.id)}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })}

                    {/* 新規追加フォーム */}
                    <div className="pt-4 border-t border-line-strong space-y-2">
                        <h4 className="text-xs font-medium text-fg-muted uppercase tracking-wide">{t(SETTINGS_I18N_KEYS.modelEditorAddSectionTitle)}</h4>
                        {/* プロバイダ選択。未選択（自動判定）はIDプレフィックスから推定する。 */}
                        <div className="flex items-center gap-2">
                            <label className="text-xs text-fg-muted shrink-0">{t(SETTINGS_I18N_KEYS.modelEditorProviderLabel)}</label>
                            <select
                                value={newProvider}
                                onChange={e => setNewProvider(e.target.value as '' | ModelProvider)}
                                className="flex-1 bg-surface border border-line-strong rounded-lg px-2 py-2 text-sm text-fg outline-none focus:border-accent cursor-pointer"
                            >
                                <option value="">{t(SETTINGS_I18N_KEYS.modelEditorProviderAuto)}</option>
                                {providerSections.map(({ provider, label }) => (
                                    <option key={provider} value={provider}>{label}</option>
                                ))}
                            </select>
                        </div>
                        <input
                            type="text"
                            value={newId}
                            onChange={e => setNewId(e.target.value)}
                            placeholder={t(SETTINGS_I18N_KEYS.modelEditorNewIdPlaceholder)}
                            className="w-full bg-surface border border-line-strong rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-accent"
                        />
                        <div className="flex flex-col gap-2 lg:flex-row">
                            <input
                                type="text"
                                value={newName}
                                onChange={e => setNewName(e.target.value)}
                                placeholder={t(SETTINGS_I18N_KEYS.modelEditorNewNamePlaceholder)}
                                className="flex-1 min-w-0 bg-surface border border-line-strong rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-accent"
                            />
                            <input
                                type="text"
                                value={newDescription}
                                onChange={e => setNewDescription(e.target.value)}
                                placeholder={t(SETTINGS_I18N_KEYS.modelEditorNewDescriptionPlaceholder)}
                                className="flex-1 min-w-0 bg-surface border border-line-strong rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-accent"
                            />
                        </div>
                        {newId.trim() !== '' && (
                            <p className="text-xs text-fg-muted">
                                {formatText(t(SETTINGS_I18N_KEYS.modelEditorRouteInfo), {
                                    provider: providerSections.find(s => s.provider === newIdProvider)?.label || newIdProvider,
                                })}
                            </p>
                        )}
                        {newIdProvider === 'antigravity' && (
                            <p className="text-xs text-accent/80">{t(SETTINGS_I18N_KEYS.modelEditorAntigravityHint)}</p>
                        )}
                        {newIdProvider === 'gemini' && newId.trim() !== '' && (
                            <div className="rounded-lg border border-line-strong bg-surface p-3 space-y-2">
                                <p className="text-xs font-medium text-fg-muted">{t(SETTINGS_I18N_KEYS.modelEditorThinkingTitle)}</p>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={thinkingBase}
                                        onChange={e => setThinkingBase(e.target.value)}
                                        placeholder={t(SETTINGS_I18N_KEYS.modelEditorThinkingBasePlaceholder)}
                                        className="flex-1 bg-surface border border-line-strong rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-accent"
                                    />
                                    <select
                                        value={thinkingLevel}
                                        onChange={e => setThinkingLevel(e.target.value as '' | 'high' | 'medium' | 'low')}
                                        className="bg-surface border border-line-strong rounded-lg px-2 py-2 text-sm text-fg outline-none focus:border-accent cursor-pointer"
                                    >
                                        <option value="">{t(SETTINGS_I18N_KEYS.modelEditorThinkingLevelNone)}</option>
                                        <option value="high">High</option>
                                        <option value="medium">Medium</option>
                                        <option value="low">Low</option>
                                    </select>
                                </div>
                                <p className="text-xs text-fg-muted">{t(SETTINGS_I18N_KEYS.modelEditorThinkingHint)}</p>
                            </div>
                        )}
                        <button
                            onClick={handleAdd}
                            className="w-full px-4 py-2 text-sm text-on-accent bg-accent hover:brightness-110 rounded-lg transition-colors"
                        >
                            {t(SETTINGS_I18N_KEYS.modelEditorAddButton)}
                        </button>
                        <p className="text-xs text-fg-muted">{t(SETTINGS_I18N_KEYS.modelEditorUnsavedNote)}</p>
                    </div>
                </div>

                {/* フッター */}
                <div className="flex justify-end gap-3 px-5 py-4 border-t border-line-strong bg-surface shrink-0">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm text-fg-muted hover:text-fg hover:bg-surface-2 rounded-lg transition-colors"
                    >
                        {t(COMMON_I18N_KEYS.cancel)}
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isSaving || !isDirty}
                        className="px-4 py-2 text-sm text-on-accent bg-accent hover:brightness-110 disabled:opacity-50 rounded-lg transition-colors"
                    >
                        {isSaving ? t(SETTINGS_I18N_KEYS.saving) : t(COMMON_I18N_KEYS.save)}
                    </button>
                </div>
            </div>
        </div>
    );
};
