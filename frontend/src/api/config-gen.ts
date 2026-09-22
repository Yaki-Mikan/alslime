/**
 * config-gen.ts - 設定ファイル自動作成（AI 生成）API クライアント
 *
 * submit / status / cancel と、じっくり作成（2段階）でユーザーが手直しする
 * 調査メモの取得・保存、対話作成のセッション操作を提供する。
 */

import axios from '../lib/axios';

export type ConfigGenMethod = 'two_step' | 'one_shot';

export interface ConfigGenSubmitRequest {
    categoryId: string;
    method: ConfigGenMethod;
    step?: number; // two_step のみ 1 | 2
    /** キャラクター名（キャラクター種別）。他種別ではファイル名と同じ値を入れる（互換） */
    characterName: string;
    /** 作品名（キャラクター種別のみ必須） */
    workTitle: string;
    /** 調査メモの所在ディレクトリ（通常はキャラクター名。設定ファイルの配置は常にキャラクター名基準） */
    dirName: string;
    /** 成果物ファイル名（拡張子なし）。キャラクター種別では characterName と同じ */
    fileName?: string;
    model?: string;
    claudeEffort?: string;
    antigravityThinking?: string;
    timeoutMinutes?: number;
    locale?: string;
    /** 設定作成備考（ユーザーの要望・指示。指示ファイルへ結合される） */
    notes?: string;
    /** 左エディタの内容（入力項目テンプレートの差し込み。空なら同梱テンプレート） */
    editorContent?: string;
    /** 使うテンプレート名（空なら既定） */
    searchTemplate?: string;
    settingTemplate?: string;
}

export interface ConfigGenProgressEntry {
    seq: number;
    kind: 'text' | 'tool' | 'done' | 'error';
    text?: string;
    textKey?: string;
    args?: string[];
}

export interface ConfigGenResultFile {
    /** tempCharacter はセッションからの取り込み（会話設定へ一時キャラクターとして登録済み。relPath は仮想パス） */
    kind: 'research' | 'setting' | 'tempCharacter';
    categoryId: string;
    dirName: string;
    fileName: string;
    relPath: string;
    /** 対話作成のみ */
    sessionId?: string;
    fileHash?: string;
}

export interface ConfigGenStatus {
    jobId: string;
    status: 'pending' | 'processing' | 'completed' | 'error' | 'canceled';
    progress?: ConfigGenProgressEntry[];
    elapsedSeconds: number;
    result?: ConfigGenResultFile;
    error?: string;
}

export const submitConfigGen = async (
    backendUrl: string,
    req: ConfigGenSubmitRequest
): Promise<{ jobId: string }> => {
    const response = await axios.post(`${backendUrl}/api/config-gen/submit`, req);
    return response.data;
};

export const getConfigGenStatus = async (
    backendUrl: string,
    jobId: string,
    since: number
): Promise<ConfigGenStatus> => {
    const response = await axios.get(`${backendUrl}/api/config-gen/status/${encodeURIComponent(jobId)}`, {
        params: since > 0 ? { since } : undefined,
    });
    return response.data;
};

export const cancelConfigGen = async (backendUrl: string, jobId: string): Promise<void> => {
    await axios.post(`${backendUrl}/api/config-gen/cancel/${encodeURIComponent(jobId)}`);
};

/** セッションからの一時キャラクター取り込み（1 キャラ 1 ジョブ）の投入 */
export interface ConfigGenFromSessionRequest {
    sessionId: string;
    /** 抽出時の表示名（置き換え前の元のまま） */
    targetCharacter: string;
    /** AI 用の設定ファイルテンプレート名（設定自動生成と同じ置き場）。manualTemplate と排他 */
    settingTemplate?: string;
    /** 手動作成用の雛形名。settingTemplate と排他。両方空なら AI 用の既定 */
    manualTemplate?: string;
    model?: string;
    claudeEffort?: string;
    antigravityThinking?: string;
    timeoutMinutes?: number;
    locale?: string;
}

export const submitConfigGenFromSession = async (
    backendUrl: string,
    req: ConfigGenFromSessionRequest
): Promise<{ jobId: string }> => {
    const response = await axios.post(`${backendUrl}/api/config-gen/from-session`, req);
    return response.data;
};

export interface ConfigGenActive {
    active: boolean;
    jobId?: string;
    status?: string;
    elapsedSeconds?: number;
}

export const getConfigGenActive = async (backendUrl: string): Promise<ConfigGenActive> => {
    const response = await axios.get(`${backendUrl}/api/config-gen/active`);
    return response.data;
};

export const deleteResearchMemo = async (
    backendUrl: string,
    categoryId: string,
    dirName: string,
    characterName: string
): Promise<void> => {
    await axios.delete(
        `${backendUrl}/api/config-gen/research/${encodeURIComponent(categoryId)}/${encodeURIComponent(dirName)}/${encodeURIComponent(characterName)}`
    );
};

export interface CLIStatusEntry {
    id: string;
    label: string;
    status: string; // 'cliFound' | 'cliNotFound' 等
    authStatus?: string;
}

export const getCLIStatus = async (backendUrl: string): Promise<CLIStatusEntry[]> => {
    const response = await axios.get(`${backendUrl}/api/system/cli-status`);
    return response.data?.clis ?? [];
};

export interface ResearchMemoEntry {
    dirName: string;
    characterName: string;
    fileName: string;
}

export const listResearchMemos = async (
    backendUrl: string,
    categoryId: string
): Promise<ResearchMemoEntry[]> => {
    const response = await axios.get(
        `${backendUrl}/api/config-gen/research-list/${encodeURIComponent(categoryId)}`
    );
    return response.data?.files ?? [];
};

export const getResearchMemo = async (
    backendUrl: string,
    categoryId: string,
    dirName: string,
    characterName: string
): Promise<{ exists: boolean; content?: string; workTitle?: string }> => {
    const response = await axios.get(
        `${backendUrl}/api/config-gen/research/${encodeURIComponent(categoryId)}/${encodeURIComponent(dirName)}/${encodeURIComponent(characterName)}`
    );
    return response.data;
};

export const saveResearchMemo = async (
    backendUrl: string,
    categoryId: string,
    dirName: string,
    characterName: string,
    content: string
): Promise<void> => {
    await axios.post(
        `${backendUrl}/api/config-gen/research/${encodeURIComponent(categoryId)}/${encodeURIComponent(dirName)}/${encodeURIComponent(characterName)}`,
        { content }
    );
};

// ---- 対話作成 ----

export interface ConfigGenDialogMessage {
    role: 'user' | 'agent';
    content: string;
    timestamp: string;
    jobId?: string;
    /** AI 応答が中止・失敗で得られなかったターン */
    canceled?: boolean;
}

export interface ConfigGenDialogSession {
    sessionId: string;
    categoryId: string;
    dirName: string;
    fileName: string;
    /** 正規位置にまだ保存されていない新規作成 */
    isNew: boolean;
    /** サーバーが最後に確認した正規ファイルの内容ハッシュ（sha256） */
    fileHash: string;
    /** 正規ファイルの現在の本文（新規なら開始時に渡した editorContent） */
    fileContent: string;
    messages: ConfigGenDialogMessage[];
}

export interface ConfigGenDialogStartRequest {
    categoryId: string;
    dirName?: string;
    fileName: string;
    provider?: string;
    model?: string;
    locale?: string;
    /** 新規作成時の下書き（手動作成向けテンプレート＋ユーザー記入） */
    editorContent?: string;
    /** 既存セッションを削除して新しく始める */
    reset?: boolean;
}

export const startConfigGenDialog = async (
    backendUrl: string,
    req: ConfigGenDialogStartRequest
): Promise<ConfigGenDialogSession> => {
    const response = await axios.post(`${backendUrl}/api/config-gen/dialog/start`, req);
    return response.data;
};

export interface ConfigGenDialogSendRequest {
    sessionId: string;
    message: string;
    editorContent: string;
    /** 送信時点の左エディタ内容の sha256（計算できなければ空。サーバーが補う） */
    editorHash: string;
    model?: string;
    claudeEffort?: string;
    antigravityThinking?: string;
    timeoutMinutes?: number;
    locale?: string;
    /** 使う設定ファイルテンプレート名（空なら既定） */
    settingTemplate?: string;
}

export const sendConfigGenDialog = async (
    backendUrl: string,
    req: ConfigGenDialogSendRequest
): Promise<{ jobId: string }> => {
    const response = await axios.post(`${backendUrl}/api/config-gen/dialog/send`, req);
    return response.data;
};

export const getConfigGenDialog = async (
    backendUrl: string,
    sessionId: string
): Promise<ConfigGenDialogSession> => {
    const response = await axios.get(`${backendUrl}/api/config-gen/dialog/${encodeURIComponent(sessionId)}`);
    return response.data;
};

export const deleteConfigGenDialog = async (backendUrl: string, sessionId: string): Promise<void> => {
    await axios.delete(`${backendUrl}/api/config-gen/dialog/${encodeURIComponent(sessionId)}`);
};

/** 本文の sha256（16 進）。サーバーと同じ規則（UTF-8 バイト列）。計算できない環境では空を返す。 */
export const contentHash = async (content: string): Promise<string> => {
    try {
        if (typeof crypto === 'undefined' || !crypto.subtle) return '';
        const data = new TextEncoder().encode(content);
        const digest = await crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch {
        return '';
    }
};
