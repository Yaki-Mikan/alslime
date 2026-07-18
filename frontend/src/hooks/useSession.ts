/**
 * useSession.ts - セッション管理ロジック
 * 
 * チャットセッションの状態管理と操作を提供するカスタムフック。
 * - セッション一覧の取得
 * - 新規セッションの開始
 * - 既存セッションの再開
 */

import { useState } from 'react';
import axios from '../lib/axios';
import { CHAT_VIEW_I18N_KEYS, CHAT_VIEW_TEXT_FALLBACK_JA } from '../constants/i18n';
import { resolveMessage, type I18NCatalog } from '../api/i18n';

// 型定義
// 注意: SSRP設定（config）は一覧APIには含まれない。復元時の設定はresume APIが返す。
export interface Session {
    index: number;
    title: string;
    timeAgo: string;
    id: string;
    isSSRP?: boolean;
    modelType?: 'gemini' | 'claude' | 'antigravity';
}

interface UseSessionProps {
    backendUrl: string;
    onSessionChange?: (sessionId: string | null, title: string) => void;
    onHistoryLoaded?: (history: any[]) => void;
    // UI辞書。新規セッションタイトル等のローカル文言を表示言語へ解決する（04調査 低#6）。
    catalog?: I18NCatalog | null;
}

export const useSession = ({ backendUrl, onSessionChange, onHistoryLoaded, catalog }: UseSessionProps) => {
    const uiText = (key: string) => resolveMessage(catalog ?? null, key, CHAT_VIEW_TEXT_FALLBACK_JA[key] || key);
    const [sessions, setSessions] = useState<Session[]>([]);
    const [isSessionModalOpen, setIsSessionModalOpen] = useState(false);
    const [currentSessionTitle, setCurrentSessionTitle] = useState<string>(CHAT_VIEW_TEXT_FALLBACK_JA[CHAT_VIEW_I18N_KEYS.newSessionTitle]);
    const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    // セッション一覧を取得
    const fetchSessions = async () => {
        try {
            console.log('[useSession] Fetching sessions...');
            const res = await axios.get(`${backendUrl}/api/sessions`);
            console.log('[useSession] Received sessions:', res.data.sessions?.length || 0);
            if (res.data.sessions) {
                setSessions(res.data.sessions);
            }
        } catch (error) {
            console.error('Failed to fetch sessions', error);
        }
    };

    // 新規セッション開始
    const handleNewSession = async (ssrpSettings?: any, modelType?: string) => {
        if (isLoading) return;
        setIsLoading(true);
        try {
            await axios.post(`${backendUrl}/api/sessions/new`, { ssrpSettings, modelType });
            const newTitle = ssrpSettings
                ? uiText(CHAT_VIEW_I18N_KEYS.newSSRPTitle)
                : uiText(CHAT_VIEW_I18N_KEYS.newSessionTitle);
            setCurrentSessionTitle(newTitle);
            setCurrentSessionId(null);

            if (onSessionChange) onSessionChange(null, newTitle);
            if (onHistoryLoaded) onHistoryLoaded([]);
        } catch (error) {
            console.error('Failed to start new session', error);
        } finally {
            setIsLoading(false);
        }
    };

    // セッション再開
    const handleResumeSession = async (session: Session) => {
        if (isLoading) return;
        setIsLoading(true);
        try {
            const res = await axios.post(`${backendUrl}/api/sessions/resume`, {
                sessionIndex: session.index,
                sessionId: session.id,
                modelType: session.modelType
            });

            console.log('[Frontend] Resume API Response:', res.data);
            setCurrentSessionTitle(session.title);
            setCurrentSessionId(session.id);

            if (onSessionChange) onSessionChange(session.id, session.title);

            // 履歴があればセット
            if (res.data.history && Array.isArray(res.data.history)) {
                console.log('[Frontend] History items found:', res.data.history.length);
                if (onHistoryLoaded) onHistoryLoaded(res.data.history);
            } else {
                console.log('[Frontend] No history found in response');
                if (onHistoryLoaded) onHistoryLoaded([]);
            }

            setIsSessionModalOpen(false);

            // APIレスポンスの拡張情報を返す（activeJobIdも含む）
            return {
                config: res.data.config,
                uiState: res.data.uiState || null,
                isSSRP: res.data.isSSRP,
                activeJobId: res.data.activeJobId || null
            };
        } catch (error) {
            console.error('Failed to resume session', error);
        } finally {
            setIsLoading(false);
        }
    };

    // セッション履歴モーダルを開く
    const openSessionModal = async () => {
        await fetchSessions();
        setIsSessionModalOpen(true);
    };

    // セッションを削除（成功時は一覧からも除去する）
    const deleteSession = async (sessionId: string): Promise<boolean> => {
        try {
            const res = await axios.delete(`${backendUrl}/api/session/${sessionId}`);
            if (res.data.success) {
                setSessions(prev => prev.filter(s => s.id !== sessionId));
                return true;
            }
            return false;
        } catch (error) {
            console.error('Failed to delete session', error);
            return false;
        }
    };

    // 複数セッションをまとめて削除（成功した分だけ一覧から除去する）
    const deleteSessions = async (sessionIds: string[]): Promise<{ deletedIds: string[]; failedCount: number }> => {
        const results = await Promise.allSettled(
            sessionIds.map(id => axios.delete(`${backendUrl}/api/session/${id}`))
        );
        const deletedIds: string[] = [];
        let failedCount = 0;
        results.forEach((result, i) => {
            if (result.status === 'fulfilled' && result.value.data.success) {
                deletedIds.push(sessionIds[i]);
            } else {
                if (result.status === 'rejected') {
                    console.error('Failed to delete session', sessionIds[i], result.reason);
                }
                failedCount++;
            }
        });
        if (deletedIds.length > 0) {
            const deleted = new Set(deletedIds);
            setSessions(prev => prev.filter(s => !deleted.has(s.id)));
        }
        return { deletedIds, failedCount };
    };

    // セッションタイトルを更新
    const updateSessionTitle = async (sessionId: string, title: string): Promise<boolean> => {
        try {
            const res = await axios.post(`${backendUrl}/api/session/${sessionId}/title`, { title });
            if (res.data.success) {
                setCurrentSessionTitle(title);
                return true;
            }
            return false;
        } catch (error) {
            console.error('Failed to update session title', error);
            return false;
        }
    };

    return {
        sessions,
        isSessionModalOpen,
        setIsSessionModalOpen,
        currentSessionTitle,
        currentSessionId,
        setCurrentSessionId,
        setCurrentSessionTitle,
        isLoading,
        handleNewSession,
        handleResumeSession,
        openSessionModal,
        fetchSessions,
        updateSessionTitle,
        deleteSession,
        deleteSessions
    };
};
