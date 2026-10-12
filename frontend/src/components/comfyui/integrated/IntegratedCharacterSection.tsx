/**
 * IntegratedCharacterSection.tsx - キャラの画像設定のフォーム（素材づくりのキャラ画像・設定ファイルの右の欄で使う）
 *
 * キャラクター選択、プロンプト、LoRA、服装設定、追加prompt等を管理する。
 * state は親（IntegratedSettingsModal）でリフトアップされ、props で受け取る。
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Search, Trash2, Loader2, Users, Sparkles, Shirt, RefreshCw } from 'lucide-react';
import type { ApiServiceId, CharacterImageGenConfig, DanbooruTagFormat, ImageBackend, ReferenceImage, TriggerWordFormat } from '../../../api/comfyui';
import { IdentityOutputPreview } from '../IdentityOutputPreview';
import {
    addCharacterReferenceImage,
    deleteCharacterReferenceImage,
    emptyCharacterApiServiceConfig,
    forgetAuthedUrl,
    getCharacterReferenceImageUrl,
    getComfyUIConfig,
} from '../../../api/comfyui';
import { CharacterApiServiceFields } from '../apiservice/CharacterApiServiceFields';
import { normalizeApiService, normalizeImageBackend } from '../apiservice/services';
import { useApiReferenceDisabledNote } from '../apiservice/useApiReferenceSupport';
import type { CharacterTagInfo } from '../../../api/files';
import { createComfyUIText } from '../i18n';
import type { I18NCatalog } from '../../../api/i18n';
import { formatTriggerLine, appendTriggerLineDedup } from '../danbooru-format';
import { LoraUnreachableNotice } from '../LoraUnreachableNotice';
import { LoraStrengthInput } from '../LoraStrengthInput';
import { withTrailingEmptyLora } from '../loraEntries';
import { AppearancePromptPanel } from '../AppearancePromptPanel';
import { CharacterSaveBar } from './CharacterSaveBar';
import { scrollListToSelected } from '../../../lib/listScroll';
import type { AppearancePromptHandle, AppearanceTarget } from '../../../hooks/useAppearancePromptGen';

interface Props {
    // キャラクター選択ドロップダウン用。hideCharacterSelector のときは不要
    //（設定ファイルエディタ埋め込みでは開いているキャラクターに固定するため）。
    characters?: CharacterTagInfo[];
    selectedCharacter: string;
    onCharacterChange?: (name: string) => void;
    // true ならキャラクター選択ドロップダウンを出さない（フォーム部分だけを使う）。
    hideCharacterSelector?: boolean;
    // true なら保存ボタンを出さない（設定ファイルの画面で、上の帯の「保存」からまとめて保存するときと、
    // 素材づくりのキャラのタブで、保存の帯をスクロールする欄の外に置くとき）。
    hideSaveButton?: boolean;
    // 作品名ラベルへの補足（フィルタ用の「作品」との区別を示す文言）。
    workNameHint?: string;
    config: CharacterImageGenConfig;
    onUpdateConfig: <K extends keyof CharacterImageGenConfig>(key: K, value: CharacterImageGenConfig[K]) => void;
    isLoading: boolean;
    isDirty: boolean;
    onSave: () => Promise<boolean | undefined>;
    availableLoras: string[];
    availableOutfitLoras: string[];
    // ComfyUI 未接続で LoRA 一覧を取得できていないか（ドロップダウン内の通知表示用）
    comfyUnreachable?: boolean;
    onRefreshLoras: () => Promise<void>;
    onFetchTriggerWords: (loraName: string) => Promise<{ words: string[]; lines: string[] } | null>;
    triggerWordFormat?: TriggerWordFormat;
    uiCatalog?: I18NCatalog | null;
    // キャラクター容姿プロンプト作成（小窓の状態は親の Hub が持つ）。無ければボタンを出さない。
    appearancePrompt?: AppearancePromptHandle;
    // 容姿分析の対象（フォルダ名・設定ファイル名・表示名）。null なら押せない。
    appearanceTarget?: AppearanceTarget | null;
    backendUrl?: string;
    // 画像生成バックエンドの選択（内部タブの初期値）。親が全画面共用の値を持っていれば渡し、
    // 無ければこのセクションが設定を読んで決める。
    imageBackend?: ImageBackend;
    apiService?: ApiServiceId;
    // 参照画像の登録・削除に使うキャラ設定フォルダ名。無ければ参照画像欄を出さない。
    characterDirName?: string;
    // 参照画像が使えないモデルのときの注記（無効表示）。指定が無ければこのセクションが判定する。
    referenceDisabledNote?: string;
    // 変わるたびに参照画像の可否を読み直す印（使用モデルの切り替え後など）。
    referenceRefreshKey?: unknown;
    // 参照画像の登録・削除のあと、親が設定を読み直すための口。
    onReloadConfig?: () => Promise<void>;
    // ComfyUI 用の Danbooru タグ形式。親が持っていれば渡す（無ければ出力表示が保存済みの設定を読む）。
    danbooruTagFormat?: DanbooruTagFormat;
}

const createEmptyLora = () => ({ name: '', strengthModel: 1.0, strengthClip: 1.0 });
const createEmptyOutfit = () => ({ name: '', prompt: '', lora: [createEmptyLora()] });

export const IntegratedCharacterSection: React.FC<Props> = ({
    characters = [],
    selectedCharacter,
    onCharacterChange,
    hideCharacterSelector = false,
    hideSaveButton = false,
    workNameHint,
    config,
    onUpdateConfig,
    isLoading,
    isDirty,
    onSave,
    availableLoras,
    availableOutfitLoras,
    comfyUnreachable = false,
    onRefreshLoras,
    onFetchTriggerWords,
    triggerWordFormat = 'raw',
    uiCatalog = null,
    appearancePrompt,
    appearanceTarget = null,
    backendUrl = '',
    imageBackend,
    apiService,
    characterDirName,
    referenceDisabledNote,
    referenceRefreshKey,
    onReloadConfig,
    danbooruTagFormat,
}) => {
    const { CHARACTER, LORA, TRIGGER_WORDS, COMMON } = createComfyUIText(uiCatalog);
    // ===== ローカルstate =====
    // 内部タブ（ComfyUI 用 / API サービス用）。開いたときは全画面共用の選択に従う。
    const [tab, setTab] = useState<ImageBackend>(imageBackend ?? 'comfyui');
    const [service, setService] = useState<ApiServiceId>(apiService ?? 'novelai');
    useEffect(() => {
        if (imageBackend !== undefined) {
            setTab(imageBackend);
            setService(apiService ?? 'novelai');
            return;
        }
        let cancelled = false;
        (async () => {
            try {
                const cfg = await getComfyUIConfig(backendUrl);
                if (cancelled) return;
                setTab(normalizeImageBackend(cfg.imageBackend));
                setService(normalizeApiService(cfg.apiService));
            } catch { /* 読めなければ ComfyUI 用タブのまま */ }
        })();
        return () => { cancelled = true; };
    }, [imageBackend, apiService, backendUrl]);
    const apiConfig = config.apiService?.[service] ?? emptyCharacterApiServiceConfig();
    // 親から注記が来なければ、全体の設定で選ばれている使用モデルで参照画像の可否を判定する。
    const autoReferenceNote = useApiReferenceDisabledNote(backendUrl, service, tab === 'api' && referenceDisabledNote === undefined, uiCatalog, {
        refreshKey: referenceRefreshKey,
    });
    const effectiveReferenceNote = referenceDisabledNote ?? autoReferenceNote;
    const updateApiConfig = useCallback((next: typeof apiConfig) => {
        onUpdateConfig('apiService', { ...(config.apiService ?? {}), [service]: next });
    }, [config.apiService, service, onUpdateConfig]);
    const referenceImageUrl = useCallback(
        (ref: ReferenceImage) => getCharacterReferenceImageUrl(backendUrl, characterDirName ?? '', service, ref.id),
        [backendUrl, characterDirName, service]
    );
    const [searchQuery, setSearchQuery] = useState('');
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // LoRA
    const [loraDropdownIdx, setLoraDropdownIdx] = useState<number | null>(null);
    const [loraSearchQuery, setLoraSearchQuery] = useState('');
    const [loraDetailMode, setLoraDetailMode] = useState<Record<number, boolean>>({});
    const loraDropdownRef = useRef<HTMLDivElement>(null);

    // 服装LoRA
    const [outfitLoraDropdown, setOutfitLoraDropdown] = useState<{ outfitIndex: number; loraIndex: number } | null>(null);
    const [outfitLoraSearchQuery, setOutfitLoraSearchQuery] = useState('');
    const outfitLoraDropdownRef = useRef<HTMLDivElement>(null);

    // トリガーワード
    const [triggerWords, setTriggerWords] = useState<Record<string, string[]>>({});
    const [triggerLines, setTriggerLines] = useState<Record<string, string[]>>({});
    const [triggerWordsLoading, setTriggerWordsLoading] = useState<Record<number, boolean>>({});

    // エイリアス
    const [aliasesText, setAliasesText] = useState('');

    // エイリアステキストをconfigと同期
    useEffect(() => {
        setAliasesText((config.aliases || []).join(', '));
    }, [config.aliases]);

    // ドロップダウン外クリック
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setIsDropdownOpen(false);
            }
        };
        if (isDropdownOpen) document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isDropdownOpen]);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as Node;
            if (loraDropdownRef.current?.contains(target) || outfitLoraDropdownRef.current?.contains(target)) return;
            setLoraDropdownIdx(null);
            setOutfitLoraDropdown(null);
        };
        if (loraDropdownIdx !== null || outfitLoraDropdown !== null) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [loraDropdownIdx, outfitLoraDropdown]);

    // LoRA の一覧を開いたときは、今選んでいる LoRA の位置まで一覧を送る（番号違いの LoRA へ選び直しやすくするため）。
    // 画面全体は動かさず、一覧の中だけを送る
    const loraListRef = useRef<HTMLDivElement>(null);
    const outfitLoraListRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (loraDropdownIdx !== null) scrollListToSelected(loraListRef.current);
    }, [loraDropdownIdx]);
    useEffect(() => {
        if (outfitLoraDropdown !== null) scrollListToSelected(outfitLoraListRef.current);
    }, [outfitLoraDropdown]);

    // フィルタ済みキャラ一覧
    const filteredCharacters = searchQuery.trim()
        ? characters.filter(c => c.name.toLowerCase().includes(searchQuery.trim().toLowerCase()))
        : characters;

    // LoRA操作
    const removeLora = (index: number) => {
        const remaining = config.lora.filter((_, i) => i !== index);
        onUpdateConfig('lora', withTrailingEmptyLora(remaining));
        setLoraDetailMode(prev => { const next = { ...prev }; delete next[index]; return next; });
    };

    const updateLora = (index: number, field: string, value: string | number) => {
        const newLora = [...config.lora];
        if (!loraDetailMode[index] && (field === 'strengthModel' || field === 'strengthClip')) {
            newLora[index] = { ...newLora[index], strengthModel: value as number, strengthClip: value as number };
        } else {
            newLora[index] = { ...newLora[index], [field]: value };
        }
        onUpdateConfig('lora', newLora);
    };

    const selectLora = (index: number, loraName: string) => {
        // 名前を差し替えたうえで、末尾が埋まっていれば新しい空行を追加
        const newLora = config.lora.map((l, i) => i === index ? { ...l, name: loraName } : l);
        onUpdateConfig('lora', withTrailingEmptyLora(newLora));
        setLoraDropdownIdx(null);
        setLoraSearchQuery('');
    };

    // トリガーワード
    const handleFetchTriggerWords = useCallback(async (idx: number, loraName: string) => {
        if (!loraName || triggerWords[loraName]) return;
        setTriggerWordsLoading(prev => ({ ...prev, [idx]: true }));
        const result = await onFetchTriggerWords(loraName);
        if (result) {
            setTriggerWords(prev => ({ ...prev, [loraName]: result.words }));
            setTriggerLines(prev => ({ ...prev, [loraName]: result.lines }));
        }
        setTriggerWordsLoading(prev => ({ ...prev, [idx]: false }));
    }, [triggerWords, onFetchTriggerWords]);

    // トリガーワードの「1行（グループ）」を LoRA の triggerWords フィールドに追加（ワード単位で重複除去）
    const addTriggerLineToLora = useCallback((loraIdx: number, line: string) => {
        const newLora = [...config.lora];
        const current = newLora[loraIdx].triggerWords || '';
        newLora[loraIdx] = { ...newLora[loraIdx], triggerWords: appendTriggerLineDedup(current, line, triggerWordFormat) };
        onUpdateConfig('lora', newLora);
    }, [config.lora, triggerWordFormat, onUpdateConfig]);

    // 容姿プロンプト小窓の「追加」：タグ行をキャラクタープロンプト欄の末尾へ追記（ワード単位で重複除去）。
    // 書き込み先は開いているタブ側。
    const appendAppearanceLine = useCallback((line: string) => {
        if (tab === 'api') {
            updateApiConfig({ ...apiConfig, characterPrompt: appendTriggerLineDedup(apiConfig.characterPrompt || '', line, 'space') });
            return;
        }
        onUpdateConfig('characterPrompt', appendTriggerLineDedup(config.characterPrompt || '', line, triggerWordFormat));
    }, [tab, apiConfig, updateApiConfig, config.characterPrompt, triggerWordFormat, onUpdateConfig]);

    const openAppearancePrompt = () => {
        if (!appearancePrompt || !appearanceTarget) return;
        appearancePrompt.open(appearanceTarget, tab === 'api'
            ? { characterPrompt: apiConfig.characterPrompt || '', physicalFeatures: apiConfig.physicalFeatures || '' }
            : { characterPrompt: config.characterPrompt || '', physicalFeatures: config.physicalFeatures || '' });
    };
    const canOpenAppearancePrompt = !!appearancePrompt && !!appearanceTarget && !appearancePrompt.running;

    // 服装操作
    const updateOutfit = (outfitIndex: number, field: keyof CharacterImageGenConfig['outfits'][number], value: any) => {
        const newOutfits = [...config.outfits];
        newOutfits[outfitIndex] = { ...newOutfits[outfitIndex], [field]: value };
        onUpdateConfig('outfits', newOutfits);
    };

    const addOutfit = () => onUpdateConfig('outfits', [...config.outfits, createEmptyOutfit()]);
    const removeOutfit = (outfitIndex: number) => onUpdateConfig('outfits', config.outfits.filter((_, i) => i !== outfitIndex));

    const updateOutfitLora = (outfitIndex: number, loraIndex: number, field: string, value: string | number) => {
        const newOutfits = [...config.outfits];
        const outfit = newOutfits[outfitIndex];
        const newLora = [...outfit.lora];
        if (field === 'strengthModel' || field === 'strengthClip') {
            newLora[loraIndex] = { ...newLora[loraIndex], strengthModel: value as number, strengthClip: value as number };
        } else {
            newLora[loraIndex] = { ...newLora[loraIndex], [field]: value };
        }
        newOutfits[outfitIndex] = { ...outfit, lora: newLora };
        onUpdateConfig('outfits', newOutfits);
    };

    const selectOutfitLora = (outfitIndex: number, loraIndex: number, loraName: string) => {
        const newOutfits = [...config.outfits];
        const outfit = newOutfits[outfitIndex];
        const newLora = [...outfit.lora];
        newLora[loraIndex] = { ...newLora[loraIndex], name: loraName };
        newOutfits[outfitIndex] = { ...outfit, lora: withTrailingEmptyLora(newLora) };
        onUpdateConfig('outfits', newOutfits);
        setOutfitLoraDropdown(null);
        setOutfitLoraSearchQuery('');
    };

    const removeOutfitLora = (outfitIndex: number, loraIndex: number) => {
        const newOutfits = [...config.outfits];
        const outfit = newOutfits[outfitIndex];
        const newLora = outfit.lora.filter((_, i) => i !== loraIndex);
        newOutfits[outfitIndex] = { ...outfit, lora: withTrailingEmptyLora(newLora) };
        onUpdateConfig('outfits', newOutfits);
    };

    return (
        <div className="space-y-4">
            {/* キャラクター選択（エディタ埋め込みでは開いているキャラクターに固定するため出さない） */}
            {!hideCharacterSelector && (
            <div className="space-y-2" ref={dropdownRef}>
                <label className="flex items-center gap-2 text-sm font-medium text-fg-muted">
                    <Users size={16} className="text-accent" />
                    {CHARACTER.LABELS.CHARACTER}
                </label>
                <div
                    onClick={() => { setIsDropdownOpen(!isDropdownOpen); setSearchQuery(''); }}
                    className="w-full bg-surface border border-accent rounded-lg px-3 py-2 text-sm text-fg cursor-pointer hover:border-accent transition-colors flex items-center justify-between"
                >
                    <span className={selectedCharacter ? 'text-fg' : 'text-fg-muted'}>
                        {selectedCharacter || CHARACTER.PLACEHOLDERS.SELECT_CHARACTER}
                    </span>
                    <Search size={14} className="text-fg-muted" />
                </div>
                {isDropdownOpen && (
                    <div className="bg-surface border border-line-strong rounded-lg overflow-hidden">
                        <div className="p-2 border-b border-line-strong">
                            <div className="relative">
                                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted pointer-events-none" />
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder={CHARACTER.PLACEHOLDERS.SEARCH_CHARACTER}
                                    autoFocus
                                    className="w-full bg-surface border border-line-strong rounded pl-8 pr-3 py-1.5 text-sm text-fg placeholder-fg-muted outline-none focus:border-accent"
                                />
                            </div>
                        </div>
                        <div className="max-h-48 overflow-y-auto custom-scrollbar">
                            {filteredCharacters.length > 0 ? (
                                filteredCharacters.map((c) => (
                                    <button
                                        key={c.path}
                                        onClick={() => {
                                            onCharacterChange?.(c.name);
                                            setIsDropdownOpen(false);
                                            setSearchQuery('');
                                            setLoraDetailMode({});
                                        }}
                                        className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                                            selectedCharacter === c.name
                                                ? 'bg-accent-soft text-fg'
                                                : 'text-fg-muted hover:bg-surface-2'
                                        }`}
                                    >
                                        {c.name}
                                    </button>
                                ))
                            ) : (
                                <p className="px-3 py-2 text-sm text-fg-muted">{CHARACTER.MESSAGES.NO_RESULTS}</p>
                            )}
                        </div>
                    </div>
                )}
            </div>
            )}

            {isLoading ? (
                <div className="flex justify-center py-8">
                    <Loader2 size={24} className="animate-spin text-fg-muted" />
                </div>
            ) : selectedCharacter ? (
                <>
                    {/* キャラクター名 / 作品名 */}
                    <div className="space-y-1">
                        <label className="text-sm font-medium text-fg-muted">
                            {CHARACTER.LABELS.CHARACTER_AND_WORK}
                            <span className="text-xs text-fg-muted ml-2">{CHARACTER.HELP.CHARACTER_JOINED}</span>
                            {workNameHint && <span className="block text-xs text-fg-muted mt-0.5">{workNameHint}</span>}
                        </label>
                        <div className="flex flex-col gap-2 lg:flex-row">
                            <div className="flex-1 min-w-0 space-y-0.5">
                                <span className="text-xs text-fg-muted">{CHARACTER.LABELS.CHARACTER_NAME}</span>
                                <input
                                    type="text"
                                    value={config.characterName}
                                    onChange={(e) => onUpdateConfig('characterName', e.target.value)}
                                    placeholder={CHARACTER.PLACEHOLDERS.CHARACTER_NAME}
                                    className="w-full bg-surface border border-line-strong rounded px-3 py-1.5 text-sm text-fg outline-none focus:border-accent transition-colors"
                                />
                            </div>
                            <div className="flex-1 min-w-0 space-y-0.5">
                                <span className="text-xs text-fg-muted">{CHARACTER.LABELS.WORK_NAME}</span>
                                <input
                                    type="text"
                                    value={config.workName}
                                    onChange={(e) => onUpdateConfig('workName', e.target.value)}
                                    placeholder={CHARACTER.PLACEHOLDERS.WORK_NAME}
                                    className="w-full bg-surface border border-line-strong rounded px-3 py-1.5 text-sm text-fg outline-none focus:border-accent transition-colors"
                                />
                            </div>
                        </div>
                        <IdentityOutputPreview
                            backendUrl={backendUrl}
                            active={!!selectedCharacter}
                            characterName={config.characterName}
                            workName={config.workName}
                            danbooruTagFormat={danbooruTagFormat}
                            uiCatalog={uiCatalog}
                        />
                    </div>

                    {/* エイリアス */}
                    <div className="space-y-1">
                        <label className="text-sm font-medium text-fg-muted">{CHARACTER.LABELS.ALIASES}</label>
                        <input
                            type="text"
                            value={aliasesText}
                            onChange={(e) => setAliasesText(e.target.value)}
                            onBlur={() => {
                                const parsed = aliasesText.split(/[,、]/).map(s => s.trim()).filter(Boolean);
                                onUpdateConfig('aliases', parsed);
                                setAliasesText(parsed.join(', '));
                            }}
                            placeholder={CHARACTER.PLACEHOLDERS.ALIASES}
                            className="w-full bg-surface border border-line-strong rounded px-3 py-1.5 text-sm text-fg outline-none focus:border-accent transition-colors"
                        />
                        <p className="text-xs text-fg-muted">{CHARACTER.HELP.ALIASES_DESC}</p>
                    </div>

                    {/* 内部タブ: プロンプト系は ComfyUI 用 / API サービス用で別の値を持つ */}
                    <div className="flex rounded-lg border border-line-strong bg-surface p-1" role="tablist">
                        {([
                            { value: 'comfyui', label: CHARACTER.LABELS.BACKEND_TAB_COMFYUI },
                            { value: 'api', label: CHARACTER.LABELS.BACKEND_TAB_API },
                        ] as { value: ImageBackend; label: string }[]).map((t) => (
                            <button
                                key={t.value}
                                type="button"
                                role="tab"
                                aria-selected={tab === t.value}
                                onClick={() => setTab(t.value)}
                                className={`flex-1 px-3 py-1.5 text-sm rounded transition-colors ${
                                    tab === t.value ? 'bg-accent text-on-accent' : 'text-fg-muted hover:bg-surface-2'
                                }`}
                            >
                                {t.label}
                            </button>
                        ))}
                    </div>

                    {tab === 'api' ? (
                        <CharacterApiServiceFields
                            uiCatalog={uiCatalog}
                            value={apiConfig}
                            onChange={updateApiConfig}
                            description={CHARACTER.HELP.API_PROMPT_DESC}
                            promptAction={appearancePrompt && (
                                <button
                                    type="button"
                                    onClick={openAppearancePrompt}
                                    disabled={!canOpenAppearancePrompt}
                                    className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-accent-soft hover:brightness-110 text-fg border border-line-strong disabled:opacity-40 transition-colors"
                                >
                                    <Sparkles size={12} />
                                    {CHARACTER.BUTTONS.APPEARANCE_PROMPT}
                                </button>
                            )}
                            referenceImages={characterDirName ? {
                                imageUrl: referenceImageUrl,
                                onAdd: async (file) => {
                                    // 登録はサーバー側が設定ファイルを書くため、未保存の編集があれば先に保存する。
                                    if (isDirty) await onSave();
                                    await addCharacterReferenceImage(backendUrl, characterDirName, service, file, { kind: 'character', strength: 0.6, fidelity: 0.5 });
                                    await onReloadConfig?.();
                                },
                                onRemove: async (id) => {
                                    if (isDirty) await onSave();
                                    forgetAuthedUrl(getCharacterReferenceImageUrl(backendUrl, characterDirName, service, id));
                                    await deleteCharacterReferenceImage(backendUrl, characterDirName, service, id);
                                    await onReloadConfig?.();
                                },
                                disabledNote: effectiveReferenceNote,
                            } : undefined}
                        />
                    ) : (<>
                    {/* キャラクタープロンプト */}
                    <div className="space-y-1">
                        <div className="flex items-center justify-between gap-2">
                            <label className="text-sm font-medium text-fg-muted">
                                {CHARACTER.LABELS.CHARACTER_PROMPT}
                                <span className="text-xs text-fg-muted ml-2">{CHARACTER.HELP.CHARACTER_JOINED}</span>
                            </label>
                            {appearancePrompt && (
                                <button
                                    type="button"
                                    onClick={openAppearancePrompt}
                                    disabled={!canOpenAppearancePrompt}
                                    className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-accent-soft hover:brightness-110 text-fg border border-line-strong disabled:opacity-40 transition-colors"
                                >
                                    <Sparkles size={12} />
                                    {CHARACTER.BUTTONS.APPEARANCE_PROMPT}
                                </button>
                            )}
                        </div>
                        <textarea
                            value={config.characterPrompt}
                            onChange={(e) => onUpdateConfig('characterPrompt', e.target.value)}
                            placeholder={CHARACTER.PLACEHOLDERS.CHARACTER_PROMPT}
                            className="w-full bg-surface border border-line-strong rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-accent resize-y transition-colors"
                            rows={2}
                        />
                        <p className="text-xs text-fg-muted">{CHARACTER.HELP.CHARACTER_PROMPT_DESC}</p>
                    </div>

                    {/* 身体的特徴 */}
                    <div className="space-y-1">
                        <label className="text-sm font-medium text-fg-muted">
                            {CHARACTER.LABELS.PHYSICAL_FEATURES}
                            <span className="text-xs text-fg-muted ml-2">{CHARACTER.HELP.FEATURES_PLACEHOLDER}</span>
                        </label>
                        <textarea
                            value={config.physicalFeatures}
                            onChange={(e) => onUpdateConfig('physicalFeatures', e.target.value)}
                            placeholder={CHARACTER.PLACEHOLDERS.PHYSICAL_FEATURES}
                            className="w-full bg-surface border border-line-strong rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-accent resize-y transition-colors"
                            rows={2}
                        />
                        <p className="text-xs text-fg-muted">{CHARACTER.HELP.PHYSICAL_FEATURES_DESC}</p>
                    </div>

                    {/* LoRA */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <label className="flex items-center gap-2 text-sm font-medium text-fg-muted">
                                <Sparkles size={16} className="text-accent" />
                                {CHARACTER.LABELS.LORA}
                            </label>
                            <button
                                onClick={onRefreshLoras}
                                className="flex items-center gap-1 text-xs text-fg-muted hover:text-ok transition-colors"
                                title={COMMON.MESSAGES.REFRESH_TOOLTIP}
                            >
                                <RefreshCw size={12} />
                                {COMMON.BUTTONS.REFRESH_LORA}
                            </button>
                        </div>
                        <div ref={loraDropdownRef}>
                            {config.lora.map((lora, idx) => {
                                const isDetail = loraDetailMode[idx] || false;
                                const isEmptyLast = !lora.name && idx === config.lora.length - 1;
                                return (
                                    <div key={idx} className="space-y-1 mb-2">
                                        <div className="flex items-center gap-1.5">
                                            <div
                                                onClick={() => {
                                                    setLoraDropdownIdx(loraDropdownIdx === idx ? null : idx);
                                                    setLoraSearchQuery('');
                                                }}
                                                className="flex-1 min-w-0 bg-surface border border-line-strong rounded px-2 py-1.5 text-sm cursor-pointer hover:border-accent transition-colors flex items-center justify-between"
                                            >
                                                <span className={`truncate ${lora.name ? 'text-fg' : 'text-fg-muted'}`}>
                                                    {lora.name || LORA.PLACEHOLDERS.SELECT_LORA}
                                                </span>
                                                <Search size={12} className="text-fg-muted shrink-0 ml-1" />
                                            </div>
                                            {lora.name && (
                                                <>
                                                    {isDetail ? (
                                                        <>
                                                            <div className="flex items-center gap-0.5">
                                                                <span className="text-xs text-fg-muted">{LORA.LABELS.MODEL_STRENGTH}</span>
                                                                <LoraStrengthInput value={lora.strengthModel}
                                                                    onCommit={v => updateLora(idx, 'strengthModel', v)}
                                                                    step={0.05} min={-2} max={2}
                                                                    className="w-14 bg-surface border border-line-strong rounded px-1 py-1 text-xs text-fg outline-none focus:border-accent" />
                                                            </div>
                                                            <div className="flex items-center gap-0.5">
                                                                <span className="text-xs text-fg-muted">{LORA.LABELS.CLIP_STRENGTH}</span>
                                                                <LoraStrengthInput value={lora.strengthClip}
                                                                    onCommit={v => updateLora(idx, 'strengthClip', v)}
                                                                    step={0.05} min={-2} max={2}
                                                                    className="w-14 bg-surface border border-line-strong rounded px-1 py-1 text-xs text-fg outline-none focus:border-accent" />
                                                            </div>
                                                        </>
                                                    ) : (
                                                        <LoraStrengthInput value={lora.strengthModel}
                                                            onCommit={v => updateLora(idx, 'strengthModel', v)}
                                                            step={0.05} min={-2} max={2}
                                                            className="w-14 bg-surface border border-line-strong rounded px-1 py-1 text-xs text-fg outline-none focus:border-accent"
                                                            title={LORA.LABELS.STRENGTH} />
                                                    )}
                                                    <button
                                                        onClick={() => setLoraDetailMode(prev => ({ ...prev, [idx]: !isDetail }))}
                                                        className={`px-1 py-0.5 rounded text-xs transition-colors shrink-0 ${isDetail ? 'bg-accent-soft text-accent' : 'bg-surface text-fg-muted hover:text-fg-muted'}`}
                                                        title={isDetail ? LORA.HELP.SIMPLE_MODE_TOOLTIP : LORA.HELP.DETAIL_MODE_TOOLTIP}
                                                    >
                                                        {isDetail ? LORA.LABELS.SIMPLE_MODE : LORA.LABELS.DETAIL_MODE}
                                                    </button>
                                                    <button onClick={() => removeLora(idx)}
                                                        className="p-0.5 text-fg-muted hover:text-danger transition-colors shrink-0" title={COMMON.BUTTONS.DELETE}>
                                                        <Trash2 size={14} />
                                                    </button>
                                                </>
                                            )}
                                            {!lora.name && !isEmptyLast && (
                                                <button onClick={() => removeLora(idx)}
                                                    className="p-0.5 text-fg-muted hover:text-danger transition-colors shrink-0">
                                                    <Trash2 size={14} />
                                                </button>
                                            )}
                                        </div>

                                        {/* LoRAドロップダウン */}
                                        {loraDropdownIdx === idx && (
                                            <div className="bg-surface border border-line-strong rounded-lg overflow-hidden">
                                                <div className="p-2 border-b border-line-strong">
                                                    <div className="relative">
                                                        <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-fg-muted pointer-events-none" />
                                                        <input type="text" value={loraSearchQuery}
                                                            onChange={(e) => setLoraSearchQuery(e.target.value)}
                                                            placeholder={LORA.PLACEHOLDERS.SEARCH_LORA} autoFocus
                                                            className="w-full bg-surface border border-line-strong rounded pl-7 pr-3 py-1 text-xs text-fg placeholder-fg-muted outline-none focus:border-accent" />
                                                    </div>
                                                </div>
                                                <div ref={loraListRef} className="relative max-h-40 overflow-y-auto custom-scrollbar">
                                                    {(() => {
                                                        const q = loraSearchQuery.trim().toLowerCase();
                                                        const filtered = q ? availableLoras.filter(l => l.toLowerCase().includes(q)) : availableLoras;
                                                        return filtered.length > 0 ? (
                                                            filtered.map(loraName => (
                                                                <button key={loraName} onClick={() => selectLora(idx, loraName)}
                                                                    data-selected={lora.name === loraName}
                                                                    className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                                                                        lora.name === loraName ? 'bg-ok/10 text-ok' : 'text-fg-muted hover:bg-surface-2'
                                                                    }`}>
                                                                    {loraName}
                                                                </button>
                                                            ))
                                                        ) : comfyUnreachable ? (
                                                            <LoraUnreachableNotice visible compact onRetry={onRefreshLoras} uiCatalog={uiCatalog} />
                                                        ) : (
                                                            <p className="px-3 py-2 text-xs text-fg-muted">{LORA.MESSAGES.NO_RESULTS}</p>
                                                        );
                                                    })()}
                                                </div>
                                            </div>
                                        )}

                                        {/* トリガーワード */}
                                        {lora.name && (
                                            <div className="space-y-1.5">
                                                <input
                                                    type="text"
                                                    value={lora.triggerWords || ''}
                                                    onChange={(e) => updateLora(idx, 'triggerWords', e.target.value)}
                                                    placeholder={TRIGGER_WORDS.PLACEHOLDERS.INPUT}
                                                    className="w-full bg-surface border border-line-strong rounded px-2 py-1 text-xs text-fg outline-none focus:border-accent transition-colors"
                                                />
                                                <button
                                                    onClick={() => handleFetchTriggerWords(idx, lora.name)}
                                                    className="px-2 py-1 bg-surface border border-line-strong rounded text-xs text-ok hover:bg-ok/10 hover:text-ok transition-colors"
                                                >
                                                    {triggerWordsLoading[idx] ? TRIGGER_WORDS.LABELS.FETCHING : triggerWords[lora.name] ? TRIGGER_WORDS.LABELS.FETCHED : TRIGGER_WORDS.LABELS.FETCH}
                                                </button>
                                                {triggerWords[lora.name] && (
                                                    <div className="space-y-1 pl-1">
                                                        {(triggerLines[lora.name] && triggerLines[lora.name].length > 0) ? triggerLines[lora.name].map((line, li) => {
                                                            const formattedLine = formatTriggerLine(line, triggerWordFormat);
                                                            return (
                                                                <div key={li} className="flex items-center gap-1">
                                                                    <span
                                                                        onClick={() => navigator.clipboard.writeText(formattedLine)}
                                                                        className="flex-1 bg-surface border border-line-strong rounded px-2 py-1 text-xs text-ok cursor-pointer hover:bg-surface-2 transition-colors break-words"
                                                                        title={COMMON.MESSAGES.COPY_ROW_TOOLTIP}
                                                                    >
                                                                        {formattedLine}
                                                                    </span>
                                                                    <button
                                                                        onClick={() => addTriggerLineToLora(idx, line)}
                                                                        className="px-1.5 py-0.5 bg-ok/10 border border-line-strong rounded text-xs text-ok hover:bg-ok/10 transition-colors shrink-0"
                                                                        title={TRIGGER_WORDS.MESSAGES.ADD_TOOLTIP}
                                                                    >
                                                                        {TRIGGER_WORDS.LABELS.ADD}
                                                                    </button>
                                                                </div>
                                                            );
                                                        }) : (
                                                            <span className="text-xs text-fg-muted">{TRIGGER_WORDS.MESSAGES.NONE}</span>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                        <p className="text-xs text-fg-muted">{LORA.HELP.SELECT_AUTO_ADD} / {LORA.HELP.DETAIL_DESC}</p>
                    </div>

                    {/* 服装設定 */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <label className="flex items-center gap-2 text-sm font-medium text-fg-muted">
                                <Shirt size={16} className="text-accent" />
                                {CHARACTER.LABELS.OUTFIT_SETTINGS}
                            </label>
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={onRefreshLoras}
                                    className="flex items-center gap-1 text-xs text-fg-muted hover:text-ok transition-colors"
                                    title={COMMON.MESSAGES.REFRESH_OUTFIT_TOOLTIP}
                                >
                                    <RefreshCw size={12} />
                                    {COMMON.BUTTONS.REFRESH_LORA}
                                </button>
                                <button
                                    onClick={addOutfit}
                                    className="px-2 py-1 bg-surface border border-line-strong rounded text-xs text-ok hover:bg-ok/10 transition-colors"
                                >
                                    {COMMON.BUTTONS.ADD}
                                </button>
                            </div>
                        </div>
                        <div className="space-y-3" ref={outfitLoraDropdownRef}>
                            {config.outfits.length === 0 ? (
                                <button
                                    onClick={addOutfit}
                                    className="w-full border border-dashed border-line-strong rounded-lg px-3 py-3 text-sm text-fg-muted hover:border-line-strong hover:text-ok transition-colors"
                                >
                                    {COMMON.BUTTONS.ADD_OUTFIT}
                                </button>
                            ) : (
                                config.outfits.map((outfit, outfitIdx) => (
                                    <div key={outfitIdx} className="bg-surface border border-line-strong rounded-lg p-3 space-y-2">
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="text"
                                                value={outfit.name}
                                                onChange={(e) => updateOutfit(outfitIdx, 'name', e.target.value)}
                                                placeholder={CHARACTER.PLACEHOLDERS.OUTFIT_NAME}
                                                className="flex-1 bg-surface border border-line-strong rounded px-2 py-1.5 text-sm text-fg outline-none focus:border-accent"
                                            />
                                            <button
                                                onClick={() => removeOutfit(outfitIdx)}
                                                className="p-1 text-fg-muted hover:text-danger transition-colors"
                                                title={COMMON.MESSAGES.DELETE_OUTFIT_TOOLTIP}
                                            >
                                                <Trash2 size={15} />
                                            </button>
                                        </div>
                                        <textarea
                                            value={outfit.prompt}
                                            onChange={(e) => updateOutfit(outfitIdx, 'prompt', e.target.value)}
                                            placeholder={CHARACTER.PLACEHOLDERS.OUTFIT_PROMPT}
                                            className="w-full bg-surface border border-line-strong rounded px-2 py-1.5 text-sm text-fg outline-none focus:border-accent resize-y"
                                            rows={2}
                                        />
                                        {/* 服装LoRA */}
                                        <div className="space-y-1">
                                            <span className="text-xs text-fg-muted">{CHARACTER.LABELS.OUTFIT_LORA}</span>
                                            {outfit.lora.map((lora, loraIdx) => {
                                                const dropdownOpen = outfitLoraDropdown?.outfitIndex === outfitIdx && outfitLoraDropdown?.loraIndex === loraIdx;
                                                const q = outfitLoraSearchQuery.trim().toLowerCase();
                                                const filtered = q ? availableOutfitLoras.filter(name => name.toLowerCase().includes(q)) : availableOutfitLoras;
                                                const isEmptyLast = !lora.name && loraIdx === outfit.lora.length - 1;
                                                return (
                                                    <div key={loraIdx} className="space-y-1">
                                                        <div className="flex items-center gap-1.5">
                                                            <div
                                                                onClick={() => {
                                                                    setOutfitLoraDropdown(dropdownOpen ? null : { outfitIndex: outfitIdx, loraIndex: loraIdx });
                                                                    setLoraDropdownIdx(null);
                                                                    setOutfitLoraSearchQuery('');
                                                                }}
                                                                className="flex-1 min-w-0 bg-surface border border-line-strong rounded px-2 py-1.5 text-xs cursor-pointer hover:border-accent transition-colors flex items-center justify-between"
                                                            >
                                                                <span className={`truncate ${lora.name ? 'text-fg' : 'text-fg-muted'}`}>
                                                                    {lora.name || LORA.PLACEHOLDERS.SELECT_LORA}
                                                                </span>
                                                                <Search size={12} className="text-fg-muted shrink-0 ml-1" />
                                                            </div>
                                                            {lora.name && (
                                                                <>
                                                                    <LoraStrengthInput value={lora.strengthModel}
                                                                        onCommit={v => updateOutfitLora(outfitIdx, loraIdx, 'strengthModel', v)}
                                                                        step={0.05} min={-2} max={2}
                                                                        className="w-14 bg-surface border border-line-strong rounded px-1 py-1 text-xs text-fg outline-none focus:border-accent"
                                                                        title={LORA.LABELS.STRENGTH} />
                                                                    <button onClick={() => removeOutfitLora(outfitIdx, loraIdx)}
                                                                        className="p-0.5 text-fg-muted hover:text-danger transition-colors" title={COMMON.BUTTONS.DELETE}>
                                                                        <Trash2 size={14} />
                                                                    </button>
                                                                </>
                                                            )}
                                                            {!lora.name && !isEmptyLast && (
                                                                <button onClick={() => removeOutfitLora(outfitIdx, loraIdx)}
                                                                    className="p-0.5 text-fg-muted hover:text-danger transition-colors">
                                                                    <Trash2 size={14} />
                                                                </button>
                                                            )}
                                                        </div>
                                                        {dropdownOpen && (
                                                            <div className="bg-surface border border-line-strong rounded-lg overflow-hidden">
                                                                <div className="p-2 border-b border-line-strong">
                                                                    <div className="relative">
                                                                        <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-fg-muted pointer-events-none" />
                                                                        <input type="text" value={outfitLoraSearchQuery}
                                                                            onChange={(e) => setOutfitLoraSearchQuery(e.target.value)}
                                                                            placeholder={LORA.PLACEHOLDERS.SEARCH_LORA} autoFocus
                                                                            className="w-full bg-bg border border-line-strong rounded pl-7 pr-3 py-1 text-xs text-fg placeholder-fg-muted outline-none focus:border-accent" />
                                                                    </div>
                                                                </div>
                                                                <div ref={outfitLoraListRef} className="relative max-h-36 overflow-y-auto custom-scrollbar">
                                                                    {filtered.length > 0 ? (
                                                                        filtered.map(loraName => (
                                                                            <button key={loraName}
                                                                                onClick={() => selectOutfitLora(outfitIdx, loraIdx, loraName)}
                                                                                data-selected={lora.name === loraName}
                                                                                className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                                                                                    lora.name === loraName ? 'bg-ok/10 text-ok' : 'text-fg-muted hover:bg-surface-2'
                                                                                }`}>
                                                                                {loraName}
                                                                            </button>
                                                                        ))
                                                                    ) : comfyUnreachable ? (
                                                                        <LoraUnreachableNotice visible compact onRetry={onRefreshLoras} uiCatalog={uiCatalog} />
                                                                    ) : (
                                                                        <p className="px-3 py-2 text-xs text-fg-muted">{LORA.MESSAGES.NO_RESULTS}</p>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                        <p className="text-xs text-fg-muted">{CHARACTER.HELP.OUTFIT_DESC}</p>
                    </div>

                    {/* 追加ポジティブ */}
                    <div className="space-y-1">
                        <label className="text-sm font-medium text-fg-muted">
                            {CHARACTER.LABELS.EXTRA_POSITIVE}
                            <span className="text-xs text-fg-muted ml-2">{CHARACTER.HELP.EXTRA_POSITIVE_PLACEHOLDER}</span>
                        </label>
                        <input
                            type="text"
                            value={config.extraPositive}
                            onChange={(e) => onUpdateConfig('extraPositive', e.target.value)}
                            placeholder={CHARACTER.PLACEHOLDERS.EXTRA_POSITIVE}
                            className="w-full bg-surface border border-line-strong rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-accent transition-colors"
                        />
                    </div>

                    {/* 追加ネガティブ */}
                    <div className="space-y-1">
                        <label className="text-sm font-medium text-fg-muted">
                            {CHARACTER.LABELS.EXTRA_NEGATIVE}
                            <span className="text-xs text-fg-muted ml-2">{CHARACTER.HELP.EXTRA_NEGATIVE_PLACEHOLDER}</span>
                        </label>
                        <input
                            type="text"
                            value={config.extraNegative}
                            onChange={(e) => onUpdateConfig('extraNegative', e.target.value)}
                            placeholder={CHARACTER.PLACEHOLDERS.EXTRA_NEGATIVE}
                            className="w-full bg-surface border border-line-strong rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-accent transition-colors"
                        />
                    </div>
                    </>)}

                    {/* 保存ボタン */}
                    {!hideSaveButton && (
                        <CharacterSaveBar onSave={onSave} uiCatalog={uiCatalog} className="pt-2 border-t border-line-strong" />
                    )}
                </>
            ) : (
                <p className="text-sm text-fg-muted text-center py-4">{CHARACTER.MESSAGES.SELECT_CHARACTER}</p>
            )}
            {appearancePrompt && (
                <AppearancePromptPanel
                    backendUrl={backendUrl}
                    handle={appearancePrompt}
                    isDirty={isDirty}
                    triggerWordFormat={triggerWordFormat}
                    onAppendLine={appendAppearanceLine}
                    uiCatalog={uiCatalog}
                />
            )}
        </div>
    );
};
