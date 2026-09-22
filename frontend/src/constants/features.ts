// backend features.Feature と合わせる feature ID。
export const FEATURE_COMFYUI = 'comfyui';
export const FEATURE_ACTION_CHOICE = 'actionChoice';
export const FEATURE_TTS = 'tts';

// isFeatureEnabled は未取得・未定義を安全側の false として扱う。
export const isFeatureEnabled = (
    features: Record<string, boolean> | null,
    featureId: string
): boolean => Boolean(features?.[featureId]);

// isImageGenAvailable は画像生成設定 UI（容姿プロンプト作成を含む）の表示条件。
// ComfyUI 機能が有効な支援レベル かつ ComfyUI 連携の実体（サイドカー / in-process）が稼働中。
export const isImageGenAvailable = (
    features: Record<string, boolean> | null,
    comfyModuleActive: boolean
): boolean => isFeatureEnabled(features, FEATURE_COMFYUI) && comfyModuleActive;
