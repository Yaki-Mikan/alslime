
// ... existing imports ...
import axios from 'axios';

// SSRPセッション設定（プリセット/セッション保存用）
export interface SSRPSettings {
    characters: string[];
    situations: string[];
    users: string[];
    worlds: string[];
    stages: string[];
    writingStyles: string[];
    characterDetails?: Record<string, any>; // 詳細な型定義が必要なら別途定義
    directiveMode?: 'A' | 'B' | 'C';
    parameterSchemaId?: string; // 選択されたパラメータスキーマID
    dateTimeSettings?: any; // 日付時刻設定（セッション時刻、インクリメント設定など）
    imageGenerationNotes?: string; // 画像生成時の分析に渡す補足事項
}

// SSRP設定のセッション反映APIのレスポンス
export interface ApplySSRPSettingsResult {
    success: boolean;
    ssrpSettings?: Record<string, any>;
    uiState?: Record<string, any>;
}

/**
 * UIの最新SSRP設定を既存セッションの正本（中間ファイル）へ明示反映する。
 * suppressConfirm を渡すと送信時確認モーダルの抑制フラグも保存される。
 * どちらか一方だけの指定も可能（トグルだけ保存する場合は ssrpSettings を省略）。
 */
export const applySSRPSettingsToSession = async (
    backendUrl: string,
    sessionId: string,
    ssrpSettings?: Record<string, any> | null,
    suppressConfirm?: boolean
): Promise<ApplySSRPSettingsResult> => {
    const res = await axios.post(`${backendUrl}/api/session/apply-ssrp-settings`, {
        sessionId,
        ...(ssrpSettings ? { ssrpSettings } : {}),
        ...(suppressConfirm !== undefined ? { suppressConfirm } : {}),
    });
    return res.data;
};

export const listPresets = async (backendUrl: string): Promise<string[]> => {
    const res = await axios.get(`${backendUrl}/api/presets`);
    // Go版APIはプリセット一覧を { presets: string[] } で返す。
    // 旧実装の配列直返しにも耐えて、描画側へ必ず配列だけを渡す。
    if (Array.isArray(res.data)) {
        return res.data;
    }
    if (Array.isArray(res.data?.presets)) {
        return res.data.presets;
    }
    return [];
};

export const savePreset = async (backendUrl: string, name: string, settings: SSRPSettings): Promise<void> => {
    await axios.post(`${backendUrl}/api/presets/${name}`, settings);
};

export const loadPreset = async (backendUrl: string, name: string): Promise<SSRPSettings | null> => {
    const res = await axios.get(`${backendUrl}/api/presets/${name}`);
    return res.data;
};

export interface RelationshipOption {
    label: string;
    value: string;
    description?: string;
}

// 関係性オプションは複数コンポーネント（会話設定メニュー・キャラ状態パネル）が
// 独立に取得するため、TTL 付きでキャッシュする。相関の関係性編集ボタン押下時は
// バックエンド側ファイルの手編集を反映するため forceRefresh で取り直す
// （URL の ?t= はブラウザ/中間キャッシュ回避で、従来どおり維持する）。
let relationshipCache: { promise: Promise<RelationshipOption[]>; fetchedAt: number; backendUrl: string } | null = null;
const RELATIONSHIP_CACHE_TTL_MS = 30_000;

export const getRelationshipOptions = async (backendUrl: string, forceRefresh = false): Promise<RelationshipOption[]> => {
    const now = Date.now();
    if (forceRefresh || !relationshipCache || relationshipCache.backendUrl !== backendUrl || now - relationshipCache.fetchedAt >= RELATIONSHIP_CACHE_TTL_MS) {
        const promise = axios.get(`${backendUrl}/api/settings/relationships?t=${new Date().getTime()}`).then(res => res.data as RelationshipOption[]);
        const entry = { promise, fetchedAt: now, backendUrl };
        relationshipCache = entry;
        // 失敗はキャッシュに残さない（次回呼び出しで再試行する）
        promise.catch(() => {
            if (relationshipCache === entry) relationshipCache = null;
        });
    }
    try {
        return await relationshipCache.promise;
    } catch (error) {
        console.error('Failed to fetch relationship options:', error);
        return [];
    }
};
