import { useEffect, useState } from 'react';
import { getComfyUIConfig } from '../../api/comfyui';
import type { DanbooruTagFormat } from '../../api/comfyui';

export function useDanbooruTagFormat(
    backendUrl: string,
    isActive: boolean,
    override?: DanbooruTagFormat
): DanbooruTagFormat {
    const [format, setFormat] = useState<DanbooruTagFormat>(override || 'underscore');

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
                    setFormat(config.danbooruTagFormat || 'underscore');
                }
            } catch {
                if (!cancelled) {
                    setFormat('underscore');
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [backendUrl, isActive, override]);

    return format;
}
