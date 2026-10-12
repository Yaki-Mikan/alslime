import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterTagInfo } from '../../../api/files';
import type { CharacterImageGenConfig } from '../../../api/comfyui';
import { getCharacterImageGenConfig, saveCharacterImageGenConfig } from '../../../api/comfyui';
import { applyLora } from './bulkLora';
import { BulkLoraModal } from './BulkLoraModal';

vi.mock('../../../api/comfyui', () => ({
    getCharacterImageGenConfig: vi.fn(),
    saveCharacterImageGenConfig: vi.fn(),
}));

const config = (over: Partial<CharacterImageGenConfig> = {}): CharacterImageGenConfig => ({
    characterName: '',
    workName: '',
    aliases: [],
    characterPrompt: '',
    physicalFeatures: '',
    lora: [],
    outfits: [],
    extraPositive: '',
    extraNegative: '',
    ...over,
});

const chara = (name: string): CharacterTagInfo => ({ name, dirName: `dir_${name}`, path: `p/${name}`, work: null, tags: [], iconUrl: null });

describe('LoRA の差し替え', () => {
    const current = config({
        characterPrompt: 'keep',
        lora: [
            { name: 'a', strengthModel: 0.5, strengthClip: 0.5, triggerWords: 'ta' },
            { name: '', strengthModel: 1, strengthClip: 1 },
        ],
    });

    it('置き換えるときは今の LoRA を外して1つにし、ほかの項目は残す', () => {
        const next = applyLora(current, 'b', 0.8, 'replace');
        expect(next.lora).toEqual([{ name: 'b', strengthModel: 0.8, strengthClip: 0.8 }]);
        expect(next.characterPrompt).toBe('keep');
    });

    it('足すときは空の行を除いて後ろに足し、同じ LoRA は強さだけ変える', () => {
        expect(applyLora(current, 'b', 0.8, 'append').lora.map(l => l.name)).toEqual(['a', 'b']);
        expect(applyLora(current, 'a', 0.9, 'append').lora).toEqual([
            { name: 'a', strengthModel: 0.9, strengthClip: 0.9, triggerWords: 'ta' },
        ]);
    });
});

describe('LoRA をまとめて設定する小窓', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const renderModal = (characters: CharacterTagInfo[], onApplied = vi.fn()) => {
        render(
            <BulkLoraModal
                open
                onClose={() => {}}
                backendUrl="http://backend"
                uiCatalog={null}
                characters={characters}
                availableLoras={['lora1', 'lora2']}
                onApplied={onApplied}
            />,
        );
        return onApplied;
    };

    it('1人ずつ読み出して LoRA だけを差し替えて保存し、失敗したキャラを一覧に出して残りは続ける', async () => {
        const user = userEvent.setup();
        vi.mocked(getCharacterImageGenConfig).mockImplementation(async (_url, dir) => {
            if (dir === 'dir_失敗') throw new Error('network');
            return dir === 'dir_既存' ? config({ characterName: '既存の名前', extraPositive: 'x' }) : config();
        });
        vi.mocked(saveCharacterImageGenConfig).mockResolvedValue(undefined);
        const onApplied = renderModal([chara('既存'), chara('失敗'), chara('新規')]);

        await user.selectOptions(screen.getByLabelText('LoRA'), 'lora2');
        await user.click(screen.getByText('3人に設定する'));

        await waitFor(() => expect(screen.getByText('2人に設定しました')).toBeTruthy());
        expect(saveCharacterImageGenConfig).toHaveBeenCalledTimes(2);
        const [, dir1, saved1] = vi.mocked(saveCharacterImageGenConfig).mock.calls[0];
        expect(dir1).toBe('dir_既存');
        expect(saved1).toMatchObject({ characterName: '既存の名前', extraPositive: 'x', lora: [{ name: 'lora2', strengthModel: 1, strengthClip: 1 }] });
        // 設定が無かったキャラはキャラ名を入れて新しく作る
        const [, dir2, saved2] = vi.mocked(saveCharacterImageGenConfig).mock.calls[1];
        expect(dir2).toBe('dir_新規');
        expect(saved2.characterName).toBe('新規');
        expect(screen.getByText('設定できなかったキャラ')).toBeTruthy();
        expect(screen.getByText('失敗')).toBeTruthy();
        expect(onApplied).toHaveBeenCalledTimes(1);
    });

    it('中止すると次のキャラへ進まない', async () => {
        const user = userEvent.setup();
        let release: () => void = () => {};
        vi.mocked(getCharacterImageGenConfig).mockImplementation(() => new Promise(res => { release = () => res(config()); }));
        vi.mocked(saveCharacterImageGenConfig).mockResolvedValue(undefined);
        renderModal([chara('一'), chara('二'), chara('三')]);

        await user.selectOptions(screen.getByLabelText('LoRA'), 'lora1');
        await user.click(screen.getByText('3人に設定する'));
        await user.click(screen.getByText('中止'));
        release();

        await waitFor(() => expect(screen.getByText('一括設定を中止しました。中止前に完了したキャラクターの設定は保存されています。')).toBeTruthy());
        expect(getCharacterImageGenConfig).toHaveBeenCalledTimes(1);
        expect(saveCharacterImageGenConfig).toHaveBeenCalledTimes(1);
    });
});
