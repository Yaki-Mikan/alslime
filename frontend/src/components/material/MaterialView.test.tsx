import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MATERIAL_I18N_KEYS, MATERIAL_TEXT_FALLBACK_JA } from '../../constants/i18n';
import { MaterialView, type MaterialRequest } from './MaterialView';

// 中の窓は、表示の条件を確かめるための印だけを描く差し替えにする。
vi.mock('../settings/ConfigEditorModal', () => ({
    COMFY_DIRECTIVE_CATEGORY_ID: 'comfy-directive',
    CONFIG_GEN_INSTRUCTION_CATEGORY_ID: 'config-gen-instruction',
    ConfigEditorModal: ({ isOpen, imageGenEnabled, appearancePrompt }: { isOpen: boolean; imageGenEnabled: boolean; appearancePrompt?: unknown }) => (isOpen ? (
        <div data-testid="config-editor" data-image-gen={String(imageGenEnabled)} data-appearance={appearancePrompt ? 'yes' : 'no'} />
    ) : null),
}));
vi.mock('./files/AiCreatePanel', () => ({ AiCreatePanel: () => null }));
vi.mock('./images/CharacterImagesTab', () => ({
    CharacterImagesTab: ({ active }: { active: boolean }) => (active ? <div data-testid="character-images" /> : null),
}));
vi.mock('./workflow/WorkflowTab', () => ({ WorkflowTab: () => null }));
vi.mock('./tags/TagMappingTab', () => ({ TagMappingTab: () => null }));
vi.mock('../settings/sections/media/TTSSettingsPanel', () => ({
    TTSSettingsPanel: ({ active, part }: { active: boolean; part?: string }) => (active ? <div data-testid="voice-registry" data-part={part} /> : null),
}));
vi.mock('../../hooks/useAppearancePromptGen', () => ({ useAppearancePromptGen: () => ({ marker: 'appearance' }) }));

const IMAGES_TAB = MATERIAL_TEXT_FALLBACK_JA[MATERIAL_I18N_KEYS.tabImages];

const view = (imageGenEnabled: boolean, ttsEnabled: boolean, request: MaterialRequest | null) => (
    <MaterialView
        backendUrl=""
        uiCatalog={null}
        imageGenEnabled={imageGenEnabled}
        ttsEnabled={ttsEnabled}
        comfyDirectiveVisible={false}
        active
        request={request}
        onRequestConsumed={() => {}}
        sessionCharacterPaths={[]}
    />
);

describe('素材づくりの画像生成の表示条件', () => {
    it('画像生成も読み上げも使えないときはキャラのタブ・容姿プロンプト作成を出さず、設定ファイルを開く', () => {
        render(view(false, false, { tab: 'images' }));
        expect(screen.queryByRole('radio', { name: IMAGES_TAB })).toBeNull();
        expect(screen.queryByTestId('character-images')).toBeNull();
        const editor = screen.getByTestId('config-editor');
        expect(editor.dataset.imageGen).toBe('false');
        expect(editor.dataset.appearance).toBe('no');
    });

    it('使えるときはキャラのタブを出し、依頼に合わせて開く', () => {
        render(view(true, false, { tab: 'images' }));
        expect(screen.getByRole('radio', { name: IMAGES_TAB })).toBeTruthy();
        expect(screen.getByTestId('character-images')).toBeTruthy();
        expect(screen.queryByTestId('config-editor')).toBeNull();
    });

    it('開いている途中で使えなくなったら設定ファイルへ戻る', () => {
        const { rerender } = render(view(true, false, { tab: 'images' }));
        expect(screen.getByTestId('character-images')).toBeTruthy();
        rerender(view(false, false, null));
        expect(screen.queryByTestId('character-images')).toBeNull();
        expect(screen.getByTestId('config-editor').dataset.appearance).toBe('no');
    });
});

describe('素材づくりの読み上げの表示条件', () => {
    it('声のタブは声の登録を出し、使えなくなったら設定ファイルへ戻る', () => {
        const { rerender } = render(view(false, true, { tab: 'voice' }));
        expect(screen.getByTestId('voice-registry').dataset.part).toBe('voices');
        expect(screen.queryByTestId('config-editor')).toBeNull();
        rerender(view(false, false, null));
        expect(screen.queryByTestId('voice-registry')).toBeNull();
        expect(screen.getByTestId('config-editor')).toBeTruthy();
    });

    it('読み上げだけが使えるときも、声の紐づけのためにキャラのタブを出す', () => {
        render(view(false, true, { tab: 'images' }));
        expect(screen.getByRole('radio', { name: IMAGES_TAB })).toBeTruthy();
        expect(screen.getByTestId('character-images')).toBeTruthy();
    });
});
