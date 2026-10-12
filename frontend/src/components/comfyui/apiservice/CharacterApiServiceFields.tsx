/**
 * CharacterApiServiceFields.tsx - API サービス側の人物プロンプト欄
 *
 * キャラクタープロンプト・身体的特徴・服装（名前とプロンプト）・追加ポジティブ／ネガティブ・
 * 参照画像。キャラ設定の API サービスタブと、ユーザーの容姿設定の両方で使う。LoRA は無い。
 */

import React from 'react';
import { Trash2, Shirt, Image as ImageIcon } from 'lucide-react';
import type { ApiServiceOutfit, CharacterApiServiceConfig, ReferenceImage } from '../../../api/comfyui';
import type { I18NCatalog } from '../../../api/i18n';
import { createComfyUIText } from '../i18n';
import { ReferenceImageField } from './ReferenceImageField';

export interface ReferenceImageHandlers {
    imageUrl: (ref: ReferenceImage) => string;
    onAdd: (file: File) => Promise<void>;
    onRemove: (id: string) => Promise<void>;
    /** モデルが参照画像に対応しないときの注記（無効表示） */
    disabledNote?: string;
}

interface CharacterApiServiceFieldsProps {
    uiCatalog?: I18NCatalog | null;
    value: CharacterApiServiceConfig;
    /**
     * 変更通知。commit が true の操作（服装の追加・削除、参照画像の種別・強さ・忠実度の変更）は
     * 入力欄を離れる契機が無いため、即時保存する画面はここで保存する。
     */
    onChange: (next: CharacterApiServiceConfig, commit?: boolean) => void;
    referenceImages?: ReferenceImageHandlers;
    /** キャラクタープロンプト欄の右上に置くボタン（容姿プロンプトを AI に作らせる等） */
    promptAction?: React.ReactNode;
    /** 入力欄を離れたときに呼ぶ（即時保存する画面用） */
    onBlurField?: () => void;
    description?: string;
}

const inputClass = 'w-full bg-surface border border-line-strong rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-accent transition-colors';
const smallInputClass = 'w-full bg-surface border border-line-strong rounded px-2 py-1.5 text-sm text-fg outline-none focus:border-accent';

export const CharacterApiServiceFields: React.FC<CharacterApiServiceFieldsProps> = ({
    uiCatalog = null,
    value,
    onChange,
    referenceImages,
    promptAction,
    onBlurField,
    description,
}) => {
    const { CHARACTER, COMMON } = createComfyUIText(uiCatalog);
    const update = (patch: Partial<CharacterApiServiceConfig>, commit = false) => onChange({ ...value, ...patch }, commit);
    const outfits = value.outfits ?? [];

    const updateOutfit = (index: number, patch: Partial<ApiServiceOutfit>) => {
        const next = outfits.map((o, i) => (i === index ? { ...o, ...patch } : o));
        update({ outfits: next });
    };
    // 追加直後の空行は編集途中の画面状態（保存すると空行は落ちるため、入力して欄を離れたときに保存する）。
    const addOutfit = () => update({ outfits: [...outfits, { name: '', prompt: '' }] });
    const removeOutfit = (index: number) => update({ outfits: outfits.filter((_, i) => i !== index) }, true);

    const updateReference = (id: string, patch: Partial<Pick<ReferenceImage, 'kind' | 'strength' | 'fidelity'>>) => {
        const next = (value.referenceImages ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r));
        update({ referenceImages: next }, true);
    };

    return (
        <div className="space-y-4">
            {description && <p className="text-xs text-fg-muted">{description}</p>}

            {/* キャラクタープロンプト */}
            <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                    <label className="text-sm font-medium text-fg-muted">{CHARACTER.LABELS.CHARACTER_PROMPT}</label>
                    {promptAction}
                </div>
                <textarea
                    value={value.characterPrompt}
                    onChange={(e) => update({ characterPrompt: e.target.value })}
                    onBlur={onBlurField}
                    placeholder={CHARACTER.PLACEHOLDERS.CHARACTER_PROMPT}
                    className={`${inputClass} resize-y`}
                    rows={2}
                />
                <p className="text-xs text-fg-muted">{CHARACTER.HELP.API_PROMPT_DESC}</p>
            </div>

            {/* 身体的特徴 */}
            <div className="space-y-1">
                <label className="text-sm font-medium text-fg-muted">{CHARACTER.LABELS.PHYSICAL_FEATURES}</label>
                <textarea
                    value={value.physicalFeatures}
                    onChange={(e) => update({ physicalFeatures: e.target.value })}
                    onBlur={onBlurField}
                    placeholder={CHARACTER.PLACEHOLDERS.PHYSICAL_FEATURES}
                    className={`${inputClass} resize-y`}
                    rows={2}
                />
                <p className="text-xs text-fg-muted">{CHARACTER.HELP.PHYSICAL_FEATURES_DESC}</p>
            </div>

            {/* 服装設定（名前とプロンプトのみ） */}
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-sm font-medium text-fg-muted">
                        <Shirt size={16} className="text-accent" />
                        {CHARACTER.LABELS.OUTFIT_SETTINGS}
                    </label>
                    <button
                        type="button"
                        onClick={addOutfit}
                        className="px-2 py-1 bg-surface border border-line-strong rounded text-xs text-ok hover:bg-ok/10 transition-colors"
                    >
                        {COMMON.BUTTONS.ADD}
                    </button>
                </div>
                {outfits.length === 0 ? (
                    <button
                        type="button"
                        onClick={addOutfit}
                        className="w-full border border-dashed border-line-strong rounded-lg px-3 py-3 text-sm text-fg-muted hover:border-line-strong hover:text-ok transition-colors"
                    >
                        {COMMON.BUTTONS.ADD_OUTFIT}
                    </button>
                ) : (
                    <div className="space-y-2">
                        {outfits.map((outfit, idx) => (
                            <div key={idx} className="bg-surface border border-line-strong rounded-lg p-3 space-y-2">
                                <div className="flex items-center gap-2">
                                    <input
                                        type="text"
                                        value={outfit.name}
                                        onChange={(e) => updateOutfit(idx, { name: e.target.value })}
                                        onBlur={onBlurField}
                                        placeholder={CHARACTER.PLACEHOLDERS.OUTFIT_NAME}
                                        className={`flex-1 ${smallInputClass}`}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => removeOutfit(idx)}
                                        className="p-1 text-fg-muted hover:text-danger transition-colors"
                                        title={COMMON.MESSAGES.DELETE_OUTFIT_TOOLTIP}
                                    >
                                        <Trash2 size={15} />
                                    </button>
                                </div>
                                <textarea
                                    value={outfit.prompt}
                                    onChange={(e) => updateOutfit(idx, { prompt: e.target.value })}
                                    onBlur={onBlurField}
                                    placeholder={CHARACTER.PLACEHOLDERS.OUTFIT_PROMPT}
                                    className={`${smallInputClass} resize-y`}
                                    rows={2}
                                />
                            </div>
                        ))}
                    </div>
                )}
                <p className="text-xs text-fg-muted">{CHARACTER.HELP.API_OUTFIT_DESC}</p>
            </div>

            {/* 追加ポジティブ / ネガティブ */}
            <div className="space-y-1">
                <label className="text-sm font-medium text-fg-muted">{CHARACTER.LABELS.EXTRA_POSITIVE}</label>
                <input
                    type="text"
                    value={value.extraPositive}
                    onChange={(e) => update({ extraPositive: e.target.value })}
                    onBlur={onBlurField}
                    placeholder={CHARACTER.PLACEHOLDERS.EXTRA_POSITIVE}
                    className={inputClass}
                />
            </div>
            <div className="space-y-1">
                <label className="text-sm font-medium text-fg-muted">{CHARACTER.LABELS.EXTRA_NEGATIVE}</label>
                <input
                    type="text"
                    value={value.extraNegative}
                    onChange={(e) => update({ extraNegative: e.target.value })}
                    onBlur={onBlurField}
                    placeholder={CHARACTER.PLACEHOLDERS.EXTRA_NEGATIVE}
                    className={inputClass}
                />
            </div>

            {/* 参照画像 */}
            {referenceImages && (
                <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm font-medium text-fg-muted">
                        <ImageIcon size={16} className="text-accent" />
                        {CHARACTER.LABELS.REFERENCE_IMAGES}
                    </label>
                    <ReferenceImageField
                        uiCatalog={uiCatalog}
                        images={value.referenceImages ?? []}
                        imageUrl={referenceImages.imageUrl}
                        onAdd={referenceImages.onAdd}
                        onRemove={referenceImages.onRemove}
                        onUpdate={updateReference}
                        disabled={!!referenceImages.disabledNote}
                        note={referenceImages.disabledNote}
                    />
                </div>
            )}
        </div>
    );
};
