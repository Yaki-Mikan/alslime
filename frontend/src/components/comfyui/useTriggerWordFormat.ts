import { useEffect, useState } from 'react';
import { getComfyUIConfig } from '../../api/comfyui';
import type { TriggerWordFormat } from '../../api/comfyui';

/**
 * トリガーワードのコピー時フォーマット（raw/underscore/space）を取得するフック。
 * danbooruTagFormat とは別物。既定は raw（変換なし）。
 */
export function useTriggerWordFormat(
    backendUrl: string,
    isActive: boolean,
    override?: TriggerWordFormat
): TriggerWordFormat {
    const [format, setFormat] = useState<TriggerWordFormat>(override || 'raw');

    useEffect(() => {
        if (!isActive) return;
        if (override) {
            setFormat(override);
            return;
        }

        let cancelled = false;
        (async () => {
            try {
                const config = await getComfyUIConfig(backendUrl);
                if (!cancelled) {
                    setFormat(config.triggerWordFormat || 'raw');
                }
            } catch {
                if (!cancelled) {
                    setFormat('raw');
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [backendUrl, isActive, override]);

    return format;
}
