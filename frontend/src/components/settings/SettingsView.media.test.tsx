import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Settings } from '../../types/Settings';
import { SETTINGS_VIEW_I18N_KEYS, SETTINGS_VIEW_TEXT_FALLBACK_JA } from '../../constants/i18n';
import { SettingsView } from './SettingsView';

const imageSave = vi.fn().mockResolvedValue([]);

// 画像生成・読み上げの分類の出し分けと保存の受け渡しだけを確かめるため、ほかの分類と中身は差し替える。
// vi.mock は先頭へ巻き上げられるため、差し替えの部品はそれぞれの中で作る
vi.mock('./sections/GeneralSection', async () => ({ GeneralSection: (await import('react')).forwardRef(() => null) }));
vi.mock('./sections/AiSection', async () => ({ AiSection: (await import('react')).forwardRef(() => null) }));
vi.mock('./sections/ConversationSection', async () => ({ ConversationSection: (await import('react')).forwardRef(() => null) }));
vi.mock('./sections/SystemSection', async () => ({ SystemSection: (await import('react')).forwardRef(() => null) }));
vi.mock('../SponsorModal', () => ({ SponsorModal: () => null }));
vi.mock('./SettingsPackModal', () => ({ SettingsPackModal: () => null }));
vi.mock('./sections/media/ImageGenSettings', async () => {
    const React = await import('react');
    return {
        ImageGenSettings: React.forwardRef<unknown, { onDirtyChange: (d: boolean) => void }>(({ onDirtyChange }, ref) => {
            React.useImperativeHandle(ref, () => ({ save: () => imageSave(), revert: () => {} }));
            return <button type="button" onClick={() => onDirtyChange(true)}>画像生成の欄</button>;
        }),
    };
});
vi.mock('./sections/media/TTSSettingsPanel', () => ({
    TTSSettingsPanel: () => <div data-testid="tts-settings" />,
}));

const MEDIA_LABEL = SETTINGS_VIEW_TEXT_FALLBACK_JA[SETTINGS_VIEW_I18N_KEYS.categoryMedia];
const TTS_LABEL = SETTINGS_VIEW_TEXT_FALLBACK_JA[SETTINGS_VIEW_I18N_KEYS.mediaTts];
const OPEN_IMAGES = SETTINGS_VIEW_TEXT_FALLBACK_JA[SETTINGS_VIEW_I18N_KEYS.mediaOpenImages];

const renderView = (imageGenAvailable: boolean, ttsAvailable = false, onOpenMaterial = vi.fn()) => {
    render(
        <SettingsView
            settings={{ uiLanguage: 'ja' } as Settings}
            onSave={() => Promise.resolve()}
            uiCatalog={null}
            imageGenAvailable={imageGenAvailable}
            ttsAvailable={ttsAvailable}
            onOpenMaterial={onOpenMaterial}
            registerLeaveGuard={() => {}}
        />,
    );
    return onOpenMaterial;
};

describe('設定画面の画像生成・読み上げ', () => {
    it('画像生成も読み上げも使えないときは分類を出さない', () => {
        renderView(false);
        expect(screen.queryByRole('button', { name: MEDIA_LABEL })).toBeNull();
    });

    it('画像生成だけのときは切り替えを出さず、画像生成の欄と素材づくりへの入口を出す', async () => {
        const user = userEvent.setup();
        const onOpenMaterial = renderView(true);
        await user.click(screen.getByRole('button', { name: MEDIA_LABEL }));
        expect(screen.getByText('画像生成の欄')).toBeTruthy();
        expect(screen.queryByRole('radio', { name: TTS_LABEL })).toBeNull();
        await user.click(screen.getByRole('button', { name: OPEN_IMAGES }));
        expect(onOpenMaterial).toHaveBeenCalledWith('images');
    });

    it('両方使えるときは切り替えで読み上げを出す', async () => {
        const user = userEvent.setup();
        renderView(true, true);
        await user.click(screen.getByRole('button', { name: MEDIA_LABEL }));
        expect(screen.queryByTestId('tts-settings')).toBeNull();
        await user.click(screen.getByRole('radio', { name: TTS_LABEL }));
        expect(screen.getByTestId('tts-settings')).toBeTruthy();
    });

    it('画像生成の欄の変更で保存の帯を出し、保存で画像生成の欄の保存を呼ぶ', async () => {
        const user = userEvent.setup();
        renderView(true);
        await user.click(screen.getByRole('button', { name: MEDIA_LABEL }));
        await user.click(screen.getByText('画像生成の欄'));
        const saveButton = await screen.findByRole('button', { name: /^保存/ });
        await user.click(saveButton);
        await waitFor(() => expect(imageSave).toHaveBeenCalled());
    });
});
