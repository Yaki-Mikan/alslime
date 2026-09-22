import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Settings } from '../types/Settings';
import { SETTINGS_I18N_KEYS, SETTINGS_TEXT_FALLBACK_JA } from '../constants/i18n';
import { SettingsModal } from './SettingsModal';

// 画像生成設定ボタンと小画面用の画像生成設定モーダルの表示条件だけを確かめるため、
// 他のサブモーダルと通信は差し替える。
vi.mock('./settings/AIModelSettingsModal', () => ({ AIModelSettingsModal: () => null }));
vi.mock('./settings/ApiProvidersModal', () => ({ ApiProvidersModal: () => null }));
vi.mock('./settings/ChatBasicSettingsModal', () => ({ ChatBasicSettingsModal: () => null }));
vi.mock('./settings/ServerSettingsModal', () => ({ ServerSettingsModal: () => null }));
vi.mock('./settings/DebugSettingsModal', () => ({ DebugSettingsModal: () => null }));
vi.mock('./settings/SettingsPackModal', () => ({ SettingsPackModal: () => null }));
vi.mock('./tts/TTSSettingsModal', () => ({ TTSSettingsModal: () => null }));
vi.mock('./ProcessLimitsModal', () => ({ ProcessLimitsModal: () => null }));
vi.mock('./SystemDiagnosticsModal', () => ({ SystemDiagnosticsModal: () => null }));
vi.mock('./SponsorModal', () => ({ SponsorModal: () => null }));
vi.mock('./UpdateModal', () => ({ UpdateModal: () => null }));
vi.mock('./comfyui/ComfyUISettingsModal', () => ({
    ComfyUISettingsModal: ({ isOpen }: { isOpen: boolean }) => (
        <div data-testid="comfy-settings" data-open={String(isOpen)} />
    ),
}));
vi.mock('../api/update', () => ({
    fetchUpdateCheck: vi.fn(),
    fetchUpdateSettings: vi.fn(() => Promise.resolve({ autoCheck: true })),
    saveUpdateSettings: vi.fn(),
}));
vi.mock('../api/files', () => ({ rebuildCharacterFilters: vi.fn() }));
vi.mock('../api/i18n', async importOriginal => ({
    ...(await importOriginal<typeof import('../api/i18n')>()),
    fetchI18NLanguages: vi.fn(() => Promise.resolve({ languages: ['ja'] })),
}));

const BUTTON_LABEL = SETTINGS_TEXT_FALLBACK_JA[SETTINGS_I18N_KEYS.comfyUIButtonLabel];

const renderModal = (onOpenImageGenSettings?: () => void) => render(
    <SettingsModal
        isOpen
        onClose={() => {}}
        settings={{} as Settings}
        onSave={() => Promise.resolve()}
        uiCatalog={null}
        onOpenImageGenSettings={onOpenImageGenSettings}
    />,
);

describe('設定メニューの画像生成設定の表示条件', () => {
    it('画像生成設定を開く口が渡されないときはボタンも小画面モーダルも描画しない', () => {
        renderModal(undefined);
        expect(screen.queryByRole('button', { name: BUTTON_LABEL })).toBeNull();
        expect(screen.queryByTestId('comfy-settings')).toBeNull();
    });

    it('画像生成設定を開く口が渡されたときはボタンを描画し押すと小画面モーダルを開く', async () => {
        renderModal(() => {});
        const button = screen.getByRole('button', { name: BUTTON_LABEL });
        expect(screen.getByTestId('comfy-settings').dataset.open).toBe('false');
        await userEvent.click(button);
        expect(screen.getByTestId('comfy-settings').dataset.open).toBe('true');
    });
});
