/**
 * bulkLora.ts - LoRA のまとめて設定で、1人分の画像設定の LoRA を差し替える
 */
import type { CharacterImageGenConfig } from '../../../api/comfyui';

export type BulkLoraMode = 'replace' | 'append';

type CharacterLora = CharacterImageGenConfig['lora'][number];

/**
 * 読み出した設定の LoRA を、選んだ LoRA で置き換えるか足した設定を返す（ほかの項目はそのまま）。
 * 足すときに同じ LoRA が既にあれば、強さだけを変える（トリガーワードは残す）。
 */
export const applyLora = (config: CharacterImageGenConfig, name: string, strength: number, mode: BulkLoraMode): CharacterImageGenConfig => {
    const entry: CharacterLora = { name, strengthModel: strength, strengthClip: strength };
    const current = (config.lora ?? []).filter(l => l.name);
    const lora = mode === 'replace'
        ? [entry]
        : current.some(l => l.name === name)
            ? current.map(l => (l.name === name ? { ...l, strengthModel: strength, strengthClip: strength } : l))
            : [...current, entry];
    return { ...config, lora };
};
