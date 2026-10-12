import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    getAllTagMappings,
    getComfyUIConfig,
    getLoraDirConfig,
    getLoraTriggerWordsBatch,
    getTagMapping,
    saveTagCategories,
    saveTagMapping,
    setTagEnabled,
} from '../../../api/comfyui';
import type { TagMappingFile } from '../../../api/comfyui';
import { TagMappingTab } from './TagMappingTab';

vi.mock('../../../api/comfyui', async importOriginal => {
    const actual = await importOriginal<typeof import('../../../api/comfyui')>();
    return {
        ...actual,
        getAllTagMappings: vi.fn(),
        getLoraDirConfig: vi.fn(),
        listComfyUITemplates: vi.fn().mockResolvedValue([]),
        getComfyUIConfig: vi.fn(),
        listApiServicePresets: vi.fn().mockResolvedValue([]),
        getTagMapping: vi.fn(),
        saveTagMapping: vi.fn(),
        saveTagCategories: vi.fn(),
        saveLoraDirConfig: vi.fn(),
        setTagEnabled: vi.fn(),
        getLoraTriggerWords: vi.fn(),
        getLoraTriggerWordsBatch: vi.fn(),
    };
});
vi.mock('../../comfyui/useComfyLoras', () => ({
    useComfyLoras: () => ({ lorasByCategory: { pose: ['p1.safetensors'] }, comfyUnreachable: false, retry: vi.fn() }),
}));
vi.mock('../../comfyui/useDanbooruTagFormat', () => ({ useDanbooruTagFormat: () => 'underscore' }));
vi.mock('../../comfyui/useTriggerWordFormat', () => ({ useTriggerWordFormat: () => 'raw' }));
vi.mock('../../comfyui/integrated/IntegratedDanbooruSearch', () => ({ IntegratedDanbooruSearch: () => null }));

const CATEGORIES = [
    { id: 'pose', label: '体位・姿勢', loraPrefixes: [] },
    { id: 'emotion', label: '表情', loraPrefixes: [] },
];

const poseMapping = (): TagMappingFile => ({
    categoryId: 'pose',
    tags: [
        { key: '立ち', description: '', prompt: 'standing', negativePrompt: '', lora: [{ name: 'p1.safetensors', strengthModel: 1, strengthClip: 1 }] },
        { key: '座り', description: '', prompt: 'sitting', negativePrompt: '', lora: [] },
    ],
});

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAllTagMappings).mockResolvedValue({ categories: CATEGORIES, mappings: [poseMapping(), { categoryId: 'emotion', tags: [] }] });
    vi.mocked(getLoraDirConfig).mockResolvedValue({ categories: [{ id: 'pose', label: 'pose', directory: 'pose/' }] });
    vi.mocked(getComfyUIConfig).mockResolvedValue({ imageBackend: 'comfyui' } as never);
    vi.mocked(getTagMapping).mockImplementation(async (_url, cat) => (cat === 'pose' ? poseMapping() : { categoryId: cat, tags: [] }));
    vi.mocked(getLoraTriggerWordsBatch).mockResolvedValue({ 'p1.safetensors': { success: true, triggerWords: ['tw1'], triggerLines: ['tw1, tw2'] } } as never);
    vi.mocked(saveTagMapping).mockResolvedValue(undefined);
    vi.mocked(saveTagCategories).mockResolvedValue(undefined);
    vi.mocked(setTagEnabled).mockResolvedValue(undefined);
});

const renderTab = async () => {
    render(<TagMappingTab backendUrl="http://backend" uiCatalog={null} active />);
    await waitFor(() => expect(screen.getByText('standing')).toBeTruthy());
};
const rowOf = (key: string) => screen.getByText(key).closest('tr') as HTMLElement;
// 行のチェック欄は ComfyUI・API・有効の順で、最後が有効の切り替え
const enabledOf = (key: string) => within(rowOf(key)).getAllByRole('checkbox').at(-1) as HTMLElement;

describe('素材づくりのタグのタブ', () => {
    it('分類の件数と、選んだ分類のタグの表とトリガーワードを出す', async () => {
        await renderTab();
        const poseButton = screen.getAllByText('体位・姿勢').map(el => el.closest('button')).find(Boolean) as HTMLElement;
        expect(within(poseButton).getByText('2件')).toBeTruthy();
        expect(await within(rowOf('立ち')).findByText('tw1, tw2')).toBeTruthy();
    });

    it('保存していない変更が無ければ、有効の切り替えをその場で送る', async () => {
        const user = userEvent.setup();
        await renderTab();
        await user.click(enabledOf('座り'));
        await waitFor(() => expect(setTagEnabled).toHaveBeenCalledWith('http://backend', 'pose', '座り', false));
        expect(saveTagMapping).not.toHaveBeenCalled();
    });

    it('編集して保存すると、有効の切り替えも含めて LoRA の空の行を除いて送る', async () => {
        const user = userEvent.setup();
        await renderTab();
        await user.click(screen.getByText('座り'));
        const keyInput = screen.getByDisplayValue('座り');
        await user.type(keyInput, 'こみ');
        await user.click(enabledOf('座りこみ'));
        expect(setTagEnabled).not.toHaveBeenCalled();
        await user.click(screen.getByRole('button', { name: /保存/ }));
        await waitFor(() => expect(saveTagMapping).toHaveBeenCalledTimes(1));
        const sent = vi.mocked(saveTagMapping).mock.calls[0][2];
        expect(sent.tags[1]).toMatchObject({ key: '座りこみ', enabled: false, lora: [] });
        expect(sent.tags[0].lora).toEqual([{ name: 'p1.safetensors', strengthModel: 1, strengthClip: 1 }]);
    });

    it('保存していない変更があるまま分類を移るときは確かめ、破棄すれば移る', async () => {
        const user = userEvent.setup();
        await renderTab();
        await user.click(screen.getByText('座り'));
        await user.type(screen.getByDisplayValue('座り'), 'x');
        await user.click(screen.getByText('表情'));
        expect(screen.getByText('保存していない変更があります')).toBeTruthy();
        await user.click(screen.getByText('破棄して移る'));
        await waitFor(() => expect(getTagMapping).toHaveBeenLastCalledWith('http://backend', 'emotion'));
        expect(saveTagMapping).not.toHaveBeenCalled();
    });

    it('分類の追加は ID を確かめ、正しければ分類の定義の末尾に足して保存する', async () => {
        const user = userEvent.setup();
        await renderTab();
        await user.click(screen.getByText('分類を追加'));
        await user.type(screen.getByLabelText('ID（半角英数字と _ -）'), '日本語');
        await user.click(screen.getByText('追加する'));
        expect(screen.getByText('ID は半角英数字と _ - で入力してください')).toBeTruthy();
        await user.clear(screen.getByLabelText('ID（半角英数字と _ -）'));
        await user.type(screen.getByLabelText('ID（半角英数字と _ -）'), 'pose');
        await user.click(screen.getByText('追加する'));
        expect(screen.getByText('その ID の分類は既にあります')).toBeTruthy();
        await user.clear(screen.getByLabelText('ID（半角英数字と _ -）'));
        await user.type(screen.getByLabelText('ID（半角英数字と _ -）'), 'weather');
        await user.type(screen.getByLabelText('名前'), '天気');
        await user.click(screen.getByText('追加する'));
        await waitFor(() => expect(saveTagCategories).toHaveBeenCalledWith('http://backend', {
            categories: [...CATEGORIES, { id: 'weather', label: '天気', loraPrefixes: [] }],
        }));
    });
});
