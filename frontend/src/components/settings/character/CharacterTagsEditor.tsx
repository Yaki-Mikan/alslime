/**
 * CharacterTagsEditor - 設定ファイル（キャラクター種別）の作品・タグ。
 *
 * tags.json の作品（1 つ）とタグ（複数）を編集し、PUT /api/character-tags/{dirName} で保存する。
 * 保存後はサーバー側でキャラタグマスタが再構築されるため、会話設定の選択肢キャッシュを破棄して即時反映する。
 * 設定ファイルの画面では保存ボタンを隠し、上の帯の「保存」から ref の save を呼ぶ。
 */

import React, { useEffect, useImperativeHandle, useState } from 'react';
import { Save, X } from 'lucide-react';
import { resolveMessage, type I18NCatalog } from '../../../api/i18n';
import { getCharacterTags, getCharacterFilters } from '../../../api/files';
import { saveCharacterTags } from '../../../api/characters';
import { invalidateSSRPOptionsCache } from '../../SSRP/RolePlaySettings';
import { CONFIG_EDITOR_I18N_KEYS, CONFIG_EDITOR_TEXT_FALLBACK_JA, COMMON_TEXT_FALLBACK_JA } from '../../../constants/i18n';
import { Button, Chip, TextField } from '../../ui';

interface Props {
    backendUrl: string;
    /** 保存先のキャラディレクトリ名。null（未保存キャラ）なら無効表示 */
    dirName: string | null;
    uiCatalog?: I18NCatalog | null;
    /** 保存ボタンを出さない（上の帯の「保存」でまとめて保存するとき） */
    hideSaveButton?: boolean;
    /** 保存していない変更があるかの通知 */
    onDirtyChange?: (dirty: boolean) => void;
}

/** 外から呼ぶ保存。変更が無ければ何もせず true、失敗したら false */
export interface SaveHandle {
    save: () => Promise<boolean>;
}

export const CharacterTagsEditor = React.forwardRef<SaveHandle, Props>(({ backendUrl, dirName, uiCatalog = null, hideSaveButton = false, onDirtyChange }, ref) => {
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

    useEffect(() => { onDirtyChange?.(isDirty); }, [isDirty, onDirtyChange]);

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

    const save = async (): Promise<boolean> => {
        if (!dirName || !isDirty) return true;
        setIsSaving(true);
        setNotice(null);
        try {
            const result = await saveCharacterTags(backendUrl, dirName, { work: work.trim() || null, tags });
            setWorks(result.filters.works || []);
            setTagMaster(result.filters.tags || []);
            invalidateSSRPOptionsCache();
            setIsDirty(false);
            if (!hideSaveButton) setNotice({ ok: true, text: t(CONFIG_EDITOR_I18N_KEYS.characterTagsSaved) });
            return true;
        } catch {
            setNotice({ ok: false, text: t(CONFIG_EDITOR_I18N_KEYS.characterSaveFailed) });
            return false;
        } finally {
            setIsSaving(false);
            setTimeout(() => setNotice(null), 3000);
        }
    };

    useImperativeHandle(ref, () => ({ save }));

    const disabled = !dirName;
    const suggestions = tagInput.trim()
        ? tagMaster.filter(m => m.toLowerCase().includes(tagInput.trim().toLowerCase()) && !tags.includes(m)).slice(0, 8)
        : [];

    return (
        // 保存前の案内は、この欄を置く付属の欄の上部に出す
        <div className={`space-y-4 ${disabled ? 'opacity-50' : ''}`}>
            {/* 作品（マスタ候補＋自由入力） */}
            <label className="block space-y-1.5">
                <span className="text-xs text-fg-muted">{t(CONFIG_EDITOR_I18N_KEYS.characterTagsWork)}</span>
                <TextField
                    list="character-tags-work-list"
                    value={work}
                    disabled={disabled}
                    onChange={e => { setWork(e.target.value); setIsDirty(true); }}
                />
                <datalist id="character-tags-work-list">
                    {works.map(w => <option key={w} value={w} />)}
                </datalist>
            </label>

            {/* タグ（札） */}
            <div className="space-y-1.5">
                <span className="text-xs text-fg-muted">{t(CONFIG_EDITOR_I18N_KEYS.characterTagsTags)}</span>
                {tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                        {tags.map(tag => (
                            <Chip key={tag} selected onClick={() => removeTag(tag)} disabled={disabled}>
                                {tag}
                                <X size={11} />
                            </Chip>
                        ))}
                    </div>
                )}
                <TextField
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
                />
                {suggestions.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                        {suggestions.map(s => (
                            <Chip key={s} onClick={() => addTag(s)}>{s}</Chip>
                        ))}
                    </div>
                )}
            </div>

            {(!hideSaveButton || notice) && (
                <div className="flex items-center justify-between gap-2">
                    <span className={`text-xs ${notice ? (notice.ok ? 'text-ok' : 'text-danger') : 'text-transparent'}`}>{notice?.text || '-'}</span>
                    {!hideSaveButton && (
                        <Button size="sm" variant="primary" onClick={() => void save()} disabled={disabled || isSaving || !isDirty}>
                            <Save size={12} />
                            {t(CONFIG_EDITOR_I18N_KEYS.characterSaveTab)}
                        </Button>
                    )}
                </div>
            )}
        </div>
    );
});
CharacterTagsEditor.displayName = 'CharacterTagsEditor';
