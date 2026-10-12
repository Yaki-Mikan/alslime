import React from 'react';
import { Button } from './ui';

interface ReloadBoundaryProps {
    message: string;
    reloadLabel: string;
    children: React.ReactNode;
}

interface ReloadBoundaryState {
    failed: boolean;
}

// 画面の中身が描けなかったとき、アプリ全体が消えて真っ暗になるのを防ぐ受け皿。
// 案内文と再読み込みボタンを出し、利用者に新しい版を読み直してもらう。
export class ReloadBoundary extends React.Component<ReloadBoundaryProps, ReloadBoundaryState> {
    state: ReloadBoundaryState = { failed: false };

    static getDerivedStateFromError(): ReloadBoundaryState {
        return { failed: true };
    }

    componentDidCatch(error: unknown) {
        console.error('[ReloadBoundary]', error);
    }

    render() {
        if (!this.state.failed) {
            return this.props.children;
        }
        return (
            <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
                <p className="text-sm text-fg-muted">{this.props.message}</p>
                <Button variant="primary" onClick={() => window.location.reload()}>
                    {this.props.reloadLabel}
                </Button>
            </div>
        );
    }
}
