import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    addUserReferenceImage,
    deleteUserReferenceImage,
    getApiServiceUserAppearance,
    saveApiServiceUserAppearance,
    type ReferenceImage,
    type UserAppearance,
} from '../../../api/comfyui';
import { COMMON } from '../constants';
import { UserAppearanceSection } from './UserAppearanceSection';

vi.mock('../../../api/comfyui', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../api/comfyui')>()),
    getApiServiceUserAppearance: vi.fn(),
    saveApiServiceUserAppearance: vi.fn(),
    addUserReferenceImage: vi.fn(),
    deleteUserReferenceImage: vi.fn(),
    resolveAuthedUrl: vi.fn(async () => 'blob:thumb'),
    forgetAuthedUrl: vi.fn(),
}));

const refA: ReferenceImage = { id: 'ref-a', file: 'api_reference/user/ref-a.png', kind: 'character', strength: 0.6, fidelity: 0.5 };
const refB: ReferenceImage = { id: 'ref-b', file: 'api_reference/user/ref-b.png', kind: 'character', strength: 0.6, fidelity: 0.5 };

const baseAppearance = (refs: ReferenceImage[]): UserAppearance => ({
    names: [],
    characterPrompt: '',
    physicalFeatures: '',
    outfits: [],
    extraPositive: '',
    extraNegative: '',
    referenceImages: refs,
});

// 受け取った設定で丸ごと置き換える保存先（画面側の順序制御だけで守れているかを見るため）。
let stored: UserAppearance;
let callOrder: string[];

interface Deferred {
    promise: Promise<void>;
    resolve: () => void;
    reject: (e: unknown) => void;
}

const deferred = (): Deferred => {
    let resolve!: () => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
};

const renderSection = async () => {
    const view = render(
        <UserAppearanceSection backendUrl="http://backend" service="novelai" active referenceDisabledNote="" />,
    );
    await waitFor(() => expect(getApiServiceUserAppearance).toHaveBeenCalled());
    await waitFor(() => expect(view.container.querySelector('input[type="file"]')).not.toBeNull());
    return view;
};

const removeButton = (container: HTMLElement): HTMLButtonElement => {
    const button = container.querySelector('svg.lucide-trash-2')?.closest('button');
    if (!button) throw new Error('remove button not found');
    return button as HTMLButtonElement;
};

const strengthSlider = (): HTMLInputElement => screen.getAllByRole('slider')[0] as HTMLInputElement;

describe('UserAppearanceSection の保存と参照画像操作の順序', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        callOrder = [];
        stored = baseAppearance([refA]);
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        vi.mocked(getApiServiceUserAppearance).mockImplementation(async () => structuredClone(stored));
        vi.mocked(saveApiServiceUserAppearance).mockImplementation(async (_url, appearance) => {
            callOrder.push('save');
            stored = structuredClone(appearance);
            return structuredClone(stored);
        });
        vi.mocked(deleteUserReferenceImage).mockImplementation(async (_url, _service, id) => {
            callOrder.push('delete');
            stored = { ...stored, referenceImages: (stored.referenceImages ?? []).filter((ref) => ref.id !== id) };
        });
        vi.mocked(addUserReferenceImage).mockImplementation(async () => {
            callOrder.push('add');
            stored = { ...stored, referenceImages: [...(stored.referenceImages ?? []), refB] };
            return structuredClone(refB);
        });
    });

    it('強さ変更の保存が終わる前に削除しても、削除した登録が戻らない', async () => {
        const gate = deferred();
        vi.mocked(saveApiServiceUserAppearance).mockImplementationOnce(async (_url, appearance) => {
            callOrder.push('save-start');
            await gate.promise;
            callOrder.push('save-end');
            stored = structuredClone(appearance);
            return structuredClone(stored);
        });
        const { container } = await renderSection();

        fireEvent.change(strengthSlider(), { target: { value: '0.9' } });
        await waitFor(() => expect(callOrder).toContain('save-start'));
        await userEvent.click(removeButton(container));
        // 保存が終わるまで削除は送られない。
        expect(deleteUserReferenceImage).not.toHaveBeenCalled();

        gate.resolve();
        await waitFor(() => expect(deleteUserReferenceImage).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(screen.queryAllByRole('slider')).toHaveLength(0));
        expect(callOrder).toEqual(['save-start', 'save-end', 'delete']);
        expect(stored.referenceImages).toHaveLength(0);
    });

    it('保存が終わる前に追加しても、古い保存で新しい登録が消えない', async () => {
        const gate = deferred();
        vi.mocked(saveApiServiceUserAppearance).mockImplementationOnce(async (_url, appearance) => {
            callOrder.push('save-start');
            await gate.promise;
            callOrder.push('save-end');
            stored = structuredClone(appearance);
            return structuredClone(stored);
        });
        const { container } = await renderSection();

        fireEvent.change(strengthSlider(), { target: { value: '0.9' } });
        await waitFor(() => expect(callOrder).toContain('save-start'));
        const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
        await userEvent.upload(fileInput, new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'b.png', { type: 'image/png' }));
        expect(addUserReferenceImage).not.toHaveBeenCalled();

        gate.resolve();
        await waitFor(() => expect(screen.getAllByRole('slider')).toHaveLength(4));
        expect(callOrder).toEqual(['save-start', 'save-end', 'add']);
        expect((stored.referenceImages ?? []).map((ref) => ref.id)).toEqual(['ref-a', 'ref-b']);
        expect(stored.referenceImages?.[0].strength).toBe(0.9);
    });

    it('保存待ち中の編集は参照画像の操作後も残り、欄を離れたときに保存される', async () => {
        const gate = deferred();
        vi.mocked(saveApiServiceUserAppearance).mockImplementationOnce(async (_url, appearance) => {
            callOrder.push('save-start');
            await gate.promise;
            stored = structuredClone(appearance);
            return structuredClone(stored);
        });
        const { container } = await renderSection();

        fireEvent.change(strengthSlider(), { target: { value: '0.9' } });
        await waitFor(() => expect(callOrder).toContain('save-start'));
        const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
        fireEvent.change(textarea, { target: { value: 'short hair, glasses' } });
        await userEvent.click(removeButton(container));

        gate.resolve();
        await waitFor(() => expect(deleteUserReferenceImage).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(screen.queryAllByRole('slider')).toHaveLength(0));
        expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('short hair, glasses');

        fireEvent.blur(container.querySelector('textarea') as HTMLTextAreaElement);
        await waitFor(() => expect(JSON.stringify(stored)).toContain('short hair, glasses'));
        expect(stored.referenceImages).toHaveLength(0);
    });

    it('先行の保存か削除が失敗したら、一覧を変えずに失敗を表示する', async () => {
        vi.mocked(saveApiServiceUserAppearance).mockRejectedValueOnce(new Error('save failed'));
        const { container } = await renderSection();

        fireEvent.change(strengthSlider(), { target: { value: '0.9' } });
        await waitFor(() => expect(screen.getByText(COMMON.MESSAGES.SAVE_FAILED)).toBeTruthy());
        // 未保存のまま削除すると、先に保存をやり直す。それも失敗したら削除は送らない。
        vi.mocked(saveApiServiceUserAppearance).mockRejectedValueOnce(new Error('save failed again'));
        await userEvent.click(removeButton(container));
        await waitFor(() => expect(saveApiServiceUserAppearance).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(removeButton(container).disabled).toBe(false));
        expect(deleteUserReferenceImage).not.toHaveBeenCalled();
        expect(screen.getAllByRole('slider')).toHaveLength(2);
        expect(screen.getByText(COMMON.MESSAGES.SAVE_FAILED)).toBeTruthy();

        // 保存は通るが削除が失敗する場合も、一覧に残して失敗を表示する。
        vi.mocked(deleteUserReferenceImage).mockRejectedValueOnce(new Error('delete failed'));
        await userEvent.click(removeButton(container));
        await waitFor(() => expect(deleteUserReferenceImage).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(removeButton(container).disabled).toBe(false));
        expect(screen.getAllByRole('slider')).toHaveLength(2);
        expect(screen.getByText(COMMON.MESSAGES.SAVE_FAILED)).toBeTruthy();
        expect(stored.referenceImages).toHaveLength(1);
    });
});
