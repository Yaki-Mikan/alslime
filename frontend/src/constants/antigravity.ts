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
