/**
 * ssrpDiff.ts - 準備・調整欄の今の設定と、会話に保存された設定の違いを判定する
 *
 * 違いがあると「変更を反映」を出す。何も変えていないのに出ないよう、
 * 実行の記録や欄の開閉のような設定でない値と、空の値の有無の違いは比べない。
 */

type SSRPConfig = Record<string, unknown> | null | undefined;

// キー順に依存しない比較用のstringify（オブジェクトのキーを再帰的にソート）
const stableStringify = (value: unknown): string => {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`;
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(',')}}`;
};

// 空の値（""・{}・[]・null）を持つキーを、どの深さでも取り除く。
// 古い会話の保存値には後から増えた項目が無く、画面側はそれを空の値で埋めて返すため、
// 「項目が無い」と「空の値」を同じものとして比べる。
const pruneEmpty = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(pruneEmpty);
    if (value === null || typeof value !== 'object') return value;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
        const pruned = pruneEmpty(child);
        if (pruned === null || pruned === undefined || pruned === '') continue;
        if (Array.isArray(pruned) && pruned.length === 0) continue;
        if (typeof pruned === 'object' && !Array.isArray(pruned) && Object.keys(pruned).length === 0) continue;
        out[key] = pruned;
    }
    return out;
};

// dirty比較用の正規化。
// lastModel等の実行記録キーと、characterDetails内のUI開閉状態は設定差分として扱わない。
const normalizeSSRPForComparison = (config: SSRPConfig): Record<string, unknown> | null => {
    if (!config) return null;
    const normalized = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
    delete normalized.lastModel;
    const details = normalized.characterDetails;
    if (details && typeof details === 'object') {
        for (const detail of Object.values(details as Record<string, unknown>)) {
            if (detail && typeof detail === 'object') {
                delete (detail as Record<string, unknown>).isOpen;
                delete (detail as Record<string, unknown>).isCorrelationOpen;
            }
        }
    }
    return pruneEmpty(normalized) as Record<string, unknown>;
};

const characterSet = (characters: unknown): string[] => (Array.isArray(characters)
    ? characters.filter((c): c is string => typeof c === 'string' && c !== '').sort()
    : []);

/**
 * 話す相手（キャラ）の顔ぶれが違うか。並べ替えだけは違いとしない。
 * ui は画面の今の characters、saved は会話に保存された characters
 */
export const isCharacterSetDifferent = (ui: unknown, saved: unknown): boolean => {
    const a = characterSet(ui);
    const b = characterSet(saved);
    return a.length !== b.length || a.some((c, i) => c !== b[i]);
};

/** ui は画面の今の設定、saved は会話に保存された設定。違いがあれば true */
export const isSSRPConfigDifferent = (ui: SSRPConfig, saved: SSRPConfig): boolean => {
    const a = normalizeSSRPForComparison(ui);
    const b = normalizeSSRPForComparison(saved);
    // 保存値の項目設定が空のとき、画面は一覧の最初の項目設定を選んで返す。
    // 項目設定は会話を始めたあとは変えられないので、この場合は比べない
    if (a && b && !b.parameterSchemaId) delete a.parameterSchemaId;
    return stableStringify(a) !== stableStringify(b);
};
