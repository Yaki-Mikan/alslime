import type React from 'react';
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterTagInfo } from '../../api/files';
import type { MaterialStatusResult } from '../../hooks/useMaterialStatus';
import { useMaterialStatus } from '../../hooks/useMaterialStatus';
import { fetchCharacterImageConfigSummary, fetchCharacterVoiceSummary, fetchMaterialImageStatus } from '../../api/material';
import { CharacterListPane } from './CharacterListPane';
import axios from '../../lib/axios';
import { notifyConfigFilesChanged } from '../../lib/configFilesChanged';

vi.mock('../../lib/axios', () => ({
    default: {
        get: vi.fn().mockResolvedValue({ data: { characters: [
            { name: 'いろは', dirName: 'いろは', path: 'p/いろは', work: '作品A', tags: [], iconUrl: null },
            { name: '猫', dirName: '猫', path: 'p/猫', work: null, tags: [], iconUrl: null },
        ] } }),
    },
}));

vi.mock('../../api/material', () => ({
    fetchMaterialImageStatus: vi.fn(),
    fetchCharacterImageConfigSummary: vi.fn(),
    fetchCharacterVoiceSummary: vi.fn(),
}));

const chara = (name: string, work: string | null): CharacterTagInfo => ({ name, dirName: name, path: `p/${name}`, work, tags: [], iconUrl: null });

const CHARACTERS = [chara('いろは', '作品A'), chara('しずく', '作品A'), chara('猫', null), chara('雪', '作品B')];

const status = (over: Partial<MaterialStatusResult> = {}): MaterialStatusResult => ({
    characters: CHARACTERS,
    loading: false,
    states: {
        いろは: { image: 'ok', faces: 'ok', voice: 'ok' },
        しずく: { image: 'none', faces: 'partial', voice: 'none', faceCount: { done: 3, total: 8 } },
        猫: { image: 'unknown', faces: 'none', voice: 'unknown' },
        雪: { image: 'partial', faces: 'ok', voice: 'ok' },
    },
    known: { image: true, faces: true, voice: true },
    reload: vi.fn(),
    ...over,
});

const onSelect = vi.fn();

const pane = (props: Partial<React.ComponentProps<typeof CharacterListPane>> = {}) => (
    <CharacterListPane
        uiCatalog={null}
        status={status()}
        showImage
        showVoice
        sessionCharacterPaths={[]}
        selectedDirName={null}
        onSelect={onSelect}
        {...props}
    />
);

const allSection = () => screen.getByText('すべて').closest('section') as HTMLElement;
// 行の名前の欄だけを読む（アイコンが無いときの頭文字や作品名を含めない）
const namesIn = (el: HTMLElement) => within(el).queryAllByRole('button').map(b => b.querySelector('.text-sm')?.textContent ?? '');

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
});

describe('素材づくりのキャラ一覧', () => {
    it('すべての段に件数（表示数／全体数）を出し、名前・作品・状態で絞り込む', async () => {
        const user = userEvent.setup();
        render(pane());
        expect(within(allSection()).getByText('4 / 4')).toBeTruthy();

        await user.type(screen.getByPlaceholderText('名前で探す'), 'し');
        expect(namesIn(allSection())).toEqual(['しずく']);
        await user.clear(screen.getByPlaceholderText('名前で探す'));

        await user.selectOptions(screen.getByLabelText('すべての作品'), '作品A');
        expect(namesIn(allSection())).toEqual(['いろは', 'しずく']);
        await user.selectOptions(screen.getByLabelText('すべての作品'), '__none__');
        expect(namesIn(allSection())).toEqual(['猫']);
        await user.selectOptions(screen.getByLabelText('すべての作品'), '');

        await user.selectOptions(screen.getByLabelText('すべての状態'), 'missingFaces');
        expect(namesIn(allSection())).toEqual(['しずく', '猫']);
        await user.selectOptions(screen.getByLabelText('すべての状態'), 'noVoice');
        expect(namesIn(allSection())).toEqual(['しずく']);
        expect(within(allSection()).getByText('1 / 4')).toBeTruthy();
    });

    it('画像設定・声を出さないときは、その点と状態の絞り込みを出さない', () => {
        render(pane({ showImage: false, showVoice: false }));
        const options = Array.from((screen.getByLabelText('すべての状態') as HTMLSelectElement).options).map(o => o.value);
        expect(options).toEqual(['', 'missingFaces']);
        expect(screen.queryAllByLabelText(/^画像設定：/)).toHaveLength(0);
        expect(screen.queryAllByLabelText(/^声：/)).toHaveLength(0);
    });

    it('状態の点に中身を添え、読めない状態は「不明」にする', () => {
        render(pane());
        expect(screen.getByLabelText('表情画像：3/8')).toBeTruthy();
        expect(screen.getAllByLabelText('画像設定：未取得（キャラクターを選択すると状態を確認します）')).toHaveLength(1);
        expect(screen.getAllByLabelText('声：未取得（キャラクターを選択すると状態を確認します）')).toHaveLength(1);
    });

    it('この会話のキャラクターと、選択したキャラクターを最近編集したキャラクターの段に出す', async () => {
        const user = userEvent.setup();
        render(pane({ sessionCharacterPaths: ['p/雪', 'p/いない'] }));
        const session = screen.getByText('この会話のキャラ').closest('section') as HTMLElement;
        expect(namesIn(session)).toEqual(['雪']);
        expect(screen.queryByText('最近編集したキャラクター')).toBeNull();

        const neko = within(allSection()).getAllByRole('button').find(b => b.querySelector('.text-sm')?.textContent === '猫');
        await user.click(neko!);
        expect(onSelect).toHaveBeenCalledWith(CHARACTERS[2]);
        const recent = screen.getByText('最近編集したキャラクター').closest('section') as HTMLElement;
        expect(namesIn(recent)).toEqual(['猫']);
        expect(JSON.parse(localStorage.getItem('alslime.material.recent') ?? '[]')).toEqual(['猫']);
    });

    it('一括操作を渡すと複数を選べ、選んだ人数と操作を出す', async () => {
        const user = userEvent.setup();
        const bulk = vi.fn((selected: CharacterTagInfo[]) => <span>操作:{selected.map(c => c.name).join(',')}</span>);
        render(pane({ bulkActions: bulk }));
        await user.click(screen.getByLabelText('複数選ぶ'));
        await user.click(within(allSection()).getByLabelText('いろは'));
        await user.click(within(allSection()).getByLabelText('雪'));
        expect(screen.getByText('2人を選択中')).toBeTruthy();
        expect(screen.getByText('操作:いろは,雪')).toBeTruthy();
        expect(onSelect).not.toHaveBeenCalled();

        await user.click(screen.getByText('選択を解除'));
        expect(screen.queryByText('2人を選択中')).toBeNull();
    });

    it('2,000人でも全件を描く', () => {
        const many = Array.from({ length: 2000 }, (_, i) => chara(`キャラ${i}`, `作品${i % 40}`));
        render(pane({ status: status({ characters: many, states: {} }) }));
        expect(within(allSection()).getByText('2000 / 2000')).toBeTruthy();
    });

    it('一つのフォルダに設定ファイルが複数あっても行を取り違えず、絞り込むと合う行だけが残る', async () => {
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        const user = userEvent.setup();
        const inShared = (name: string): CharacterTagInfo => ({ name, dirName: '共有', path: `p/共有/${name}`, work: null, tags: [], iconUrl: null });
        render(pane({ status: status({ characters: [inShared('あかね'), inShared('あおい'), inShared('みどり')], states: {} }) }));
        expect(namesIn(allSection())).toEqual(['あかね', 'あおい', 'みどり']);

        await user.type(screen.getByPlaceholderText('名前で探す'), 'みど');
        expect(namesIn(allSection())).toEqual(['みどり']);
        // 行の見分けが重なると、React が同じ見分けの行があるという警告を出す
        expect(errors.mock.calls.some(args => String(args[0]).includes('same key'))).toBe(false);
        errors.mockRestore();
    });
});

describe('キャラ一覧の状態の読み込み', () => {
    it('集計が読めない（古いモジュールなど）ときは不明にし、読めた分だけ状態を決める', async () => {
        vi.mocked(fetchMaterialImageStatus).mockResolvedValue({ enabledEmotions: 4, characters: [{ dirName: 'いろは', originals: 4, icons: 4 }] });
        vi.mocked(fetchCharacterImageConfigSummary).mockResolvedValue(null);
        vi.mocked(fetchCharacterVoiceSummary).mockResolvedValue([{ dirName: '猫', voiceId: 'neko', readEnabled: true }]);

        const { result } = renderHook(() => useMaterialStatus('http://backend', { imageGenEnabled: true, ttsEnabled: true }));
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.known).toEqual({ image: false, faces: true, voice: true });
        expect(result.current.states['いろは']).toMatchObject({ image: 'unknown', faces: 'ok', voice: 'none' });
        expect(result.current.states['猫']).toMatchObject({ image: 'unknown', faces: 'none', voice: 'ok', voiceId: 'neko' });
    });

    it('設定ファイルが変わった知らせで、キャラ一覧を読み直す（ページを読み直さなくても作ったキャラが出る）', async () => {
        vi.mocked(fetchMaterialImageStatus).mockResolvedValue(null);
        const { result } = renderHook(() => useMaterialStatus('http://backend', { imageGenEnabled: false, ttsEnabled: false }));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.characters.map(c => c.name)).toEqual(['いろは', '猫']);

        vi.mocked(axios.get).mockResolvedValueOnce({ data: { characters: [
            { name: 'いろは', dirName: 'いろは', path: 'p/いろは', work: '作品A', tags: [], iconUrl: null },
            { name: '猫', dirName: '猫', path: 'p/猫', work: null, tags: [], iconUrl: null },
            { name: '雪', dirName: '雪', path: 'p/雪', work: '作品B', tags: [], iconUrl: null },
        ] } });
        act(() => notifyConfigFilesChanged());
        await waitFor(() => expect(result.current.characters.map(c => c.name)).toEqual(['いろは', '猫', '雪']));
    });

    it('画像生成・読み上げが使えないときはモジュールの集計を呼ばない', async () => {
        vi.mocked(fetchMaterialImageStatus).mockResolvedValue(null);
        const { result } = renderHook(() => useMaterialStatus('http://backend', { imageGenEnabled: false, ttsEnabled: false }));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(fetchCharacterImageConfigSummary).not.toHaveBeenCalled();
        expect(fetchCharacterVoiceSummary).not.toHaveBeenCalled();
        expect(result.current.characters).toHaveLength(2);
    });
});
