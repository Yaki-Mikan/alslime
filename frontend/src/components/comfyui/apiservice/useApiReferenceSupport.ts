/**
 * useApiReferenceDisabledNote - 参照画像が使えるモデルかを判定し、使えないときの注記を返す
 *
 * 判定に使うモデルは、全体の設定で選ばれている使用モデル（生成プリセットには依らない）。
 * refreshKey が変わるたび（使用モデルの切り替え後など）に読み直す。
 * 対応しないモデル（V5 系）のときは、参照画像欄を無効表示するための注記を返す。
 */

import { useEffect, useState } from 'react';
import { apiServiceModelOf, getApiServiceCatalog, getComfyUIConfig } from '../../../api/comfyui';
import type { ApiServiceId } from '../../../api/comfyui';
import type { I18NCatalog } from '../../../api/i18n';
import { createComfyUIText } from '../i18n';

export interface ApiReferenceSupportOptions {
    /** 変わるたびに読み直す印（選ばれている使用モデルなど） */
    refreshKey?: unknown;
}

export function useApiReferenceDisabledNote(
    backendUrl: string,
    service: ApiServiceId,
    active: boolean,
    uiCatalog: I18NCatalog | null,
    options: ApiReferenceSupportOptions = {},
): string | undefined {
    const { REFERENCE_IMAGE } = createComfyUIText(uiCatalog);
    const [supported, setSupported] = useState<boolean | null>(null);
    const refreshKey = options.refreshKey;

    useEffect(() => {
        if (!active) return;
        let cancelled = false;
        (async () => {
            try {
                const [config, catalog] = await Promise.all([
                    getComfyUIConfig(backendUrl),
                    getApiServiceCatalog(backendUrl, service),
                ]);
                if (cancelled) return;
                const modelId = apiServiceModelOf(config, service);
                const model = catalog.models.find(m => m.id === modelId);
                setSupported(model ? model.supportsReference : null);
            } catch (e) {
                console.error('[useApiReferenceDisabledNote] load failed:', e);
                if (!cancelled) setSupported(null);
            }
        })();
        return () => { cancelled = true; };
    }, [active, backendUrl, service, refreshKey]);

    return supported === false ? REFERENCE_IMAGE.MESSAGES.V45_ONLY : undefined;
}
