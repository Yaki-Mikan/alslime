/** 会話の応答を待つ時間（分）の既定値。サーバーの CLI 待機上限の既定と同じ 10 分。 */
export const DEFAULT_CHAT_RESPONSE_TIMEOUT_MINUTES = 10;

/** 画面から指定できる応答の待ち時間（分）の最小値。 */
export const MIN_CHAT_RESPONSE_TIMEOUT_MINUTES = 1;

/** サーバー側の打ち切りより少し長く待ち、打ち切りの結果を受け取れるようにする余裕（秒）。 */
export const CHAT_RESPONSE_TIMEOUT_GRACE_SECONDS = 30;

/** 保存値を正の整数へ正規化し、不正値は既定値へ戻す。 */
export const normalizeChatResponseTimeoutMinutes = (value: unknown): number => {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed) || parsed < MIN_CHAT_RESPONSE_TIMEOUT_MINUTES) {
        return DEFAULT_CHAT_RESPONSE_TIMEOUT_MINUTES;
    }
    return Math.floor(parsed);
};
