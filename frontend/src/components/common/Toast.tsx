/**
 * Toast.tsx - 一時的な通知メッセージ表示コンポーネント
 */

import React, { useEffect, useState } from 'react';
import { X, AlertTriangle, Info } from 'lucide-react';

export interface ToastMessage {
    id: string;
    text: string;
    type: 'error' | 'info';
}

interface ToastProps {
    messages: ToastMessage[];
    onDismiss: (id: string) => void;
    /** 自動消去までの秒数（デフォルト6秒） */
    duration?: number;
}

const ToastItem: React.FC<{ msg: ToastMessage; onDismiss: (id: string) => void; duration: number }> = ({ msg, onDismiss, duration }) => {
    const [isExiting, setIsExiting] = useState(false);

    useEffect(() => {
        const fadeTimer = setTimeout(() => setIsExiting(true), (duration - 0.4) * 1000);
        const removeTimer = setTimeout(() => onDismiss(msg.id), duration * 1000);
        return () => { clearTimeout(fadeTimer); clearTimeout(removeTimer); };
    }, [msg.id, onDismiss, duration]);

    const isError = msg.type === 'error';
    const borderColor = isError ? 'border-red-700/50' : 'border-cyan-700/50';
    const bgColor = isError ? 'bg-red-900/30' : 'bg-cyan-900/30';
    const textColor = isError ? 'text-red-300' : 'text-cyan-300';
    const iconColor = isError ? 'text-red-400' : 'text-cyan-400';

    return (
        <div
            className={`flex items-start gap-2 px-4 py-3 rounded-lg border ${borderColor} ${bgColor} backdrop-blur-sm shadow-lg transition-opacity duration-400 ${isExiting ? 'opacity-0' : 'opacity-100'}`}
            style={{ maxWidth: '480px' }}
        >
            {isError ? <AlertTriangle size={16} className={`${iconColor} mt-0.5 shrink-0`} /> : <Info size={16} className={`${iconColor} mt-0.5 shrink-0`} />}
            <span className={`text-sm ${textColor} flex-1`}>{msg.text}</span>
            <button onClick={() => onDismiss(msg.id)} className="text-gray-500 hover:text-gray-300 transition-colors shrink-0 mt-0.5">
                <X size={14} />
            </button>
        </div>
    );
};

export const Toast: React.FC<ToastProps> = ({ messages, onDismiss, duration = 6 }) => {
    if (messages.length === 0) return null;

    return (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2">
            {messages.map(msg => (
                <ToastItem key={msg.id} msg={msg} onDismiss={onDismiss} duration={duration} />
            ))}
        </div>
    );
};

/** トーストのstate管理用フック */
export function useToast() {
    const [messages, setMessages] = useState<ToastMessage[]>([]);

    const showToast = (text: string, type: 'error' | 'info' = 'error') => {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        setMessages(prev => [...prev, { id, text, type }]);
    };

    const dismissToast = (id: string) => {
        setMessages(prev => prev.filter(m => m.id !== id));
    };

    return { messages, showToast, dismissToast };
}
