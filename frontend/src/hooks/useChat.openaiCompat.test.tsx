import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from '../lib/axios';
import { getGlobalSettings } from '../api/global-settings';
import { DEFAULT_SETTINGS } from '../types/Settings';
import { useChat } from './useChat';

vi.mock('../lib/axios', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
    },
}));

vi.mock('../api/global-settings', () => ({
    getGlobalSettings: vi.fn(),
    updateGlobalSettings: vi.fn(),
}));

const apiModel = {
    id: 'openai_compat:connection-id:remote-model',
    name: 'Remote model',
    description: 'Remote model',
    provider: 'openai_compat' as const,
};

const renderApiChat = () => renderHook(() => useChat({
    backendUrl: '',
    settings: DEFAULT_SETTINGS,
    currentSessionId: 'session-id',
    disableAutoLoadHistory: true,
}));

describe('openai_compatチャット操作', () => {
    beforeEach(() => {
        vi.mocked(getGlobalSettings).mockResolvedValue({
            defaultProvider: 'openai_compat',
            defaultModels: { openai_compat: apiModel.id },
        });
        vi.mocked(axios.get).mockImplementation(async (url: string) => {
            if (url === '/api/models') return { data: { models: [apiModel] } };
            if (url.startsWith('/api/chat/status/')) {
                return {
                    data: {
                        status: 'completed',
                        result: 'API応答',
                        model: apiModel.id,
                        sessionId: 'session-id',
                    },
                };
            }
            return { data: {} };
        });
        vi.mocked(axios.post).mockImplementation(async (url: string) => {
            if (url === '/api/chat/submit') return { data: { jobId: 'chat-job' } };
            if (url === '/api/regenerate') return { data: { jobId: 'regenerate-job' } };
            if (url === '/api/abort') return { data: {} };
            return { data: {} };
        });
    });

    it('APIモデルを選択した新規チャットをsubmitし、完了応答を表示する', async () => {
        const { result } = renderApiChat();
        await waitFor(() => expect(result.current.selectedModel).toBe(apiModel.id));

        act(() => result.current.setInput('APIへ送る本文'));
        await act(async () => result.current.handleSend());

        expect(axios.post).toHaveBeenCalledWith('/api/chat/submit', expect.objectContaining({
            message: 'APIへ送る本文',
            model: apiModel.id,
            sessionId: 'session-id',
        }));
        await waitFor(() => expect(result.current.messages).toEqual(expect.arrayContaining([
            expect.objectContaining({ role: 'agent', content: 'API応答' }),
        ])));
    });

    it('生成中断操作をabort APIへ送る', async () => {
        const { result } = renderApiChat();
        await act(async () => result.current.handleStop());
        expect(axios.post).toHaveBeenCalledWith('/api/abort');
    });

    it('APIセッションの再生成を専用endpointへ送り、最後のagentを置換する', async () => {
        const { result } = renderApiChat();
        await waitFor(() => expect(result.current.selectedModelProvider).toBe('openai_compat'));
        act(() => result.current.setMessages([
            { role: 'user', content: '元の質問' },
            { role: 'agent', content: '置換前の応答' },
        ]));

        await act(async () => result.current.handleRegenerate());

        expect(axios.post).toHaveBeenCalledWith('/api/regenerate', expect.objectContaining({
            sessionId: 'session-id',
        }));
        await waitFor(() => expect(result.current.messages).toEqual([
            { role: 'user', content: '元の質問' },
            expect.objectContaining({ role: 'agent', content: 'API応答' }),
        ]));
    });
});
