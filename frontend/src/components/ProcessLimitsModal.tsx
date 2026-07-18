/**
 * ProcessLimitsModal.tsx - 同時実行数設定モーダル
 *
 * 全体・各種別の同時実行数上限を設定する。
 * 各種別の上限は全体上限を超えられない（超えた場合は全体値にクランプ）。
 */

import React, { useState, useEffect } from 'react';
import { X, Cpu } from 'lucide-react';
import { fetchProcessLimits, updateProcessLimits, type ProcessLimits } from '../api/jobs';
import { BACKEND_URL } from '../api/base-url';
import { resolveMessage, type I18NCatalog } from '../api/i18n';
import { COMMON_I18N_KEYS, COMMON_TEXT_FALLBACK_JA, JOBS_I18N_KEYS, JOBS_TEXT_FALLBACK_JA } from '../constants/i18n';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    uiCatalog?: I18NCatalog | null;
}

const KIND_LABELS: { key: keyof Omit<ProcessLimits, 'global'>; label: string; color: string }[] = [
    { key: 'gemini', label: 'Gemini', color: 'text-blue-400' },
    { key: 'claude', label: 'Claude', color: 'text-orange-400' },
    { key: 'antigravity', label: 'Antigravity', color: 'text-purple-400' },
];

export const ProcessLimitsModal: React.FC<Props> = ({ isOpen, onClose, uiCatalog = null }) => {
    const t = (key: string) => resolveMessage(
        uiCatalog,
        key,
        JOBS_TEXT_FALLBACK_JA[key] || COMMON_TEXT_FALLBACK_JA[key] || key
    );
    const formatText = (template: string, values: Record<string, string | number>) => {
        return Object.entries(values).reduce((text, [key, value]) => {
            return text.split(`{{${key}}}`).join(String(value));
        }, template);
    };
    const [limits, setLimits] = useState<ProcessLimits>({ global: 1, gemini: 1, claude: 1, antigravity: 1 });
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen) return;
        fetchProcessLimits(BACKEND_URL)
            .then(l => setLimits(l))
            .catch(() => setError(t(JOBS_I18N_KEYS.loadError)));
    }, [isOpen]);

    // 全体を変更したとき、各種別が全体を超えていたらクランプ
    const handleGlobalChange = (val: number) => {
        const g = Math.max(1, val);
        setLimits(prev => ({
            global: g,
            gemini: Math.min(prev.gemini, g),
            claude: Math.min(prev.claude, g),
            antigravity: Math.min(prev.antigravity, g),
        }));
    };

    const handleKindChange = (key: keyof Omit<ProcessLimits, 'global'>, val: number) => {
        setLimits(prev => ({
            ...prev,
            [key]: Math.min(Math.max(1, val), prev.global),
        }));
    };

    const handleSave = async () => {
        setIsSaving(true);
        setError(null);
        try {
            const updated = await updateProcessLimits(BACKEND_URL, limits);
            setLimits(updated);
            onClose();
        } catch {
            setError(t(JOBS_I18N_KEYS.saveError));
        } finally {
            setIsSaving(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-sm border border-gray-700 overflow-hidden">
                {/* ヘッダー */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 bg-gray-800">
                    <div className="flex items-center gap-2">
                        <Cpu size={18} className="text-gray-400" />
                        <h3 className="font-semibold text-gray-100 text-base">{t(JOBS_I18N_KEYS.limitsTitle)}</h3>
                    </div>
                    <button onClick={onClose} className="p-1.5 hover:bg-gray-700 rounded text-gray-400 hover:text-gray-200 transition-colors">
                        <X size={18} />
                    </button>
                </div>

                <div className="p-5 space-y-5">
                    {error && (
                        <p className="text-sm text-red-400 bg-red-950/30 border border-red-900/50 rounded px-3 py-2">{error}</p>
                    )}

                    {/* 全体 */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">{t(JOBS_I18N_KEYS.globalLimit)}</label>
                        <input
                            type="number"
                            min={1}
                            value={limits.global}
                            onChange={e => handleGlobalChange(parseInt(e.target.value, 10) || 1)}
                            className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-100 outline-none focus:border-blue-500"
                        />
                        <p className="text-xs text-gray-500 mt-1">{t(JOBS_I18N_KEYS.globalLimitDescription)}</p>
                    </div>

                    {/* 各種別 */}
                    <div className="space-y-3">
                        <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wide">{t(JOBS_I18N_KEYS.perKindLimit)}</h4>
                        {KIND_LABELS.map(({ key, label, color }) => (
                            <div key={key} className="flex items-center gap-3">
                                <span className={`text-sm font-medium w-24 ${color}`}>{label}</span>
                                <input
                                    type="number"
                                    min={1}
                                    max={limits.global}
                                    value={limits[key]}
                                    onChange={e => handleKindChange(key, parseInt(e.target.value, 10) || 1)}
                                    className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-100 outline-none focus:border-blue-500"
                                />
                                <span className="text-xs text-gray-600 w-16 text-right">{formatText(t(JOBS_I18N_KEYS.max), { value: limits.global })}</span>
                            </div>
                        ))}
                        <p className="text-xs text-gray-500">{t(JOBS_I18N_KEYS.clampDescription)}</p>
                    </div>
                </div>

                {/* フッター */}
                <div className="flex justify-end gap-3 px-5 py-4 border-t border-gray-700 bg-gray-800/50">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm text-gray-300 hover:text-gray-100 hover:bg-gray-700 rounded-lg transition-colors"
                    >
                        {t(COMMON_I18N_KEYS.cancel)}
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg transition-colors"
                    >
                        {isSaving ? t(JOBS_I18N_KEYS.saving) : t(COMMON_I18N_KEYS.save)}
                    </button>
                </div>
            </div>
        </div>
    );
};
