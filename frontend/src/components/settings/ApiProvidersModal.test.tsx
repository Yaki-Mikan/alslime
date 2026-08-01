import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    createApiProvider,
    deleteApiProvider,
    dryRunDeleteApiProvider,
    fetchApiProviderPresets,
    fetchApiProviders,
    fetchApiProviderSystemPrompt,
    saveApiProviderSystemPrompt,
    testApiProvider,
    updateApiProvider,
    type ApiProviderConnection,
} from '../../api/api-providers';
import { fetchUserModels, saveUserModels } from '../../api/user-models';
import { ApiProvidersModal } from './ApiProvidersModal';

vi.mock('../../api/api-providers', () => ({
    createApiProvider: vi.fn(),
    deleteApiProvider: vi.fn(),
    dryRunDeleteApiProvider: vi.fn(),
    fetchApiProviderPresets: vi.fn(),
    fetchApiProviders: vi.fn(),
    fetchApiProviderSystemPrompt: vi.fn(),
    saveApiProviderSystemPrompt: vi.fn(),
    testApiProvider: vi.fn(),
    updateApiProvider: vi.fn(),
}));

vi.mock('../../api/user-models', () => ({
    fetchUserModels: vi.fn(),
    saveUserModels: vi.fn(),
}));

const connection: ApiProviderConnection = {
    id: 'connection-id',
    preset: 'openrouter',
    label: '試験接続',
    baseUrl: 'https://example.invalid/api/v1',
    authScheme: 'bearer',
    enabled: true,
    hasApiKey: true,
};

const userModels = {
    builtin: [],
    added: [],
    hidden: [],
};

const renderModal = (onOpenInstruction = vi.fn(), messages: Record<string, string> = {}) => render(
    <ApiProvidersModal
        isOpen
        onClose={vi.fn()}
        onModelsChanged={vi.fn()}
        onOpenInstruction={onOpenInstruction}
        uiCatalog={{ lang: 'ja', defaultLang: 'ja', fallbackLang: 'ja', messages }}
    />
);

const openExistingConnection = async (user: ReturnType<typeof userEvent.setup>) => {
    await screen.findByText(connection.label);
    await user.click(screen.getByRole('button', { name: '編集' }));
    await screen.findByDisplayValue(connection.label);
};

describe('API接続先管理UI', () => {
    beforeEach(() => {
        vi.mocked(fetchApiProviders).mockResolvedValue([connection]);
        vi.mocked(fetchApiProviderPresets).mockResolvedValue([{
            id: 'openrouter',
            labelKey: 'apiProviders.preset.openrouter',
            baseUrl: connection.baseUrl,
            authScheme: 'bearer',
            noticeKeys: [],
            supportsModelsApi: true,
            cacheKeyParam: 'session_id',
        }]);
        vi.mocked(fetchUserModels).mockResolvedValue(userModels);
        vi.mocked(fetchApiProviderSystemPrompt).mockImplementation(async (_backendUrl, _id, locale) => ({
            content: locale === 'ja' ? '日本語の追加指示' : 'English instruction',
            label: connection.label,
            locale,
            file: `instructions/${locale}.md`,
        }));
        vi.mocked(saveApiProviderSystemPrompt).mockResolvedValue();
        vi.mocked(createApiProvider).mockResolvedValue(connection);
        vi.mocked(updateApiProvider).mockResolvedValue(connection);
        vi.mocked(testApiProvider).mockResolvedValue({
            success: true,
            models: [],
            supportsModelsApi: true,
        });
        vi.mocked(saveUserModels).mockResolvedValue({ success: true, added: [], hidden: [], models: [] });
        vi.mocked(dryRunDeleteApiProvider).mockResolvedValue({
            userModels: [],
            isDefaultModel: false,
            deletesConnectionPrompts: false,
        });
        vi.mocked(deleteApiProvider).mockResolvedValue({
            userModels: [],
            isDefaultModel: false,
            deletesConnectionPrompts: false,
        });
    });

    it('新規接続のテスト前に保存し、返却IDで接続テストする', async () => {
        const user = userEvent.setup();
        renderModal();
        await screen.findByText(connection.label);
        await user.click(screen.getByRole('button', { name: '接続先を追加' }));
        await user.click(screen.getByRole('button', { name: '接続テスト' }));

        await waitFor(() => expect(testApiProvider).toHaveBeenCalledWith(expect.any(String), connection.id));
        expect(vi.mocked(createApiProvider).mock.invocationCallOrder[0])
            .toBeLessThan(vi.mocked(testApiProvider).mock.invocationCallOrder[0]);
    });

    it('接続確認で取得したモデルをAPIキー直下で選び、画面の保存ボタンで同時登録する', async () => {
        const user = userEvent.setup();
        vi.mocked(testApiProvider).mockResolvedValue({
            success: true,
            models: [{ id: 'provider/model-a', name: 'Model A' }],
            supportsModelsApi: true,
        });
        vi.mocked(saveUserModels).mockResolvedValue({
            success: true,
            added: [{
                id: 'openai_compat:connection-id/provider/model-a',
                provider: 'openai_compat',
                connectionId: connection.id,
                remoteModelId: 'provider/model-a',
            }],
            hidden: [],
            models: [],
        });
        renderModal();
        await openExistingConnection(user);
        await user.click(screen.getByRole('button', { name: '接続テスト' }));

        const modelCheckbox = await screen.findByRole('checkbox', { name: /provider\/model-a/ });
        const apiKeyInput = screen.getByPlaceholderText('設定済み（変更する場合のみ入力）');
        const saveButton = screen.getByRole('button', { name: '保存' });
        expect(apiKeyInput.compareDocumentPosition(modelCheckbox) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
        expect(modelCheckbox.compareDocumentPosition(saveButton) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);

        await user.click(modelCheckbox);
        await user.click(saveButton);
        await waitFor(() => expect(saveUserModels).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
            added: expect.arrayContaining([
                expect.objectContaining({ connectionId: connection.id, remoteModelId: 'provider/model-a' }),
            ]),
        })));
    });

    it('登録済みモデルは再接続テストをせず編集画面に表示する', async () => {
        const user = userEvent.setup();
        vi.mocked(fetchUserModels).mockResolvedValue({
            builtin: [],
            added: [{
                id: 'openai_compat:connection-id/provider/registered',
                provider: 'openai_compat',
                connectionId: connection.id,
                remoteModelId: 'provider/registered',
            }],
            hidden: [],
        });
        renderModal();
        await openExistingConnection(user);

        expect(await screen.findByRole('checkbox', { name: /provider\/registered/ })).toBeChecked();
        expect(testApiProvider).not.toHaveBeenCalled();
    });

    it('モデル登録エラーをフォーム最上部ではなく使用モデル選択欄の中へ表示する', async () => {
        const user = userEvent.setup();
        vi.mocked(testApiProvider).mockResolvedValue({
            success: true,
            models: [{ id: 'provider/model-error' }],
            supportsModelsApi: true,
        });
        vi.mocked(saveUserModels).mockRejectedValue({
            response: { data: { messageKey: 'error.modelIdConflictsBuiltIn' } },
        });
        renderModal(vi.fn(), {
            'error.modelIdConflictsBuiltIn': '内蔵デフォルトと同じモデル ID は追加できません。',
        });
        await openExistingConnection(user);
        await user.click(screen.getByRole('button', { name: '接続テスト' }));
        await user.click(await screen.findByRole('checkbox', { name: /provider\/model-error/ }));
        await user.click(screen.getByRole('button', { name: '保存' }));

        const picker = screen.getByText('使用するモデルを選択').closest('div')!;
        expect(await within(picker).findByRole('alert')).toHaveTextContent('内蔵デフォルトと同じモデル ID は追加できません。');
    });

    it('自動保存に失敗した場合は接続テストを実行せず、フォームを保持する', async () => {
        const user = userEvent.setup();
        vi.mocked(createApiProvider).mockRejectedValue({
            response: { data: { messageKey: 'apiProviders.error.saveFailed' } },
        });
        renderModal();
        await screen.findByText(connection.label);
        await user.click(screen.getByRole('button', { name: '接続先を追加' }));
        const labelInput = screen.getAllByRole('textbox')[0];
        await user.type(labelInput, '保存失敗後も残る表示名');
        await user.click(screen.getByRole('button', { name: '接続テスト' }));

        await screen.findByText('保存に失敗したため、接続テストを中止しました。');
        expect(testApiProvider).not.toHaveBeenCalled();
        expect(screen.getByDisplayValue('保存失敗後も残る表示名')).toBeInTheDocument();
    });

    it('認証必須接続のキー未設定エラーを表示し、成功扱いのモデル選択欄を出さない', async () => {
        const user = userEvent.setup();
        vi.mocked(testApiProvider).mockResolvedValue({
            success: false,
            models: [],
            supportsModelsApi: false,
            messageKey: 'apiProviders.testKeyRequired',
            failureKind: 'auth',
        });
        renderModal();
        await screen.findByText(connection.label);
        await user.click(screen.getByRole('button', { name: '接続先を追加' }));
        await user.click(screen.getByRole('button', { name: '接続テスト' }));

        expect(await screen.findByText('APIキーを入力してから接続テストを実行してください。')).toBeInTheDocument();
        expect(screen.queryByText('使用するモデルを選択')).not.toBeInTheDocument();
    });

    it('APIキー上書き入力を削除予定へ変えると入力値を破棄し、再入力で解除する', async () => {
        const user = userEvent.setup();
        renderModal();
        await openExistingConnection(user);

        const keyInput = screen.getByPlaceholderText('設定済み（変更する場合のみ入力）');
        await user.type(keyInput, 'should-be-discarded');
        await user.click(screen.getByRole('button', { name: 'キーを削除' }));
        const confirmation = screen.getByText('このAPIキーを削除しますか？削除は次回保存時に反映されます。').parentElement!;
        await user.click(within(confirmation).getByRole('button', { name: 'キーを削除' }));

        expect(screen.getByText('保存時にキーが削除されます')).toBeInTheDocument();
        expect(screen.queryByDisplayValue('should-be-discarded')).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: '入力し直す' }));
        expect(screen.getByPlaceholderText('設定済み（変更する場合のみ入力）')).toHaveValue('');
    });

    it('APIキーの未保存状態はキャンセルして開き直すと未変更へ戻る', async () => {
        const user = userEvent.setup();
        renderModal();
        await openExistingConnection(user);
        await user.type(screen.getByPlaceholderText('設定済み（変更する場合のみ入力）'), 'unsaved-key');
        await user.click(screen.getByRole('button', { name: 'キャンセル' }));
        await user.click(screen.getByRole('button', { name: '編集' }));

        expect(await screen.findByPlaceholderText('設定済み（変更する場合のみ入力）')).toHaveValue('');
        expect(screen.queryByDisplayValue('unsaved-key')).not.toBeInTheDocument();
    });

    it('指示の本文編集欄を置かず、設定ファイルエディタへ対象Connection ID・プリセット・言語を渡す', async () => {
        const user = userEvent.setup();
        const onOpenInstruction = vi.fn();
        renderModal(onOpenInstruction);
        await openExistingConnection(user);

        expect(screen.queryByDisplayValue('日本語の追加指示')).not.toBeInTheDocument();
        expect(fetchApiProviderSystemPrompt).not.toHaveBeenCalled();
        await user.click(screen.getByRole('button', { name: '日本語の指示ファイルを開く' }));
        expect(onOpenInstruction).toHaveBeenCalledWith({ connectionId: connection.id, preset: connection.preset, locale: 'ja' });
        await user.click(screen.getByRole('button', { name: '英語の指示ファイルを開く' }));
        expect(onOpenInstruction).toHaveBeenCalledWith({ connectionId: connection.id, preset: connection.preset, locale: 'en' });
        expect(saveApiProviderSystemPrompt).not.toHaveBeenCalled();
    });

    it('ExtraParamsの予約キーと秘密系キーを該当行のエラーとして表示する', async () => {
        const user = userEvent.setup();
        const { container } = renderModal();
        await openExistingConnection(user);
        await user.click(screen.getByRole('button', { name: '行を追加' }));

        const rowInputs = container.querySelectorAll<HTMLInputElement>('input[type="text"]');
        const keyInput = rowInputs[rowInputs.length - 2];
        const valueInput = rowInputs[rowInputs.length - 1];
        await user.type(keyInput, 'stream');
        await user.type(valueInput, 'true');
        await user.click(screen.getByRole('button', { name: '保存' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('このキーはAlSlimeが管理するため使用できません。');
        expect(updateApiProvider).not.toHaveBeenCalled();

        await user.clear(keyInput);
        await user.type(keyInput, 'authorization');
        await user.click(screen.getByRole('button', { name: '保存' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('秘密情報とみられるキーは拡張パラメータに設定できません。');
        expect(updateApiProvider).not.toHaveBeenCalled();
    });

    it('dryRunの削除影響を表示してから削除し、追加指示の削除も明示する', async () => {
        const user = userEvent.setup();
        vi.mocked(dryRunDeleteApiProvider).mockResolvedValue({
            userModels: ['openai_compat:connection-id:model'],
            isDefaultModel: true,
            deletesConnectionPrompts: true,
        });
        renderModal();
        await screen.findByText(connection.label);
        await user.click(screen.getByRole('button', { name: '削除' }));

        expect(await screen.findByText('openai_compat:connection-id:model')).toBeInTheDocument();
        expect(screen.getByText('この接続先の追加指示（日本語・英語）も削除されます。')).toBeInTheDocument();
        expect(deleteApiProvider).not.toHaveBeenCalled();
        await user.click(screen.getByRole('button', { name: '削除を実行' }));
        await waitFor(() => expect(deleteApiProvider).toHaveBeenCalledWith(expect.any(String), connection.id));
    });

    it('dryRun取得失敗時は削除を中止し、途中失敗はステップを表示して再実行可能にする', async () => {
        const user = userEvent.setup();
        vi.mocked(dryRunDeleteApiProvider)
            .mockRejectedValueOnce(new Error('dry-run failed'))
            .mockResolvedValue({ userModels: [], isDefaultModel: false, deletesConnectionPrompts: false });
        vi.mocked(deleteApiProvider).mockRejectedValue({
            response: {
                data: {
                    messageKey: 'apiProviders.error.cascadeStepFailed',
                    details: { step: 2, total: 4 },
                },
            },
        });
        renderModal();
        await screen.findByText(connection.label);
        await user.click(screen.getByRole('button', { name: '削除' }));
        expect(await screen.findByText('削除の影響範囲を取得できませんでした。')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '削除を実行' })).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: '削除' }));
        await user.click(await screen.findByRole('button', { name: '削除を実行' }));
        expect(await screen.findByText(/2\/4/)).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: '削除' }));
        expect(await screen.findByRole('button', { name: '削除を実行' })).toBeInTheDocument();
    });

    it('messageKeyを画面辞書で解決し、接続テストdetailsは一時表示する', async () => {
        const user = userEvent.setup();
        vi.mocked(testApiProvider).mockResolvedValue({
            success: false,
            models: [],
            supportsModelsApi: true,
            messageKey: 'apiProviders.testFailedAuth',
            failureKind: 'auth',
            details: 'sanitized-detail',
        });
        renderModal();
        await openExistingConnection(user);
        await user.click(screen.getByRole('button', { name: '接続テスト' }));

        expect(await screen.findByText('接続に失敗しました（APIキーが無効か権限がありません）。')).toBeInTheDocument();
        expect(screen.getByText('sanitized-detail')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'キャンセル' }));
        expect(screen.queryByText('sanitized-detail')).not.toBeInTheDocument();
    });

    it('画面スナップショットにAPIキー値を含めず、編集時も空のpassword入力だけを出す', async () => {
        const user = userEvent.setup();
        const { container } = renderModal();
        await screen.findByText(connection.label);

        expect(container).not.toHaveTextContent('provider-secret-value');
        const connectionStatus = screen.getByText((_content, element) => (
            element?.tagName === 'P' && element.textContent?.includes('キー: 設定済み') === true
        ));
        expect(connectionStatus).toMatchSnapshot();
        await user.click(screen.getByRole('button', { name: '編集' }));
        const passwordInput = await screen.findByPlaceholderText('設定済み（変更する場合のみ入力）');
        expect(passwordInput).toHaveValue('');
        expect(container.innerHTML).not.toContain('provider-secret-value');
    });
});
