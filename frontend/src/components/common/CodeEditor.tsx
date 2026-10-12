import React, { useEffect, useRef } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, placeholder as placeholderExt, drawSelection, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { search, searchKeymap, highlightSelectionMatches, openSearchPanel, closeSearchPanel, searchPanelOpen, getSearchQuery } from '@codemirror/search';
import { resolveMessage, type I18NCatalog } from '../../api/i18n';
import { CODE_EDITOR_I18N_KEYS, COMMON_TEXT_FALLBACK_JA } from '../../constants/i18n';

interface CodeEditorProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    /** Ctrl+S / Cmd+S が押されたときに呼ぶ。未指定なら何もしない（外側へ伝播する）。 */
    onSave?: () => void;
    uiCatalog?: I18NCatalog | null;
    className?: string;
}

// 検索パネルの文言を辞書から組み立てる。CodeMirror 側のキーは固定の原文なので、ここで翻訳へ対応付ける。
const buildPhrases = (uiCatalog: I18NCatalog | null | undefined): Record<string, string> => {
    const t = (key: string) => resolveMessage(uiCatalog ?? null, key, COMMON_TEXT_FALLBACK_JA[key] || key);
    return {
        'Find': t(CODE_EDITOR_I18N_KEYS.find),
        'Replace': t(CODE_EDITOR_I18N_KEYS.replace),
        'next': t(CODE_EDITOR_I18N_KEYS.next),
        'previous': t(CODE_EDITOR_I18N_KEYS.previous),
        'all': t(CODE_EDITOR_I18N_KEYS.all),
        'match case': t(CODE_EDITOR_I18N_KEYS.matchCase),
        'by word': t(CODE_EDITOR_I18N_KEYS.byWord),
        'regexp': t(CODE_EDITOR_I18N_KEYS.regexp),
        'replace': t(CODE_EDITOR_I18N_KEYS.replaceOne),
        'replace all': t(CODE_EDITOR_I18N_KEYS.replaceAll),
        'close': t(CODE_EDITOR_I18N_KEYS.close),
    };
};

type PanelMode = 'find' | 'replace';

// 一致件数の走査上限。巨大な本文で更新のたびに全件数えて重くならないよう打ち切る。
const MATCH_COUNT_LIMIT = 10000;

const formatCount = (template: string, values: Record<string, string | number>) =>
    Object.entries(values).reduce((text, [key, value]) => text.split(`{{${key}}}`).join(String(value)), template);

// 検索パネルが開いているとき、総一致件数と現在選択中の一致の番号を検索欄の右隣に表示する。
const updateMatchCount = (view: EditorView, uiCatalog: I18NCatalog | null | undefined) => {
    const input = view.dom.querySelector<HTMLInputElement>('.cm-panel.cm-search input[name="search"]');
    if (!input) return;
    let label = input.nextElementSibling as HTMLElement | null;
    if (!label || !label.classList.contains('cm-search-count')) {
        label = document.createElement('span');
        label.className = 'cm-search-count';
        input.insertAdjacentElement('afterend', label);
    }
    const query = getSearchQuery(view.state);
    if (!query.search || !query.valid) {
        label.textContent = '';
        return;
    }
    const { from, to } = view.state.selection.main;
    let total = 0;
    let current = 0;
    const cursor = query.getCursor(view.state.doc) as Iterator<{ from: number; to: number }>;
    for (let step = cursor.next(); !step.done && total < MATCH_COUNT_LIMIT; step = cursor.next()) {
        total++;
        if (step.value.from === from && step.value.to === to) current = total;
    }
    const t = (key: string) => resolveMessage(uiCatalog ?? null, key, COMMON_TEXT_FALLBACK_JA[key] || key);
    if (total === 0) {
        label.textContent = t(CODE_EDITOR_I18N_KEYS.noMatch);
        return;
    }
    const totalText = total >= MATCH_COUNT_LIMIT ? `${MATCH_COUNT_LIMIT}+` : String(total);
    label.textContent = formatCount(t(CODE_EDITOR_I18N_KEYS.matchCount), { current: current > 0 ? current : '-', total: totalText });
};

// 検索パネルの表示モードを切り替える。
// 同じモードで再度押されたら閉じ、別モードなら置換行の表示を切り替えてフォーカスを移す。
// モードは data 属性として保持し、CSS 側で置換行の表示・非表示を切り替える。
const togglePanel = (view: EditorView, mode: PanelMode): boolean => {
    const isOpen = searchPanelOpen(view.state);
    const current = view.dom.dataset.searchMode as PanelMode | undefined;
    if (isOpen && current === mode) {
        closeSearchPanel(view);
        delete view.dom.dataset.searchMode;
        return true;
    }
    view.dom.dataset.searchMode = mode;
    openSearchPanel(view);
    requestAnimationFrame(() => {
        const field = view.dom.querySelector<HTMLInputElement>(`.cm-panel.cm-search input[name="${mode === 'replace' ? 'replace' : 'search'}"]`);
        field?.focus();
        field?.select();
    });
    return true;
};

// 色は画面全体の設計値（CSS 変数）を参照するので、デザイン・明るさの切り替えに自動で追従する。
const editorTheme = EditorView.theme({
    '&': { height: '100%', backgroundColor: 'transparent', color: 'var(--c-fg)', fontSize: '0.875rem' },
    '.cm-scroller': { fontFamily: 'var(--ff-mono)', lineHeight: '1.5', overflow: 'auto' },
    '.cm-content': { caretColor: 'var(--c-fg)', padding: '0' },
    '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--c-fg-muted)', border: 'none', paddingRight: '0.75rem' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--c-fg)' },
    '&.cm-focused': { outline: 'none' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--c-fg)' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'var(--c-surface-2)' },
    '.cm-placeholder': { color: 'var(--c-fg-muted)' },
    '.cm-searchMatch': { backgroundColor: 'rgba(250, 204, 21, 0.35)', outline: '1px solid rgba(250, 204, 21, 0.55)' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'rgba(249, 115, 22, 0.55)', outline: '1px solid rgba(249, 115, 22, 0.9)' },
    '.cm-selectionMatch': { backgroundColor: 'var(--c-accent-soft)' },
});

// CodeMirror の既定の描き方（暗い画面用か明るい画面用か）。画面全体の data-mode に合わせる。
const modeTheme = (dark: boolean) => EditorView.theme({}, { dark });
const isDarkMode = () => document.documentElement.dataset.mode !== 'light';

/**
 * 設定ファイル・テンプレート用の本文エディタ。
 * Ctrl+F で検索、Ctrl+H で置換のパネルを右上に表示し、一致箇所をすべて強調する。
 */
export const CodeEditor: React.FC<CodeEditorProps> = ({ value, onChange, placeholder, onSave, uiCatalog, className }) => {
    const hostRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const onChangeRef = useRef(onChange);
    const onSaveRef = useRef(onSave);
    const uiCatalogRef = useRef(uiCatalog);
    const placeholderCompartment = useRef(new Compartment());
    const phrasesCompartment = useRef(new Compartment());
    const modeCompartment = useRef(new Compartment());
    // 外から本文を差し替えている最中（読み込みなど）。書き換えとして知らせない
    const applyingExternalRef = useRef(false);
    onChangeRef.current = onChange;
    onSaveRef.current = onSave;
    uiCatalogRef.current = uiCatalog;

    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;
        const state = EditorState.create({
            doc: value,
            extensions: [
                lineNumbers(),
                history(),
                drawSelection(),
                EditorView.lineWrapping,
                search({ top: true }),
                highlightSelectionMatches(),
                phrasesCompartment.current.of(EditorState.phrases.of(buildPhrases(uiCatalog))),
                placeholderCompartment.current.of(placeholder ? placeholderExt(placeholder) : []),
                keymap.of([
                    { key: 'Mod-f', run: view => togglePanel(view, 'find'), scope: 'editor search-panel', preventDefault: true },
                    { key: 'Mod-h', run: view => togglePanel(view, 'replace'), scope: 'editor search-panel', preventDefault: true },
                    { key: 'Mod-s', run: () => { if (!onSaveRef.current) return false; onSaveRef.current(); return true; }, preventDefault: true },
                    ...searchKeymap,
                    ...historyKeymap,
                    indentWithTab,
                    ...defaultKeymap,
                ]),
                editorTheme,
                modeCompartment.current.of(modeTheme(isDarkMode())),
                EditorView.updateListener.of(update => {
                    if (update.docChanged && !applyingExternalRef.current) onChangeRef.current(update.state.doc.toString());
                    if (searchPanelOpen(update.state)) updateMatchCount(update.view, uiCatalogRef.current);
                }),
            ],
        });
        const view = new EditorView({ state, parent: host });
        viewRef.current = view;
        // 明るさの切り替えを見張り、既定の描き方を差し替える
        const observer = new MutationObserver(() => {
            view.dispatch({ effects: modeCompartment.current.reconfigure(modeTheme(isDarkMode())) });
        });
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode'] });
        return () => {
            observer.disconnect();
            view.destroy();
            viewRef.current = null;
        };
        // 初期化は1回だけ行い、以降の props 変化は下の effect で反映する。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // 外側から本文が差し替えられたとき（ファイル読み込み・テンプレート適用等）だけ反映する。
    useEffect(() => {
        const view = viewRef.current;
        if (!view) return;
        const current = view.state.doc.toString();
        if (current === value) return;
        applyingExternalRef.current = true;
        try {
            view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
        } finally {
            applyingExternalRef.current = false;
        }
    }, [value]);

    useEffect(() => {
        viewRef.current?.dispatch({ effects: placeholderCompartment.current.reconfigure(placeholder ? placeholderExt(placeholder) : []) });
    }, [placeholder]);

    useEffect(() => {
        viewRef.current?.dispatch({ effects: phrasesCompartment.current.reconfigure(EditorState.phrases.of(buildPhrases(uiCatalog))) });
    }, [uiCatalog]);

    return <div ref={hostRef} className={`code-editor h-full min-h-0 ${className ?? ''}`} />;
};
