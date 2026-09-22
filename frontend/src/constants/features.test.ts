import { describe, expect, it } from 'vitest';
import { FEATURE_COMFYUI, isImageGenAvailable } from './features';

describe('画像生成設定 UI の表示条件', () => {
    it.each([
        { comfyui: false, active: false, expected: false },
        { comfyui: false, active: true, expected: false },
        { comfyui: true, active: false, expected: false },
        { comfyui: true, active: true, expected: true },
    ])('FeatureComfyUI=$comfyui / モジュール稼働=$active → $expected', ({ comfyui, active, expected }) => {
        expect(isImageGenAvailable({ [FEATURE_COMFYUI]: comfyui }, active)).toBe(expected);
    });

    it('機能フラグ未取得は表示しない', () => {
        expect(isImageGenAvailable(null, true)).toBe(false);
    });
});
