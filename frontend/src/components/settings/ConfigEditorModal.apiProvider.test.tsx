import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    fetchApiProviders,
    fetchApiProviderSystemPrompt,
    saveApiProviderSystemPrompt,
} from '../../api/api-providers';
import {
    getCategories,
    getInitialContent,
    getProviderInstruction,
    listConfigFiles,
    listProviderInstructions,
    listTemplates,
    saveProviderInstruction,
} from '../../api/config-editor';
import { ConfigEditorModal } from './ConfigEditorModal';

vi.mock('../../api/api-providers', () => ({
    fetchApiProviders: vi.fn(),
    fetchApiProviderSystemPrompt: vi.fn(),
    saveApiProviderSystemPrompt: vi.fn(),
}));

vi.mock('../../api/config-editor', () => ({
    getCategories: vi.fn(),
    getInitialContent: vi.fn(),
    listConfigFiles: vi.fn(),
    listProviderInstructions: vi.fn(),
    listTemplates: vi.fn(),
    getProviderInstruction: vi.fn(),
    saveProviderInstruction: vi.fn(),
    // 設定自動生成指示の言語絞り込みはレンダー毎に呼ばれる純粋関数のため、実装相当を与える。
    normalizeConfigGenInstructionLocale: (locale: string) => (locale.toLowerCase().startsWith('en') ? 'en' : 'ja'),
}));

describe('設定ファイルエディタのAPI接続指示', () => {
    beforeEach(() => {
        vi.mocked(getCategories).mockResolvedValue([{ id: 'character', label: 'キャラクター', isCharacter: true }]);
        vi.mocked(getInitialContent).mockResolvedValue('');
        vi.mocked(listConfigFiles).mockResolvedValue([]);
        vi.mocked(listTemplates).mockResolvedValue([]);
        vi.mocked(listProviderInstructions).mockResolvedValue([{
            id: 'openai-compat-openrouter-ja',
            label: 'OpenRouter基本指示（日本語）',
            file: 'roleplay/global/prompts/openai-compat/presets/openrouter/system.ja.md',
            exists: true,
        }]);
        vi.mocked(fetchApiProviders).mockResolvedValue([{
            id: 'connection-id',
            preset: 'openrouter',
            label: '試験接続',
            baseUrl: 'https://example.invalid/api/v1',
            authScheme: 'bearer',
            enabled: true,
            hasApiKey: true,
        }]);
        vi.mocked(fetchApiProviderSystemPrompt).mockResolvedValue({
            content: '接続指示本文',
            label: '試験接続',
            locale: 'ja',
            file: 'roleplay/global/prompts/openai-compat/connections/connection-id/system.ja.md',
        });
        vi.mocked(saveApiProviderSystemPrompt).mockResolvedValue();
        vi.mocked(getProviderInstruction).mockResolvedValue('OpenRouter基本指示本文');
        vi.mocked(saveProviderInstruction).mockResolvedValue();
    });

    it('指定された接続と言語のmdを直接開き、同じ専用APIで保存する', async () => {
        const user = userEvent.setup();
        vi.mocked(fetchApiProviders).mockResolvedValue([{
            id: 'connection-id',
            preset: 'custom',
            label: '試験接続',
            baseUrl: 'https://example.invalid/api/v1',
            authScheme: 'bearer',
            enabled: true,
            hasApiKey: true,
        }]);
        render(
            <ConfigEditorModal
                isOpen
                onClose={vi.fn()}
                backendUrl=""
                openApiProviderInstruction={{ connectionId: 'connection-id', preset: 'custom', locale: 'ja' }}
                onOpenApiProviderInstructionConsumed={vi.fn()}
            />
        );

        const editor = await screen.findByDisplayValue('接続指示本文');
        expect(fetchApiProviderSystemPrompt).toHaveBeenCalledWith('', 'connection-id', 'ja');
        expect(screen.getByDisplayValue('roleplay/global/prompts/openai-compat/connections/connection-id/system.ja.md')).toBeDisabled();

        await user.clear(editor);
        await user.type(editor, '更新後の接続指示');
        await user.click(screen.getByRole('button', { name: '上書き保存' }));
        await waitFor(() => expect(saveApiProviderSystemPrompt).toHaveBeenCalledWith(
            '', 'connection-id', 'ja', '更新後の接続指示'
        ));
    });

    it('固定プリセットは短い接続別指示ではなく共有の基本指示全文を直接開く', async () => {
        render(
            <ConfigEditorModal
                isOpen
                onClose={vi.fn()}
                backendUrl=""
                openApiProviderInstruction={{ connectionId: 'connection-id', preset: 'openrouter', locale: 'ja' }}
                onOpenApiProviderInstructionConsumed={vi.fn()}
            />
        );

        expect(await screen.findByDisplayValue('OpenRouter基本指示本文')).toBeInTheDocument();
        expect(getProviderInstruction).toHaveBeenCalledWith('', 'openai-compat-openrouter-ja');
        expect(fetchApiProviderSystemPrompt).not.toHaveBeenCalled();
    });
});
