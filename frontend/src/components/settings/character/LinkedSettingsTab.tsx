/**
 * LinkedSettingsTab - 設定ファイルエディタ（キャラクター種別）の設定紐づけタブ。
 *
 * キャラクターに「個別性格設定／個別服装・髪型／個別背景」のファイルと
 * キャラクター側の追加設定（追記／置換）を紐づけ、linked_settings.json へ保存する。
 * 会話設定でこのキャラクターを選ぶとファイルが自動投入され、追加設定はプロンプト合成時に
 * プリセット側と合成される。
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Save, Trash2 } from 'lucide-react';
import { resolveMessage, type I18NCatalog } from '../../../api/i18n';
import {
    getLinkedSettings,
    saveLinkedSettings,
    createEmptyLinkedSettings,
    type LinkedSettings,
    type LinkedGroup,
    type LinkedMode,
} from '../../../api/characters';
import {
    INDIVIDUAL_KINDS,
    loadIndividualOptions,
    type IndividualKind,
    type IndividualOption,
} from '../../SSRP/individualOptions';
import {
    CONFIG_EDITOR_I18N_KEYS,
    CONFIG_EDITOR_TEXT_FALLBACK_JA,
    COMMON_TEXT_FALLBACK_JA,
    SSRP_I18N_KEYS,
    SSRP_TEXT_FALLBACK_JA,
} from '../../../constants/i18n';

interface Props {
    backendUrl: string;
    dirName: string;
    uiCatalog?: I18NCatalog | null;
    onDirtyChange?: (dirty: boolean) => void;
}

const KIND_LABEL_KEYS: Record<IndividualKind, string> = {
    personalities: SSRP_I18N_KEYS.individualPersonality,
    outfits: SSRP_I18N_KEYS.individualOutfit,
    backgrounds: SSRP_I18N_KEYS.individualBackground,
};

// 末尾に空スロットを 1 つ保証する（会話設定の個別設定欄と同じ操作感。上限は掛けない）。
function withTrailingEmpty(files: string[]): string[] {
    const filled = files.filter(Boolean);
    return [...filled, ''];
}

export const LinkedSettingsTab: React.FC<Props> = ({ backendUrl, dirName, uiCatalog = null, onDirtyChange }) => {
    const t = (key: string) => resolveMessage(
        uiCatalog,
        key,
        CONFIG_EDITOR_TEXT_FALLBACK_JA[key] || SSRP_TEXT_FALLBACK_JA[key] || COMMON_TEXT_FALLBACK_JA[key] || key,
    );

    const [settings, setSettings] = useState<LinkedSettings>(createEmptyLinkedSettings());
    const [slots, setSlots] = useState<Record<IndividualKind, string[]>>({ personalities: [''], outfits: [''], backgrounds: [''] });
    const [options, setOptions] = useState<Record<IndividualKind, IndividualOption[]>>({ personalities: [], outfits: [], backgrounds: [] });
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isDirty, setIsDirty] = useState(false);
    const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

    useEffect(() => {
        onDirtyChange?.(isDirty);
    }, [isDirty, onDirtyChange]);

    // 読込：設定本体と選択肢（3 種は独立のため並列）
    useEffect(() => {
        let cancelled = false;
        setIsLoading(true);
        const labels = { local: t(SSRP_I18N_KEYS.localOptionPrefix), shared: t(SSRP_I18N_KEYS.sharedOptionPrefix) };
        const basePath = `roleplay/characters/${dirName}`;
        (async () => {
            const [loaded, ...opts] = await Promise.all([
                getLinkedSettings(backendUrl, dirName).catch(() => createEmptyLinkedSettings()),
                ...INDIVIDUAL_KINDS.map(kind => loadIndividualOptions(basePath, kind, labels)),
            ]);
            if (cancelled) return;
            setSettings(loaded);
            setSlots({
                personalities: withTrailingEmpty(loaded.personalities.files),
                outfits: withTrailingEmpty(loaded.outfits.files),
                backgrounds: withTrailingEmpty(loaded.backgrounds.files),
            });
            setOptions({ personalities: opts[0], outfits: opts[1], backgrounds: opts[2] });
            setIsDirty(false);
            setIsLoading(false);
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [backendUrl, dirName, uiCatalog]);

    const updateSlot = (kind: IndividualKind, idx: number, value: string) => {
        setSlots(prev => {
            const next = [...prev[kind]];
            next[idx] = value;
            if (value && idx === next.length - 1) next.push('');
            return { ...prev, [kind]: next };
        });
        setIsDirty(true);
    };

    const removeSlot = (kind: IndividualKind, idx: number) => {
        setSlots(prev => {
            const next = prev[kind].filter((_, i) => i !== idx);
            if (next.length === 0 || next[next.length - 1] !== '') next.push('');
            return { ...prev, [kind]: next };
        });
        setIsDirty(true);
    };

    const updateAdditional = (kind: IndividualKind, patch: Partial<LinkedGroup['additional']>) => {
        setSettings(prev => ({ ...prev, [kind]: { ...prev[kind], additional: { ...prev[kind].additional, ...patch } } }));
        setIsDirty(true);
    };

    const handleSave = useCallback(async () => {
        setIsSaving(true);
        setNotice(null);
        try {
            const body: LinkedSettings = {
                ...settings,
                personalities: { ...settings.personalities, files: slots.personalities.filter(Boolean) },
                outfits: { ...settings.outfits, files: slots.outfits.filter(Boolean) },
                backgrounds: { ...settings.backgrounds, files: slots.backgrounds.filter(Boolean) },
            };
            const saved = await saveLinkedSettings(backendUrl, dirName, body);
            setSettings(saved);
            setSlots({
                personalities: withTrailingEmpty(saved.personalities.files),
                outfits: withTrailingEmpty(saved.outfits.files),
                backgrounds: withTrailingEmpty(saved.backgrounds.files),
            });
            setIsDirty(false);
            setNotice({ ok: true, text: t(CONFIG_EDITOR_I18N_KEYS.characterSaved) });
        } catch {
            setNotice({ ok: false, text: t(CONFIG_EDITOR_I18N_KEYS.characterSaveFailed) });
        } finally {
            setIsSaving(false);
            setTimeout(() => setNotice(null), 3000);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [backendUrl, dirName, settings, slots]);

    return (
        <div className="space-y-5">
            <p className="text-xs text-gray-500">{t(CONFIG_EDITOR_I18N_KEYS.characterLinkedDescription)}</p>
            {INDIVIDUAL_KINDS.map(kind => {
                const group = settings[kind];
                const kindOptions = options[kind];
                const selected = slots[kind];
                return (
                    <div key={kind} className="border border-gray-700 rounded-lg p-3 space-y-3">
                        <div className="text-sm font-medium text-gray-300">{t(KIND_LABEL_KEYS[kind])}</div>

                        {/* 紐づけるファイル */}
                        <div className="space-y-1.5">
                            <div className="text-[11px] text-gray-500">{t(CONFIG_EDITOR_I18N_KEYS.characterLinkedFiles)}</div>
                            {selected.map((value, idx) => (
                                <div key={idx} className="flex gap-2 items-center">
                                    <select
                                        value={value}
                                        disabled={isLoading}
                                        onChange={e => updateSlot(kind, idx, e.target.value)}
                                        className="flex-1 bg-gray-900 border border-gray-700 text-gray-200 rounded text-xs p-2 outline-none focus:border-blue-500 transition-colors"
                                    >
                                        <option value="">{t(SSRP_I18N_KEYS.none)}</option>
                                        {kindOptions.map(opt => (
                                            <option key={opt.value} value={opt.value} disabled={selected.includes(opt.value) && value !== opt.value}>{opt.label}</option>
                                        ))}
                                        {/* 選択肢に無い（削除済み等）値も表示だけは残す */}
                                        {value && !kindOptions.some(o => o.value === value) && (
                                            <option value={value}>{value}</option>
                                        )}
                                    </select>
                                    {(value || (idx !== selected.length - 1)) && (
                                        <button
                                            onClick={() => removeSlot(kind, idx)}
                                            className="text-gray-500 hover:text-red-400 p-1.5 rounded hover:bg-gray-800 transition-colors"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>

                        {/* キャラクター側の追加設定 */}
                        <div className="space-y-1.5">
                            <div className="flex items-center gap-2">
                                <span className="text-[11px] text-gray-500">{t(CONFIG_EDITOR_I18N_KEYS.characterLinkedAdditional)}</span>
                                <select
                                    value={group.additional.mode}
                                    onChange={e => updateAdditional(kind, { mode: e.target.value as LinkedMode })}
                                    title={t(CONFIG_EDITOR_I18N_KEYS.characterLinkedModeHint)}
                                    className="ml-auto bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded px-2 py-1 outline-none focus:border-blue-500"
                                >
                                    <option value="append">{t(CONFIG_EDITOR_I18N_KEYS.characterLinkedModeAppend)}</option>
                                    <option value="replace">{t(CONFIG_EDITOR_I18N_KEYS.characterLinkedModeReplace)}</option>
                                </select>
                            </div>
                            <textarea
                                value={group.additional.text}
                                onChange={e => updateAdditional(kind, { text: e.target.value })}
                                rows={3}
                                className="w-full bg-gray-900 border border-gray-700 text-gray-200 rounded text-xs p-2 outline-none focus:border-blue-500 transition-colors resize-y"
                            />
                            <p className="text-[10px] text-gray-600">{t(CONFIG_EDITOR_I18N_KEYS.characterLinkedModeHint)}</p>
                        </div>
                    </div>
                );
            })}

            <div className="flex items-center justify-between pt-2 border-t border-gray-700/50">
                <div className="text-sm">
                    {notice && <span className={notice.ok ? 'text-green-400' : 'text-red-400'}>{notice.text}</span>}
                </div>
                <button
                    onClick={handleSave}
                    disabled={isSaving || isLoading || !isDirty}
                    className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded-lg transition-colors flex items-center gap-1.5"
                >
                    <Save size={14} />
                    {t(CONFIG_EDITOR_I18N_KEYS.characterSaveTab)}
                </button>
            </div>
        </div>
    );
};
