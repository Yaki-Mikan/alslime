/**
 * responseAdvancedSettings.ts - 応答の確定で本体が進めた値を、画面の設定へ差し替える
 *
 * 本体は応答を受け取ったとき、会話の設定のうち日付時刻の設定（今の時刻・経過日数・増分の切り替え）と、
 * 経過日数に連動した各キャラの付き合いの長さを進めて保存する。
 * 準備・調整欄に反映していない変更があるときは、ほかの変更を残したままこれらだけを差し替える。
 */

type SSRPConfig = Record<string, any>;

const clone = <T>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)));

const relationshipGroup = (detail: unknown): { values?: Record<string, unknown> } | null => {
    const groups = (detail as { parameterGroups?: unknown } | null)?.parameterGroups;
    if (!Array.isArray(groups)) return null;
    const group = groups.find(g => g && typeof g === 'object' && (g as { id?: unknown }).id === 'relationship');
    return group ?? null;
};

/** base は画面の設定、saved は本体が保存した会話の設定。base を書き換えず、差し替えた写しを返す */
export const mergeResponseAdvancedSettings = (base: SSRPConfig, saved: SSRPConfig): SSRPConfig => {
    const out = clone(base);
    if (saved.dateTimeSettings !== undefined) {
        out.dateTimeSettings = clone(saved.dateTimeSettings);
    }
    const outDetails = out.characterDetails;
    const savedDetails = saved.characterDetails;
    if (!outDetails || typeof outDetails !== 'object' || !savedDetails || typeof savedDetails !== 'object') {
        return out;
    }
    for (const [charPath, detail] of Object.entries(outDetails)) {
        const savedValues = relationshipGroup(savedDetails[charPath])?.values;
        if (!savedValues || !('relationshipDuration' in savedValues)) continue;
        const group = relationshipGroup(detail);
        if (!group) continue;
        group.values = { ...(group.values ?? {}), relationshipDuration: clone(savedValues.relationshipDuration) };
    }
    return out;
};
