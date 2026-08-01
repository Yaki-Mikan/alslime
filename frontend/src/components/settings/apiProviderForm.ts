import type { ApiProviderSaveRequest } from '../../api/api-providers';
import type { UserModel, UserModelsData } from '../../api/user-models';
import { buildOpenAICompatId } from '../../constants/openaicompat';

export type ApiKeyState = 'unchanged' | 'entering' | 'clearPending';

export interface ExtraParamRowValue {
    key: string;
    value: string;
}

export interface ExtraParamsBuildResult {
    params?: Record<string, unknown>;
    errorKey?: string;
    errorRow?: number;
}

const RESERVED_EXTRA_PARAM_KEYS: ReadonlySet<string> = new Set([
    'model',
    'messages',
    'stream',
    'stream_options',
    'prompt_cache_key',
    'session_id',
]);

const SECRET_LIKE_EXTRA_PARAM_KEYS: ReadonlySet<string> = new Set([
    'api_key',
    'apikey',
    'api-key',
    'authorization',
    'token',
    'access_token',
    'secret',
]);

export const apiKeyStateAfterInput = (value: string): ApiKeyState => (
    value === '' ? 'unchanged' : 'entering'
);

export const apiKeyPayload = (
    state: ApiKeyState,
    input: string
): Pick<ApiProviderSaveRequest, 'apiKey' | 'clearApiKey'> => {
    if (state === 'entering' && input.trim() !== '') return { apiKey: input };
    if (state === 'clearPending') return { clearApiKey: true };
    return {};
};

export const buildExtraParams = (rows: ExtraParamRowValue[]): ExtraParamsBuildResult => {
    const params: Record<string, unknown> = {};
    const seen = new Set<string>();
    for (let index = 0; index < rows.length; index++) {
        const row = rows[index];
        const key = row.key.trim();
        if (key === '' && row.value.trim() === '') continue;
        if (key === '') return { errorKey: 'apiProviders.error.extraParamsEmptyKey', errorRow: index };
        if (seen.has(key)) return { errorKey: 'apiProviders.error.extraParamsDuplicateKey', errorRow: index };
        seen.add(key);
        const normalizedKey = key.toLowerCase();
        if (RESERVED_EXTRA_PARAM_KEYS.has(normalizedKey)) {
            return { errorKey: 'apiProviders.error.extraParamsReservedKey', errorRow: index };
        }
        if (SECRET_LIKE_EXTRA_PARAM_KEYS.has(normalizedKey)) {
            return { errorKey: 'apiProviders.error.extraParamsSecretKey', errorRow: index };
        }
        try {
            params[key] = JSON.parse(row.value);
        } catch {
            return { errorKey: 'apiProviders.error.extraParamsInvalidJson', errorRow: index };
        }
    }
    return { params };
};

export const mergeApiProviderModels = (
    latest: UserModelsData,
    connectionId: string,
    checkedRemoteIds: ReadonlySet<string>
): { added: UserModel[]; hidden: string[] } => {
    // 内蔵一覧の更新前に保存された同一IDの旧 added 行は、GET では防御的に
    // 返り得る一方、全置換POSTでは検証により拒否される。内蔵側が正本なので、
    // 今回と無関係な旧重複行を再送せず、モデル選択の保存を妨げない。
    const builtinIds = new Set(latest.builtin.map(model => model.id));
    const others = latest.added.filter(model => (
        model.connectionId !== connectionId && !builtinIds.has(model.id)
    ));
    const kept = latest.added.filter(model => (
        model.connectionId === connectionId && checkedRemoteIds.has(model.remoteModelId ?? '')
    ));
    const existingRemoteIds = new Set(kept.map(model => model.remoteModelId));
    const additions: UserModel[] = [...checkedRemoteIds]
        .filter(remoteId => !existingRemoteIds.has(remoteId))
        .map(remoteId => ({
            id: buildOpenAICompatId(connectionId, remoteId),
            provider: 'openai_compat',
            connectionId,
            remoteModelId: remoteId,
        }));

    return {
        added: [...others, ...kept, ...additions],
        hidden: latest.hidden,
    };
};
