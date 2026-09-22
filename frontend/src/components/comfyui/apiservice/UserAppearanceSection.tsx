/**
 * UserAppearanceSection.tsx - ユーザー（会話の相手）の容姿設定
 *
 * 画像生成設定の API サービスタブに全体で 1 つ置く。呼び名と、キャラ設定の API サービス側と
 * 同じ構成の欄（容姿プロンプト・身体的特徴・服装・追加ポジティブ／ネガティブ・参照画像）。
 * 入力欄を離れたときに保存する（GET → 差し替え → PUT）。参照画像の登録・削除は即時。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { User, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import {
    addUserReferenceImage,
    deleteUserReferenceImage,
    forgetAuthedUrl,
    getApiServiceUserAppearance,
    getUserReferenceImageUrl,
    saveApiServiceUserAppearance,
} from '../../../api/comfyui';
import type { ApiServiceId, CharacterApiServiceConfig, ReferenceImage, UserAppearance } from '../../../api/comfyui';
import type { I18NCatalog } from '../../../api/i18n';
import { createComfyUIText } from '../i18n';
import { CharacterApiServiceFields } from './CharacterApiServiceFields';
import { useApiReferenceDisabledNote } from './useApiReferenceSupport';

interface UserAppearanceSectionProps {
    backendUrl: string;
    uiCatalog?: I18NCatalog | null;
    service: ApiServiceId;
    active: boolean;
    /** 参照画像が使えないモデルのときの注記（無効表示）。指定が無ければこの部品が判定する */
    referenceDisabledNote?: string;
    /** 変わるたびに参照画像の可否を読み直す印（使用モデルの切り替え後など） */
    referenceRefreshKey?: unknown;
    hideHeading?: boolean;
}

const emptyAppearance = (): UserAppearance => ({
    names: [],
    characterPrompt: '',
    physicalFeatures: '',
    outfits: [],
    extraPositive: '',
    extraNegative: '',
    referenceImages: [],
});

export const UserAppearanceSection: React.FC<UserAppearanceSectionProps> = ({
    backendUrl,
    uiCatalog = null,
    service,
    active,
    referenceDisabledNote,
    referenceRefreshKey,
    hideHeading = false,
}) => {
    const { CHARACTER, COMMON, SECTION_NAMES } = createComfyUIText(uiCatalog);
    // 親から注記が来なければ、全体の設定で選ばれている使用モデルで参照画像の可否を判定する。
    const autoReferenceNote = useApiReferenceDisabledNote(backendUrl, service, active && referenceDisabledNote === undefined, uiCatalog, {
        refreshKey: referenceRefreshKey,
    });
    const effectiveReferenceNote = referenceDisabledNote ?? autoReferenceNote;
    const [appearance, setAppearance] = useState<UserAppearance>(emptyAppearance());
    const [namesText, setNamesText] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
    // 画面の最新値（保存はこれを送る）。保存応答で画面を上書きしないため、編集途中の空行や
    // 保存待ち中の変更が応答に戻されることはない。
    const latestRef = useRef<UserAppearance>(emptyAppearance());
    // 保存済みの値との差があるか（保存応答時に「送った値」と最新値を比べて決める）。
    const dirtyRef = useRef(false);
    // 保存の直列化（先に発行した保存の応答が後から届いて最新の操作を戻さないようにする）。
    const saveChain = useRef<Promise<void>>(Promise.resolve());
    const pendingRef = useRef(false);

    const applyLoaded = (loaded: UserAppearance) => {
        const merged = { ...emptyAppearance(), ...loaded };
        latestRef.current = merged;
        setAppearance(merged);
        setNamesText((merged.names ?? []).join(', '));
        dirtyRef.current = false;
    };

    const load = useCallback(async () => {
        setIsLoading(true);
        try {
            applyLoaded(await getApiServiceUserAppearance(backendUrl, service));
        } catch (e) {
            console.error('[UserAppearanceSection] load failed:', e);
        } finally {
            setIsLoading(false);
        }
    }, [backendUrl, service]);

    useEffect(() => {
        if (!active) return;
        setNotice(null);
        void load();
    }, [active, load]);

    // 保存は直列化し、実行時点の最新値を送る。応答は画面へ戻さず、最新値が送った値と
    // 変わっていれば未保存のままにする（連続操作の最後の値が最後の保存値になる）。
    const saveOnce = useCallback(async (): Promise<boolean> => {
        const sending = latestRef.current;
        setIsSaving(true);
        setNotice(null);
        try {
            await saveApiServiceUserAppearance(backendUrl, sending, service);
            if (latestRef.current === sending) {
                dirtyRef.current = false;
                setNotice({ ok: true, text: COMMON.MESSAGES.SAVED });
                setTimeout(() => setNotice(null), 2000);
            }
            return true;
        } catch (e) {
            console.error('[UserAppearanceSection] save failed:', e);
            dirtyRef.current = true;
            setNotice({ ok: false, text: COMMON.MESSAGES.SAVE_FAILED });
            return false;
        } finally {
            setIsSaving(false);
        }
    }, [backendUrl, service, COMMON.MESSAGES.SAVED, COMMON.MESSAGES.SAVE_FAILED]);

    const persist = useCallback(() => {
        if (pendingRef.current) return saveChain.current;
        pendingRef.current = true;
        const run = async () => {
            pendingRef.current = false;
            await saveOnce();
        };
        saveChain.current = saveChain.current.then(run, run);
        return saveChain.current;
    }, [saveOnce]);

    // 参照画像の追加・削除は同じ設定を書き換えるため、保存と同じ列で順に実行する。
    // 未保存の編集は先に保存し、失敗したら操作を行わない。操作後は全体を読み直さず、
    // 参照画像の一覧だけを操作結果で更新する（編集中の値を保つ）。
    const runReferenceOperation = useCallback((operation: () => Promise<(refs: ReferenceImage[]) => ReferenceImage[]>) => {
        const run = async () => {
            if (dirtyRef.current && !(await saveOnce())) {
                throw new Error('user appearance save failed before the reference image operation');
            }
            let apply: (refs: ReferenceImage[]) => ReferenceImage[];
            try {
                apply = await operation();
            } catch (e) {
                setNotice({ ok: false, text: COMMON.MESSAGES.SAVE_FAILED });
                throw e;
            }
            const current = latestRef.current;
            const next = { ...current, referenceImages: apply(current.referenceImages ?? []) };
            latestRef.current = next;
            setAppearance(next);
        };
        const result = saveChain.current.then(run, run);
        saveChain.current = result.catch(() => undefined);
        return result;
    }, [saveOnce, COMMON.MESSAGES.SAVE_FAILED]);

    const setLatest = (next: UserAppearance) => {
        latestRef.current = next;
        setAppearance(next);
        dirtyRef.current = true;
    };

    const saveIfDirty = () => {
        if (!dirtyRef.current) return;
        void persist();
    };

    // commit の操作（服装の削除、参照画像の調整）は入力欄を離れる契機が無いため、その場で保存する。
    const updateFields = (next: CharacterApiServiceConfig, commit?: boolean) => {
        setLatest({ ...latestRef.current, ...next });
        if (commit) void persist();
    };

    const commitNames = () => {
        const parsed = namesText.split(/[,、]/).map((s) => s.trim()).filter(Boolean);
        setLatest({ ...latestRef.current, names: parsed });
        setNamesText(parsed.join(', '));
        void persist();
    };

    const fields: CharacterApiServiceConfig = {
        characterPrompt: appearance.characterPrompt,
        physicalFeatures: appearance.physicalFeatures,
        outfits: appearance.outfits ?? [],
        extraPositive: appearance.extraPositive,
        extraNegative: appearance.extraNegative,
        referenceImages: appearance.referenceImages ?? [],
    };

    const imageUrl = useCallback((ref: ReferenceImage) => getUserReferenceImageUrl(backendUrl, service, ref.id), [backendUrl, service]);

    return (
        <div className="space-y-3">
            {!hideHeading && (
                <h4 className="flex items-center gap-2 text-sm font-medium text-gray-400">
                    <User size={16} className="text-pink-400" />
                    {SECTION_NAMES.USER_APPEARANCE}
                </h4>
            )}
            <p className="text-xs text-gray-500">{CHARACTER.HELP.USER_APPEARANCE_DESC}</p>
            {isLoading ? (
                <div className="flex justify-center py-6">
                    <Loader2 size={20} className="animate-spin text-gray-500" />
                </div>
            ) : (
                <>
                    <div className="space-y-1">
                        <label className="text-sm font-medium text-gray-400">{CHARACTER.LABELS.USER_NAMES}</label>
                        <input
                            type="text"
                            value={namesText}
                            onChange={(e) => { setNamesText(e.target.value); dirtyRef.current = true; }}
                            onBlur={commitNames}
                            placeholder={CHARACTER.PLACEHOLDERS.USER_NAMES}
                            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 outline-none focus:border-green-500 transition-colors"
                        />
                        <p className="text-xs text-gray-600">{CHARACTER.HELP.USER_NAMES_DESC}</p>
                    </div>
                    <CharacterApiServiceFields
                        uiCatalog={uiCatalog}
                        value={fields}
                        onChange={updateFields}
                        onBlurField={saveIfDirty}
                        referenceImages={{
                            imageUrl,
                            onAdd: (file) => runReferenceOperation(async () => {
                                const added = await addUserReferenceImage(backendUrl, service, file, { kind: 'character', strength: 0.6, fidelity: 0.5 });
                                return (refs) => [...refs.filter((ref) => ref.id !== added.id), added];
                            }),
                            onRemove: (id) => runReferenceOperation(async () => {
                                await deleteUserReferenceImage(backendUrl, service, id);
                                forgetAuthedUrl(getUserReferenceImageUrl(backendUrl, service, id));
                                return (refs) => refs.filter((ref) => ref.id !== id);
                            }),
                            disabledNote: effectiveReferenceNote,
                        }}
                    />
                    <div className="flex items-center justify-end gap-2 text-xs min-h-[1.25rem]">
                        {isSaving && <Loader2 size={12} className="animate-spin text-gray-500" />}
                        {notice && (
                            <span className={`flex items-center gap-1 ${notice.ok ? 'text-green-300' : 'text-red-300'}`}>
                                {notice.ok ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
                                {notice.text}
                            </span>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};
