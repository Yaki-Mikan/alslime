import type React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfigEditorHub } from './ConfigEditorHub';

// 子モーダルは表示条件の確認に必要な印だけを描画する差し替えにする。
vi.mock('./ConfigEditorModal', () => ({
    COMFY_DIRECTIVE_CATEGORY_ID: 'comfy-directive',
    CONFIG_GEN_INSTRUCTION_CATEGORY_ID: 'config-gen-instruction',
    ConfigEditorModal: ({ isOpen, headerTabs, imageGenEnabled, appearancePrompt }: {
        isOpen: boolean;
        headerTabs: React.ReactNode;
        imageGenEnabled: boolean;
        appearancePrompt?: unknown;
    }) => (isOpen ? (
        <div data-testid="config-editor" data-image-gen={String(imageGenEnabled)} data-appearance={appearancePrompt ? 'yes' : 'no'}>
            {headerTabs}
        </div>
    ) : null),
}));
vi.mock('./ConfigGenModal', () => ({ ConfigGenModal: () => null }));
vi.mock('../comfyui/ComfyUIIntegratedSettingsModal', () => ({
    ComfyUIIntegratedSettingsModal: ({ isOpen, headerTabs }: { isOpen: boolean; headerTabs: React.ReactNode }) => (
        <div data-testid="image-gen-integrated" data-open={String(isOpen)}>{isOpen ? headerTabs : null}</div>
    ),
}));
vi.mock('../tts/TTSIntegratedSettingsModal', () => ({
    TTSIntegratedSettingsModal: ({ isOpen }: { isOpen: boolean }) => (
        <div data-testid="tts-integrated" data-open={String(isOpen)} />
    ),
}));
vi.mock('../../hooks/useIsWideScreen', () => ({ useIsWideScreen: () => true }));
vi.mock('../../hooks/useAppearancePromptGen', () => ({ useAppearancePromptGen: () => ({ marker: 'appearance' }) }));

const IMAGE_GEN_TAB_LABEL = '画像生成統合設定';

const renderHub = (imageGenEnabled: boolean) => render(
    <ConfigEditorHub isOpen onClose={() => {}} backendUrl="" imageGenEnabled={imageGenEnabled} initialTab="imageGen" />,
);

describe('ConfigEditorHub の画像生成区画の表示条件', () => {
    it('使えないときは画像生成タブ・統合設定・容姿プロンプト作成を描画せず設定ファイルタブを開く', () => {
        renderHub(false);
        expect(screen.queryByRole('button', { name: IMAGE_GEN_TAB_LABEL })).toBeNull();
        expect(screen.queryByTestId('image-gen-integrated')).toBeNull();
        const editor = screen.getByTestId('config-editor');
        expect(editor.dataset.imageGen).toBe('false');
        expect(editor.dataset.appearance).toBe('no');
    });

    it('使えるときは画像生成タブ・統合設定・容姿プロンプト作成を描画する', () => {
        renderHub(true);
        expect(screen.getByTestId('image-gen-integrated').dataset.open).toBe('true');
        expect(screen.getByRole('button', { name: IMAGE_GEN_TAB_LABEL })).toBeTruthy();
        expect(screen.queryByTestId('config-editor')).toBeNull();
    });

    it('開いている途中で使えなくなったら画像生成タブから設定ファイルタブへ戻る', () => {
        const { rerender } = renderHub(true);
        expect(screen.getByTestId('image-gen-integrated').dataset.open).toBe('true');
        rerender(<ConfigEditorHub isOpen onClose={() => {}} backendUrl="" imageGenEnabled={false} initialTab="imageGen" />);
        expect(screen.queryByTestId('image-gen-integrated')).toBeNull();
        expect(screen.getByTestId('config-editor').dataset.appearance).toBe('no');
    });
});

describe('ConfigEditorHub の TTS 区画の表示条件', () => {
    const renderTTS = (ttsEnabled: boolean) => (
        <ConfigEditorHub isOpen onClose={() => {}} backendUrl="" imageGenEnabled={false} ttsEnabled={ttsEnabled} initialTab="tts" />
    );

    it('開いている途中で使えなくなったら TTS タブから設定ファイルタブへ戻る', () => {
        const { rerender } = render(renderTTS(true));
        expect(screen.getByTestId('tts-integrated').dataset.open).toBe('true');
        expect(screen.queryByTestId('config-editor')).toBeNull();
        rerender(renderTTS(false));
        expect(screen.queryByTestId('tts-integrated')).toBeNull();
        expect(screen.getByTestId('config-editor')).toBeTruthy();
    });
});
