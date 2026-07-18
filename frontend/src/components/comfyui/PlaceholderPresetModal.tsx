/**
 * PlaceholderPresetModal.tsx - プレースホルダプリセット設定モーダル
 *
 * 「変換元 → 変換先 + AIへの説明」の組をプリセットとして保存・削除する。
 * 画像生成統合設定のプレースホルダ変換欄の遷移ボタンから開く。
 * 編集中の内容の JSON エクスポートと、ドラッグ&ドロップでのインポートに対応する
 * （インポートは編集領域へ読み込むだけで、保存ボタンを押すまで確定しない）。
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X, Save, Trash2, Info, Download, Upload } from 'lucide-react';
import {
    listPlaceholderPresets,
    savePlaceholderPreset,
    deletePlaceholderPreset,
} from '../../api/comfyui';
import type { PlaceholderPreset, PlaceholderEntry } from '../../api/comfyui';
import { createComfyUIText, formatComfyText } from './i18n';
import type { I18NCatalog } from '../../api/i18n';
import { PlaceholderEntriesEditor } from './PlaceholderEntriesEditor';
import { CollapsibleSection } from '../settings/CollapsibleSection';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    backendUrl: string;
    uiCatalog?: I18NCatalog | null;
    /** 保存・削除でプリセット一覧が変わったときに親へ通知する（一覧再読込用） */
    onPresetsChanged?: () => void;
}

// プルダウンの「(新規作成)」を表す番兵値（プリセット名としては presetname 検証で
// 使えない文字を含まないが、実名と衝突しないよう空文字を使う）
const NEW_PRESET = '';

export const PlaceholderPresetModal: React.FC<Props> = ({
    isOpen,
    onClose,
    backendUrl,
    uiCatalog = null,
    onPresetsChanged,
}) => {
    const { PLACEHOLDER_PRESET, COMMON } = createComfyUIText(uiCatalog);

    const [presets, setPresets] = useState<PlaceholderPreset[]>([]);
    const [selected, setSelected] = useState<string>(NEW_PRESET);
    const [nameInput, setNameInput] = useState('');
    const [entries, setEntries] = useState<PlaceholderEntry[]>([]);
    const [isSaving, setIsSaving] = useState(false);
    const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

    // インポート（ドラッグ&ドロップ / クリック選択）
    const [isDragOver, setIsDragOver] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const reload = useCallback(async () => {
        try {
            const list = await listPlaceholderPresets(backendUrl);
            setPresets(list);
            return list;
        } catch (e) {
            console.error('[PlaceholderPresetModal] preset load failed:', e);
            return [];
        }
    }, [backendUrl]);

    useEffect(() => {
        if (!isOpen) return;
        setMessage(null);
        void reload();
    }, [isOpen, reload]);

    const selectPreset = useCallback((name: string, list: PlaceholderPreset[]) => {
        setSelected(name);
        setMessage(null);
        if (name === NEW_PRESET) {
            setNameInput('');
            setEntries([]);
            return;
        }
        const preset = list.find(p => p.name === name);
        setNameInput(name);
        setEntries(preset ? preset.entries.map(e => ({ ...e })) : []);
    }, []);

    const handleSave = useCallback(async () => {
        const name = nameInput.trim();
        if (!name) {
            setMessage({ text: PLACEHOLDER_PRESET.MESSAGES.NAME_REQUIRED, isError: true });
            return;
        }
        setIsSaving(true);
        setMessage(null);
        try {
            const saved = await savePlaceholderPreset(
                backendUrl,
                name,
                entries.filter(e => e.from.trim() || e.to.trim() || (e.description || '').trim())
            );
            const list = await reload();
            selectPreset(saved, list);
            setMessage({ text: PLACEHOLDER_PRESET.MESSAGES.SAVED, isError: false });
            onPresetsChanged?.();
        } catch (e: any) {
            const detail = e?.response?.data?.error || e?.message || '';
            setMessage({ text: `${PLACEHOLDER_PRESET.MESSAGES.SAVE_FAILED}${detail ? `: ${detail}` : ''}`, isError: true });
        } finally {
            setIsSaving(false);
        }
    }, [backendUrl, nameInput, entries, reload, selectPreset, onPresetsChanged, PLACEHOLDER_PRESET]);

    const handleDelete = useCallback(async () => {
        if (selected === NEW_PRESET) return;
        if (!window.confirm(formatComfyText(PLACEHOLDER_PRESET.MESSAGES.DELETE_CONFIRM, { name: selected }))) return;
        setMessage(null);
        try {
            await deletePlaceholderPreset(backendUrl, selected);
            const list = await reload();
            selectPreset(NEW_PRESET, list);
            onPresetsChanged?.();
        } catch (e: any) {
            const detail = e?.response?.data?.error || e?.message || '';
            setMessage({ text: `${PLACEHOLDER_PRESET.MESSAGES.DELETE_FAILED}${detail ? `: ${detail}` : ''}`, isError: true });
        }
    }, [backendUrl, selected, reload, selectPreset, onPresetsChanged, PLACEHOLDER_PRESET]);

    // 編集中の内容を { name, entries } 形式の JSON としてダウンロードする
    const handleExport = useCallback(() => {
        const name = nameInput.trim();
        const validEntries = entries
            .filter(e => e.from.trim() && e.to.trim())
            .map(e => ({ from: e.from.trim(), to: e.to.trim(), description: (e.description || '').trim() }));
        const payload = JSON.stringify({ name, entries: validEntries }, null, 2);
        const blob = new Blob([payload], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${name || 'placeholder_preset'}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }, [nameInput, entries]);

    // JSON ファイルを編集領域へ読み込む（保存はしない。保存ボタンで確定）。
    // { name, entries } 形式（エクスポート/ストア形式）と entries 配列直置きの両方を受ける。
    const processImportFile = useCallback(async (file: File) => {
        if (!file.name.toLowerCase().endsWith('.json')) {
            setMessage({ text: COMMON.MESSAGES.JSON_ONLY, isError: true });
            return;
        }
        try {
            const text = await file.text();
            const json = JSON.parse(text);
            const rawEntries = Array.isArray(json) ? json : json?.entries;
            const imported: PlaceholderEntry[] = [];
            if (Array.isArray(rawEntries)) {
                for (const raw of rawEntries) {
                    if (!raw || typeof raw !== 'object') continue;
                    const from = typeof raw.from === 'string' ? raw.from.trim() : '';
                    const to = typeof raw.to === 'string' ? raw.to.trim() : '';
                    const description = typeof raw.description === 'string' ? raw.description.trim() : '';
                    if (!from || !to) continue;
                    imported.push({ from, to, description });
                }
            }
            if (imported.length === 0) {
                setMessage({ text: PLACEHOLDER_PRESET.MESSAGES.IMPORT_INVALID, isError: true });
                return;
            }
            const importedName = (!Array.isArray(json) && typeof json?.name === 'string' && json.name.trim())
                ? json.name.trim()
                : file.name.replace(/\.json$/i, '');
            setSelected(NEW_PRESET);
            setNameInput(importedName);
            setEntries(imported);
            setMessage({ text: PLACEHOLDER_PRESET.MESSAGES.IMPORTED, isError: false });
        } catch (e) {
            console.error('[PlaceholderPresetModal] import failed:', e);
            setMessage({ text: PLACEHOLDER_PRESET.MESSAGES.IMPORT_FAILED, isError: true });
        }
    }, [COMMON.MESSAGES.JSON_ONLY, PLACEHOLDER_PRESET.MESSAGES]);

    // ドラッグ&ドロップ
    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(true);
    };
    const handleDragLeave = () => setIsDragOver(false);
    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(false);
        const file = e.dataTransfer.files[0];
        if (file) void processImportFile(file);
    };

    // クリックでファイル選択
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) void processImportFile(file);
        // 同じファイルを連続で選べるようにリセット
        e.target.value = '';
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="bg-gray-900 rounded-xl shadow-2xl border border-gray-700 flex flex-col w-[640px] max-w-[92vw] max-h-[85vh]">
                {/* ヘッダー */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700 bg-gray-800 rounded-t-xl shrink-0">
                    <h3 className="text-base font-semibold text-gray-100">{PLACEHOLDER_PRESET.TITLE}</h3>
                    <button
                        onClick={onClose}
                        className="p-1.5 hover:bg-gray-700 rounded text-gray-400 hover:text-gray-200 transition-colors"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* 本体 */}
                <div className="p-5 space-y-4 overflow-y-auto custom-scrollbar">
                    {/* 説明 */}
                    <div className="flex items-start gap-2 text-xs text-gray-500 bg-gray-800/50 border border-gray-700 rounded-lg px-3 py-2">
                        <Info size={14} className="shrink-0 mt-0.5 text-cyan-400" />
                        <span>{PLACEHOLDER_PRESET.MESSAGES.DESCRIPTION_HELP}</span>
                    </div>

                    {/* プリセット選択 + 削除 */}
                    <div className="flex items-center gap-2">
                        <label className="text-sm text-gray-400 w-24 shrink-0">{PLACEHOLDER_PRESET.LABELS.PRESET}</label>
                        <select
                            value={selected}
                            onChange={e => selectPreset(e.target.value, presets)}
                            className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 outline-none focus:border-purple-500"
                        >
                            <option value={NEW_PRESET}>{PLACEHOLDER_PRESET.PLACEHOLDERS.NEW_PRESET}</option>
                            {presets.map(p => (
                                <option key={p.name} value={p.name}>{p.name}</option>
                            ))}
                        </select>
                        <button
                            type="button"
                            onClick={handleDelete}
                            disabled={selected === NEW_PRESET}
                            title={PLACEHOLDER_PRESET.MESSAGES.DELETE_PRESET_TOOLTIP}
                            className="p-2 rounded text-gray-500 hover:text-red-400 hover:bg-gray-700 disabled:opacity-40 disabled:pointer-events-none transition-colors"
                        >
                            <Trash2 size={16} />
                        </button>
                        <button
                            type="button"
                            onClick={handleExport}
                            disabled={!entries.some(e => e.from.trim() && e.to.trim())}
                            title={PLACEHOLDER_PRESET.MESSAGES.EXPORT_TOOLTIP}
                            className="p-2 rounded text-gray-500 hover:text-cyan-400 hover:bg-gray-700 disabled:opacity-40 disabled:pointer-events-none transition-colors"
                        >
                            <Download size={16} />
                        </button>
                    </div>

                    {/* プリセット名 */}
                    <div className="flex items-center gap-2">
                        <label className="text-sm text-gray-400 w-24 shrink-0">{PLACEHOLDER_PRESET.LABELS.NAME}</label>
                        <input
                            type="text"
                            value={nameInput}
                            onChange={e => setNameInput(e.target.value)}
                            placeholder={PLACEHOLDER_PRESET.PLACEHOLDERS.NAME}
                            className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 outline-none focus:border-purple-500"
                        />
                    </div>

                    {/* エントリ編集（説明列あり） */}
                    <PlaceholderEntriesEditor
                        entries={entries}
                        onChange={setEntries}
                        showDescription
                        uiCatalog={uiCatalog}
                    />

                    {/* インポート領域（開閉・デフォルト閉） */}
                    <CollapsibleSection
                        title={
                            <>
                                <Upload size={16} className="text-cyan-400" />
                                {PLACEHOLDER_PRESET.MESSAGES.IMPORT_SECTION}
                            </>
                        }
                    >
                        <div
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                            onDrop={handleDrop}
                            onClick={() => fileInputRef.current?.click()}
                            className={`relative border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-all ${isDragOver
                                ? 'border-cyan-400 bg-cyan-900/20'
                                : 'border-gray-600 hover:border-cyan-500 hover:bg-gray-800/50'
                                }`}
                        >
                            <div className="space-y-2">
                                <Upload size={24} className="mx-auto text-gray-500" />
                                <p className="text-sm text-gray-400">
                                    {PLACEHOLDER_PRESET.MESSAGES.DROP_TEXT}<br />
                                    {PLACEHOLDER_PRESET.MESSAGES.DROP_ACTION}
                                </p>
                                <p className="text-xs text-gray-600">
                                    {PLACEHOLDER_PRESET.MESSAGES.DROP_HINT}
                                </p>
                            </div>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".json"
                                onChange={handleFileChange}
                                className="hidden"
                            />
                        </div>
                    </CollapsibleSection>
                </div>

                {/* フッター */}
                <div className="flex items-center justify-between px-5 py-3 border-t border-gray-700 bg-gray-800/60 rounded-b-xl shrink-0">
                    <span className={`text-xs ${message?.isError ? 'text-red-400' : 'text-green-400'}`}>
                        {message?.text || ''}
                    </span>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-1.5 rounded-lg text-sm text-gray-300 hover:bg-gray-700 transition-colors"
                        >
                            {COMMON.BUTTONS.CLOSE}
                        </button>
                        <button
                            type="button"
                            onClick={handleSave}
                            disabled={isSaving}
                            className="flex items-center gap-1.5 px-4 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded-lg text-sm text-white transition-colors"
                        >
                            <Save size={14} />
                            {isSaving ? COMMON.BUTTONS.SAVING : COMMON.BUTTONS.SAVE}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
