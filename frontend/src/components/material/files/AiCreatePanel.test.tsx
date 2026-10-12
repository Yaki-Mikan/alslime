import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    listConfigGenTemplates,
    getConfigGenTemplate,
    getConfigGenTemplateDefaults,
    getCategories,
    getConfigFile,
    saveConfigGenTemplate,
} from '../../../api/config-editor';
import { getCLIStatus, getResearchMemo, listResearchMemos, type ConfigGenResultFile } from '../../../api/config-gen';
import { useConfigGenJob } from '../../../hooks/useConfigGenJob';
import { getGlobalSettings } from '../../../api/global-settings';
import type { I18NCatalog } from '../../../api/i18n';
import { AiCreatePanel } from './AiCreatePanel';

vi.mock('../../../lib/axios', () => ({
    default: { get: vi.fn().mockResolvedValue({ data: { models: [] } }), post: vi.fn().mockResolvedValue({ data: {} }) },
}));

// CodeMirror は jsdom で座標計算に失敗するため textarea へ差し替える。
vi.mock('../../common/CodeEditor', () => ({
    CodeEditor: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
        <textarea data-testid="code-editor" value={value} onChange={e => onChange(e.target.value)} />
    ),
}));

vi.mock('../../../hooks/useConfigGenJob', () => ({ useConfigGenJob: vi.fn() }));
vi.mock('../../SSRP/RolePlaySettings', () => ({ invalidateSSRPOptionsCache: vi.fn() }));

vi.mock('../../../api/config-editor', async importOriginal => {
    const actual = await importOriginal<typeof import('../../../api/config-editor')>();
    return {
        ...actual,
        getCategories: vi.fn(),
        getConfigFile: vi.fn(),
        checkConfigFileExists: vi.fn().mockResolvedValue(false),
        saveConfigFile: vi.fn().mockResolvedValue(undefined),
        getConfigGenInstruction: vi.fn().mockResolvedValue(''),
        saveConfigGenInstruction: vi.fn().mockResolvedValue(undefined),
        listConfigGenTemplates: vi.fn(),
        getConfigGenTemplate: vi.fn(),
        saveConfigGenTemplate: vi.fn().mockResolvedValue(undefined),
        getConfigGenTemplateDefaults: vi.fn(),
    };
});

vi.mock('../../../api/config-gen', async importOriginal => {
    const actual = await importOriginal<typeof import('../../../api/config-gen')>();
    return {
        ...actual,
        getCLIStatus: vi.fn(),
        listResearchMemos: vi.fn(),
        getResearchMemo: vi.fn(),
        saveResearchMemo: vi.fn(),
        deleteResearchMemo: vi.fn(),
    };
});

vi.mock('../../../api/global-settings', () => ({
    getGlobalSettings: vi.fn(),
    updateGlobalSettings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../api/user-models', () => ({ pingModel: vi.fn() }));

const startMock = vi.fn().mockResolvedValue({ ok: true });

// 項目と設定ファイルで既定名を変え、日本語名と差別言語名も対応しない値にして「名前を変換しない」ことを確かめる。
const TEMPLATE_LISTS: Record<string, string[]> = {
    'character:ja:search': ['標準', '詳細'],
    'character:ja:setting': ['標準', '軽量'],
    'character:en:search': ['standard', 'detailed'],
    'character:en:setting': ['standard', 'lite'],
    'situation:ja:search': ['標準'],
    'situation:ja:setting': ['標準'],
    'situation:en:search': ['standard'],
    'situation:en:setting': ['standard'],
};

const DEFAULTS = {
    ja: {
        character: { search: '標準', setting: '軽量' },
        situation: { search: '標準', setting: '標準' },
    },
    en: {
        character: { search: 'detailed', setting: 'standard' },
        situation: { search: 'standard', setting: 'standard' },
    },
};

const JA: I18NCatalog | null = null; // 辞書なし → 日本語の控え
const EN = { lang: 'en', messages: {} } as unknown as I18NCatalog;

const onOpenInEditor = vi.fn();

const panel = (uiCatalog: I18NCatalog | null, active = true) => (
    <AiCreatePanel active={active} backendUrl="http://backend" uiCatalog={uiCatalog} onClose={() => {}} onOpenInEditor={onOpenInEditor} />
);

const codeEditor = () => screen.getByTestId('code-editor') as HTMLTextAreaElement;

// 見出しの文言の隣にある select / input を取る
const selectAfterLabel = (labelText: string): HTMLSelectElement => screen.getByText(labelText).parentElement!.querySelector('select')!;
const inputAfterLabel = (labelText: string): HTMLInputElement => screen.getByText(labelText).parentElement!.querySelector('input')!;
const textareaAfterLabel = (labelText: string): HTMLTextAreaElement => screen.getByText(labelText).parentElement!.querySelector('textarea')!;
// 見出しの文言の隣にある「開いて編集」のボタンを取る
const editButtonAfterLabel = (labelText: string): HTMLButtonElement => screen.getByText(labelText).parentElement!.querySelector('button')!;
const currentStep = () => document.querySelector('[aria-current="step"]')?.textContent ?? '';

beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    vi.mocked(getCategories).mockResolvedValue([
        { id: 'character', label: 'キャラクター', isCharacter: true },
        { id: 'situation', label: 'シチュエーション', isCharacter: false },
    ]);
    vi.mocked(listConfigGenTemplates).mockImplementation((_url, cat, locale, kind) =>
        Promise.resolve(TEMPLATE_LISTS[`${cat}:${locale}:${kind}`] ?? []));
    vi.mocked(getConfigGenTemplate).mockImplementation((_url, _cat, locale, _kind, name) =>
        Promise.resolve(`${locale}:${name}:本文`));
    vi.mocked(getConfigGenTemplateDefaults).mockResolvedValue(structuredClone(DEFAULTS));
    vi.mocked(getCLIStatus).mockResolvedValue([]);
    vi.mocked(listResearchMemos).mockResolvedValue([]);
    vi.mocked(getResearchMemo).mockResolvedValue({ exists: false } as never);
    vi.mocked(getGlobalSettings).mockResolvedValue({ configGen: {} } as never);
    startMock.mockReset();
    startMock.mockResolvedValue({ ok: true });
    vi.mocked(useConfigGenJob).mockReturnValue({
        state: { running: false, progress: [], elapsedSeconds: 0, finishedStatus: null, errorKey: null },
        start: startMock,
        attachJob: vi.fn(),
        attach: vi.fn().mockResolvedValue(undefined),
        cancel: vi.fn(),
    } as never);
});

describe('AI で作る：UI の言語を切り替えたときの読み直し', () => {
    it('日本語で初めて出すと日本語側の一覧と保存された既定名を選ぶ', async () => {
        render(panel(JA));
        await waitFor(() => expect(selectAfterLabel('項目のテンプレート').value).toBe('標準'));
        expect(selectAfterLabel('使うテンプレート').value).toBe('軽量');
        expect(listConfigGenTemplates).toHaveBeenCalledWith('http://backend', 'character', 'ja', 'search');
    });

    it('隠して差別言語へ切り替えて出し直すと差別言語側を取り直し、既定名を名前変換せずそれぞれ選ぶ', async () => {
        const { rerender } = render(panel(JA));
        await waitFor(() => expect(selectAfterLabel('項目のテンプレート').value).toBe('標準'));

        rerender(panel(JA, false));
        rerender(panel(EN));

        await waitFor(() => expect(selectAfterLabel('項目のテンプレート').value).toBe('detailed'));
        expect(selectAfterLabel('使うテンプレート').value).toBe('standard');
        expect(listConfigGenTemplates).toHaveBeenCalledWith('http://backend', 'character', 'en', 'search');
    });

    it('出したまま差別言語へ切り替えると差別言語側を、日本語へ戻すと日本語側を取り直す', async () => {
        const { rerender } = render(panel(JA));
        await waitFor(() => expect(selectAfterLabel('項目のテンプレート').value).toBe('標準'));

        rerender(panel(EN));
        await waitFor(() => expect(selectAfterLabel('項目のテンプレート').value).toBe('detailed'));

        rerender(panel(JA));
        await waitFor(() => expect(selectAfterLabel('項目のテンプレート').value).toBe('標準'));
        expect(selectAfterLabel('使うテンプレート').value).toBe('軽量');
    });

    it('項目の小窓は、開いたときの言語のテンプレートの本文を出す', async () => {
        const user = userEvent.setup();
        const { rerender } = render(panel(JA));
        await waitFor(() => expect(selectAfterLabel('項目のテンプレート').value).toBe('標準'));
        await user.click(editButtonAfterLabel('項目のテンプレート'));
        await waitFor(() => expect(codeEditor().value).toBe('ja:標準:本文'));
        await user.click(screen.getAllByRole('button', { name: 'キャンセル' })[0]);

        rerender(panel(EN));
        await waitFor(() => expect(selectAfterLabel('項目のテンプレート').value).toBe('detailed'));
        await user.click(editButtonAfterLabel('項目のテンプレート'));
        await waitFor(() => expect(codeEditor().value).toBe('en:detailed:本文'));
    });

    it('遅れて返った古い言語の応答は、最後の言語の状態を上書きしない', async () => {
        let resolveJa: (names: string[]) => void = () => {};
        vi.mocked(listConfigGenTemplates).mockImplementation((_url, cat, locale, kind) => {
            if (locale === 'ja' && kind === 'search') {
                return new Promise<string[]>(res => { resolveJa = res; });
            }
            return Promise.resolve(TEMPLATE_LISTS[`${cat}:${locale}:${kind}`] ?? []);
        });

        const { rerender } = render(panel(JA));
        await waitFor(() => expect(listConfigGenTemplates).toHaveBeenCalledWith('http://backend', 'character', 'ja', 'search'));

        rerender(panel(EN));
        await waitFor(() => expect(selectAfterLabel('項目のテンプレート').value).toBe('detailed'));

        resolveJa(['標準', '詳細']);
        await new Promise(res => setTimeout(res, 20));
        expect(selectAfterLabel('項目のテンプレート').value).toBe('detailed');
    });

    it('読み込みに失敗した条件は読み込み済みとせず、隠して出し直すと読み直す', async () => {
        vi.mocked(listConfigGenTemplates).mockRejectedValue(new Error('network'));

        const { rerender } = render(panel(JA));
        await waitFor(() => expect(screen.getByText('テンプレート情報の読み込みに失敗しました')).toBeTruthy());
        expect(selectAfterLabel('項目のテンプレート').value).toBe('');

        vi.mocked(listConfigGenTemplates).mockImplementation((_url, cat, locale, kind) =>
            Promise.resolve(TEMPLATE_LISTS[`${cat}:${locale}:${kind}`] ?? []));
        rerender(panel(JA, false));
        rerender(panel(JA));

        await waitFor(() => expect(selectAfterLabel('項目のテンプレート').value).toBe('標準'));
    });

    it('実行の要求の locale・searchTemplate・settingTemplate が画面の最後の選択と一致する', async () => {
        const user = userEvent.setup();
        const { rerender } = render(panel(JA));
        await waitFor(() => expect(selectAfterLabel('項目のテンプレート').value).toBe('標準'));

        rerender(panel(EN));
        await waitFor(() => expect(selectAfterLabel('項目のテンプレート').value).toBe('detailed'));

        await user.type(inputAfterLabel('名前'), '雪');
        await user.type(inputAfterLabel('作品名'), 'テスト作品');
        await user.click(screen.getByText('調べ始める'));

        await waitFor(() => expect(startMock).toHaveBeenCalled());
        const req = startMock.mock.calls[0][0];
        expect(req.locale).toBe('en');
        expect(req.searchTemplate).toBe('detailed');
        expect(req.settingTemplate).toBe('standard');
    });
});

describe('AI で作る：手順の進み方', () => {
    it('2段階で作るは調べ始めると「調べる」の段へ進み、1段階目を要求する', async () => {
        const user = userEvent.setup();
        render(panel(JA));
        await waitFor(() => expect(selectAfterLabel('項目のテンプレート').value).toBe('標準'));
        expect(currentStep()).toContain('条件');

        await user.type(inputAfterLabel('名前'), '雪');
        await user.type(inputAfterLabel('作品名'), 'テスト作品');
        await user.click(screen.getByText('調べ始める'));

        await waitFor(() => expect(currentStep()).toContain('調べる'));
        const req = startMock.mock.calls[0][0];
        expect(req.method).toBe('two_step');
        expect(req.step).toBe(1);
        expect(req.editorContent).toBeUndefined();
    });

    it('1段階目で失敗すると、設定を作る代わりに再実行を出し、押すと1段階目をもう一度要求する', async () => {
        const user = userEvent.setup();
        const { rerender } = render(panel(JA));
        await waitFor(() => expect(selectAfterLabel('項目のテンプレート').value).toBe('標準'));
        await user.type(inputAfterLabel('名前'), '雪');
        await user.type(inputAfterLabel('作品名'), 'テスト作品');
        await user.click(screen.getByText('調べ始める'));
        await waitFor(() => expect(currentStep()).toContain('調べる'));

        // ジョブが失敗で終わった状態にする
        vi.mocked(useConfigGenJob).mockReturnValue({
            state: { running: false, progress: [], elapsedSeconds: 0, finishedStatus: 'failed', errorKey: null },
            start: startMock,
            attachJob: vi.fn(),
            attach: vi.fn().mockResolvedValue(undefined),
            cancel: vi.fn(),
        } as never);
        rerender(panel(JA));

        expect(screen.queryByRole('button', { name: '設定を作る' })).toBeNull();
        await user.click(screen.getByRole('button', { name: /同じ条件で再実行/ }));
        await waitFor(() => expect(startMock).toHaveBeenCalledTimes(2));
        const req = startMock.mock.calls[1][0];
        expect(req.step).toBe(1);
        expect(req.characterName).toBe('雪');
        expect(currentStep()).toContain('調べる');
    });

    it('項目の小窓で保存すると、選んでいるテンプレートへ保存して閉じる', async () => {
        const user = userEvent.setup();
        render(panel(JA));
        await waitFor(() => expect(selectAfterLabel('項目のテンプレート').value).toBe('標準'));
        await user.click(editButtonAfterLabel('項目のテンプレート'));
        await waitFor(() => expect(codeEditor().value).toBe('ja:標準:本文'));
        await user.type(codeEditor(), '追記');
        await user.click(screen.getByRole('button', { name: '保存' }));

        await waitFor(() => expect(saveConfigGenTemplate).toHaveBeenCalledWith('http://backend', 'character', 'ja', 'search', '標準', 'ja:標準:本文追記'));
        await waitFor(() => expect(screen.queryByTestId('code-editor')).toBeNull());
    });

    it('項目の小窓でキャンセルすると、直した内容を保存せずに閉じる', async () => {
        const user = userEvent.setup();
        render(panel(JA));
        await waitFor(() => expect(selectAfterLabel('項目のテンプレート').value).toBe('標準'));
        await user.click(editButtonAfterLabel('項目のテンプレート'));
        await waitFor(() => expect(codeEditor().value).toBe('ja:標準:本文'));
        await user.type(codeEditor(), '追記');
        await user.click(screen.getAllByRole('button', { name: 'キャンセル' })[0]);

        expect(screen.queryByTestId('code-editor')).toBeNull();
        expect(saveConfigGenTemplate).not.toHaveBeenCalled();
    });

    it('使うテンプレートの小窓で保存すると、選んでいる設定のテンプレートへ保存する', async () => {
        const user = userEvent.setup();
        render(panel(JA));
        await waitFor(() => expect(selectAfterLabel('使うテンプレート').value).toBe('軽量'));
        await user.click(editButtonAfterLabel('使うテンプレート'));
        await waitFor(() => expect(codeEditor().value).toBe('ja:軽量:本文'));
        await user.type(codeEditor(), '追記');
        await user.click(screen.getByRole('button', { name: '保存' }));

        await waitFor(() => expect(saveConfigGenTemplate).toHaveBeenCalledWith('http://backend', 'character', 'ja', 'setting', '軽量', 'ja:軽量:本文追記'));
    });

    it('テンプレートの小窓は、外を押しても閉じない', async () => {
        const user = userEvent.setup();
        render(panel(JA));
        await waitFor(() => expect(selectAfterLabel('項目のテンプレート').value).toBe('標準'));
        await user.click(editButtonAfterLabel('項目のテンプレート'));
        await waitFor(() => expect(codeEditor().value).toBe('ja:標準:本文'));

        fireEvent.mouseDown(screen.getByRole('dialog').parentElement!);
        expect(screen.getByTestId('code-editor')).toBeTruthy();
    });

    it('調べる段階で直した設定作成備考を、2段階目へ送る', async () => {
        const user = userEvent.setup();
        const research: ConfigGenResultFile = { kind: 'research', categoryId: 'character', dirName: '雪', fileName: '雪_設定作成前メモ', relPath: '' };
        startMock.mockImplementationOnce(async (_req, onComplete: (r: ConfigGenResultFile) => void) => {
            setTimeout(() => onComplete(research), 0);
            return { ok: true };
        });
        // 調べ始める前の上書きの確かめでは「まだ無い」、1段階目が終わった後の読み込みでは「ある」と返す
        vi.mocked(getResearchMemo)
            .mockResolvedValueOnce({ exists: false } as never)
            .mockResolvedValue({ exists: true, content: 'メモ本文', workTitle: 'テスト作品' } as never);
        render(panel(JA));
        await waitFor(() => expect(selectAfterLabel('項目のテンプレート').value).toBe('標準'));

        await user.type(inputAfterLabel('名前'), '雪');
        await user.type(inputAfterLabel('作品名'), 'テスト作品');
        await user.type(textareaAfterLabel('備考'), '原作の後日談として');
        await user.click(screen.getByText('調べ始める'));

        // 1段階目で書いた備考が入った状態で出る
        await waitFor(() => expect(textareaAfterLabel('設定作成備考').value).toBe('原作の後日談として'));
        await user.clear(textareaAfterLabel('設定作成備考'));
        await user.type(textareaAfterLabel('設定作成備考'), '口調をやわらかく');
        await user.click(screen.getByRole('button', { name: '設定を作る' }));

        await waitFor(() => expect(startMock).toHaveBeenCalledTimes(2));
        const req = startMock.mock.calls[1][0];
        expect(req.step).toBe(2);
        expect(req.notes).toBe('口調をやわらかく');
    });

    it('キャラ以外の種別は「調べる」を飛ばし、項目の本文を差し込んでまとめて作る', async () => {
        const user = userEvent.setup();
        render(panel(JA));
        await waitFor(() => expect(selectAfterLabel('項目のテンプレート').value).toBe('標準'));
        await user.selectOptions(selectAfterLabel('種別'), 'situation');
        await waitFor(() => expect(screen.getByText('書き込む項目')).toBeTruthy());
        expect(document.querySelectorAll('ol li')).toHaveLength(3);

        await user.type(inputAfterLabel('ファイル名'), '放課後');
        await user.click(screen.getByRole('button', { name: '設定を作る' }));

        await waitFor(() => expect(currentStep()).toContain('設定を作る'));
        const req = startMock.mock.calls[0][0];
        expect(req.categoryId).toBe('situation');
        expect(req.method).toBe('one_shot');
        expect(req.editorContent).toBe('ja:標準:本文');
    });

    it('できあがると「確かめて保存」へ進み、設定ファイルとして開くと設定ファイルの編集へ渡す', async () => {
        const user = userEvent.setup();
        const result: ConfigGenResultFile = { kind: 'setting', categoryId: 'situation', dirName: '放課後', fileName: '放課後', relPath: '' };
        startMock.mockImplementation(async (_req, onComplete: (r: ConfigGenResultFile) => void) => {
            setTimeout(() => onComplete(result), 0);
            return { ok: true };
        });
        vi.mocked(getConfigFile).mockResolvedValue('# できた設定');

        render(panel(JA));
        await waitFor(() => expect(selectAfterLabel('項目のテンプレート').value).toBe('標準'));
        await user.selectOptions(selectAfterLabel('種別'), 'situation');
        await waitFor(() => expect(screen.getByText('書き込む項目')).toBeTruthy());
        await user.type(inputAfterLabel('ファイル名'), '放課後');
        await user.click(screen.getByRole('button', { name: '設定を作る' }));

        await waitFor(() => expect(currentStep()).toContain('確かめて保存'));
        expect(codeEditor().value).toBe('# できた設定');
        await user.click(screen.getByText('設定ファイルとして開く'));
        expect(onOpenInEditor).toHaveBeenCalledWith(result, '# できた設定');
        await waitFor(() => expect(currentStep()).toContain('条件'));
    });
});
