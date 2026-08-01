import type { Model } from '../../hooks/useChat';

export interface APIConnectionChoice {
    id: string;
    label: string;
}

/** APIモデルから、登録順を維持した接続先選択肢を組み立てる。 */
export const buildAPIConnectionChoices = (models: Model[]): APIConnectionChoice[] => {
    const choices = new Map<string, string>();
    for (const model of models) {
        if (!model.connectionId || choices.has(model.connectionId)) continue;
        choices.set(model.connectionId, model.connectionLabel || model.connectionId);
    }
    return [...choices].map(([id, label]) => ({ id, label }));
};

export const apiModelsForConnection = (models: Model[], connectionId: string): Model[] => (
    models.filter(model => model.connectionId === connectionId)
);

export const apiRemoteModelLabel = (model: Model): string => (
    model.remoteModelId || model.description || model.name || model.id
);
