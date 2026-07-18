import axios from '../lib/axios';

// 設定パック（設定インポート・エクスポート）API クライアント。
// backend: internal/api/settingspack（設定設定大設定/設定インポートエクスポート_設計.md §10）。

export interface SettingsPackKind {
    id: string;
    label: string;
    class: string; // "A" | "B" | "C" | "D"
}

export interface SettingsPackCatalog {
    kinds: SettingsPackKind[];
}

export type SettingsPackAction = 'new' | 'conflict' | 'skip';

export interface SettingsPackPlanEntry {
    path: string;
    kind?: string;
    class?: string;
    action: SettingsPackAction;
    reasonKey?: string;
    sizeBytes: number;
}

export interface SettingsPackWarning {
    key: string;
    path?: string;
}

export interface SettingsPackManifest {
    packFormat: number;
    structure?: string;
    name?: string;
    description?: string;
    createdAt?: string;
    createdBy?: string;
}

export interface SettingsPackPlan {
    manifest?: SettingsPackManifest;
    entries: SettingsPackPlanEntry[];
    warnings: SettingsPackWarning[];
    blocked: boolean;
    blockedKey?: string;
    summary: Partial<Record<SettingsPackAction, number>>;
}

export type SettingsPackPolicy = 'skip' | 'overwrite' | 'rename';

export interface SettingsPackImportedEntry {
    path: string;
    writtenAs?: string;
}

export interface SettingsPackSkippedEntry {
    path: string;
    reasonKey: string;
}

export interface SettingsPackImportResult {
    messageKey: string;
    written: SettingsPackImportedEntry[];
    skipped: SettingsPackSkippedEntry[];
    warnings: SettingsPackWarning[];
}

// 起動時取り込み（import_inbox）の結果。
export interface SettingsPackInboxItem {
    file: string;
    messageKey: string;
    written: number;
    skipped: number;
}

export interface SettingsPackInboxReport {
    processedAt: string;
    items: SettingsPackInboxItem[];
    deferred: number;
    errorKey?: string;
}

export interface SettingsPackInboxResponse {
    status: 'pending' | 'done';
    report?: SettingsPackInboxReport;
}

export const fetchSettingsPackInbox = async (backendUrl: string): Promise<SettingsPackInboxResponse> => {
    const response = await axios.get(`${backendUrl}/api/settings-pack/inbox`);
    return response.data;
};

export const fetchSettingsPackCatalog = async (backendUrl: string): Promise<SettingsPackCatalog> => {
    const response = await axios.get(`${backendUrl}/api/settings-pack/catalog`);
    return response.data;
};

export const inspectSettingsPack = async (backendUrl: string, file: File): Promise<SettingsPackPlan> => {
    const form = new FormData();
    form.append('pack', file);
    const response = await axios.post(`${backendUrl}/api/settings-pack/inspect`, form);
    return response.data;
};

export const importSettingsPack = async (
    backendUrl: string,
    file: File,
    policy: SettingsPackPolicy,
    overrides?: Record<string, SettingsPackPolicy>,
): Promise<SettingsPackImportResult> => {
    const form = new FormData();
    form.append('pack', file);
    form.append('policy', policy);
    if (overrides && Object.keys(overrides).length > 0) {
        form.append('overrides', JSON.stringify(overrides));
    }
    const response = await axios.post(`${backendUrl}/api/settings-pack/import`, form);
    return response.data;
};

// downloadSamplePack は公式サンプルパック（GitHub Releases の固定URL）を
// サーバー側でダウンロードして取り込む。lang はサーバーの提供言語（ja/en）のみ有効。
export const downloadSamplePack = async (
    backendUrl: string,
    lang: string,
    policy: SettingsPackPolicy = 'skip',
): Promise<SettingsPackImportResult> => {
    const response = await axios.post(`${backendUrl}/api/settings-pack/download-samples`, { lang, policy });
    return response.data;
};

// exportSettingsPack は zip をダウンロードさせる（ブラウザ保存）。
export const exportSettingsPack = async (
    backendUrl: string,
    kinds: string[],
    includeCharacterImages: boolean,
    name: string,
): Promise<void> => {
    const response = await axios.post(
        `${backendUrl}/api/settings-pack/export`,
        { kinds, includeCharacterImages, name },
        { responseType: 'blob' },
    );
    const url = URL.createObjectURL(response.data as Blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name.trim() !== '' ? `${name.trim()}.zip` : 'settings-pack.zip';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
};
