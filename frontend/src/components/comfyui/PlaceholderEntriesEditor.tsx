/**
 * PlaceholderEntriesEditor.tsx - プレースホルダ変換エントリの編集リスト
 *
 * 「変換元 → 変換先 (+ AIへの説明)」の行を編集する。末尾に常に空行を1つ表示し、
 * 入力されると行が実体化して次の空行が現れる。既存行はゴミ箱ボタンで削除できる。
 * プレースホルダ設定モーダル（説明列あり）と統合設定のインライン直接指定
 * （説明列なし）の両方で使う。
 */

import React from 'react';
import { Trash2 } from 'lucide-react';
import type { PlaceholderEntry, TagTargets } from '../../api/comfyui';
import { tagTargetsOf } from '../../api/comfyui';
import { createComfyUIText } from './i18n';
import type { I18NCatalog } from '../../api/i18n';

interface Props {
    entries: PlaceholderEntry[];
    onChange: (entries: PlaceholderEntry[]) => void;
    /** AIへの説明列を表示するか（モーダル: true / インライン直接指定: false） */
    showDescription?: boolean;
    /** 適用先（ComfyUI / API）のチェック列を表示するか（モーダル: true） */
    showTargets?: boolean;
    uiCatalog?: I18NCatalog | null;
}

const EMPTY_ENTRY: PlaceholderEntry = { from: '', to: '', description: '' };

export const PlaceholderEntriesEditor: React.FC<Props> = ({
    entries,
    onChange,
    showDescription = false,
    showTargets = false,
    uiCatalog = null,
}) => {
    const { PLACEHOLDER_PRESET, TAG_MAPPING } = createComfyUIText(uiCatalog);

    // 適用先の変更。両方付いた状態は項目を持たない形へ揃える（既存データと同じ形）。
    const setTarget = (index: number, key: keyof TagTargets, checked: boolean) => {
        const next = { ...tagTargetsOf(entries[index]), [key]: checked };
        onChange(entries.map((entry, i) => (i === index ? { ...entry, targets: next.comfyui && next.api ? undefined : next } : entry)));
    };

    // 表示行 = 実体行 + 末尾の空行1つ（「入力されると1行追加」の実現）
    const rows = [...entries, { ...EMPTY_ENTRY }];

    const updateRow = (index: number, patch: Partial<PlaceholderEntry>) => {
        if (index < entries.length) {
            onChange(entries.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));
        } else {
            // 末尾の空行への入力で行を実体化する
            onChange([...entries, { ...EMPTY_ENTRY, ...patch }]);
        }
    };

    const removeRow = (index: number) => {
        onChange(entries.filter((_, i) => i !== index));
    };

    const inputClass =
        'flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 outline-none focus:border-purple-500 transition-colors';

    return (
        <div className="space-y-1">
            {/* ヘッダー行 */}
            <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
                <span className="flex-1">{PLACEHOLDER_PRESET.LABELS.FROM}</span>
                <span className="flex-1">{PLACEHOLDER_PRESET.LABELS.TO}</span>
                {showDescription && <span className="flex-1">{PLACEHOLDER_PRESET.LABELS.DESCRIPTION}</span>}
                {showTargets && (
                    <>
                        <span className="w-14 shrink-0 text-center">{TAG_MAPPING.LABELS.TARGET_COMFYUI}</span>
                        <span className="w-10 shrink-0 text-center">{TAG_MAPPING.LABELS.TARGET_API}</span>
                    </>
                )}
                <span className="w-7 shrink-0" />
            </div>
            {rows.map((row, index) => {
                const isGhost = index >= entries.length;
                const targets = tagTargetsOf(row);
                return (
                    <div key={index} className="flex items-center gap-1.5">
                        <input
                            type="text"
                            value={row.from}
                            onChange={e => updateRow(index, { from: e.target.value })}
                            placeholder={PLACEHOLDER_PRESET.PLACEHOLDERS.FROM}
                            className={inputClass}
                        />
                        <input
                            type="text"
                            value={row.to}
                            onChange={e => updateRow(index, { to: e.target.value })}
                            placeholder={PLACEHOLDER_PRESET.PLACEHOLDERS.TO}
                            className={inputClass}
                        />
                        {showDescription && (
                            <input
                                type="text"
                                value={row.description || ''}
                                onChange={e => updateRow(index, { description: e.target.value })}
                                placeholder={PLACEHOLDER_PRESET.PLACEHOLDERS.DESCRIPTION}
                                className={inputClass}
                            />
                        )}
                        {showTargets && (
                            <>
                                <span className="w-14 shrink-0 flex justify-center">
                                    <input type="checkbox" checked={targets.comfyui} disabled={isGhost}
                                        onChange={e => setTarget(index, 'comfyui', e.target.checked)}
                                        className="accent-purple-500 cursor-pointer disabled:opacity-0" title={TAG_MAPPING.LABELS.TARGET_COMFYUI} />
                                </span>
                                <span className="w-10 shrink-0 flex justify-center">
                                    <input type="checkbox" checked={targets.api} disabled={isGhost}
                                        onChange={e => setTarget(index, 'api', e.target.checked)}
                                        className="accent-purple-500 cursor-pointer disabled:opacity-0" title={TAG_MAPPING.LABELS.TARGET_API} />
                                </span>
                            </>
                        )}
                        <button
                            type="button"
                            onClick={() => removeRow(index)}
                            disabled={isGhost}
                            className="w-7 shrink-0 p-1.5 rounded text-gray-500 hover:text-red-400 hover:bg-gray-700 disabled:opacity-0 disabled:pointer-events-none transition-colors"
                        >
                            <Trash2 size={14} />
                        </button>
                    </div>
                );
            })}
        </div>
    );
};
