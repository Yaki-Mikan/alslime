import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    listConfigGenTemplates,
    getConfigGenTemplate,
    getConfigGenTemplateDefaults,
    getDefaultTemplates,
    getCategories,
    listTemplates,
} from '../../api/config-editor';
import { getCLIStatus, getResearchMemo, listResearchMemos } from '../../api/config-gen';
import { useConfigGenJob } from '../../hooks/useConfigGenJob';
import { getGlobalSettings } from '../../api/global-settings';
import type { I18NCatalog } from '../../api/i18n';
import { ConfigGenModal } from './ConfigGenModal';

vi.mock('../../lib/axios', () => ({
    default: { get: vi.fn().mockResolvedValue({ data: { models: [] } }), post: vi.fn().mockResolvedValue({ data: {} }) },
}));

// CodeMirror は jsdom で座標計算に失敗するため textarea へ差し替える。
vi.mock('../common/CodeEditor', () => ({
    CodeEditor: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
        <textarea data-testid="left-editor" value={value} onChange={e => onChange(e.target.value)} />
    ),
}));

vi.mock('../../hooks/useConfigGenJob', () => ({ useConfigGenJob: vi.fn() }));
vi.mock('../../hooks/useIsWideScreen', () => ({ useIsWideScreen: () => true }));
vi.mock('../SSRP/RolePlaySettings', () => ({ invalidateSSRPOptionsCache: vi.fn() }));

vi.mock('../../api/config-editor', async importOriginal => {
    const actual = await importOriginal<typeof import('../../api/config-editor')>();
    return {
        ...actual,
        getCategories: vi.fn(),
        getInitialContent: vi.fn().mockResolvedValue(''),
        getConfigFile: vi.fn(),
        checkConfigFileExists: vi.fn().mockResolvedValue(false),
        saveConfigFile: vi.fn(),
        listConfigFiles: vi.fn().mockResolvedValue([]),
        getConfigGenInstruction: vi.fn().mockResolvedValue(''),
        listConfigGenTemplates: vi.fn(),
        getConfigGenTemplate: vi.fn(),
        getConfigGenTemplateDefaults: vi.fn(),
        listTemplates: vi.fn(),
        getTemplate: vi.fn().mockResolvedValue(''),
        getDefaultTemplates: vi.fn(),
    };
});

vi.mock('../../api/config-gen', async importOriginal => {
    const actual = await importOriginal<typeof import('../../api/config-gen')>();
    return {
        ...actual,
        getCLIStatus: vi.fn(),
        listResearchMemos: vi.fn(),
        getResearchMemo: vi.fn(),
        saveResearchMemo: vi.fn(),
        deleteResearchMemo: vi.fn(),
        startConfigGenDialog: vi.fn(),
        sendConfigGenDialog: vi.fn(),
        getConfigGenDialog: vi.fn(),
    };
});

vi.mock('../../api/global-settings', () => ({
    getGlobalSettings: vi.fn(),
    updateGlobalSettings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../api/user-models', () => ({ pingModel: vi.fn() }));

const startMock = vi.fn().mockResolvedValue({ ok: true });

// 既定のモックデータ。入力項目と設定ファイルで既定名を変え、
// 日本語名と英語名も対応しない値にして「名前変換しない」ことを検証できるようにする。
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

const JA: I18NCatalog | null = null; // uiCatalog 無し → ja フォールバック
const EN = { lang: 'en', messages: {} } as unknown as I18NCatalog;

const renderModal = (uiCatalog: I18NCatalog | null, isOpen = true) =>
    render(<ConfigGenModal isOpen={isOpen} onClose={() => {}} backendUrl="http://backend" uiCatalog={uiCatalog} />);

const leftEditor = () => screen.getByTestId('left-editor') as HTMLTextAreaElement;

// ラベル文字列の隣にある select を取る（label と select は for で紐付いていないため）。
const selectAfterLabel = (labelText: string): HTMLSelectElement => {
    const label = screen.getByText(labelText);
    return label.parentElement!.querySelector('select')!;
};

const inputAfterLabel = (labelText: string): HTMLInputElement => {
    // 同じラベル文言が複数ある場合（キャラクター名は設定欄と左パネルの2箇所で
    // 同じ state を編集する）は、input を持つ最初のものを使う。
    const labels = screen.getAllByText(labelText);
    for (const label of labels) {
        const input = label.parentElement?.querySelector('input');
        if (input) return input;
    }
    throw new Error(`ラベル ${labelText} の隣に input が見つからない`);
};

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
    vi.mocked(listTemplates).mockResolvedValue([]);
    vi.mocked(getDefaultTemplates).mockResolvedValue({});
    vi.mocked(getCLIStatus).mockResolvedValue([]);
    vi.mocked(listResearchMemos).mockResolvedValue([]);
    vi.mocked(getResearchMemo).mockResolvedValue({ exists: false } as never);
    vi.mocked(getGlobalSettings).mockResolvedValue({ configGen: {} } as never);
    startMock.mockClear();
    startMock.mockResolvedValue({ ok: true });
    vi.mocked(useConfigGenJob).mockReturnValue({
        state: { running: false, progress: [] },
        start: startMock,
        attachJob: vi.fn(),
        attach: vi.fn().mockResolvedValue(undefined),
        cancel: vi.fn(),
    } as never);
});

describe('設定自動生成のUI言語切替再読込', () => {
    it('日本語で初回表示すると日本語側の一覧と保存された既定名を選ぶ', async () => {
        renderModal(JA);
        const searchSelect = await waitFor(() => {
            const s = selectAfterLabel('入力項目テンプレート');
            expect(s.value).toBe('標準');
            return s;
        });
        expect(searchSelect.value).toBe('標準');
        expect(selectAfterLabel('設定ファイルテンプレート').value).toBe('軽量');
        expect(listConfigGenTemplates).toHaveBeenCalledWith('http://backend', 'character', 'ja', 'search');
    });

    it('閉じて英語へ切り替えて開き直すと英語側を再取得し、既定名を名前変換せず独立に選ぶ', async () => {
        const { rerender } = renderModal(JA);
        await waitFor(() => expect(selectAfterLabel('入力項目テンプレート').value).toBe('標準'));

        rerender(<ConfigGenModal isOpen={false} onClose={() => {}} backendUrl="http://backend" uiCatalog={JA} />);
        rerender(<ConfigGenModal isOpen={true} onClose={() => {}} backendUrl="http://backend" uiCatalog={EN} />);

        // 入力項目は en の保存値 detailed（ja の「標準」に対応する standard ではない）。
        await waitFor(() => expect(selectAfterLabel('入力項目テンプレート').value).toBe('detailed'));
        // 設定ファイルは入力項目と独立に en の保存値 standard。
        expect(selectAfterLabel('設定ファイルテンプレート').value).toBe('standard');
        expect(listConfigGenTemplates).toHaveBeenCalledWith('http://backend', 'character', 'en', 'search');
    });

    it('開いたまま英語へ切り替えると英語側を再取得し、日本語へ戻すと日本語側を再取得する', async () => {
        const { rerender } = renderModal(JA);
        await waitFor(() => expect(selectAfterLabel('入力項目テンプレート').value).toBe('標準'));

        rerender(<ConfigGenModal isOpen={true} onClose={() => {}} backendUrl="http://backend" uiCatalog={EN} />);
        await waitFor(() => expect(selectAfterLabel('入力項目テンプレート').value).toBe('detailed'));

        rerender(<ConfigGenModal isOpen={true} onClose={() => {}} backendUrl="http://backend" uiCatalog={JA} />);
        await waitFor(() => expect(selectAfterLabel('入力項目テンプレート').value).toBe('標準'));
        expect(selectAfterLabel('設定ファイルテンプレート').value).toBe('軽量');
    });

    it('未編集の初期本文は変更後の言語の本文へ切り替える', async () => {
        const user = userEvent.setup();
        const { rerender } = renderModal(JA);
        await waitFor(() => expect(selectAfterLabel('入力項目テンプレート').value).toBe('標準'));

        // 非キャラクター種別は一括作成となり、入力項目テンプレート本文が左エディタへ入る。
        await user.selectOptions(selectAfterLabel('種別'), 'situation');
        await waitFor(() => expect(leftEditor().value).toBe('ja:標準:本文'));

        rerender(<ConfigGenModal isOpen={true} onClose={() => {}} backendUrl="http://backend" uiCatalog={EN} />);
        await waitFor(() => expect(leftEditor().value).toBe('en:standard:本文'));
    });

    it('手編集済みの本文は言語切替で上書きせず、一覧と選択名だけ更新する', async () => {
        const user = userEvent.setup();
        const { rerender } = renderModal(JA);
        await waitFor(() => expect(selectAfterLabel('入力項目テンプレート').value).toBe('標準'));
        await user.selectOptions(selectAfterLabel('種別'), 'situation');
        await waitFor(() => expect(leftEditor().value).toBe('ja:標準:本文'));

        await user.type(leftEditor(), '追記');
        const edited = leftEditor().value;
        expect(edited).not.toBe('ja:標準:本文');

        rerender(<ConfigGenModal isOpen={true} onClose={() => {}} backendUrl="http://backend" uiCatalog={EN} />);
        await waitFor(() => expect(selectAfterLabel('入力項目テンプレート').value).toBe('standard'));
        expect(leftEditor().value).toBe(edited);
    });

    it('遅れて返った古い言語の応答は最後の言語の状態を上書きしない', async () => {
        let resolveJa: (names: string[]) => void = () => {};
        vi.mocked(listConfigGenTemplates).mockImplementation((_url, cat, locale, kind) => {
            if (locale === 'ja' && kind === 'search') {
                return new Promise<string[]>(res => { resolveJa = res; });
            }
            return Promise.resolve(TEMPLATE_LISTS[`${cat}:${locale}:${kind}`] ?? []);
        });

        const { rerender } = renderModal(JA);
        await waitFor(() => expect(listConfigGenTemplates).toHaveBeenCalledWith('http://backend', 'character', 'ja', 'search'));

        rerender(<ConfigGenModal isOpen={true} onClose={() => {}} backendUrl="http://backend" uiCatalog={EN} />);
        await waitFor(() => expect(selectAfterLabel('入力項目テンプレート').value).toBe('detailed'));

        resolveJa(['標準', '詳細']);
        await new Promise(res => setTimeout(res, 20));
        expect(selectAfterLabel('入力項目テンプレート').value).toBe('detailed');
    });

    it('読込失敗はコンテキストを読込済みとせず、閉じて開き直すと再試行する', async () => {
        // 失敗が続く間は選択が確定しないことを保証するため、恒常的に失敗させる。
        vi.mocked(listConfigGenTemplates).mockRejectedValue(new Error('network'));

        const { rerender } = renderModal(JA);
        await waitFor(() => expect(screen.getByText('テンプレート情報の読み込みに失敗しました')).toBeTruthy());
        expect(selectAfterLabel('入力項目テンプレート').value).toBe('');

        // 復旧後、閉じて開き直すと同じ言語でも再試行して反映される。
        vi.mocked(listConfigGenTemplates).mockImplementation((_url, cat, locale, kind) =>
            Promise.resolve(TEMPLATE_LISTS[`${cat}:${locale}:${kind}`] ?? []));
        rerender(<ConfigGenModal isOpen={false} onClose={() => {}} backendUrl="http://backend" uiCatalog={JA} />);
        rerender(<ConfigGenModal isOpen={true} onClose={() => {}} backendUrl="http://backend" uiCatalog={JA} />);

        await waitFor(() => expect(selectAfterLabel('入力項目テンプレート').value).toBe('標準'));
    });

    it('生成要求の locale・searchTemplate・settingTemplate が画面の最終選択と一致する', async () => {
        const user = userEvent.setup();
        const { rerender } = renderModal(JA);
        await waitFor(() => expect(selectAfterLabel('入力項目テンプレート').value).toBe('標準'));

        rerender(<ConfigGenModal isOpen={true} onClose={() => {}} backendUrl="http://backend" uiCatalog={EN} />);
        await waitFor(() => expect(selectAfterLabel('入力項目テンプレート').value).toBe('detailed'));

        await user.type(inputAfterLabel('キャラクター名'), '雪');
        await user.type(inputAfterLabel('作品名'), 'テスト作品');
        await user.click(screen.getByText('1段階目（調査）を実行'));

        await waitFor(() => expect(startMock).toHaveBeenCalled());
        const req = startMock.mock.calls[0][0];
        expect(req.locale).toBe('en');
        expect(req.searchTemplate).toBe('detailed');
        expect(req.settingTemplate).toBe('standard');
    });
});
