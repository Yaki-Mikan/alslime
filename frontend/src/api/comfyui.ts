/**
 * comfyui.ts - ComfyUI設定管理 API クライアント
 */

import axios from '../lib/axios';

// 型定義
export type DirectiveMode = 'danbooru_only' | 'natural_language';
export type DanbooruTagFormat = 'underscore' | 'space';
/** トリガーワードのコピー時変換。raw=変換なし / underscore=スペース→_ / space=_→スペース */
export type TriggerWordFormat = 'raw' | 'underscore' | 'space';
export type TagJudgeProvider = 'gemini' | 'claude' | 'antigravity';
export type GeminiTagJudgeModel = string;
export type ClaudeTagJudgeModel = string;
export type AntigravityTagJudgeModel = string;

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
    tagJudgeAntigravityModel: AntigravityTagJudgeModel;
    tagJudgeTimeoutSeconds: number;
    lightweightImageSave: LightweightImageSaveConfig;
    /** 選択中のプレースホルダプリセット名（空/未設定は未選択） */
    placeholderPresetName?: string;
}

/** プレースホルダプリセットの1行（変換元→変換先。description はタグ判定AIへの状況説明） */
export interface PlaceholderEntry {
    from: string;
    to: string;
    description?: string;
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
}

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

export interface TagEntry {
    key: string;
    description: string;
    prompt: string;
    negativePrompt: string;
    workflowTemplateId?: string;
    lora: TagLoraEntry[];
}

export interface TagMappingFile {
    categoryId: string;
    tags: TagEntry[];
}

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

// ===== 画像生成 =====

export interface GenerateRequest {
    templateName: string;
    characterName: string;
    tagSelections: Record<string, string>;
    /** カテゴリID→プロンプト直接指定（タグマッピング照合をバイパス） */
    directTags?: Record<string, string>;
    /** プレースホルダ名→値 直接指定（テスト用。CHARACTER, FEATURES等を直接上書き） */
    directReplacements?: Record<string, string>;
}

export interface ResolvedPromptInfo {
    positive: string;
    negative: string;
    lorasApplied: string[];
}

export interface GenerateResult {
    success: boolean;
    error?: string;
    imageBase64?: string;
    mimeType?: string;
    resolvedPrompt?: ResolvedPromptInfo;
}

export async function generateImage(
    backendUrl: string,
    req: GenerateRequest
): Promise<GenerateResult> {
    const res = await axios.post(`${backendUrl}/api/comfyui/generate`, req);
    return res.data;
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
    createdAt: string;
    filename: string;
    mimeType: string;
    tagsUsed: Record<string, string>;
    selectedKeys?: Record<string, string>;
    resolvedPrompt?: ResolvedPromptInfo;
    templateId: string;
    workflowOverrideTemplateId?: string;
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
export async function generateFromChat(
    backendUrl: string,
    sessionId: string,
    messageId: string,
    characterName?: string,
    templateName?: string
): Promise<GenerateFromChatJobResult> {
    const res = await axios.post(`${backendUrl}/api/comfyui/generate-from-chat`, {
        sessionId, messageId, characterName, templateName,
    });
    return res.data;
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
