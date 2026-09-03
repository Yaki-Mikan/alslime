/**
 * CharacterTagsEditor - 設定ファイルエディタ（キャラクター種別）右パネル最下部のタグ設定。
 *
 * tags.json の作品（1 つ）とタグ（複数）を編集し、PUT /api/character-tags/{dirName} で保存する。
 * 保存後はサーバー側でキャラタグマスタが再構築されるため、会話設定の選択肢キャッシュを破棄して即時反映する。
 */

import React, { useEffect, useState } from 'react';
import { Save, X, Tag } from 'lucide-react';
import { resolveMessage, type I18NCatalog } from '../../../api/i18n';
import { getCharacterTags, getCharacterFilters } from '../../../api/files';
import { saveCharacterTags } from '../../../api/characters';
import { invalidateSSRPOptionsCache } from '../../SSRP/RolePlaySettings';
import { CONFIG_EDITOR_I18N_KEYS, CONFIG_EDITOR_TEXT_FALLBACK_JA, COMMON_TEXT_FALLBACK_JA } from '../../../constants/i18n';

interface Props {
    backendUrl: string;
    /** 保存先のキャラディレクトリ名。null（未保存キャラ）なら無効表示 */
    dirName: string | null;
    uiCatalog?: I18NCatalog | null;
}

export const CharacterTagsEditor: React.FC<Props> = ({ backendUrl, dirName, uiCatalog = null }) => {
    const t = (key: string) => resolveMessage(uiCatalog, key, CONFIG_EDITOR_TEXT_FALLBACK_JA[key] || COMMON_TEXT_FALLBACK_JA[key] || key);

    const [work, setWork] = useState('');
    const [tags, setTags] = useState<string[]>([]);
    const [tagInput, setTagInput] = useState('');
    const [works, setWorks] = useState<string[]>([]);
    const [tagMaster, setTagMaster] = useState<string[]>([]);
    const [isDirty, setIsDirty] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
    const isComposingRef = React.useRef(false);

    useEffect(() => {
        let cancelled = false;
        setWork('');
        setTags([]);
        setTagInput('');
        setIsDirty(false);
        if (!dirName) return;
        (async () => {
            try {
                const [tagsResult, filters] = await Promise.all([getCharacterTags(), getCharacterFilters()]);
                if (cancelled) return;
                const mine = tagsResult.characters.find(c => c.dirName === dirName);
                setWork(mine?.work || '');
                setTags(mine?.tags || []);
                setWorks(filters.works || []);
                setTagMaster(filters.tags || []);
            } catch (error) {
                console.error('[CharacterTagsEditor] load failed:', error);
            }
        })();
        return () => { cancelled = true; };
    }, [dirName]);

    const addTag = (raw: string) => {
        const value = raw.trim();
        if (!value || tags.includes(value)) { setTagInput(''); return; }
        setTags(prev => [...prev, value]);
        setTagInput('');
        setIsDirty(true);
    };

    const removeTag = (value: string) => {
        setTags(prev => prev.filter(t => t !== value));
        setIsDirty(true);
    };

    const handleSave = async () => {
        if (!dirName) return;
        setIsSaving(true);
        setNotice(null);
        try {
            const result = await saveCharacterTags(backendUrl, dirName, { work: work.trim() || null, tags });
            setWorks(result.filters.works || []);
            setTagMaster(result.filters.tags || []);
            invalidateSSRPOptionsCache();
            setIsDirty(false);
            setNotice({ ok: true, text: t(CONFIG_EDITOR_I18N_KEYS.characterTagsSaved) });
        } catch {
            setNotice({ ok: false, text: t(CONFIG_EDITOR_I18N_KEYS.characterSaveFailed) });
        } finally {
            setIsSaving(false);
            setTimeout(() => setNotice(null), 3000);
        }
    };

    const disabled = !dirName;
    const suggestions = tagInput.trim()
        ? tagMaster.filter(m => m.toLowerCase().includes(tagInput.trim().toLowerCase()) && !tags.includes(m)).slice(0, 8)
        : [];

    return (
        <div className={`border-t border-gray-700 pt-3 space-y-2 ${disabled ? 'opacity-50' : ''}`}>
            <div className="flex items-center gap-1.5 text-xs text-gray-400">
                <Tag size={12} />
                {t(CONFIG_EDITOR_I18N_KEYS.characterTagsTitle)}
            </div>
            {disabled && <p className="text-[10px] text-gray-500">{t(CONFIG_EDITOR_I18N_KEYS.characterSaveFirst)}</p>}

            {/* 作品（マスタ候補＋自由入力） */}
            <div>
                <label className="block text-[10px] text-gray-500 mb-0.5">{t(CONFIG_EDITOR_I18N_KEYS.characterTagsWork)}</label>
                <input
                    type="text"
                    list="character-tags-work-list"
                    value={work}
                    disabled={disabled}
                    onChange={e => { setWork(e.target.value); setIsDirty(true); }}
                    className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-gray-500 disabled:cursor-not-allowed"
                />
                <datalist id="character-tags-work-list">
                    {works.map(w => <option key={w} value={w} />)}
                </datalist>
            </div>

            {/* タグ（チップ） */}
            <div>
                <label className="block text-[10px] text-gray-500 mb-0.5">{t(CONFIG_EDITOR_I18N_KEYS.characterTagsTags)}</label>
                <div className="flex flex-wrap gap-1 mb-1">
                    {tags.map(tag => (
                        <span key={tag} className="inline-flex items-center gap-1 bg-gray-700 text-gray-200 text-[11px] rounded-full px-2 py-0.5">
                            {tag}
                            <button onClick={() => removeTag(tag)} disabled={disabled} className="text-gray-400 hover:text-red-300">
                                <X size={10} />
                            </button>
                        </span>
                    ))}
                </div>
                <input
                    type="text"
                    value={tagInput}
                    disabled={disabled}
                    placeholder={t(CONFIG_EDITOR_I18N_KEYS.characterTagsAddPlaceholder)}
                    onChange={e => setTagInput(e.target.value)}
                    onCompositionStart={() => { isComposingRef.current = true; }}
                    onCompositionEnd={() => { isComposingRef.current = false; }}
                    onKeyDown={e => {
                        if (e.key !== 'Enter' || isComposingRef.current || e.nativeEvent.isComposing) return;
                        e.preventDefault();
                        addTag(tagInput);
                    }}
                    className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-gray-500 disabled:cursor-not-allowed"
                />
                {suggestions.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                        {suggestions.map(s => (
                            <button
                                key={s}
                                onClick={() => addTag(s)}
                                className="text-[10px] text-blue-300 hover:text-blue-200 border border-blue-800 hover:border-blue-500 rounded-full px-2 py-0.5"
                            >
                                {s}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            <div className="flex items-center justify-between">
                <span className={`text-[10px] ${notice ? (notice.ok ? 'text-green-400' : 'text-red-400') : 'text-transparent'}`}>{notice?.text || '-'}</span>
                <button
                    onClick={handleSave}
                    disabled={disabled || isSaving || !isDirty}
                    className="px-3 py-1 text-xs text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded transition-colors flex items-center gap-1"
                >
                    <Save size={12} />
                    {t(CONFIG_EDITOR_I18N_KEYS.characterSaveTab)}
                </button>
            </div>
        </div>
    );
};
