/**
 * CharacterListPane.tsx - 素材づくりのキャラ一覧（キャラ画像・声で共通）
 *
 * 上に絞り込み（名前・作品・状態）、下に「この会話のキャラ」「最近さわったキャラ」「すべて」。
 * 各行に画像設定・表情画像・声の状態を点で出す。状態を読めないとき（古いモジュールなど）は「不明」の点にする。
 * 一括操作を渡されたときは複数を選べるようにし、下に選んだ人数と操作を出す。
 */
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatLabelValue, resolveMessage, type I18NCatalog } from '../../api/i18n';
import type { CharacterTagInfo } from '../../api/files';
import { MATERIAL_I18N_KEYS, MATERIAL_TEXT_FALLBACK_JA } from '../../constants/i18n';
import type { CharacterMaterialState, DotState, MaterialStatusResult } from '../../hooks/useMaterialStatus';
import { Button, TextField, cn } from '../ui';
import { readRecentCharacters, rememberRecentCharacter } from './recentCharacters';

const NO_WORK = '__none__';

type StateFilter = '' | 'noImage' | 'missingFaces' | 'noVoice';

interface CharacterListPaneProps {
    uiCatalog: I18NCatalog | null;
    status: MaterialStatusResult;
    /** 画像設定の点と絞り込みを出すか */
    showImage: boolean;
    /** 声の点と絞り込みを出すか */
    showVoice: boolean;
    /** 今の会話の参加キャラ（キャラ一覧の path と同じ値） */
    sessionCharacterPaths: string[];
    selectedDirName: string | null;
    onSelect: (character: CharacterTagInfo) => void;
    /** 一括操作。渡されたときだけ複数を選べる */
    bulkActions?: (selected: CharacterTagInfo[], clear: () => void) => React.ReactNode;
    className?: string;
}

const DOT_CLASSES: Record<DotState, string> = {
    ok: 'bg-ok',
    partial: 'bg-warn',
    none: 'bg-danger',
    unknown: 'border border-fg-muted',
};

interface RowLabels {
    image: string;
    faces: string;
    voice: string;
    ok: string;
    partial: string;
    none: string;
    unknown: string;
    /** 点の説明（「画像：あり」など）を組み立てる */
    dotTitle: (label: string, value: string) => string;
}

interface CharacterRowProps {
    character: CharacterTagInfo;
    state?: CharacterMaterialState;
    selected: boolean;
    multiSelect: boolean;
    checked: boolean;
    showImage: boolean;
    showVoice: boolean;
    labels: RowLabels;
    onSelect: (character: CharacterTagInfo) => void;
    onToggle: (dirName: string) => void;
}

/** 一覧の1行。変わっていない行は描き直さない（数百〜数千人でも絞り込みの入力を重くしないため） */
const CharacterRow = memo(({ character: c, state: s, selected, multiSelect, checked, showImage, showVoice, labels, onSelect, onToggle }: CharacterRowProps) => {
    const dot = (label: string, kind: DotState, isFaces = false) => {
        const value = kind === 'ok' ? labels.ok
            : kind === 'partial' ? (isFaces && s?.faceCount ? `${s.faceCount.done}/${s.faceCount.total}` : labels.partial)
                : kind === 'none' ? labels.none
                    : labels.unknown;
        const title = labels.dotTitle(label, value);
        return <span key={label} role="img" aria-label={title} title={title} className={cn('w-2 h-2 rounded-full shrink-0', DOT_CLASSES[kind])} />;
    };
    return (
        <div
            className={cn(
                'flex items-center gap-2 px-2 py-1.5 rounded-ui cursor-pointer',
                selected ? 'bg-accent-soft' : 'hover:bg-surface-2',
            )}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(c)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(c); } }}
            aria-current={selected ? 'true' : undefined}
        >
            {multiSelect && (
                <input
                    type="checkbox"
                    aria-label={c.name}
                    checked={checked}
                    onClick={e => e.stopPropagation()}
                    onChange={() => onToggle(c.dirName)}
                />
            )}
            {c.iconUrl ? (
                <img src={c.iconUrl} alt="" loading="lazy" className="w-8 h-8 rounded-full object-cover shrink-0 bg-surface-2" />
            ) : (
                <span className="w-8 h-8 rounded-full shrink-0 grid place-items-center bg-surface-2 text-xs text-fg-muted">{c.name.slice(0, 1)}</span>
            )}
            <span className="flex-1 min-w-0">
                <span className="block text-sm truncate">{c.name}</span>
                {c.work && <span className="block text-xs text-fg-muted truncate">{c.work}</span>}
            </span>
            <span className="flex items-center gap-1 shrink-0">
                {showImage && dot(labels.image, s?.image ?? 'unknown')}
                {dot(labels.faces, s?.faces ?? 'unknown', true)}
                {showVoice && dot(labels.voice, s?.voice ?? 'unknown')}
            </span>
        </div>
    );
});
CharacterRow.displayName = 'CharacterRow';

export const CharacterListPane: React.FC<CharacterListPaneProps> = ({
    uiCatalog,
    status,
    showImage,
    showVoice,
    sessionCharacterPaths,
    selectedDirName,
    onSelect,
    bulkActions,
    className,
}) => {
    const t = (key: string) => resolveMessage(uiCatalog, key, MATERIAL_TEXT_FALLBACK_JA[key] || key);
    const format = (template: string, values: Record<string, string | number>) =>
        Object.entries(values).reduce((text, [k, v]) => text.split(`{{${k}}}`).join(String(v)), template);

    const [query, setQuery] = useState('');
    const [work, setWork] = useState('');
    const [stateFilter, setStateFilter] = useState<StateFilter>('');
    const [recent, setRecent] = useState<string[]>(readRecentCharacters);
    const [multiSelect, setMultiSelect] = useState(false);
    const [checked, setChecked] = useState<Set<string>>(new Set());

    const { characters, states, loading } = status;

    const works = useMemo(
        () => Array.from(new Set(characters.map(c => c.work).filter((w): w is string => !!w))).sort((a, b) => a.localeCompare(b, 'ja')),
        [characters],
    );

    // 探す文字は打つたびにその場で反映する（反映を後回しにすると、スマホでは絞り込みが追いつかない）
    const matches = useCallback((c: CharacterTagInfo): boolean => {
        const q = query.trim().toLowerCase();
        if (q && !c.name.toLowerCase().includes(q) && !(c.work ?? '').toLowerCase().includes(q)) return false;
        if (work === NO_WORK ? !!c.work : work && c.work !== work) return false;
        const s = states[c.dirName];
        if (stateFilter === 'noImage' && s?.image !== 'none') return false;
        if (stateFilter === 'missingFaces' && !(s?.faces === 'none' || s?.faces === 'partial')) return false;
        if (stateFilter === 'noVoice' && s?.voice !== 'none') return false;
        return true;
    }, [query, work, stateFilter, states]);

    const filtered = useMemo(() => characters.filter(matches), [characters, matches]);
    const byDir = useMemo(() => new Map(characters.map(c => [c.dirName, c])), [characters]);
    const byPath = useMemo(() => new Map(characters.map(c => [c.path, c])), [characters]);
    const sessionRows = sessionCharacterPaths
        .map(p => byPath.get(p))
        .filter((c): c is CharacterTagInfo => !!c && matches(c));
    const recentRows = recent
        .map(d => byDir.get(d))
        .filter((c): c is CharacterTagInfo => !!c && matches(c));

    // 行へ渡す選ぶ・チェックの処理は毎回同じものにする（行の描き直しを省くため）
    const onSelectRef = useRef(onSelect);
    useEffect(() => { onSelectRef.current = onSelect; });
    const select = useCallback((c: CharacterTagInfo) => {
        setRecent(rememberRecentCharacter(c.dirName));
        onSelectRef.current(c);
    }, []);
    const toggleChecked = useCallback((dirName: string) => {
        setChecked(prev => {
            const next = new Set(prev);
            if (next.has(dirName)) next.delete(dirName);
            else next.add(dirName);
            return next;
        });
    }, []);
    const clearChecked = () => setChecked(new Set());
    const checkedCharacters = characters.filter(c => checked.has(c.dirName));

    const labels = useMemo<RowLabels>(() => {
        const r = (key: string) => resolveMessage(uiCatalog, key, MATERIAL_TEXT_FALLBACK_JA[key] || key);
        return {
            image: r(MATERIAL_I18N_KEYS.listDotImage),
            faces: r(MATERIAL_I18N_KEYS.listDotFaces),
            voice: r(MATERIAL_I18N_KEYS.listDotVoice),
            ok: r(MATERIAL_I18N_KEYS.listDotOk),
            partial: r(MATERIAL_I18N_KEYS.listDotPartial),
            none: r(MATERIAL_I18N_KEYS.listDotNone),
            unknown: r(MATERIAL_I18N_KEYS.listDotUnknown),
            dotTitle: (label: string, value: string) => formatLabelValue(uiCatalog, label, value),
        };
    }, [uiCatalog]);

    // 行はパスで見分ける。一つのフォルダに設定ファイルが複数あると同じフォルダ名のキャラが並ぶため、
    // フォルダ名で見分けると行が取り違えられ、絞り込んだときに別のキャラが残る
    const row = (c: CharacterTagInfo, section: string) => (
        <CharacterRow
            key={`${section}-${c.path}`}
            character={c}
            state={states[c.dirName]}
            selected={c.dirName === selectedDirName}
            multiSelect={multiSelect}
            checked={checked.has(c.dirName)}
            showImage={showImage}
            showVoice={showVoice}
            labels={labels}
            onSelect={select}
            onToggle={toggleChecked}
        />
    );

    const section = (key: string, title: React.ReactNode, rows: CharacterTagInfo[]) => (
        <section key={key} className="mb-2">
            <h3 className="px-2 pt-3 pb-1 text-xs font-bold tracking-wider text-fg-muted">{title}</h3>
            {rows.map(c => row(c, key))}
        </section>
    );

    const stateOptions: { value: StateFilter; label: string }[] = [
        { value: '', label: t(MATERIAL_I18N_KEYS.listState) },
        ...(showImage ? [{ value: 'noImage' as const, label: t(MATERIAL_I18N_KEYS.listStateNoImage) }] : []),
        { value: 'missingFaces', label: t(MATERIAL_I18N_KEYS.listStateMissingFaces) },
        ...(showVoice ? [{ value: 'noVoice' as const, label: t(MATERIAL_I18N_KEYS.listStateNoVoice) }] : []),
    ];
    const selectCls = 'h-8 px-2 rounded-ui bg-surface border border-line-strong text-fg text-xs outline-none focus:border-accent min-w-0 flex-1';

    return (
        <div className={cn('flex flex-col min-h-0', className)}>
            <div className="p-3 space-y-2 border-b border-line shrink-0">
                <TextField
                    type="search"
                    enterKeyHint="search"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    // エンターでは次の欄（作品の絞り込み）へ移らず、キーボードを閉じる
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
                    placeholder={t(MATERIAL_I18N_KEYS.listSearch)}
                    aria-label={t(MATERIAL_I18N_KEYS.listSearch)}
                    className="h-8 text-xs"
                />
                <div className="flex gap-1.5">
                    <select aria-label={t(MATERIAL_I18N_KEYS.listWork)} value={work} onChange={e => setWork(e.target.value)} className={selectCls}>
                        <option value="">{t(MATERIAL_I18N_KEYS.listWork)}</option>
                        <option value={NO_WORK}>{t(MATERIAL_I18N_KEYS.listNoWork)}</option>
                        {works.map(w => <option key={w} value={w}>{w}</option>)}
                    </select>
                    <select aria-label={t(MATERIAL_I18N_KEYS.listState)} value={stateFilter} onChange={e => setStateFilter(e.target.value as StateFilter)} className={selectCls}>
                        {stateOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                </div>
                {bulkActions && (
                    <label className="flex items-center gap-1.5 text-xs text-fg-muted">
                        <input
                            type="checkbox"
                            checked={multiSelect}
                            onChange={e => { setMultiSelect(e.target.checked); if (!e.target.checked) clearChecked(); }}
                        />
                        {t(MATERIAL_I18N_KEYS.listMultiSelect)}
                    </label>
                )}
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-3">
                {loading && characters.length === 0 ? (
                    <p className="px-2 py-3 text-xs text-fg-muted">{t(MATERIAL_I18N_KEYS.listLoading)}</p>
                ) : (
                    <>
                        {sessionRows.length > 0 && section('session', t(MATERIAL_I18N_KEYS.listPinnedSession), sessionRows)}
                        {recentRows.length > 0 && section('recent', t(MATERIAL_I18N_KEYS.listRecent), recentRows)}
                        {section(
                            'all',
                            <>
                                {t(MATERIAL_I18N_KEYS.listAll)}
                                <span className="ml-1.5 font-normal">{format(t(MATERIAL_I18N_KEYS.listCount), { shown: filtered.length, total: characters.length })}</span>
                            </>,
                            filtered,
                        )}
                        {filtered.length === 0 && <p className="px-2 py-2 text-xs text-fg-muted">{t(MATERIAL_I18N_KEYS.listEmpty)}</p>}
                    </>
                )}
            </div>
            {bulkActions && checked.size > 0 && (
                <div className="shrink-0 border-t border-line px-3 py-2 space-y-2">
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-bold">{format(t(MATERIAL_I18N_KEYS.bulkSelected), { count: checked.size })}</span>
                        <Button size="sm" variant="ghost" className="ml-auto" onClick={clearChecked}>{t(MATERIAL_I18N_KEYS.bulkClear)}</Button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">{bulkActions(checkedCharacters, clearChecked)}</div>
                </div>
            )}
        </div>
    );
};

export default CharacterListPane;
