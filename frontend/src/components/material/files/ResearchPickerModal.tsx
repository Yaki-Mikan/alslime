/**
 * ResearchPickerModal.tsx - 保存済みの調査メモを探して選ぶ小窓
 *
 * ファイル名・フォルダ名の一部で絞り込む。今開いている調査メモには印を付ける。
 * 各行の右で削除を頼める。削除の確認は呼び出し側が出すので、頼む前にこの小窓を閉じる（確認がこの小窓の下に隠れないように）。
 */
import React, { useMemo, useState } from 'react';
import { FileText, Search, Trash2 } from 'lucide-react';
import type { ResearchMemoEntry } from '../../../api/config-gen';
import { formatLabelValue, resolveMessage, type I18NCatalog } from '../../../api/i18n';
import { COMMON_I18N_KEYS, COMMON_TEXT_FALLBACK_JA, CONFIG_GEN_I18N_KEYS, CONFIG_GEN_TEXT_FALLBACK_JA } from '../../../constants/i18n';
import { IconButton, Modal, TextField, cn } from '../../ui';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    uiCatalog?: I18NCatalog | null;
    memos: ResearchMemoEntry[];
    /** 今開いている調査メモ */
    current?: ResearchMemoEntry;
    onSelect: (memo: ResearchMemoEntry) => void;
    onRequestDelete: (memo: ResearchMemoEntry) => void;
}

const memoKey = (m: ResearchMemoEntry) => `${m.dirName}\n${m.characterName}`;

type BodyProps = Omit<Props, 'isOpen' | 'uiCatalog'> & { t: (key: string) => string; labelValue: (label: string, value: string) => string };

/** 小窓の中身。閉じると消えるので、開くたびに検索語は空から始まる */
const PickerBody: React.FC<BodyProps> = ({ onClose, memos, current, onSelect, onRequestDelete, t, labelValue }) => {
    const [query, setQuery] = useState('');

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return memos;
        return memos.filter(m => m.fileName.toLowerCase().includes(q) || m.dirName.toLowerCase().includes(q));
    }, [memos, query]);

    const currentKey = current ? memoKey(current) : '';

    return (
        <div className="flex flex-col min-h-0 max-h-[70vh]">
            <div className="shrink-0 px-5 pt-4 pb-3 border-b border-line">
                <div className="relative">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted pointer-events-none" />
                    <TextField
                        type="search"
                        enterKeyHint="search"
                        autoFocus
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        // エンターでは次の欄へ移らず、キーボードを閉じる
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
                        placeholder={t(CONFIG_GEN_I18N_KEYS.searchPlaceholder)}
                        aria-label={t(CONFIG_GEN_I18N_KEYS.searchPlaceholder)}
                        className="pl-8"
                    />
                </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-1">
                {filtered.length === 0 ? (
                    <p className="py-8 text-center text-sm text-fg-muted">{t(CONFIG_GEN_I18N_KEYS.noResearchFound)}</p>
                ) : filtered.map(memo => {
                    const selected = memoKey(memo) === currentKey;
                    return (
                        <div key={memoKey(memo)} className={cn('flex items-center gap-1 rounded-ui', selected ? 'bg-accent-soft' : 'hover:bg-surface')}>
                            <button
                                type="button"
                                aria-current={selected ? 'true' : undefined}
                                onClick={() => { onClose(); onSelect(memo); }}
                                className="flex-1 min-w-0 flex items-center gap-2 px-3 py-2 text-left text-sm text-fg"
                            >
                                <FileText size={14} className="shrink-0 text-fg-muted" />
                                <span className={cn('truncate', selected && 'font-semibold')}>{memo.fileName}</span>
                            </button>
                            <IconButton
                                label={labelValue(t(CONFIG_GEN_I18N_KEYS.deleteResearchTitle), memo.fileName)}
                                onClick={() => { onClose(); onRequestDelete(memo); }}
                            >
                                <Trash2 size={14} />
                            </IconButton>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export const ResearchPickerModal: React.FC<Props> = ({ isOpen, onClose, uiCatalog = null, ...rest }) => {
    const t = (key: string) => resolveMessage(uiCatalog, key, CONFIG_GEN_TEXT_FALLBACK_JA[key] || COMMON_TEXT_FALLBACK_JA[key] || key);
    return (
        <Modal open={isOpen} onClose={onClose} title={t(CONFIG_GEN_I18N_KEYS.pickResearchTitle)} size="md" closeLabel={t(COMMON_I18N_KEYS.cancel)}>
            <PickerBody onClose={onClose} t={t} labelValue={(label, value) => formatLabelValue(uiCatalog, label, value)} {...rest} />
        </Modal>
    );
};
