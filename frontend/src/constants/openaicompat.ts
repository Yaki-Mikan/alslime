/**
 * openaicompat.ts - openai_compat モデルIDの正規化ヘルパ
 *
 * 判定ロジック（プロバイダ種別・実在確認）はサーバー正本
 * （/api/models の provider フィールド・/api/models/user の正規化）に従う。
 * ここには表示用の正規化関数だけを置き、startsWith による経路判定を散らさない。
 */

/** openai_compat モデルIDの接頭辞（サーバー内部表現との対応のみ）。 */
export const OPENAI_COMPAT_ID_PREFIX = 'openai_compat:';

/**
 * openai_compat モデルIDを connectionId / remoteModelId へ分解する。
 * remoteModelId 自体が "/" を含む（OpenRouter の provider/model 形式）ため、
 * 区切りは最初の "/" 1 個だけで行う。形式不正は null。
 */
export const parseOpenAICompatId = (
    modelId: string
): { connectionId: string; remoteModelId: string } | null => {
    if (!modelId.startsWith(OPENAI_COMPAT_ID_PREFIX)) return null;
    const rest = modelId.slice(OPENAI_COMPAT_ID_PREFIX.length);
    const slash = rest.indexOf('/');
    if (slash <= 0 || slash === rest.length - 1) return null;
    return { connectionId: rest.slice(0, slash), remoteModelId: rest.slice(slash + 1) };
};

/** connectionId / remoteModelId から表示・突合用のモデルIDを組み立てる（サーバー正規化と同形）。 */
export const buildOpenAICompatId = (connectionId: string, remoteModelId: string): string =>
    `${OPENAI_COMPAT_ID_PREFIX}${connectionId}/${remoteModelId}`;
