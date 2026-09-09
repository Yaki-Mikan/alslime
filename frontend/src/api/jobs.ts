/**
 * jobs.ts - ジョブ管理 API クライアント
 */

import axios from '../lib/axios';

export interface Job {
    jobId: string;
    type: 'chat' | 'regenerate' | 'tag-judge' | 'image-generate' | 'image-analyze' | 'image-render' | 'config-generate' | 'tts';
    kind: 'gemini' | 'claude' | 'antigravity' | 'openai_compat' | 'tts' | 'comfyui';
    label: string;
    sessionId?: string | null;
    status: 'pending' | 'processing' | 'completed' | 'error' | 'canceled';
    error?: string;
    /** 分析ジョブ完了時に投入された生成ジョブの ID（画像生成の分離モードのみ） */
    nextJobId?: string;
    createdAt: number;
    startedAt?: number;
    updatedAt: number;
}

export interface ProcessLimits {
    global: number;
    gemini: number;
    claude: number;
    antigravity: number;
    openai_compat: number;
    // tts は global 枠から独立した専用枠（AI CLI を使わないため）。
    tts: number;
    // comfyui は画像生成（ComfyUI への投入と完了待ち）の専用枠。global 枠から独立。
    comfyui: number;
}

export interface JobsResponse {
    jobs: Job[];
    inUse: { global: number; gemini: number; claude: number; antigravity: number; openai_compat: number; tts: number; comfyui: number };
    limits: ProcessLimits;
}

export async function fetchJobs(backendUrl: string): Promise<JobsResponse> {
    const res = await axios.get(`${backendUrl}/api/jobs`);
    return res.data;
}

export async function cancelJob(backendUrl: string, jobId: string): Promise<void> {
    await axios.post(`${backendUrl}/api/jobs/${jobId}/cancel`);
}

export async function fetchProcessLimits(backendUrl: string): Promise<ProcessLimits> {
    const res = await axios.get(`${backendUrl}/api/jobs/limits`);
    return res.data;
}

export async function updateProcessLimits(backendUrl: string, limits: Partial<ProcessLimits>): Promise<ProcessLimits> {
    const res = await axios.post(`${backendUrl}/api/jobs/limits`, limits);
    return res.data;
}
