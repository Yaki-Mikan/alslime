// backend features.Feature と合わせる feature ID。
export const FEATURE_COMFYUI = 'comfyui';
export const FEATURE_ACTION_CHOICE = 'actionChoice';

// isFeatureEnabled は未取得・未定義を安全側の false として扱う。
export const isFeatureEnabled = (
    features: Record<string, boolean> | null,
    featureId: string
): boolean => Boolean(features?.[featureId]);
