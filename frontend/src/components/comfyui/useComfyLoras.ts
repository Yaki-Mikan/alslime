/**
 * useComfyLoras.ts - LoRA一覧取得の共通フック
 *
 * ComfyUI 未接続時の扱いを一箇所へ集約する。
 * - 取得失敗・未接続は comfyUnreachable で通知し、呼び出し側の編集操作は妨げない
 * - retry はサーバー側キャッシュ（失敗のネガティブキャッシュ含む）を破棄して再取得する
 * - reload はキャッシュ許容の再取得のみ（カテゴリ切替時の追従用）
 */

import { useCallback, useEffect, useState } from 'react';
import { getLorasByCategoryDetailed, refreshComfyUILoras } from '../../api/comfyui';

export function useComfyLoras(backendUrl: string, categoryIds: string[], enabled: boolean) {
    const [lorasByCategory, setLorasByCategory] = useState<Record<string, string[]>>({});
    const [comfyUnreachable, setComfyUnreachable] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    // 配列の同一性に依存せず内容で判定する（呼び出し側がリテラル配列を渡しても再取得ループにならない）
    const categoriesKey = categoryIds.filter(id => id).join(',');

    const load = useCallback(async () => {
        const ids = categoriesKey ? categoriesKey.split(',') : [];
        if (ids.length === 0) {
            setLorasByCategory({});
            setComfyUnreachable(false);
            return;
        }
        setIsLoading(true);
        try {
            const results = await Promise.all(ids.map(id => getLorasByCategoryDetailed(backendUrl, id)));
            const next: Record<string, string[]> = {};
            ids.forEach((id, i) => { next[id] = results[i].loras; });
            setLorasByCategory(next);
            setComfyUnreachable(results.some(r => r.comfyUnreachable));
        } catch {
            // ComfyUI 未接続はフラグで返る契約のため、ここへ来るのはバックエンド自体との
            // 通信断。LoRA 欄のみ未接続扱いとし、他の編集は妨げない。
            setLorasByCategory({});
            setComfyUnreachable(true);
        } finally {
            setIsLoading(false);
        }
    }, [backendUrl, categoriesKey]);

    useEffect(() => {
        if (!enabled) return;
        void load();
    }, [enabled, load]);

    // サーバー側キャッシュ（失敗のネガティブキャッシュ含む）を破棄して再取得する
    const retry = useCallback(async () => {
        try {
            await refreshComfyUILoras(backendUrl);
        } catch {
            // 破棄に失敗しても再取得は試す
        }
        await load();
    }, [backendUrl, load]);

    return { lorasByCategory, comfyUnreachable, isLoading, retry, reload: load };
}
