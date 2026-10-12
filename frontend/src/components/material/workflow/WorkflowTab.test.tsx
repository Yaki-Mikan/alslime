import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    addComfyUITemplate,
    deleteComfyUITemplate,
    getComfyUIConfig,
    listApiServicePresets,
    listComfyUITemplates,
    patchComfyUIConfig,
} from '../../../api/comfyui';
import { getEmotionPrompts, saveEmotionPrompts } from '../../../api/characters';
import { WorkflowTab } from './WorkflowTab';

vi.mock('../../../api/comfyui', async importOriginal => {
    const actual = await importOriginal<typeof import('../../../api/comfyui')>();
    return {
        ...actual,
        listComfyUITemplates: vi.fn(),
        getComfyUIConfig: vi.fn(),
        patchComfyUIConfig: vi.fn(),
        listPlaceholderPresets: vi.fn().mockResolvedValue([]),
        listApiServicePresets: vi.fn().mockResolvedValue([]),
        addComfyUITemplate: vi.fn(),
        deleteComfyUITemplate: vi.fn(),
        downloadComfyUITemplate: vi.fn(),
    };
});
vi.mock('../../../api/characters', () => ({ getEmotionPrompts: vi.fn(), saveEmotionPrompts: vi.fn() }));
vi.mock('../../comfyui/PlaceholderPresetModal', () => ({ PlaceholderPresetModal: () => null }));
vi.mock('../../comfyui/apiservice/NovelAIPresetSection', () => ({ NovelAIPresetSection: () => <div data-testid="api-presets" /> }));

const CONFIG = { defaultTemplateId: 'wf-a', workflowByDirectiveMode: { danbooru_only: 'wf-b' }, imageBackend: 'comfyui' };
const EMOTION = { version: 1, workflow: 'wf-b', emotions: { smile: [{ title: 't', prompt: 'p' }] } };

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listComfyUITemplates).mockResolvedValue([
        { name: 'wf-a', hasWorkflow: true, hasMeta: false },
        { name: 'wf-b', hasWorkflow: true, hasMeta: false },
        { name: 'wf-c', hasWorkflow: true, hasMeta: false },
    ]);
    vi.mocked(getComfyUIConfig).mockResolvedValue(structuredClone(CONFIG) as never);
    vi.mocked(patchComfyUIConfig).mockImplementation(async (_url, patch) => ({ ...CONFIG, ...patch }) as never);
    vi.mocked(getEmotionPrompts).mockResolvedValue(structuredClone(EMOTION) as never);
    vi.mocked(saveEmotionPrompts).mockImplementation(async (_url, body) => body);
    vi.mocked(addComfyUITemplate).mockResolvedValue({ success: true });
    vi.mocked(deleteComfyUITemplate).mockResolvedValue({ success: true });
});

const renderTab = async () => {
    render(<WorkflowTab backendUrl="http://backend" uiCatalog={null} active />);
    await waitFor(() => expect(screen.getAllByText('wf-a').length).toBeGreaterThan(0));
};
const listItem = (name: string) => screen.getAllByText(name).map(el => el.closest('button')).find(Boolean) as HTMLElement;

describe('素材づくりの画像生成のタブ', () => {
    it('一覧に使っている用途の札を出す', async () => {
        await renderTab();
        await waitFor(() => expect(within(listItem('wf-a')).getByText('会話の画像')).toBeTruthy());
        expect(within(listItem('wf-b')).getByText('表情画像')).toBeTruthy();
        expect(within(listItem('wf-c')).queryByText('会話の画像')).toBeNull();
    });

    it('会話の画像の既定と表情画像のワークフローを、それぞれの項目だけ差し替えて保存する', async () => {
        const user = userEvent.setup();
        await renderTab();
        await user.click(listItem('wf-c'));
        await user.click(screen.getByText('会話の画像の既定にする'));
        await waitFor(() => expect(patchComfyUIConfig).toHaveBeenCalledWith('http://backend', { defaultTemplateId: 'wf-c' }));
        await user.click(screen.getByText('表情画像に使う'));
        await waitFor(() => expect(saveEmotionPrompts).toHaveBeenCalledWith('http://backend', { ...EMOTION, workflow: 'wf-c' }));
    });

    it('形式ごとの割り当てを保存し、「共通」に戻すとその形式の項目を消す', async () => {
        const user = userEvent.setup();
        await renderTab();
        await waitFor(() => expect((screen.getByLabelText('Danbooruタグのみ（一人称視点）') as HTMLSelectElement).value).toBe('wf-b'));
        await user.selectOptions(screen.getByLabelText('Danbooruタグのみ（一人称視点）'), '');
        await waitFor(() => expect(patchComfyUIConfig).toHaveBeenLastCalledWith('http://backend', { workflowByDirectiveMode: {} }));
    });

    it('JSON を取り込んで名前を付けて追加する', async () => {
        const user = userEvent.setup();
        await renderTab();
        const file = new File(['{"1":{}}'], 'new-flow.json', { type: 'application/json' });
        await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, file);
        await waitFor(() => expect((screen.getByLabelText('名前') as HTMLInputElement).value).toBe('new-flow'));
        await user.click(screen.getByText('追加する'));
        await waitFor(() => expect(addComfyUITemplate).toHaveBeenCalledWith('http://backend', 'new-flow', { 1: {} }));
    });

    it('削除は使っている用途を示して確かめてから行う', async () => {
        const user = userEvent.setup();
        await renderTab();
        await user.click(listItem('wf-b'));
        await user.click(screen.getByRole('button', { name: /削除/ }));
        expect(screen.getByText(/このワークフローは次の用途で使っています：表情画像/)).toBeTruthy();
        const dialog = screen.getByRole('dialog');
        await user.click(within(dialog).getByRole('button', { name: '削除' }));
        await waitFor(() => expect(deleteComfyUITemplate).toHaveBeenCalledWith('http://backend', 'wf-b'));
    });

    it('使う仕組みが ComfyUI のままでも、APIサービスに切り替えて生成プリセットを編集できる', async () => {
        const user = userEvent.setup();
        await renderTab();
        expect(screen.queryByTestId('api-presets')).toBeNull();
        await user.click(screen.getByRole('radio', { name: 'APIサービス' }));
        await waitFor(() => expect(screen.getByTestId('api-presets')).toBeTruthy());
        expect(listApiServicePresets).toHaveBeenCalled();
        expect(screen.queryByText('wf-c')).toBeNull();
        await user.click(screen.getByRole('radio', { name: 'ComfyUI' }));
        await waitFor(() => expect(screen.getAllByText('wf-c').length).toBeGreaterThan(0));
    });
});
