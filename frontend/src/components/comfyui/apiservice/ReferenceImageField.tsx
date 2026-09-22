/**
 * ReferenceImageField.tsx - 参照画像（人物の見た目を指示する画像）の受け口とサムネイル一覧
 *
 * ファイル選択・ドラッグ＆ドロップで登録し、登録後はサムネイルと種別・強さ・忠実度を並べる。
 * 登録・削除は即時（親が API を呼ぶ）。種別・強さ・忠実度の変更は親の保存に乗る。
 */

import React, { useEffect, useRef, useState } from 'react';
import { ImagePlus, Trash2, Loader2, AlertCircle } from 'lucide-react';
import type { ReferenceImage, ReferenceImageKind } from '../../../api/comfyui';
import { resolveAuthedUrl } from '../../../api/comfyui';
import type { I18NCatalog } from '../../../api/i18n';
import { createComfyUIText, formatComfyText } from '../i18n';

const MAX_REFERENCE_IMAGES = 4;

interface ReferenceImageFieldProps {
    uiCatalog?: I18NCatalog | null;
    images: ReferenceImage[];
    /** サムネイル取得用の URL（認証付き取得は本部品が行う） */
    imageUrl: (ref: ReferenceImage) => string;
    onAdd: (file: File) => Promise<void>;
    onRemove: (id: string) => Promise<void>;
    onUpdate: (id: string, patch: Partial<Pick<ReferenceImage, 'kind' | 'strength' | 'fidelity'>>) => void;
    /** 無効表示（モデルが対応しないとき）。note を添える */
    disabled?: boolean;
    note?: string;
}

const KIND_OPTIONS: ReferenceImageKind[] = ['character', 'style', 'character&style'];

export const ReferenceImageField: React.FC<ReferenceImageFieldProps> = ({
    uiCatalog = null,
    images,
    imageUrl,
    onAdd,
    onRemove,
    onUpdate,
    disabled = false,
    note,
}) => {
    const { REFERENCE_IMAGE } = createComfyUIText(uiCatalog);
    const [isDragOver, setIsDragOver] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [thumbs, setThumbs] = useState<Record<string, string>>({});
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const next: Record<string, string> = {};
            for (const ref of images) {
                try {
                    next[ref.id] = await resolveAuthedUrl(imageUrl(ref));
                } catch {
                    // 取得できない画像はサムネイル無しで並べる
                }
            }
            if (!cancelled) setThumbs(next);
        })();
        return () => {
            cancelled = true;
        };
    }, [images, imageUrl]);

    const kindLabel = (kind: ReferenceImageKind) =>
        kind === 'style' ? REFERENCE_IMAGE.LABELS.KIND_STYLE
            : kind === 'character&style' ? REFERENCE_IMAGE.LABELS.KIND_BOTH
                : REFERENCE_IMAGE.LABELS.KIND_CHARACTER;

    const handleFile = async (file: File | undefined) => {
        if (!file || disabled) return;
        if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
            setError(REFERENCE_IMAGE.MESSAGES.IMAGE_ONLY);
            return;
        }
        setBusy(true);
        setError(null);
        try {
            await onAdd(file);
        } catch (e) {
            console.error('[ReferenceImageField] add failed:', e);
            setError(REFERENCE_IMAGE.MESSAGES.UPLOAD_FAILED);
        } finally {
            setBusy(false);
        }
    };

    const handleRemove = async (id: string) => {
        if (!confirm(REFERENCE_IMAGE.MESSAGES.DELETE_CONFIRM)) return;
        setBusy(true);
        try {
            await onRemove(id);
        } catch (e) {
            console.error('[ReferenceImageField] remove failed:', e);
        } finally {
            setBusy(false);
        }
    };

    const canAdd = !disabled && !busy && images.length < MAX_REFERENCE_IMAGES;

    return (
        <div className={`space-y-2 ${disabled ? 'opacity-60' : ''}`}>
            {note && <p className="text-xs text-amber-300">{note}</p>}
            <div
                onDragOver={(e) => { e.preventDefault(); if (canAdd) setIsDragOver(true); }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setIsDragOver(false); void handleFile(e.dataTransfer.files[0]); }}
                onClick={() => { if (canAdd) inputRef.current?.click(); }}
                className={`border-2 border-dashed rounded-lg p-3 text-center text-xs transition-colors ${
                    canAdd ? 'cursor-pointer' : 'cursor-not-allowed'
                } ${isDragOver ? 'border-green-400 bg-green-900/20' : 'border-gray-600 hover:border-green-500'}`}
            >
                {busy ? <Loader2 size={16} className="mx-auto animate-spin text-gray-500" /> : <ImagePlus size={16} className="mx-auto text-gray-500" />}
                <p className="text-gray-400 mt-1">{REFERENCE_IMAGE.MESSAGES.DROP_TEXT}</p>
                <p className="text-gray-600">{formatComfyText(REFERENCE_IMAGE.MESSAGES.LIMIT, { max: MAX_REFERENCE_IMAGES })}</p>
                <input
                    ref={inputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => { void handleFile(e.target.files?.[0]); e.target.value = ''; }}
                />
            </div>
            {error && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs bg-red-900/30 border border-red-700/50 text-red-300">
                    <AlertCircle size={12} />
                    {error}
                </div>
            )}
            {images.length > 0 && (
                <div className="space-y-2">
                    {images.map((ref) => (
                        <div key={ref.id} className="flex items-start gap-3 bg-gray-800/60 border border-gray-700 rounded-lg p-2">
                            <div className="w-16 h-20 shrink-0 bg-gray-900 rounded overflow-hidden flex items-center justify-center">
                                {thumbs[ref.id]
                                    ? <img src={thumbs[ref.id]} alt="" className="w-full h-full object-cover" />
                                    : <ImagePlus size={14} className="text-gray-600" />}
                            </div>
                            <div className="flex-1 min-w-0 grid grid-cols-3 gap-2">
                                <label className="space-y-0.5 col-span-3">
                                    <span className="text-[11px] text-gray-500">{REFERENCE_IMAGE.LABELS.KIND}</span>
                                    <select
                                        value={ref.kind}
                                        disabled={disabled}
                                        onChange={(e) => onUpdate(ref.id, { kind: e.target.value as ReferenceImageKind })}
                                        className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 outline-none focus:border-green-500 disabled:opacity-50"
                                    >
                                        {KIND_OPTIONS.map((k) => (
                                            <option key={k} value={k}>{kindLabel(k)}</option>
                                        ))}
                                    </select>
                                </label>
                                <label className="space-y-0.5 col-span-3 sm:col-span-1">
                                    <span className="text-[11px] text-gray-500">{REFERENCE_IMAGE.LABELS.STRENGTH}: {ref.strength.toFixed(2)}</span>
                                    <input type="range" min={0} max={1} step={0.05} value={ref.strength} disabled={disabled} onChange={(e) => onUpdate(ref.id, { strength: Number(e.target.value) })} className="w-full accent-green-500" />
                                </label>
                                <label className="space-y-0.5 col-span-3 sm:col-span-1">
                                    <span className="text-[11px] text-gray-500">{REFERENCE_IMAGE.LABELS.FIDELITY}: {ref.fidelity.toFixed(2)}</span>
                                    <input type="range" min={0} max={1} step={0.05} value={ref.fidelity} disabled={disabled} onChange={(e) => onUpdate(ref.id, { fidelity: Number(e.target.value) })} className="w-full accent-green-500" />
                                </label>
                            </div>
                            <button
                                type="button"
                                onClick={() => void handleRemove(ref.id)}
                                disabled={busy}
                                className="p-1 text-gray-500 hover:text-red-400 transition-colors disabled:opacity-40"
                            >
                                <Trash2 size={14} />
                            </button>
                        </div>
                    ))}
                </div>
            )}
            <p className="text-xs text-gray-600">{REFERENCE_IMAGE.MESSAGES.COST_NOTE}</p>
        </div>
    );
};
