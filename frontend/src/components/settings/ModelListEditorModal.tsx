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
import { COMMON_I18N_KEYS, COMMON_TEXT_FALLBACK_JA, SETTINGS_I18N_KEYS, SETTINGS_TEXT_FALLBACK_JA } from '../../constants/i18n';
import { getModelProvider, modelProviderOf, type Model, type ModelProvider } from '../../hooks/useChat';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    uiCatalog?: I18NCatalog | null;
    /** 保存成功後に親がモデル一覧（/api/models）を再取得するためのフック */
    onSaved?: () => void;
}

const PROVIDER_SECTIONS: { provider: ModelProvider; label: string; color: string }[] = [
    { provider: 'gemini', label: 'Gemini', color: 'text-blue-400' },
    { provider: 'claude', label: 'Claude', color: 'text-orange-400' },
    { provider: 'antigravity', label: 'Antigravity', color: 'text-purple-400' },
];

type PingState = { status: 'running' } | { status: 'success' | 'failure'; message: string };

export const ModelListEditorModal: React.FC<Props> = ({ isOpen, onClose, uiCatalog = null, onSaved }) => {
    const t = (key: string) => resolveMessage(
        uiCatalog,
        key,
        SETTINGS_TEXT_FALLBACK_JA[key] || COMMON_TEXT_FALLBACK_JA[key] || key
    );
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
            <p className={`text-xs mt-1 break-all ${state.status === 'success' ? 'text-green-400' : 'text-red-400'}`}>
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
                className="p-1.5 rounded text-gray-400 hover:text-blue-300 hover:bg-gray-700 disabled:opacity-40 transition-colors shrink-0"
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
            <div className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg border border-gray-700 overflow-hidden flex flex-col max-h-[85vh]">
                {/* ヘッダー */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 bg-gray-800 shrink-0">
                    <div className="flex items-center gap-2">
                        <ListPlus size={18} className="text-gray-400" />
                        <h3 className="font-semibold text-gray-100 text-base">{t(SETTINGS_I18N_KEYS.modelEditorTitle)}</h3>
                    </div>
                    <button onClick={onClose} className="p-1.5 hover:bg-gray-700 rounded text-gray-400 hover:text-gray-200 transition-colors">
                        <X size={18} />
                    </button>
                </div>

                <div className="p-5 space-y-5 overflow-y-auto custom-scrollbar">
                    {error && (
                        <p className="text-sm text-red-400 bg-red-950/30 border border-red-900/50 rounded px-3 py-2">{error}</p>
                    )}

                    {/* プロバイダ毎の現在リスト */}
                    {PROVIDER_SECTIONS.map(({ provider, label, color }) => {
                        const builtinRows = builtin.filter(m => m.id !== '' && modelProviderOf(m) === provider);
                        const addedRows = added.filter(m => modelProviderOf(m) === provider);
                        return (
                            <div key={provider}>
                                <h4 className={`text-xs font-medium uppercase tracking-wide mb-2 ${color}`}>{label}</h4>
                                <div className="space-y-1">
                                    {builtinRows.map(m => {
                                        const isHidden = hidden.includes(m.id);
                                        return (
                                            <div key={m.id} className={`rounded-lg border border-gray-700/60 px-3 py-1.5 ${isHidden ? 'opacity-50 bg-gray-800/40' : 'bg-gray-800'}`}>
                                                <div className="flex items-center gap-2">
                                                    <div className="flex-1 min-w-0">
                                                        <span className="text-sm text-gray-200 break-all">{m.description || m.id}</span>
                                                        <span className="text-xs text-gray-500 ml-2 break-all">{m.id}</span>
                                                    </div>
                                                    {isHidden && (
                                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700 text-gray-400 shrink-0">{t(SETTINGS_I18N_KEYS.modelEditorHiddenBadge)}</span>
                                                    )}
                                                    {renderPingButton(m.id)}
                                                    {isHidden ? (
                                                        <button
                                                            onClick={() => handleRestoreBuiltin(m.id)}
                                                            title={t(SETTINGS_I18N_KEYS.modelEditorRestore)}
                                                            className="p-1.5 rounded text-gray-400 hover:text-green-300 hover:bg-gray-700 transition-colors shrink-0"
                                                        >
                                                            <RotateCcw size={15} />
                                                        </button>
                                                    ) : (
                                                        <button
                                                            onClick={() => handleHideBuiltin(m.id)}
                                                            title={t(SETTINGS_I18N_KEYS.modelEditorDelete)}
                                                            className="p-1.5 rounded text-gray-400 hover:text-red-300 hover:bg-gray-700 transition-colors shrink-0"
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
                                        <div key={m.id} className="rounded-lg border border-blue-800/50 bg-gray-800 px-3 py-1.5">
                                            <div className="flex items-center gap-2">
                                                <div className="flex-1 min-w-0">
                                                    <span className="text-sm text-gray-200 break-all">{m.name || m.id}</span>
                                                    <span className="text-xs text-gray-500 ml-2 break-all">{m.id}</span>
                                                    {m.geminiBase && (
                                                        <span className="text-xs text-blue-400/80 ml-2 break-all">{m.geminiBase} / {m.thinkingLevel}</span>
                                                    )}
                                                </div>
                                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/60 text-blue-300 shrink-0">{t(SETTINGS_I18N_KEYS.modelEditorAddedBadge)}</span>
                                                {renderPingButton(m.id)}
                                                <button
                                                    onClick={() => handleRemoveAdded(m.id)}
                                                    title={t(SETTINGS_I18N_KEYS.modelEditorDelete)}
                                                    className="p-1.5 rounded text-gray-400 hover:text-red-300 hover:bg-gray-700 transition-colors shrink-0"
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
                    <div className="pt-4 border-t border-gray-700 space-y-2">
                        <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wide">{t(SETTINGS_I18N_KEYS.modelEditorAddSectionTitle)}</h4>
                        {/* プロバイダ選択。未選択（自動判定）はIDプレフィックスから推定する。 */}
                        <div className="flex items-center gap-2">
                            <label className="text-xs text-gray-400 shrink-0">{t(SETTINGS_I18N_KEYS.modelEditorProviderLabel)}</label>
                            <select
                                value={newProvider}
                                onChange={e => setNewProvider(e.target.value as '' | ModelProvider)}
                                className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-2 py-2 text-sm text-gray-100 outline-none focus:border-blue-500 cursor-pointer"
                            >
                                <option value="">{t(SETTINGS_I18N_KEYS.modelEditorProviderAuto)}</option>
                                {PROVIDER_SECTIONS.map(({ provider, label }) => (
                                    <option key={provider} value={provider}>{label}</option>
                                ))}
                            </select>
                        </div>
                        <input
                            type="text"
                            value={newId}
                            onChange={e => setNewId(e.target.value)}
                            placeholder={t(SETTINGS_I18N_KEYS.modelEditorNewIdPlaceholder)}
                            className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-100 outline-none focus:border-blue-500"
                        />
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={newName}
                                onChange={e => setNewName(e.target.value)}
                                placeholder={t(SETTINGS_I18N_KEYS.modelEditorNewNamePlaceholder)}
                                className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-100 outline-none focus:border-blue-500"
                            />
                            <input
                                type="text"
                                value={newDescription}
                                onChange={e => setNewDescription(e.target.value)}
                                placeholder={t(SETTINGS_I18N_KEYS.modelEditorNewDescriptionPlaceholder)}
                                className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-100 outline-none focus:border-blue-500"
                            />
                        </div>
                        {newId.trim() !== '' && (
                            <p className="text-xs text-gray-500">
                                {formatText(t(SETTINGS_I18N_KEYS.modelEditorRouteInfo), {
                                    provider: PROVIDER_SECTIONS.find(s => s.provider === newIdProvider)?.label || newIdProvider,
                                })}
                            </p>
                        )}
                        {newIdProvider === 'antigravity' && (
                            <p className="text-xs text-purple-400/80">{t(SETTINGS_I18N_KEYS.modelEditorAntigravityHint)}</p>
                        )}
                        {newIdProvider === 'gemini' && newId.trim() !== '' && (
                            <div className="rounded-lg border border-gray-700/60 bg-gray-800/50 p-3 space-y-2">
                                <p className="text-xs font-medium text-gray-400">{t(SETTINGS_I18N_KEYS.modelEditorThinkingTitle)}</p>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={thinkingBase}
                                        onChange={e => setThinkingBase(e.target.value)}
                                        placeholder={t(SETTINGS_I18N_KEYS.modelEditorThinkingBasePlaceholder)}
                                        className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-100 outline-none focus:border-blue-500"
                                    />
                                    <select
                                        value={thinkingLevel}
                                        onChange={e => setThinkingLevel(e.target.value as '' | 'high' | 'medium' | 'low')}
                                        className="bg-gray-800 border border-gray-600 rounded-lg px-2 py-2 text-sm text-gray-100 outline-none focus:border-blue-500 cursor-pointer"
                                    >
                                        <option value="">{t(SETTINGS_I18N_KEYS.modelEditorThinkingLevelNone)}</option>
                                        <option value="high">High</option>
                                        <option value="medium">Medium</option>
                                        <option value="low">Low</option>
                                    </select>
                                </div>
                                <p className="text-xs text-gray-500">{t(SETTINGS_I18N_KEYS.modelEditorThinkingHint)}</p>
                            </div>
                        )}
                        <button
                            onClick={handleAdd}
                            className="w-full px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors"
                        >
                            {t(SETTINGS_I18N_KEYS.modelEditorAddButton)}
                        </button>
                        <p className="text-xs text-gray-500">{t(SETTINGS_I18N_KEYS.modelEditorUnsavedNote)}</p>
                    </div>
                </div>

                {/* フッター */}
                <div className="flex justify-end gap-3 px-5 py-4 border-t border-gray-700 bg-gray-800/50 shrink-0">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm text-gray-300 hover:text-gray-100 hover:bg-gray-700 rounded-lg transition-colors"
                    >
                        {t(COMMON_I18N_KEYS.cancel)}
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isSaving || !isDirty}
                        className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg transition-colors"
                    >
                        {isSaving ? t(SETTINGS_I18N_KEYS.saving) : t(COMMON_I18N_KEYS.save)}
                    </button>
                </div>
            </div>
        </div>
    );
};
