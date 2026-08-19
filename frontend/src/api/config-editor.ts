import axios from '../lib/axios';

export interface CategoryDef {
    id: string;
    label: string;
    isCharacter: boolean;
}

export interface ConfigFileEntry {
    name: string;    // ファイル名（拡張子なし、表示名）
    dirName: string; // フォルダ名（非キャラクターは name と同じ）
}

export async function getCategories(backendUrl: string): Promise<CategoryDef[]> {
    const res = await axios.get(`${backendUrl}/api/config-editor/categories`);
    return res.data;
}

export async function listConfigFiles(backendUrl: string, categoryId: string): Promise<ConfigFileEntry[]> {
    const res = await axios.get(`${backendUrl}/api/config-editor/files/${categoryId}`);
    return res.data;
}

export async function getConfigFile(backendUrl: string, categoryId: string, dirName: string, fileName: string): Promise<string> {
    const res = await axios.get(`${backendUrl}/api/config-editor/file/${categoryId}/${encodeURIComponent(dirName)}/${encodeURIComponent(fileName)}`);
    return res.data.content;
}

export async function checkConfigFileExists(backendUrl: string, categoryId: string, dirName: string, fileName: string): Promise<boolean> {
    const res = await axios.get(`${backendUrl}/api/config-editor/file/${categoryId}/${encodeURIComponent(dirName)}/${encodeURIComponent(fileName)}/exists`);
    return res.data.exists;
}

export async function saveConfigFile(backendUrl: string, categoryId: string, dirName: string, fileName: string, content: string): Promise<void> {
    await axios.post(`${backendUrl}/api/config-editor/file/${categoryId}/${encodeURIComponent(dirName)}/${encodeURIComponent(fileName)}`, { content });
}

export async function deleteConfigFile(backendUrl: string, categoryId: string, dirName: string, fileName: string): Promise<void> {
    await axios.delete(`${backendUrl}/api/config-editor/file/${categoryId}/${encodeURIComponent(dirName)}/${encodeURIComponent(fileName)}`);
}

// saveConfigFileUnique は同名衝突時に「名前 (2)」形式へ自動リネームして保存し、
// 実際に保存されたファイル名を返す（D&D 個別インポート用）。
export async function saveConfigFileUnique(backendUrl: string, categoryId: string, fileName: string, content: string): Promise<string> {
    const res = await axios.post(
        `${backendUrl}/api/config-editor/file/${categoryId}/${encodeURIComponent(fileName)}/${encodeURIComponent(fileName)}`,
        { content, renameIfExists: true },
    );
    return res.data.name;
}

// ---- AIプロバイダ指示ファイル（固定ファイル。編集のみ） ----

export interface ProviderInstruction {
    id: string;     // "antigravity" | "claude" | "gemini"
    label: string;
    file: string;   // 実ファイル名（AGENTS.md 等。表示用）
    exists: boolean;
}

export async function listProviderInstructions(backendUrl: string): Promise<ProviderInstruction[]> {
    const res = await axios.get(`${backendUrl}/api/config-editor/provider-instructions`);
    return res.data;
}

export async function getProviderInstruction(backendUrl: string, id: string): Promise<string> {
    const res = await axios.get(`${backendUrl}/api/config-editor/provider-instruction/${id}`);
    return res.data.content;
}

export async function saveProviderInstruction(backendUrl: string, id: string, content: string): Promise<void> {
    await axios.post(`${backendUrl}/api/config-editor/provider-instruction/${id}`, { content });
}

// ---- タグ判定指示ファイル（固定ファイル。supporter tier ゲート付き） ----

export interface ComfyDirective {
    id: string;     // "danbooru" | "natural"
    label: string;
    file: string;
    exists: boolean;
}

export async function listComfyDirectives(backendUrl: string): Promise<ComfyDirective[]> {
    const res = await axios.get(`${backendUrl}/api/config-editor/comfy-directives`);
    return res.data;
}

export async function getComfyDirective(backendUrl: string, id: string): Promise<string> {
    const res = await axios.get(`${backendUrl}/api/config-editor/comfy-directive/${id}`);
    return res.data.content;
}

export async function saveComfyDirective(backendUrl: string, id: string, content: string): Promise<void> {
    await axios.post(`${backendUrl}/api/config-editor/comfy-directive/${id}`, { content });
}

// resetComfyDirective は指示ファイルを同梱デフォルトの内容へ上書きし、復元後の本文を返す。
export async function resetComfyDirective(backendUrl: string, id: string): Promise<string> {
    const res = await axios.post(`${backendUrl}/api/config-editor/comfy-directive/${id}/reset`);
    return res.data.content;
}

// ---- 設定自動生成の指示ファイル（固定ファイル。編集のみ。ゲートなし） ----

// ConfigGenInstructionMethod は方式 ID（バックエンドのカタログと同じ値）。
// two_step_1 / two_step_2 / one_shot は作成指示本体、search_template / setting_template は
// 作成指示へ差し込まれるテンプレート（調査項目・設定ファイル形式）。
export type ConfigGenInstructionMethod = 'two_step_1' | 'two_step_2' | 'one_shot' | 'search_template' | 'setting_template';
// ConfigGenInstructionKind は種類。instruction（作成指示。編集非推奨）| template（差し込みテンプレート）。
export type ConfigGenInstructionKind = 'instruction' | 'template';
export type ConfigGenInstructionLocale = 'ja' | 'en';

export interface ConfigGenInstruction {
    id: string;       // "<target>-<method>-<locale>"
    label: string;    // 予備の表示名（フロントの i18n キー configEditor.configGenInstruction.method.<method> を優先）
    kind: ConfigGenInstructionKind;
    target: string;   // 対象種別 ID（カテゴリ ID。現状 "character" のみ）
    method: ConfigGenInstructionMethod;
    locale: ConfigGenInstructionLocale;
    file: string;
    exists: boolean;
}

// configGenInstructionId はバックエンドと同じ規則で ID を組む（設定自動生成タブからの直接遷移用）。
export function configGenInstructionId(target: string, method: ConfigGenInstructionMethod, locale: string): string {
    return `${target}-${method}-${normalizeConfigGenInstructionLocale(locale)}`;
}

// normalizeConfigGenInstructionLocale は UI 言語（"ja-JP" 等）を指示ファイルのロケールへ寄せる。
// 未対応言語は ja（実行側のフォールバックと同じ）。
export function normalizeConfigGenInstructionLocale(locale: string): ConfigGenInstructionLocale {
    const base = (locale || '').trim().toLowerCase().split(/[-_]/)[0];
    return base === 'en' ? 'en' : 'ja';
}

export async function listConfigGenInstructions(backendUrl: string): Promise<ConfigGenInstruction[]> {
    const res = await axios.get(`${backendUrl}/api/config-editor/configgen-instructions`);
    return res.data;
}

export async function getConfigGenInstruction(backendUrl: string, id: string): Promise<string> {
    const res = await axios.get(`${backendUrl}/api/config-editor/configgen-instruction/${id}`);
    return res.data.content;
}

export async function saveConfigGenInstruction(backendUrl: string, id: string, content: string): Promise<void> {
    await axios.post(`${backendUrl}/api/config-editor/configgen-instruction/${id}`, { content });
}

// resetConfigGenInstruction は指示ファイルを同梱デフォルトの内容へ上書きし、復元後の本文を返す。
export async function resetConfigGenInstruction(backendUrl: string, id: string): Promise<string> {
    const res = await axios.post(`${backendUrl}/api/config-editor/configgen-instruction/${id}/reset`);
    return res.data.content;
}

export async function listTemplates(backendUrl: string, categoryId: string): Promise<string[]> {
    const res = await axios.get(`${backendUrl}/api/config-editor/templates/${categoryId}`);
    return res.data;
}

export async function getTemplate(backendUrl: string, categoryId: string, name: string): Promise<string> {
    const res = await axios.get(`${backendUrl}/api/config-editor/template/${categoryId}/${encodeURIComponent(name)}`);
    return res.data.content;
}

export async function saveTemplate(backendUrl: string, categoryId: string, name: string, content: string): Promise<void> {
    await axios.post(`${backendUrl}/api/config-editor/template/${categoryId}/${encodeURIComponent(name)}`, { content });
}

export async function deleteTemplate(backendUrl: string, categoryId: string, name: string): Promise<void> {
    await axios.delete(`${backendUrl}/api/config-editor/template/${categoryId}/${encodeURIComponent(name)}`);
}

export async function checkTemplateExists(backendUrl: string, categoryId: string, name: string): Promise<boolean> {
    const res = await axios.get(`${backendUrl}/api/config-editor/template/${categoryId}/${encodeURIComponent(name)}/exists`);
    return res.data.exists;
}

export async function getDefaultTemplates(backendUrl: string): Promise<Record<string, string>> {
    const res = await axios.get(`${backendUrl}/api/config-editor/defaults`);
    return res.data;
}

export async function setDefaultTemplate(backendUrl: string, categoryId: string, templateName: string): Promise<void> {
    await axios.post(`${backendUrl}/api/config-editor/defaults`, { categoryId, templateName });
}

export async function getInitialContent(backendUrl: string, categoryId: string): Promise<string> {
    const res = await axios.get(`${backendUrl}/api/config-editor/initial-content/${categoryId}`);
    return res.data.content;
}
