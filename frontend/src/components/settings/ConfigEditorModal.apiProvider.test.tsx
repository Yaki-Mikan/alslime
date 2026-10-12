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
    getConfigFile,
    getInitialContent,
    getProviderInstruction,
    listConfigFiles,
    listProviderInstructions,
    listTemplates,
    saveProviderInstruction,
} from '../../api/config-editor';
import { ConfigEditorModal } from './ConfigEditorModal';

// CodeMirror は jsdom に getClientRects が無く座標計算で失敗するため textarea へ差し替える。
vi.mock('../common/CodeEditor', () => ({
    CodeEditor: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
        <textarea value={value} onChange={e => onChange(e.target.value)} />
    ),
}));

// この試験では設定ファイル本体の遷移だけを確認し、右側の付属欄は組み込まない。
vi.mock('../material/files/DialogEditPanel', () => ({ DialogEditPanel: () => null }));
vi.mock('./character/CharacterTagsEditor', () => ({ CharacterTagsEditor: () => null }));
vi.mock('./character/EmotionImageTab', () => ({ EmotionImageTab: () => null }));
vi.mock('./character/ImageGenTab', () => ({ ImageGenTab: () => null }));
vi.mock('./character/VoiceTab', () => ({ VoiceTab: () => null }));
vi.mock('./character/LinkedSettingsTab', () => ({ LinkedSettingsTab: () => null }));

vi.mock('../../api/api-providers', () => ({
    fetchApiProviders: vi.fn(),
    fetchApiProviderSystemPrompt: vi.fn(),
    saveApiProviderSystemPrompt: vi.fn(),
}));

vi.mock('../../api/config-editor', () => ({
    getCategories: vi.fn(),
    getConfigFile: vi.fn(),
    getInitialContent: vi.fn(),
    listConfigFiles: vi.fn(),
    listProviderInstructions: vi.fn(),
    listTemplates: vi.fn(),
    getProviderInstruction: vi.fn(),
    saveProviderInstruction: vi.fn(),
    // AI への指示のまとまりを開くと、ほかの決まったファイルの一覧も読む
    listConfigGenInstructions: vi.fn(() => Promise.resolve([])),
    listComfyDirectives: vi.fn(() => Promise.resolve([])),
    getDefaultTemplates: vi.fn(() => Promise.resolve({})),
    // 設定自動生成指示の言語絞り込みはレンダー毎に呼ばれる純粋関数のため、実装相当を与える。
    normalizeConfigGenInstructionLocale: (locale: string) => (locale.toLowerCase().startsWith('en') ? 'en' : 'ja'),
}));

describe('設定ファイルエディタのAPI接続指示', () => {
    beforeEach(() => {
        vi.mocked(getCategories).mockResolvedValue([{ id: 'character', label: 'キャラクター', isCharacter: true }]);
        vi.mocked(getInitialContent).mockResolvedValue('');
        vi.mocked(getConfigFile).mockResolvedValue('# 生成された設定');
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

    it('外から通常ファイルを開くと検索とテンプレート表示を解除して対象を表示する', async () => {
        const user = userEvent.setup();
        const generatedFile = { dirName: '生成キャラ', name: '生成キャラ' };
        vi.mocked(listConfigFiles).mockResolvedValue([
            { dirName: '以前のキャラ', name: '以前のキャラ' },
            generatedFile,
        ]);
        vi.mocked(listTemplates).mockResolvedValue(['標準テンプレート']);
        const request = {
            categoryId: 'character',
            dirName: generatedFile.dirName,
            fileName: generatedFile.name,
            content: '# 生成された設定',
        };

        const { rerender } = render(
            <ConfigEditorModal isOpen backendUrl="" />
        );

        const search = await screen.findByPlaceholderText('名前で探す');
        await user.type(search, '以前');
        await user.click(screen.getByRole('button', { name: 'テンプレート' }));
        expect(screen.getByRole('button', { name: '新しいテンプレート' })).toBeInTheDocument();

        rerender(
            <ConfigEditorModal
                isOpen
                backendUrl=""
                openFileRequest={request}
                onOpenFileRequestConsumed={vi.fn()}
            />
        );

        await waitFor(() => expect(search).toHaveValue(''));
        expect(await screen.findByRole('button', { name: '生成キャラ' })).toBeInTheDocument();
        expect(await screen.findByDisplayValue('# 生成された設定')).toBeInTheDocument();
        expect(screen.getByDisplayValue('生成キャラ')).toBeInTheDocument();
        expect(getConfigFile).toHaveBeenCalledWith('', 'character', '生成キャラ', '生成キャラ');
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
        await user.click(screen.getByRole('button', { name: '保存' }));
        await waitFor(() => expect(saveApiProviderSystemPrompt).toHaveBeenCalledWith(
            '', 'connection-id', 'ja', '更新後の接続指示'
        ));
    });

    it('固定プリセットは短い接続別指示ではなく共有の基本指示全文を直接開く', async () => {
        render(
            <ConfigEditorModal
                isOpen
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
