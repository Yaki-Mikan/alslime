/**
 * jobs.ts - ジョブ管理 API クライアント
 */

import axios from '../lib/axios';

export interface Job {
    jobId: string;
    type: 'chat' | 'regenerate' | 'tag-judge' | 'image-generate';
    kind: 'gemini' | 'claude' | 'antigravity';
    label: string;
    sessionId?: string | null;
    status: 'pending' | 'processing' | 'completed' | 'error' | 'canceled';
    error?: string;
    createdAt: number;
    startedAt?: number;
    updatedAt: number;
}

export interface ProcessLimits {
    global: number;
    gemini: number;
    claude: number;
    antigravity: number;
}

export interface JobsResponse {
    jobs: Job[];
    inUse: { global: number; gemini: number; claude: number; antigravity: number };
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
