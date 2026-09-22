/**
 * comfyui.ts - ComfyUI設定管理 API クライアント
 */

import axios from '../lib/axios';
import { getIdToken, isFirebaseEnabled } from '../firebase';
import type { ClaudeEffort } from '../constants/claude';
import type { AntigravityThinking } from '../constants/antigravity';

// 型定義
export type DirectiveMode = 'danbooru_only' | 'natural_language' | 'danbooru_third_person' | 'natural_language_third_person' | 'natural_language_short' | 'natural_language_third_person_short';
export type DanbooruTagFormat = 'underscore' | 'space' | 'anima';
/** トリガーワードのコピー時変換。raw=変換なし / underscore=スペース→_ / space=_→スペース */
export type TriggerWordFormat = 'raw' | 'underscore' | 'space' | 'anima';
export type TagJudgeProvider = 'gemini' | 'claude' | 'antigravity' | 'openai_compat';
export type GeminiTagJudgeModel = string;
export type ClaudeTagJudgeModel = string;
export type AntigravityTagJudgeModel = string;
/** OpenAI 互換 API のタグ判定モデル。統一 ID 'openai_compat:<connectionId>/<remoteModelId>'。未選択は '' */
export type OpenAICompatTagJudgeModel = string;
/** 画像生成ジョブの単位。combined: 分析と生成を 1 ジョブ（既定）、split: 分析ジョブと生成ジョブに分ける */
export type ImageJobMode = 'combined' | 'split';

export interface ComfyUIConfig {
    version: number;
    connectionUrl: string;
    defaultTemplateId: string;
    directiveMode: DirectiveMode;
    danbooruTagFormat: DanbooruTagFormat;
    triggerWordFormat: TriggerWordFormat;
    tagJudgeProvider: TagJudgeProvider;
    tagJudgeGeminiModel: GeminiTagJudgeModel;
    tagJudgeClaudeModel: ClaudeTagJudgeModel;
    tagJudgeClaudeEffort: ClaudeEffort;
    tagJudgeAntigravityModel: AntigravityTagJudgeModel;
    tagJudgeAntigravityThinking: AntigravityThinking;
    tagJudgeOpenAICompatModel: OpenAICompatTagJudgeModel;
    tagJudgeTimeoutSeconds: number;
    /** 画像生成ジョブの単位。省略時は combined */
    imageJobMode?: ImageJobMode;
    /** AI 応答の正常完了時に各 TURN へ上から順に画像生成を自動投入するか。省略時は無効 */
    autoGenerateEnabled?: boolean;
    lightweightImageSave: LightweightImageSaveConfig;
    /** 選択中のプレースホルダプリセット名（空/未設定は未選択） */
    placeholderPresetName?: string;
    /** directiveMode値ごとの使用ワークフロー名。未登録・空値は共通（defaultTemplateId）を使う */
    workflowByDirectiveMode?: Record<string, string>;
    /** 生成段のバックエンド（全画面共用）。省略時は comfyui */
    imageBackend?: ImageBackend;
    /** API サービスの選択。省略時は novelai */
    apiService?: ApiServiceId;
    /** API サービスの共通生成プリセット名（defaultTemplateId に相当） */
    apiPresetDefault?: string;
    /** directiveMode 値ごとの生成プリセット名（workflowByDirectiveMode に相当） */
    apiPresetByDirectiveMode?: Record<string, string>;
    /** API サービスで使う分析指示の形式。ComfyUI 用の directiveMode とは別に持つ。省略時は danbooru_only */
    apiDirectiveMode?: DirectiveMode;
    /** サービス ID ごとの接続挙動とユーザーの容姿設定 */
    apiServiceSettings?: Record<string, ApiServiceSettings>;
}

/** 生成段のバックエンド識別子 */
export type ImageBackend = 'comfyui' | 'api';
/** API サービスの ID */
export type ApiServiceId = 'novelai';

/** 参照画像の種別 */
export type ReferenceImageKind = 'character' | 'style' | 'character&style';

export interface ReferenceImage {
    id: string;
    file: string;
    kind: ReferenceImageKind;
    strength: number;
    fidelity: number;
}

/** API サービス側の服装プリセット（LoRA を持たない） */
export interface ApiServiceOutfit {
    name: string;
    prompt: string;
}

/** ユーザー（会話の相手）の容姿設定 */
export interface UserAppearance {
    names?: string[];
    characterPrompt: string;
    physicalFeatures: string;
    outfits?: ApiServiceOutfit[];
    extraPositive: string;
    extraNegative: string;
    referenceImages?: ReferenceImage[];
}

export interface ApiServiceSettings {
    user: UserAppearance;
    timeoutSeconds: number;
    retryOnBusy: number;
    /**
     * 使うモデル。生成プリセットとは別に選ぶ。保存は setApiServiceModel だけが行い、
     * 設定全体の保存ではサーバーが保存済みの値を保つ。
     */
    model?: string;
    /**
     * 自動効果音描画のトグル（全体で 1 つ。既定は OFF）。保存は setApiServiceAutoSoundEffects だけが
     * 行い、設定全体の保存ではサーバーが保存済みの値を保つ。
     */
    autoSoundEffects?: boolean;
}

/** 設定の一部だけを差し替えて保存する（GET → 差し替え → PUT）。他画面の項目を落とさない */
export async function patchComfyUIConfig(backendUrl: string, patch: Partial<ComfyUIConfig>): Promise<ComfyUIConfig> {
    const current = await getComfyUIConfig(backendUrl);
    const next: ComfyUIConfig = { ...current, ...patch };
    await saveComfyUIConfig(backendUrl, next);
    return next;
}

/** プレースホルダプリセットの1行（変換元→変換先。description はタグ判定AIへの状況説明） */
export interface PlaceholderEntry {
    from: string;
    to: string;
    description?: string;
    /** 適用先のチェック（未指定は ComfyUI・API サービスの両方） */
    targets?: TagTargets;
}

export interface PlaceholderPreset {
    name: string;
    entries: PlaceholderEntry[];
}

export type LightweightImageFormat = 'png' | 'webp' | 'avif';

export interface LightweightImageSaveConfig {
    enabled: boolean;
    format: LightweightImageFormat;
    quality: number;
    lossless: boolean;
    effort: number;
}

export interface TemplateInfo {
    name: string;
    hasWorkflow: boolean;
    hasMeta: boolean;
}

export interface ConnectionTestResult {
    success: boolean;
    message: string;
    data?: any;
}

// 接続設定取得
export async function getComfyUIConfig(backendUrl: string): Promise<ComfyUIConfig> {
    const res = await axios.get(`${backendUrl}/api/comfyui/config`);
    return res.data;
}

// 接続設定保存
export async function saveComfyUIConfig(backendUrl: string, config: ComfyUIConfig): Promise<void> {
    await axios.put(`${backendUrl}/api/comfyui/config`, config);
}

// プレースホルダプリセット一覧取得（内容込み）
export async function listPlaceholderPresets(backendUrl: string): Promise<PlaceholderPreset[]> {
    const res = await axios.get(`${backendUrl}/api/comfyui/placeholder-presets`);
    return res.data.presets || [];
}

// プレースホルダプリセット保存（同名は上書き）。保存された正本名を返す
export async function savePlaceholderPreset(backendUrl: string, name: string, entries: PlaceholderEntry[]): Promise<string> {
    const res = await axios.put(`${backendUrl}/api/comfyui/placeholder-presets/${encodeURIComponent(name)}`, { entries });
    return res.data.name || name;
}

// プレースホルダプリセット削除
export async function deletePlaceholderPreset(backendUrl: string, name: string): Promise<void> {
    await axios.delete(`${backendUrl}/api/comfyui/placeholder-presets/${encodeURIComponent(name)}`);
}

// 接続テスト
export async function testComfyUIConnection(backendUrl: string, url: string): Promise<ConnectionTestResult> {
    const res = await axios.get(`${backendUrl}/api/comfyui/test-connection`, {
        params: { url },
    });
    return res.data;
}

// テンプレート一覧
export async function listComfyUITemplates(backendUrl: string): Promise<TemplateInfo[]> {
    const res = await axios.get(`${backendUrl}/api/comfyui/templates`);
    return res.data.templates || [];
}

// テンプレート追加
export async function addComfyUITemplate(
    backendUrl: string,
    name: string,
    workflow: any
): Promise<{ success: boolean; error?: string }> {
    const res = await axios.post(`${backendUrl}/api/comfyui/templates`, { name, workflow });
    return res.data;
}

const WORKFLOW_FILE_EXTENSION = '.json';

// 保存済みテンプレートの workflow.json を認証付きで取得し、ブラウザへ保存する。
export async function downloadComfyUITemplate(backendUrl: string, name: string): Promise<void> {
    const templateName = name.trim();
    if (!templateName) return;

    const res = await axios.get(
        `${backendUrl}/api/comfyui/templates/${encodeURIComponent(templateName)}`,
        { responseType: 'blob' }
    );
    const objectUrl = URL.createObjectURL(res.data as Blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = templateName.toLowerCase().endsWith(WORKFLOW_FILE_EXTENSION)
        ? templateName
        : `${templateName}${WORKFLOW_FILE_EXTENSION}`;
    document.body.appendChild(link);
    try {
        link.click();
    } finally {
        document.body.removeChild(link);
        URL.revokeObjectURL(objectUrl);
    }
}

// テスト生成
export async function testGenerateComfyUI(
    backendUrl: string,
    templateName: string,
    connectionUrl: string,
    lightweightImageSave?: LightweightImageSaveConfig
): Promise<{ success: boolean; error?: string; imageBase64?: string; mimeType?: string }> {
    const res = await axios.post(`${backendUrl}/api/comfyui/test-generate`, { templateName, connectionUrl, lightweightImageSave });
    return res.data;
}

// キャラクター画像生成設定
export interface CharacterImageGenConfig {
    characterName: string;
    workName: string;
    aliases: string[];
    characterPrompt: string;
    physicalFeatures: string;
    lora: { name: string; strengthModel: number; strengthClip: number; triggerWords?: string }[];
    outfits: {
        name: string;
        prompt: string;
        lora: { name: string; strengthModel: number; strengthClip: number }[];
    }[];
    extraPositive: string;
    extraNegative: string;
    /** API サービスごとのプロンプト設定（サービス ID がキー）。名前・作品名・別名は共用 */
    apiService?: Record<string, CharacterApiServiceConfig>;
}

/** キャラ 1 人分の API サービス側プロンプト設定（LoRA を持たない） */
export interface CharacterApiServiceConfig {
    characterPrompt: string;
    physicalFeatures: string;
    outfits: ApiServiceOutfit[];
    extraPositive: string;
    extraNegative: string;
    referenceImages?: ReferenceImage[];
}

export const emptyCharacterApiServiceConfig = (): CharacterApiServiceConfig => ({
    characterPrompt: '',
    physicalFeatures: '',
    outfits: [],
    extraPositive: '',
    extraNegative: '',
    referenceImages: [],
});

export async function getCharacterImageGenConfig(backendUrl: string, name: string): Promise<CharacterImageGenConfig> {
    const res = await axios.get(`${backendUrl}/api/comfyui/character-config/${encodeURIComponent(name)}`);
    return res.data;
}

export async function saveCharacterImageGenConfig(backendUrl: string, name: string, config: CharacterImageGenConfig): Promise<void> {
    await axios.put(`${backendUrl}/api/comfyui/character-config/${encodeURIComponent(name)}`, config);
}

// LoRAディレクトリ設定
export interface LoraDirCategory {
    id: string;
    label: string;
    directory: string;
}

export interface LoraDirConfig {
    categories: LoraDirCategory[];
}

export async function getLoraDirConfig(backendUrl: string): Promise<LoraDirConfig> {
    const res = await axios.get(`${backendUrl}/api/comfyui/lora-directories`);
    return res.data;
}

export async function saveLoraDirConfig(backendUrl: string, config: LoraDirConfig): Promise<void> {
    await axios.put(`${backendUrl}/api/comfyui/lora-directories`, config);
}

export async function getLoraDirDefaults(backendUrl: string): Promise<LoraDirConfig> {
    const res = await axios.get(`${backendUrl}/api/comfyui/lora-directories/defaults`);
    return res.data;
}

// カテゴリ指定でLoRA一覧取得（ディレクトリ設定から自動プレフィックス）
export async function getLorasByCategory(backendUrl: string, categoryId: string): Promise<string[]> {
    const res = await axios.get(`${backendUrl}/api/comfyui/loras/category/${encodeURIComponent(categoryId)}`);
    return res.data.loras || [];
}

// LoRA一覧の取得結果。comfyUnreachable は ComfyUI 未接続で一覧を更新できなかった
// ことを示す（loras はサーバー側キャッシュ済み一覧または空。HTTP 200 で返る）。
export interface LorasResult {
    loras: string[];
    comfyUnreachable: boolean;
}

// カテゴリ指定でLoRA一覧取得（未接続フラグ付き。未接続時の表示制御用）
export async function getLorasByCategoryDetailed(backendUrl: string, categoryId: string): Promise<LorasResult> {
    const res = await axios.get(`${backendUrl}/api/comfyui/loras/category/${encodeURIComponent(categoryId)}`);
    return { loras: res.data.loras || [], comfyUnreachable: !!res.data.comfyUnreachable };
}

// LoRA一覧取得
export async function getComfyUILoras(backendUrl: string, prefixes?: string[]): Promise<string[]> {
    const params = prefixes && prefixes.length > 0 ? { prefixes: prefixes.join(',') } : {};
    const res = await axios.get(`${backendUrl}/api/comfyui/loras`, { params });
    return res.data.loras || [];
}

// LoRAキャッシュクリア
export async function refreshComfyUILoras(backendUrl: string): Promise<void> {
    await axios.post(`${backendUrl}/api/comfyui/loras/refresh`);
}

// テンプレート削除
export async function deleteComfyUITemplate(
    backendUrl: string,
    name: string
): Promise<{ success: boolean; error?: string }> {
    const res = await axios.delete(`${backendUrl}/api/comfyui/templates/${encodeURIComponent(name)}`);
    return res.data;
}

// ===== タグマッピング =====

export interface TagCategory {
    id: string;
    label: string;
    loraPrefixes: string[];
}

export interface TagCategoryDefinition {
    categories: TagCategory[];
}

export interface TagLoraEntry {
    name: string;
    strengthModel: number;
    strengthClip: number;
}

/** タグの適用先（バックエンドごとのチェック）。省略時は両方に適用 */
export interface TagTargets {
    comfyui: boolean;
    api: boolean;
}

export interface TagEntry {
    key: string;
    description: string;
    prompt: string;
    negativePrompt: string;
    workflowTemplateId?: string;
    /** API サービスでの優先生成プリセット名（pose のみ有効） */
    apiPresetId?: string;
    lora: TagLoraEntry[];
    /** 省略時は有効。false のタグは判定・照合・生成から除外される */
    enabled?: boolean;
    /** 適用先。省略時は ComfyUI・API サービスの両方 */
    targets?: TagTargets;
}

export const tagTargetsOf = (tag: Pick<TagEntry, 'targets'>): TagTargets => tag.targets ?? { comfyui: true, api: true };

export interface TagMappingFile {
    categoryId: string;
    tags: TagEntry[];
}

/** 全カテゴリのタグマッピング（横断一覧用） */
export interface TagMappingBundle {
    categories: TagCategory[];
    mappings: TagMappingFile[];
}

export const isTagEnabled = (tag: Pick<TagEntry, 'enabled'>): boolean => tag.enabled !== false;

// カテゴリ定義取得
export async function getTagCategories(backendUrl: string): Promise<TagCategoryDefinition> {
    const res = await axios.get(`${backendUrl}/api/comfyui/tag-categories`);
    return res.data;
}

// カテゴリ定義保存
export async function saveTagCategories(backendUrl: string, def: TagCategoryDefinition): Promise<void> {
    await axios.put(`${backendUrl}/api/comfyui/tag-categories`, def);
}

// タグマッピング取得
export async function getTagMapping(backendUrl: string, categoryId: string): Promise<TagMappingFile> {
    const res = await axios.get(`${backendUrl}/api/comfyui/tag-mapping/${encodeURIComponent(categoryId)}`);
    return res.data;
}

// タグマッピング保存
export async function saveTagMapping(backendUrl: string, categoryId: string, data: TagMappingFile): Promise<void> {
    await axios.put(`${backendUrl}/api/comfyui/tag-mapping/${encodeURIComponent(categoryId)}`, data);
}

// 全カテゴリのタグマッピング一括取得
export async function getAllTagMappings(backendUrl: string): Promise<TagMappingBundle> {
    const res = await axios.get(`${backendUrl}/api/comfyui/tag-mapping`);
    return {
        categories: res.data?.categories || [],
        mappings: res.data?.mappings || [],
    };
}

// タグ1件の有効/無効更新（照合キーで特定）
export async function setTagEnabled(backendUrl: string, categoryId: string, key: string, enabled: boolean): Promise<void> {
    await axios.put(`${backendUrl}/api/comfyui/tag-mapping/${encodeURIComponent(categoryId)}/enabled`, { key, enabled });
}

// ===== 画像生成 =====

export interface GenerateRequest {
    templateName: string;
    characterName: string;
    tagSelections: Record<string, string>;
    /** カテゴリID→プロンプト直接指定（タグマッピング照合をバイパス） */
    directTags?: Record<string, string>;
    /** プレースホルダ名→値 直接指定（テスト用。CHARACTER, FEATURES等を直接上書き） */
    directReplacements?: Record<string, string>;
    /** API サービスの生成プリセット名（ComfyUI 連携では無視） */
    presetName?: string;
    /** 生成バックエンドの明示（省略時は設定の選択に従う） */
    backend?: ImageBackend;
    /** その回の生成にだけ使う追加プロンプト（API サービスのテスト生成のみ。ComfyUI 連携では無視） */
    extraPrompt?: string;
}

/** 絵に描く効果音 1 個分（文言と、どこに・どんな形で描くかの説明） */
export interface ImageSoundEffect {
    text: string;
    style?: string;
}

/**
 * 自動効果音の判定結果の種別。値が無いのは「判定なし」（判定を行わなかった生成・古い画像）。
 * specified＝指定あり、notNeeded＝不要と判定、rejected＝判定結果を採用できず。
 */
export type ImageSoundEffectsStatus = 'specified' | 'notNeeded' | 'rejected';

/** 人物 1 人分の解決済みプロンプト（API サービス生成のみ） */
export interface ResolvedPersonPrompt {
    label?: string;
    positive: string;
    negative?: string;
}

export interface ResolvedPromptInfo {
    positive: string;
    negative: string;
    lorasApplied: string[];
    persons?: ResolvedPersonPrompt[];
}

export interface GenerateResult {
    success: boolean;
    error?: string;
    imageBase64?: string;
    mimeType?: string;
    resolvedPrompt?: ResolvedPromptInfo;
    /** 以下は API サービス生成のときだけ入る */
    warnings?: string[];
    backend?: ImageBackend;
    service?: ApiServiceId;
    model?: string;
    seed?: number;
    anlasEstimated?: number;
    presetName?: string;
    /** 生成へ指定した効果音（実際に送ったもの。絵に描かれたかどうかとは別）と、その種別 */
    soundEffects?: ImageSoundEffect[];
    soundEffectsStatus?: ImageSoundEffectsStatus;
}

export async function generateImage(
    backendUrl: string,
    req: GenerateRequest
): Promise<GenerateResult> {
    const res = await axios.post(`${backendUrl}/api/comfyui/generate`, req);
    return res.data;
}

/** base64 の先頭から画像種別を推定して data URL にする（途中画像は種別が事前に分からない） */
export function imageDataUrlFromBase64(base64: string, fallbackMime = 'image/png'): string {
    let mime = fallbackMime;
    if (base64.startsWith('/9j/')) mime = 'image/jpeg';
    else if (base64.startsWith('iVBOR')) mime = 'image/png';
    else if (base64.startsWith('UklGR')) mime = 'image/webp';
    return `data:${mime};base64,${base64}`;
}

/**
 * API サービスのテスト生成（途中経過付き）。サーバーが SSE で流す intermediate を
 * onIntermediate へ渡し、final（生成結果）または error で解決する。
 * axios は SSE を受け取れないため fetch で読む。認証ヘッダーは axios と同じ規則で付ける。
 */
export async function generateApiServiceTest(
    backendUrl: string,
    req: GenerateRequest,
    onIntermediate: (stepIx: number, imageBase64: string) => void,
    signal?: AbortSignal
): Promise<GenerateResult> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
    if (isFirebaseEnabled) {
        try {
            const token = await getIdToken();
            if (token) headers.Authorization = `Bearer ${token}`;
        } catch (error) {
            console.error('[generateApiServiceTest] failed to get ID token:', error);
        }
    }
    const res = await fetch(`${backendUrl}/api/comfyui/api-service/test-generate`, {
        method: 'POST',
        headers,
        body: JSON.stringify(req),
        signal,
    });
    if (!res.ok || !res.body) {
        let error = `HTTP ${res.status}`;
        try {
            const data = await res.json();
            error = data?.error || data?.messageKey || error;
        } catch { /* 本文なし */ }
        return { success: false, error };
    }
    let final: GenerateResult | null = null;
    const handleEvent = (event: string, data: string) => {
        if (!data) return;
        let parsed: any;
        try {
            parsed = JSON.parse(data);
        } catch {
            return;
        }
        if (event === 'intermediate') {
            if (parsed?.image) onIntermediate(Number(parsed.stepIx) || 0, String(parsed.image));
        } else if (event === 'final') {
            final = parsed as GenerateResult;
        } else if (event === 'error') {
            final = { success: false, error: parsed?.error || 'error.nai.serverError' };
        }
    };
    const processBlock = (block: string) => {
        let event = 'message';
        const dataLines: string[] = [];
        for (const line of block.split('\n')) {
            if (!line || line.startsWith(':')) continue;
            const idx = line.indexOf(':');
            const field = idx >= 0 ? line.slice(0, idx) : line;
            let value = idx >= 0 ? line.slice(idx + 1) : '';
            if (value.startsWith(' ')) value = value.slice(1);
            if (field === 'event') event = value;
            else if (field === 'data') dataLines.push(value);
        }
        handleEvent(event, dataLines.join('\n'));
    };
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sep = buffer.indexOf('\n\n');
        while (sep >= 0) {
            processBlock(buffer.slice(0, sep).replace(/\r/g, ''));
            buffer = buffer.slice(sep + 2);
            sep = buffer.indexOf('\n\n');
        }
    }
    buffer += decoder.decode();
    if (buffer.trim()) processBlock(buffer.replace(/\r/g, ''));
    return final ?? { success: false, error: 'error.nai.invalidResponse' };
}

// ===== トリガーワード =====

export interface TriggerWordResult {
    success: boolean;
    loraName: string;
    triggerWords: string[];
    /** 行（グループ）配列。1要素＝1行。無い場合は triggerWords を1行に包んでフォールバック */
    triggerLines?: string[];
    modelName?: string | null;
    cached?: boolean;
    error?: string;
}

// 単一LoRAのトリガーワード取得
export async function getLoraTriggerWords(backendUrl: string, loraName: string): Promise<TriggerWordResult> {
    const res = await axios.get(`${backendUrl}/api/comfyui/trigger-words/${encodeURIComponent(loraName)}`);
    return res.data;
}

// 複数LoRAのトリガーワード一括取得
export async function getLoraTriggerWordsBatch(
    backendUrl: string,
    names: string[]
): Promise<Record<string, TriggerWordResult>> {
    const res = await axios.post(`${backendUrl}/api/comfyui/trigger-words/batch`, { names });
    return res.data.results || {};
}

// ===== Danbooruタグ検索 =====

export interface DanbooruTagResult {
    label: string;
    value: string;
    category: number;
    postCount: number;
    antecedent?: string;
}

export interface DanbooruSearchResult {
    success: boolean;
    results: DanbooruTagResult[];
    error?: string;
}

/**
 * Danbooruタグ検索（日本語エイリアス対応）
 * @param categories カテゴリ番号配列（例: [3,4] でキャラ+作品名のみ）。空なら全カテゴリ。
 */
export async function searchDanbooruTags(
    backendUrl: string,
    query: string,
    categories: number[] = [],
    limit: number = 20
): Promise<DanbooruSearchResult> {
    const params: Record<string, string> = { q: query, limit: String(limit) };
    if (categories.length > 0) {
        params.categories = categories.join(',');
    }
    const res = await axios.get(`${backendUrl}/api/comfyui/danbooru-search`, { params });
    return res.data;
}

// ===== チャット中画像生成 =====

export interface ImageAttachment {
    id: string;
    characterName: string;
    /** 生成元のチャットバブル（TURN）。両方未設定は旧データ（メッセージ末尾表示） */
    turnId?: string;
    turnIndex?: number;
    createdAt: string;
    filename: string;
    mimeType: string;
    tagsUsed: Record<string, string>;
    selectedKeys?: Record<string, string>;
    resolvedPrompt?: ResolvedPromptInfo;
    templateId: string;
    workflowOverrideTemplateId?: string;
    /** 以下は生成条件と注意（API サービス生成で入る。ComfyUI 連携では backend のみ） */
    backend?: ImageBackend;
    service?: ApiServiceId;
    model?: string;
    seed?: number;
    anlasEstimated?: number;
    presetName?: string;
    warnings?: string[];
    /** 生成へ指定した効果音と、その種別（この情報を持たない古い画像では無し） */
    soundEffects?: ImageSoundEffect[];
    soundEffectsStatus?: ImageSoundEffectsStatus;
}

export interface GenerateFromChatResult {
    success: boolean;
    error?: string;
    attachment?: ImageAttachment;
    resolvedPrompt?: ResolvedPromptInfo;
}

export interface GenerateFromChatJobResult {
    jobId: string;
    status: string;
}

// 会話履歴からタグ判定 + 画像生成（ジョブキュー方式。即座にjobIdを返す）
// turnId / turnIndex は生成対象のチャットバブル指定（turnId優先。両方省略は従来動作）
export async function generateFromChat(
    backendUrl: string,
    sessionId: string,
    messageId: string,
    turnId?: string | null,
    turnIndex?: number,
    characterName?: string,
    templateName?: string,
    presetName?: string
): Promise<GenerateFromChatJobResult> {
    const res = await axios.post(`${backendUrl}/api/comfyui/generate-from-chat`, {
        sessionId, messageId, turnId: turnId || undefined, turnIndex, characterName, templateName, presetName,
    });
    return res.data;
}

// 添付画像の削除（メタデータと、他から参照されていなければ画像ファイル本体も削除）
export async function deleteImageAttachment(
    backendUrl: string,
    sessionId: string,
    messageId: string,
    attachmentId: string
): Promise<void> {
    await axios.delete(`${backendUrl}/api/comfyui/image-attachments/${encodeURIComponent(sessionId)}/${encodeURIComponent(messageId)}/${encodeURIComponent(attachmentId)}`);
}

// メッセージの添付画像一覧取得
export async function getImageAttachments(
    backendUrl: string,
    sessionId: string,
    messageId: string
): Promise<ImageAttachment[]> {
    const res = await axios.get(`${backendUrl}/api/comfyui/image-attachments/${encodeURIComponent(sessionId)}/${encodeURIComponent(messageId)}`);
    return res.data.attachments || [];
}

// セッション全体の添付画像取得
export async function getAllImageAttachments(
    backendUrl: string,
    sessionId: string
): Promise<Record<string, ImageAttachment[]>> {
    const res = await axios.get(`${backendUrl}/api/comfyui/image-attachments/${encodeURIComponent(sessionId)}`);
    return res.data.attachments || {};
}

// 生成画像のURL構築
export function getImageUrl(backendUrl: string, sessionId: string, filename: string): string {
    return `${backendUrl}/api/comfyui/images/${encodeURIComponent(sessionId)}/${encodeURIComponent(filename)}`;
}

// 生成画像を認証付きで取得し objectURL を返す。
// <img src> のブラウザ直接GETには Authorization ヘッダが付かず、
// 公開ビルド（Firebase認証）では /api/* が 401 を返して画像が表示されないため、
// axios（認証インターセプタ経由）で blob を取得して表示する。
// objectURL はモジュール内でキャッシュし、同一画像の再取得と URL リークを抑える。
const imageObjectUrls = new Map<string, string>();

export async function resolveAuthedImageUrl(
    backendUrl: string,
    sessionId: string,
    filename: string
): Promise<string> {
    const url = getImageUrl(backendUrl, sessionId, filename);
    const cached = imageObjectUrls.get(url);
    if (cached) return cached;
    const res = await axios.get(url, { responseType: 'blob' });
    const objectUrl = URL.createObjectURL(res.data);
    imageObjectUrls.set(url, objectUrl);
    return objectUrl;
}

// ===== 画像生成 API サービス（NovelAI 等） =====

export interface NovelAIModelInfo {
    id: string;
    label: string;
    generation: 'v5' | 'v45';
    maxPersons: number;
    promptTokenLimit: number;
    /** 絵に描く文字の指定全体（文言と区切りの合計）の文字数上限 */
    textRenderLimit: number;
    /** 日本語の効果音を絵に描けるか */
    supportsSoundEffects: boolean;
    supportsReference: boolean;
    supportsTransparent: boolean;
    supportsJapanese: boolean;
    supportsFurryMode: boolean;
    /** Variety+ を有効にしたときに送る値。0 は未確認（欄を無効表示） */
    varietyBoostSigma: number;
    ucPresets: number[];
    /** ネガティブ定型の番号ごとに、全体ネガティブへ足される文字列 */
    ucPresetTexts: Record<string, string>;
    /** このモデルで選べる品質タグの種類 */
    qualityTags: NovelAIQualityTagsKind[];
    /** 品質タグの種類ごとの推奨の文（編集していないときに送られる文） */
    qualityTagsDefaults: Record<string, string>;
}

/** 品質タグの種類（none は付けない） */
export type NovelAIQualityTagsKind = 'standard' | 'light' | 'none';

/**
 * 生成プリセットの中で、モデルごとに別々に保存する設定値。
 * あるモデルで変えても、ほかのモデル用の値は変わらない。モデルを戻すとそのモデルの値に戻る。
 */
export interface NovelAIModelValues {
    qualityTags: NovelAIQualityTagsKind;
    /** 種類ごとの編集した品質タグの文。キーが無い種類は推奨の文、空文字は何も足さない */
    qualityTagsText?: Record<string, string>;
    /** -1 は定型なし */
    ucPreset: number;
    transparentBackground: boolean;
    imageFormat: NovelAIImageFormat;
    varietyBoost: boolean;
}

export interface NovelAIChoice {
    id: string;
    label: string;
}

export interface NovelAISizePreset {
    id: string;
    label: string;
    width: number;
    height: number;
}

export interface NovelAIFreeTier {
    enabled: boolean;
    maxPixels: number;
    maxSteps: number;
    maxSamples: number;
}

export interface NovelAICatalog {
    models: NovelAIModelInfo[];
    samplers: NovelAIChoice[];
    schedules: NovelAIChoice[];
    sizePresets: NovelAISizePreset[];
    schedulesBySampler: Record<string, string[]>;
    freeTier: NovelAIFreeTier;
}

export interface NovelAIPromptTemplate {
    base: string;
    character: string;
    negative: string;
}

export type NovelAISeedMode = 'random' | 'fixed';
export type NovelAIImageFormat = 'png' | 'webp';

/**
 * 生成プリセット。使うモデルはここには持たない（全体の設定で選ぶ）。
 * モデルで働きが変わる項目は modelValues にモデル別で持つ。保存の要求では、編集したモデルの
 * キーだけを送る（要求に無いモデル用の値は、保存済みのまま保たれる）。
 */
export interface NovelAIPreset {
    name: string;
    sizePreset: string;
    width: number;
    height: number;
    steps: number;
    scale: number;
    cfgRescale: number;
    sampler: string;
    noiseSchedule: string;
    seedMode: NovelAISeedMode;
    fixedSeed: number;
    fixedPositive: string;
    fixedNegative: string;
    promptTemplate: NovelAIPromptTemplate;
    furryMode: boolean;
    modelValues?: Record<string, NovelAIModelValues>;
}

export interface NovelAISubscription {
    tier: number;
    tierLabelKey: string;
    active: boolean;
    expiresAt: number;
    anlas: number;
    fixedAnlas: number;
    purchasedAnlas: number;
    freeTier: NovelAIFreeTier;
    usagePercent: number;
    usageNegative: boolean;
    usageKnown: boolean;
}

export interface ApiServiceConnectionResult {
    success: boolean;
    message?: string;
    subscription?: NovelAISubscription;
}

export interface ApiServiceTokenStatus {
    success: boolean;
    hasToken: boolean;
}

const apiServiceParams = (service: ApiServiceId) => ({ params: { service } });

export async function getApiServiceCatalog(backendUrl: string, service: ApiServiceId = 'novelai'): Promise<NovelAICatalog> {
    const res = await axios.get(`${backendUrl}/api/comfyui/api-service/catalog`, apiServiceParams(service));
    return res.data;
}

export async function listApiServicePresets(backendUrl: string, service: ApiServiceId = 'novelai'): Promise<NovelAIPreset[]> {
    const res = await axios.get(`${backendUrl}/api/comfyui/api-service/presets`, apiServiceParams(service));
    return res.data.presets || [];
}

export async function getApiServicePreset(backendUrl: string, name: string, service: ApiServiceId = 'novelai'): Promise<NovelAIPreset> {
    const res = await axios.get(`${backendUrl}/api/comfyui/api-service/presets/${encodeURIComponent(name)}`, apiServiceParams(service));
    return res.data;
}

export async function saveApiServicePreset(backendUrl: string, preset: NovelAIPreset, service: ApiServiceId = 'novelai'): Promise<NovelAIPreset> {
    const res = await axios.put(`${backendUrl}/api/comfyui/api-service/presets/${encodeURIComponent(preset.name)}`, preset, apiServiceParams(service));
    return res.data;
}

export async function deleteApiServicePreset(backendUrl: string, name: string, service: ApiServiceId = 'novelai'): Promise<void> {
    await axios.delete(`${backendUrl}/api/comfyui/api-service/presets/${encodeURIComponent(name)}`, apiServiceParams(service));
}

export async function copyApiServicePreset(backendUrl: string, source: string, newName: string, service: ApiServiceId = 'novelai'): Promise<NovelAIPreset> {
    const res = await axios.post(`${backendUrl}/api/comfyui/api-service/presets/${encodeURIComponent(source)}/copy`, { name: newName }, apiServiceParams(service));
    return res.data;
}

export async function getApiServiceTokenStatus(backendUrl: string, service: ApiServiceId = 'novelai'): Promise<ApiServiceTokenStatus> {
    const res = await axios.get(`${backendUrl}/api/comfyui/api-service/token`, apiServiceParams(service));
    return res.data;
}

export async function setApiServiceToken(backendUrl: string, token: string, service: ApiServiceId = 'novelai'): Promise<ApiServiceTokenStatus> {
    const res = await axios.put(`${backendUrl}/api/comfyui/api-service/token`, { token }, apiServiceParams(service));
    return res.data;
}

/** 既定の使用モデル（未設定のときの値。サーバーの既定と合わせる） */
export const DEFAULT_NOVELAI_MODEL = 'nai-diffusion-5-full';

/** 使うモデルを保存する（この値を書く唯一の口。ほかの設定には触れない） */
export async function setApiServiceModel(backendUrl: string, model: string, service: ApiServiceId = 'novelai'): Promise<string> {
    const res = await axios.put(`${backendUrl}/api/comfyui/api-service/model`, { model }, apiServiceParams(service));
    return res.data.model;
}

/** 全体の設定から、選ばれている使用モデルを読む（未設定は既定） */
export function apiServiceModelOf(config: ComfyUIConfig | null | undefined, service: ApiServiceId = 'novelai'): string {
    return config?.apiServiceSettings?.[service]?.model || DEFAULT_NOVELAI_MODEL;
}

/** 自動効果音描画のトグルを保存する（この値を書く唯一の口。ほかの設定には触れない） */
export async function setApiServiceAutoSoundEffects(backendUrl: string, enabled: boolean, service: ApiServiceId = 'novelai'): Promise<boolean> {
    const res = await axios.put(`${backendUrl}/api/comfyui/api-service/auto-sound-effects`, { enabled }, apiServiceParams(service));
    return res.data.enabled === true;
}

/** 全体の設定から、自動効果音描画のトグルを読む（未設定は OFF） */
export function apiServiceAutoSoundEffectsOf(config: ComfyUIConfig | null | undefined, service: ApiServiceId = 'novelai'): boolean {
    return config?.apiServiceSettings?.[service]?.autoSoundEffects === true;
}

export async function deleteApiServiceToken(backendUrl: string, service: ApiServiceId = 'novelai'): Promise<ApiServiceTokenStatus> {
    const res = await axios.delete(`${backendUrl}/api/comfyui/api-service/token`, apiServiceParams(service));
    return res.data;
}

export async function testApiServiceConnection(backendUrl: string, service: ApiServiceId = 'novelai'): Promise<ApiServiceConnectionResult> {
    const res = await axios.get(`${backendUrl}/api/comfyui/api-service/test-connection`, apiServiceParams(service));
    return res.data;
}

export async function getApiServiceBalance(backendUrl: string, service: ApiServiceId = 'novelai'): Promise<ApiServiceConnectionResult> {
    const res = await axios.get(`${backendUrl}/api/comfyui/api-service/balance`, apiServiceParams(service));
    return res.data;
}

export async function getApiServiceUserAppearance(backendUrl: string, service: ApiServiceId = 'novelai'): Promise<UserAppearance> {
    const res = await axios.get(`${backendUrl}/api/comfyui/api-service/user-appearance`, apiServiceParams(service));
    return res.data;
}

export async function saveApiServiceUserAppearance(backendUrl: string, appearance: UserAppearance, service: ApiServiceId = 'novelai'): Promise<UserAppearance> {
    const res = await axios.put(`${backendUrl}/api/comfyui/api-service/user-appearance`, appearance, apiServiceParams(service));
    return res.data;
}

// ===== 参照画像（人物の見た目を指示する画像） =====

export interface ReferenceImageInput {
    kind: ReferenceImageKind;
    strength: number;
    fidelity: number;
}

const referenceImageForm = (file: File, input: ReferenceImageInput): FormData => {
    const form = new FormData();
    form.append('file', file);
    form.append('kind', input.kind);
    form.append('strength', String(input.strength));
    form.append('fidelity', String(input.fidelity));
    return form;
};

export async function addCharacterReferenceImage(backendUrl: string, name: string, service: ApiServiceId, file: File, input: ReferenceImageInput): Promise<ReferenceImage> {
    const res = await axios.post(
        `${backendUrl}/api/comfyui/character-config/${encodeURIComponent(name)}/api-service/${encodeURIComponent(service)}/reference-images`,
        referenceImageForm(file, input)
    );
    return res.data;
}

export async function deleteCharacterReferenceImage(backendUrl: string, name: string, service: ApiServiceId, id: string): Promise<void> {
    await axios.delete(`${backendUrl}/api/comfyui/character-config/${encodeURIComponent(name)}/api-service/${encodeURIComponent(service)}/reference-images/${encodeURIComponent(id)}`);
}

export function getCharacterReferenceImageUrl(backendUrl: string, name: string, service: ApiServiceId, id: string): string {
    return `${backendUrl}/api/comfyui/character-config/${encodeURIComponent(name)}/api-service/${encodeURIComponent(service)}/reference-images/${encodeURIComponent(id)}`;
}

export async function addUserReferenceImage(backendUrl: string, service: ApiServiceId, file: File, input: ReferenceImageInput): Promise<ReferenceImage> {
    const res = await axios.post(`${backendUrl}/api/comfyui/api-service/user-appearance/reference-images`, referenceImageForm(file, input), apiServiceParams(service));
    return res.data;
}

export async function deleteUserReferenceImage(backendUrl: string, service: ApiServiceId, id: string): Promise<void> {
    await axios.delete(`${backendUrl}/api/comfyui/api-service/user-appearance/reference-images/${encodeURIComponent(id)}`, apiServiceParams(service));
}

export function getUserReferenceImageUrl(backendUrl: string, service: ApiServiceId, id: string): string {
    return `${backendUrl}/api/comfyui/api-service/user-appearance/reference-images/${encodeURIComponent(id)}?service=${encodeURIComponent(service)}`;
}

// 認証付きで画像を取得して objectURL を返す（生成画像と同じ仕組み。URL 単位でキャッシュ）。
export async function resolveAuthedUrl(url: string): Promise<string> {
    const cached = imageObjectUrls.get(url);
    if (cached) return cached;
    const res = await axios.get(url, { responseType: 'blob' });
    const objectUrl = URL.createObjectURL(res.data);
    imageObjectUrls.set(url, objectUrl);
    return objectUrl;
}

// 削除した画像の objectURL キャッシュを捨てる。
export function forgetAuthedUrl(url: string): void {
    const cached = imageObjectUrls.get(url);
    if (cached) {
        URL.revokeObjectURL(cached);
        imageObjectUrls.delete(url);
    }
}
