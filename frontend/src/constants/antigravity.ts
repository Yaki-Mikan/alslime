/** Antigravity の streamGenerateContent 暴走検知で使う既定上限。 */
export const DEFAULT_ANTIGRAVITY_STREAM_GUARD_LIMIT = 20;

/** 画面から指定できる streamGenerateContent 上限の最小値。 */
export const MIN_ANTIGRAVITY_STREAM_GUARD_LIMIT = 1;

/** 保存値を正の整数へ正規化し、不正値は既定値へ戻す。 */
export const normalizeAntigravityStreamGuardLimit = (value: unknown): number => {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed) || parsed < MIN_ANTIGRAVITY_STREAM_GUARD_LIMIT) {
        return DEFAULT_ANTIGRAVITY_STREAM_GUARD_LIMIT;
    }
    return Math.floor(parsed);
};

/** Antigravity の Thinking レベル。Claude の effort と同じくモデルとは別に指定する。 */
export const ANTIGRAVITY_THINKING_VALUES = ['low', 'medium', 'high'] as const;

export type AntigravityThinking = typeof ANTIGRAVITY_THINKING_VALUES[number];

/** レベル未指定の状態を作らないための既定値（サーバ側の正規化と同じ Low）。 */
export const DEFAULT_ANTIGRAVITY_THINKING: AntigravityThinking = 'low';

const isAntigravityThinking = (value: string): value is AntigravityThinking =>
    (ANTIGRAVITY_THINKING_VALUES as readonly string[]).includes(value);

/** モデルで選べるレベルに収める。空・未知・そのモデルで選べない値は Low へ落とす。 */
export const normalizeAntigravityThinking = (
    value: unknown,
    allowed: readonly string[] = ANTIGRAVITY_THINKING_VALUES,
): AntigravityThinking => {
    const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return isAntigravityThinking(v) && allowed.includes(v) ? v : DEFAULT_ANTIGRAVITY_THINKING;
};

/** モデル一覧（サーバ正本）の thinkingLevels から選択肢を得る。空なら選択 UI を出さない。 */
export const antigravityThinkingLevelsOf = (
    model: { thinkingLevels?: string[] } | undefined,
): AntigravityThinking[] => (model?.thinkingLevels ?? []).filter(isAntigravityThinking);
