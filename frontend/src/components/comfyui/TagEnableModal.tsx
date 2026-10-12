/**
 * TagEnableModal.tsx - タグの有効・無効をその場で切り替える窓
 *
 * クイック設定の「タグの有効・無効」から開く。すべての分類のタグを分類の定義順に並べ、
 * スイッチを切り替えた時点で保存する（素材づくりのタグのタブと同じ保存）。
 * 開くたびに読み直すので、閉じている間にほかの画面で変えた値も拾う。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ListChecks, Loader2, Search } from 'lucide-react';
import { getAllTagMappings, isTagEnabled, setTagEnabled } from '../../api/comfyui';
import type { TagEntry, TagMappingBundle } from '../../api/comfyui';
import { resolveMessage, type I18NCatalog } from '../../api/i18n';
import { MATERIAL_I18N_KEYS, MATERIAL_TEXT_FALLBACK_JA } from '../../constants/i18n';
import { Button, Modal, TextField, Toggle, cn } from '../ui';
import { createComfyUIText } from './i18n';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    backendUrl: string;
    uiCatalog?: I18NCatalog | null;
    /** 素材づくりのタグタブを開く。窓はこれを呼ぶ前に閉じる */
    onOpenMaterial?: () => void;
}

const toggleKey = (categoryId: string, tagKey: string) => `${categoryId}\t${tagKey}`;

export const TagEnableModal: React.FC<Props> = ({ isOpen, onClose, backendUrl, uiCatalog = null, onOpenMaterial }) => {
    const { COMMON, SECTION_NAMES, TAG_MAPPING } = createComfyUIText(uiCatalog);
    const tm = (key: string) => resolveMessage(uiCatalog, key, MATERIAL_TEXT_FALLBACK_JA[key] || key);
    const [bundle, setBundle] = useState<TagMappingBundle | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [query, setQuery] = useState('');
    const [updating, setUpdating] = useState<Set<string>>(new Set());
    const [failed, setFailed] = useState(false);

    // 開くたびに読み直す。読めなければ、分類もタグも空として扱う
    useEffect(() => {
        if (!isOpen) return;
        let alive = true;
        setIsLoading(true);
        setFailed(false);
        getAllTagMappings(backendUrl)
            .then(data => { if (alive) setBundle(data); })
            .catch(() => { if (alive) setBundle({ categories: [], mappings: [] }); })
            .finally(() => { if (alive) setIsLoading(false); });
        return () => { alive = false; };
    }, [isOpen, backendUrl]);

    // 分類の定義順に、照合キーが検索語を含むタグだけを並べる（照合キーが空のタグは出さない）
    const groups = useMemo(() => {
        if (!bundle) return [];
        const q = query.trim().toLowerCase();
        return bundle.categories.map(cat => {
            const mapping = bundle.mappings.find(m => m.categoryId === cat.id);
            const allTags = (mapping?.tags ?? []).filter(tag => tag.key);
            return {
                id: cat.id,
                // 分類名は表示言語の訳を引く（利用者が足した分類は訳が無いので保存された名前を出す）
                label: resolveMessage(uiCatalog, `comfyui.tagCategory.${cat.id}`, cat.label || cat.id),
                total: allTags.length,
                enabledCount: allTags.filter(isTagEnabled).length,
                tags: q ? allTags.filter(tag => tag.key.toLowerCase().includes(q)) : allTags,
            };
        }).filter(group => group.tags.length > 0);
    }, [bundle, query, uiCatalog]);

    const applyLocal = useCallback((categoryId: string, tagKey: string, enabled: boolean) => {
        setBundle(prev => prev && {
            ...prev,
            mappings: prev.mappings.map(m => (m.categoryId !== categoryId ? m : {
                ...m,
                tags: m.tags.map(tag => (tag.key !== tagKey ? tag : { ...tag, enabled: enabled ? undefined : false })),
            })),
        });
    }, []);

    // 切り替えた時点で保存する。保存中の同じタグは押せない。失敗したら元に戻して知らせる
    const toggle = async (categoryId: string, tag: TagEntry, enabled: boolean) => {
        const id = toggleKey(categoryId, tag.key);
        if (updating.has(id)) return;
        const previous = isTagEnabled(tag);
        setFailed(false);
        setUpdating(prev => new Set(prev).add(id));
        applyLocal(categoryId, tag.key, enabled);
        try {
            await setTagEnabled(backendUrl, categoryId, tag.key, enabled);
        } catch {
            applyLocal(categoryId, tag.key, previous);
            setFailed(true);
        } finally {
            setUpdating(prev => {
                const next = new Set(prev);
                next.delete(id);
                return next;
            });
        }
    };

    // 素材づくりへ移るときは、先にこの窓を閉じる（重なった覆いの後ろに素材づくりが隠れないように）
    const openMaterial = () => {
        onClose();
        onOpenMaterial?.();
    };

    return (
        <Modal
            open={isOpen}
            onClose={onClose}
            title={SECTION_NAMES.TAG_ENABLE}
            icon={<ListChecks size={18} className="text-accent" />}
            size="lg"
            closeLabel={COMMON.BUTTONS.CLOSE}
            footer={(
                <div className="flex flex-wrap items-center gap-2">
                    <span className={cn('mr-auto text-xs', failed ? 'text-danger' : 'text-fg-muted')}>
                        {failed ? TAG_MAPPING.MESSAGES.UPDATE_FAILED : TAG_MAPPING.MESSAGES.AUTO_SAVE}
                    </span>
                    {onOpenMaterial && (
                        <Button size="sm" variant="ghost" onClick={openMaterial}>{tm(MATERIAL_I18N_KEYS.tagsEditInMaterial)}</Button>
                    )}
                    <Button size="sm" variant="secondary" onClick={onClose}>{COMMON.BUTTONS.CLOSE}</Button>
                </div>
            )}
        >
            <div className="flex flex-col min-h-0 max-h-[70vh]">
                <div className="shrink-0 px-5 pt-4 pb-3 border-b border-line space-y-2">
                    <div className="relative">
                        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted pointer-events-none" />
                        <TextField
                            autoFocus
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder={TAG_MAPPING.PLACEHOLDERS.SEARCH_KEY}
                            aria-label={TAG_MAPPING.PLACEHOLDERS.SEARCH_KEY}
                            className="pl-8"
                        />
                    </div>
                    <p className="text-xs text-fg-muted">{TAG_MAPPING.HELP.DISABLED_HINT}</p>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
                    {isLoading ? (
                        <div className="flex justify-center py-8 text-fg-muted">
                            <Loader2 size={20} className="animate-spin" />
                        </div>
                    ) : groups.length === 0 ? (
                        <p className="py-8 text-center text-sm text-fg-muted">
                            {query.trim() ? TAG_MAPPING.MESSAGES.NO_MATCH : TAG_MAPPING.MESSAGES.NO_TAGS}
                        </p>
                    ) : groups.map(group => (
                        <section key={group.id} className="rounded-ui border border-line overflow-hidden">
                            <div className="flex items-center justify-between px-3 py-1.5 bg-surface border-b border-line">
                                <h4 className="text-sm font-semibold text-fg">{group.label}</h4>
                                <span className="text-xs text-fg-muted">{group.enabledCount} / {group.total}</span>
                            </div>
                            <div className="flex items-center px-3 py-1 text-xs text-fg-muted border-b border-line">
                                <span className="flex-1">{TAG_MAPPING.LABELS.MATCH_KEY}</span>
                                <span className="flex-1">{TAG_MAPPING.LABELS.DANBOORU_PROMPT_SHORT}</span>
                                <span className="w-12 text-center">{TAG_MAPPING.LABELS.LORA}</span>
                                <span className="w-14 text-center">{TAG_MAPPING.LABELS.ENABLED}</span>
                            </div>
                            {group.tags.map(tag => {
                                const enabled = isTagEnabled(tag);
                                const busy = updating.has(toggleKey(group.id, tag.key));
                                return (
                                    <div
                                        key={tag.key}
                                        className={cn('flex items-center px-3 py-1.5 text-sm border-b border-line last:border-b-0', enabled ? 'text-fg' : 'text-fg-muted opacity-60')}
                                    >
                                        <span className="flex-1 min-w-0 truncate pr-2" title={tag.key}>{tag.key}</span>
                                        <span className="flex-1 min-w-0 truncate pr-2 text-xs" title={tag.prompt}>{tag.prompt || COMMON.EMPTY_MARKER}</span>
                                        <span className="w-12 text-center text-xs">
                                            {tag.lora.filter(l => l.name).length > 0 ? COMMON.HAS_LORA : COMMON.EMPTY_MARKER}
                                        </span>
                                        <span className="w-14 flex justify-center">
                                            <Toggle
                                                size="sm"
                                                checked={enabled}
                                                disabled={busy}
                                                onChange={value => { void toggle(group.id, tag, value); }}
                                                title={`${tag.key} ${TAG_MAPPING.LABELS.ENABLED}`}
                                                label={`${tag.key} ${TAG_MAPPING.LABELS.ENABLED}`}
                                                labelClassName="sr-only"
                                            />
                                        </span>
                                    </div>
                                );
                            })}
                        </section>
                    ))}
                </div>
            </div>
        </Modal>
    );
};
