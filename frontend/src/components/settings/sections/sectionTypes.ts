import { useEffect, useRef, useState } from 'react';
import type { I18NCatalog } from '../../../api/i18n';
import type { Settings } from '../../../types/Settings';

/** 設定画面が分類の部品へ求める操作。保存の帯と「保存していない変更」の確認から呼ぶ。 */
export interface SectionHandle {
    /** 変更のあった分だけ保存する。保存できなかった項目の名前を返す（空なら全部保存できた） */
    save: () => Promise<string[]>;
    /** 下書きを保存済みの値へ戻す */
    revert: () => void;
}

export interface SectionCommonProps {
    /** 下書きに保存していない変更があるかを設定画面へ知らせる */
    onDirtyChange: (dirty: boolean) => void;
    uiCatalog: I18NCatalog | null;
}

type Picked<K extends keyof Settings> = Pick<Settings, K>;

const pick = <K extends keyof Settings>(settings: Settings, keys: readonly K[]): Picked<K> => {
    const out = {} as Picked<K>;
    keys.forEach(key => { out[key] = settings[key]; });
    return out;
};

/**
 * アプリ設定（/api/settings）の一部を下書きとして持つ。
 * 分類ごとに受け持つ項目（keys）だけを扱い、保存するときは最新の設定へその項目だけを重ねる。
 * keys はモジュールの定数など、描画のたびに変わらない配列を渡す。
 */
export const useSettingsDraft = <K extends keyof Settings>(settings: Settings, keys: readonly K[]) => {
    const [draft, setDraft] = useState<Picked<K>>(() => pick(settings, keys));
    const syncedRef = useRef<Picked<K>>(pick(settings, keys));

    // 保存や別の場所での変更で設定が変わったら、手を付けていない項目だけ追いかける
    useEffect(() => {
        const next = pick(settings, keys);
        const previous = syncedRef.current;
        setDraft(current => {
            const merged = { ...current };
            keys.forEach(key => {
                if (Object.is(current[key], previous[key])) merged[key] = next[key];
            });
            return merged;
        });
        syncedRef.current = next;
    }, [settings, keys]);

    const isDirty = keys.some(key => !Object.is(draft[key], settings[key]));
    const update = (patch: Partial<Picked<K>>) => setDraft(current => ({ ...current, ...patch }));
    const revert = () => setDraft(pick(settings, keys));
    /** 最新の設定に下書きを重ねたもの（保存に使う） */
    const merged = (): Settings => ({ ...settings, ...draft });

    return { draft, update, revert, isDirty, merged };
};

/** 数値や真偽値を比べて変わったかを返す（オブジェクトは JSON で比べる） */
export const changed = (a: unknown, b: unknown): boolean =>
    typeof a === 'object' || typeof b === 'object' ? JSON.stringify(a) !== JSON.stringify(b) : !Object.is(a, b);
