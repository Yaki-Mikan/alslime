// TTS（Irodori-TTS連携・音声読み上げ）API クライアント。
// バックエンドの /api/tts/*（ttsgate 配下。支援者ゲート・サイドカー/in-process 共通形状）を呼ぶ。
import axios from '../lib/axios';

// 型定義

// 読み上げ対象の選択値（バックエンド tts.Config と一致させる）。
export type TTSReadTarget = 'dialogue' | 'dialogueAndNarration';
// 音声形式（初版は wav / mp3）。
export type TTSResponseFormat = 'wav' | 'mp3';

// TTSConfig は GET /api/tts/config の応答。apiKey の値は返らず apiKeySet だけが来る。
export interface TTSConfig {
    version: number;
    connectionUrl: string;
    connectTimeoutSeconds: number;
    apiKeySet: boolean;
    narratorEnabled: boolean;
    narratorVoiceId: string;
    autoReadEnabled: boolean;
    // 自動読み上げで生成した音声をそのまま順次再生するか（autoReadEnabled が真のときだけ有効）。
    autoReadPlaybackEnabled: boolean;
    stopButtonEnabled: boolean;
    autoAdvanceEnabled: boolean;
    emojiStyleEnabled: boolean;
    readTarget: TTSReadTarget;
    speed: number;
    cfgScaleCaption: number;
    cfgScaleSpeaker: number;
    chunkSilenceSeconds: number;
    // 通し再生で TURN 同士・応答同士の切れ目に空ける間（秒。再生側で待つ）。
    turnGapSeconds: number;
    turnSplitChars: number;
    playbackStartChunkCount: number;
    responseFormat: TTSResponseFormat;
    sequentialPlayback: boolean;
    saveMergedAudio: boolean;
    volume: number;
}

// TTSConfigUpdate は POST /api/tts/config の送信形。
// apiKey は「非空なら更新・空なら既存維持」。明示的に消すときだけ clearApiKey を使う。
export interface TTSConfigUpdate extends Omit<TTSConfig, 'apiKeySet'> {
    apiKey?: string;
    clearApiKey?: boolean;
}

// TTSConnectionTestResult は複合接続確認（要件7.2）の結果。
export interface TTSConnectionTestResult {
    success: boolean;
    message: string;
    checks: Record<string, boolean>;
    health?: unknown;
    models?: unknown;
    voices?: unknown;
}

// ===== 設定 =====

export async function getTTSConfig(backendUrl: string): Promise<TTSConfig> {
    const res = await axios.get(`${backendUrl}/api/tts/config`);
    return res.data;
}

export async function saveTTSConfig(backendUrl: string, config: TTSConfigUpdate): Promise<{ success: boolean; error?: string }> {
    const res = await axios.post(`${backendUrl}/api/tts/config`, config);
    return res.data;
}

// ===== 接続確認 =====

// TTSConnectionTestInput は接続確認の入力。保存済み設定ではなく、画面で入力中の値を送る。
// apiKey / clearApiKey の意味は TTSConfigUpdate と同じ（空は保存済みキーを引き継ぐ）。
export interface TTSConnectionTestInput {
    connectionUrl: string;
    connectTimeoutSeconds: number;
    apiKey?: string;
    clearApiKey?: boolean;
}

export async function testTTSConnection(backendUrl: string, input: TTSConnectionTestInput): Promise<TTSConnectionTestResult> {
    const res = await axios.post(`${backendUrl}/api/tts/connection-test`, input);
    return res.data;
}

// ===== 読み上げ実行 =====

// 会話設定側VoiceDesign（読み上げ開始時に現在の会話設定の値を同梱する）。
export interface TTSPresetVoiceDesign {
    mode: 'append' | 'replace';
    text: string;
}

export interface TTSReadRequest {
    sessionId: string;
    messageId: string;
    // turnId 指定時は TURN 単位実行（再作成を含む）。省略は1応答全体。
    turnId?: string;
    presetVoiceDesign?: Record<string, TTSPresetVoiceDesign>;
}

// 読み上げ開始の応答。empty は読み上げ対象なし（ジョブ未登録）、
// duplicate は同一対象の実行中あり（バックエンドの409を吸収して返す）。
export interface TTSReadResponse {
    jobId?: string;
    status?: string;
    empty?: boolean;
    reason?: string;
    duplicate?: boolean;
    existingJobId?: string;
}

export async function startTTSRead(backendUrl: string, body: TTSReadRequest): Promise<TTSReadResponse> {
    try {
        const res = await axios.post(`${backendUrl}/api/tts/read`, body);
        return res.data;
    } catch (error) {
        const status = (error as { response?: { status?: number; data?: { existingJobId?: string } } }).response;
        if (status?.status === 409) {
            return { duplicate: true, existingJobId: status.data?.existingJobId };
        }
        throw error;
    }
}

// ===== 実行状態（逐次再生のポーリング用） =====

// TTSProgressEntry はバックエンド jobs.ProgressEntry の受信形。
// textKey が "tts.chunk"（args: [messageId, turnId, chunkIndex, format]）、
// "tts.merged"（args: [messageId, turnId, durationSeconds]）、
// "tts.skipped"（args: [turnId, reason]）で構造情報を搬送する。
export interface TTSProgressEntry {
    seq: number;
    kind: string;
    text?: string;
    textKey?: string;
    args?: string[];
}

export interface TTSStatusResponse {
    jobId: string;
    status: 'pending' | 'processing' | 'completed' | 'error' | 'canceled';
    // messageId / turnId は画面更新後のボタン状態復元に使う（turnId 空は1応答全体）。
    messageId?: string;
    turnId?: string;
    error?: string;
    progress?: TTSProgressEntry[];
}

export async function fetchTTSStatus(backendUrl: string, jobId: string): Promise<TTSStatusResponse> {
    const res = await axios.get(`${backendUrl}/api/tts/status/${encodeURIComponent(jobId)}`);
    return res.data;
}

export async function cancelTTSJob(backendUrl: string, jobId: string): Promise<void> {
    await axios.post(`${backendUrl}/api/jobs/${encodeURIComponent(jobId)}/cancel`);
}

// ===== 作成済み音声 =====

export interface TTSIndexEntry {
    file: string;
    messageId: string;
    turnId: string;
    voiceId: string;
    format: string;
    createdAt: string;
    durationSeconds: number;
}

export interface TTSAudioIndex {
    version: number;
    entries: Record<string, TTSIndexEntry>;
}

// ttsTurnKey は index.json のエントリキー（backend の ttsaudio.TurnKey と一致させる）。
export function ttsTurnKey(messageId: string, turnId: string): string {
    return `${messageId}_${turnId}`;
}

export async function fetchTTSAudioIndex(backendUrl: string, sessionId: string): Promise<TTSAudioIndex> {
    const res = await axios.get(`${backendUrl}/api/tts/audio-index/${encodeURIComponent(sessionId)}`);
    return res.data;
}

// 1応答（メッセージ）分の生成音声を削除する（確認操作は呼び出し側の責務）。
export async function deleteTTSMessageAudio(backendUrl: string, sessionId: string, messageId: string): Promise<void> {
    await axios.delete(`${backendUrl}/api/tts/audio/${encodeURIComponent(sessionId)}/${encodeURIComponent(messageId)}`);
}

export function ttsFinalAudioPath(backendUrl: string, sessionId: string, messageId: string, turnId: string): string {
    return `${backendUrl}/api/tts/audio/${encodeURIComponent(sessionId)}/${encodeURIComponent(messageId)}/${encodeURIComponent(turnId)}`;
}

export function ttsChunkAudioPath(backendUrl: string, sessionId: string, messageId: string, turnId: string, index: number, format: string): string {
    return `${backendUrl}/api/tts/audio/${encodeURIComponent(sessionId)}/${encodeURIComponent(messageId)}/${encodeURIComponent(turnId)}/chunks/${index}?format=${encodeURIComponent(format)}`;
}

// ===== ボイス管理（Irodori-TTS への中継。P2#1） =====

export interface TTSVoice {
    id: string;
}

export async function fetchTTSVoices(backendUrl: string): Promise<TTSVoice[]> {
    const res = await axios.get(`${backendUrl}/api/tts/proxy/v1/audio/voices`);
    const data = (res.data?.data ?? []) as { id?: string }[];
    return data.filter((v): v is TTSVoice => Boolean(v.id));
}

export async function uploadTTSVoice(backendUrl: string, voiceId: string, file: File): Promise<void> {
    const form = new FormData();
    form.append('voice_id', voiceId);
    form.append('file', file);
    await axios.post(`${backendUrl}/api/tts/proxy/v1/audio/voices`, form);
}

export async function deleteTTSVoice(backendUrl: string, voiceId: string): Promise<void> {
    await axios.delete(`${backendUrl}/api/tts/proxy/v1/audio/voices/${encodeURIComponent(voiceId)}`);
}

// 接続先サーバーの Voice ファイル API 拡張能力（フォーク版判定）。
// checked=false は接続不可などで判定できていない状態（能力は保守的に false）。
export interface TTSServerCapabilities {
    latentUpload: boolean;
    unicodeVoiceId: boolean;
}

export interface TTSServerCapabilitiesResult {
    checked: boolean;
    capabilities: TTSServerCapabilities;
}

export async function getTTSServerCapabilities(backendUrl: string): Promise<TTSServerCapabilitiesResult> {
    const res = await axios.get(`${backendUrl}/api/tts/server-capabilities`);
    return res.data;
}

// 文体指示の対応絵文字一覧（P3#2）。絵文字説明ファイルのパース結果。
// 表示・画像生成分析の常時除去に使う（未配置・未導入は空一覧）。
export async function getTTSEmojiList(backendUrl: string): Promise<string[]> {
    const res = await axios.get(`${backendUrl}/api/tts/emoji-list`);
    return (res.data?.emojis ?? []) as string[];
}

// ===== エンジン管理（P3#5。runtime系APIを持つサーバーのみ・プロキシ経由） =====

export interface TTSRuntimeModel {
    checkpoint: string;
    name: string;
}

// TTSRuntimeState は GET /v1/runtime/models の runtime ブロック（現在のモデル状態）。
export interface TTSRuntimeState {
    selected_checkpoint?: string;
    loaded?: boolean;
    loading?: boolean;
    checkpoint_path?: string;
}

export interface TTSRuntimeModelsResult {
    models: TTSRuntimeModel[];
    runtime: TTSRuntimeState;
}

export async function fetchTTSRuntimeModels(backendUrl: string): Promise<TTSRuntimeModelsResult> {
    const res = await axios.get(`${backendUrl}/api/tts/proxy/v1/runtime/models`);
    return {
        models: (res.data?.data ?? []) as TTSRuntimeModel[],
        runtime: (res.data?.runtime ?? {}) as TTSRuntimeState,
    };
}

// setTTSRuntimeModel はモデル切替（load=true で旧モデル解放→選択モデルロードまで行う）。
export async function setTTSRuntimeModel(backendUrl: string, checkpoint: string, load: boolean): Promise<TTSRuntimeState> {
    const res = await axios.post(`${backendUrl}/api/tts/proxy/v1/runtime/model`, { checkpoint, load });
    return (res.data ?? {}) as TTSRuntimeState;
}

export async function unloadTTSRuntimeModel(backendUrl: string): Promise<TTSRuntimeState> {
    const res = await axios.post(`${backendUrl}/api/tts/proxy/v1/runtime/unload`);
    return (res.data ?? {}) as TTSRuntimeState;
}

export interface TTSRuntimeProfile {
    id: string;
    label: string;
}

export interface TTSRuntimeProfilesResult {
    profiles: TTSRuntimeProfile[];
    selectedProfile: string;
    activeProfile: string;
    restartRequired: boolean;
}

export async function fetchTTSRuntimeProfiles(backendUrl: string): Promise<TTSRuntimeProfilesResult> {
    const res = await axios.get(`${backendUrl}/api/tts/proxy/v1/runtime/profiles`);
    return {
        profiles: (res.data?.profiles ?? []) as TTSRuntimeProfile[],
        selectedProfile: res.data?.selected_profile ?? '',
        activeProfile: res.data?.active_profile ?? '',
        restartRequired: Boolean(res.data?.restart_required),
    };
}

export async function setTTSRuntimeProfile(backendUrl: string, profile: string): Promise<void> {
    await axios.post(`${backendUrl}/api/tts/proxy/v1/runtime/profile`, { profile });
}

export async function restartTTSRuntime(backendUrl: string): Promise<void> {
    await axios.post(`${backendUrl}/api/tts/proxy/v1/runtime/restart`);
}

// fetchTTSHealth は接続先の /health（再起動完了のポーリング等に使う）。
export async function fetchTTSHealth(backendUrl: string): Promise<Record<string, unknown>> {
    const res = await axios.get(`${backendUrl}/api/tts/proxy/health`);
    return (res.data ?? {}) as Record<string, unknown>;
}

// キャラクターとVoiceの紐づけ（P2#3）。保存場所はキャラ設定ディレクトリの tts_config.json。
export interface TTSCharacterConfig {
    characterName: string;
    voiceId: string;
    voiceDesignCaption: string;
    cfgScaleCaption: number | null;
    cfgScaleSpeaker: number | null;
    readEnabled: boolean;
    volumeGain: number;
}

export async function getTTSCharacterConfig(backendUrl: string, dirName: string): Promise<TTSCharacterConfig> {
    const res = await axios.get(`${backendUrl}/api/tts/character-config/${encodeURIComponent(dirName)}`);
    return res.data;
}

export async function saveTTSCharacterConfig(backendUrl: string, dirName: string, config: TTSCharacterConfig): Promise<void> {
    await axios.put(`${backendUrl}/api/tts/character-config/${encodeURIComponent(dirName)}`, config);
}

// Latent変換（P2#2）。参照音声(wav)または既存latent(.pt/.pth)を渡し、
// mode=register で Irodori へ登録、mode=download で .pt Blob を受け取る。
export interface TTSLatentEncodeParams {
    file: File;
    mode: 'register' | 'download';
    voiceId?: string;
    displayName?: string;
    startSeconds?: number;
    endSeconds?: number;
    normalizeDb?: number | null;
    device?: string;
    precision?: string;
}

export async function encodeTTSLatent(backendUrl: string, params: TTSLatentEncodeParams): Promise<Blob | null> {
    const form = new FormData();
    form.append('file', params.file);
    form.append('mode', params.mode);
    if (params.voiceId) form.append('voiceId', params.voiceId);
    if (params.displayName) form.append('displayName', params.displayName);
    if (params.startSeconds !== undefined) form.append('startSeconds', String(params.startSeconds));
    if (params.endSeconds !== undefined) form.append('endSeconds', String(params.endSeconds));
    if (params.normalizeDb !== undefined && params.normalizeDb !== null) form.append('normalizeDb', String(params.normalizeDb));
    if (params.device) form.append('device', params.device);
    if (params.precision) form.append('precision', params.precision);
    if (params.mode === 'download') {
        const res = await axios.post(`${backendUrl}/api/tts/latent-encode`, form, { responseType: 'blob' });
        return res.data;
    }
    await axios.post(`${backendUrl}/api/tts/latent-encode`, form);
    return null;
}

// previewTTS は試聴の単発合成（音声 Blob を返す。キャンセルはリクエスト中断＝signal）。
export async function previewTTS(
    backendUrl: string,
    body: { text: string; voiceId?: string; characterName?: string },
    signal?: AbortSignal,
): Promise<Blob> {
    const res = await axios.post(`${backendUrl}/api/tts/preview`, body, { responseType: 'blob', signal });
    return res.data;
}

// 認証付き音声URLの解決。<audio src> の直接GETには Authorization が付かず
// 公開ビルドで401になるため、blob 取得 → objectURL 化する
// （resolveAuthedImageUrl と同じ方式。モジュールスコープでキャッシュしてリークを抑える）。
const audioObjectUrls = new Map<string, string>();

// 音声はサーバーが no-store で返すが、再作成で同じURLの中身が差し替わるため、
// ブラウザ側の経験的キャッシュにも掛からないよう取得時に no-cache を明示する。
const AUDIO_FETCH_HEADERS = { 'Cache-Control': 'no-cache', Pragma: 'no-cache' } as const;

export async function resolveAuthedAudioUrl(url: string): Promise<string> {
    const cached = audioObjectUrls.get(url);
    if (cached) return cached;
    const res = await axios.get(url, { responseType: 'blob', headers: AUDIO_FETCH_HEADERS });
    const objectUrl = URL.createObjectURL(res.data);
    audioObjectUrls.set(url, objectUrl);
    return objectUrl;
}

// fetchAudioObjectUrlOnce は一度きりの再生用に objectURL を作る（キャッシュに載せない）。
// 逐次再生のチャンクは再作成のたびに中身が変わる使い捨てのため、こちらを使う。
// 返した objectURL の解放は呼び出し側（再生終了時）が行う。
export async function fetchAudioObjectUrlOnce(url: string): Promise<string> {
    const res = await axios.get(url, { responseType: 'blob', headers: AUDIO_FETCH_HEADERS });
    return URL.createObjectURL(res.data);
}

// releaseAuthedAudioUrl はキャッシュ済み objectURL を破棄する（再作成時の差し替え用）。
export function releaseAuthedAudioUrl(url: string): void {
    const cached = audioObjectUrls.get(url);
    if (cached) {
        URL.revokeObjectURL(cached);
        audioObjectUrls.delete(url);
    }
}
