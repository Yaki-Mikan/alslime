/**
 * ComfyUICharacterSettingsModal.tsx - キャラクター画像生成設定モーダル
 *
 * キャラクターごとの画像生成用プロンプト・LoRA・追加設定を管理する。
 * - キャラクター選択コンボボックス
 * - characterPrompt / physicalFeatures / LoRA / extra設定
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X, Trash2, Loader2, Save, Search, Users, RefreshCw } from 'lucide-react';
import { ToggleSwitch } from '../common/ToggleSwitch';
import {
    getCharacterImageGenConfig,
    saveCharacterImageGenConfig,
    getLorasByCategory,
    refreshComfyUILoras,
    getLoraTriggerWords,
    searchDanbooruTags,
} from '../../api/comfyui';
import type { CharacterImageGenConfig, DanbooruTagFormat, DanbooruTagResult } from '../../api/comfyui';
import { getCharacterTags } from '../../api/files';
import type { CharacterTagInfo } from '../../api/files';
import { formatDanbooruTag, formatTriggerLine, appendTriggerLineDedup } from './danbooru-format';
import { useDanbooruTagFormat } from './useDanbooruTagFormat';
import { useTriggerWordFormat } from './useTriggerWordFormat';
import { createComfyUIText } from './i18n';
import type { I18NCatalog } from '../../api/i18n';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    backendUrl: string;
    danbooruTagFormat?: DanbooruTagFormat;
    onOpenIntegrated?: () => void;
    initialSelectedCharacter?: string;
    uiCatalog?: I18NCatalog | null;
}

const DEFAULT_CONFIG: CharacterImageGenConfig = {
    characterName: '',
    workName: '',
    aliases: [],
    characterPrompt: '',
    physicalFeatures: '',
    lora: [],
    outfits: [],
    extraPositive: '',
    extraNegative: '',
};

const createEmptyLora = () => ({ name: '', strengthModel: 1.0, strengthClip: 1.0 });
const createEmptyOutfit = () => ({ name: '', prompt: '', lora: [createEmptyLora()] });

export const ComfyUICharacterSettingsModal: React.FC<Props> = ({
    isOpen,
    onClose,
    backendUrl,
    danbooruTagFormat,
    onOpenIntegrated,
    initialSelectedCharacter,
    uiCatalog = null,
}) => {
    const { CHARACTER, COMMON, DANBOORU, INTEGRATED, LORA, SECTION_NAMES, TRIGGER_WORDS } = createComfyUIText(uiCatalog);
    // キャラクター一覧
    const [characters, setCharacters] = useState<CharacterTagInfo[]>([]);
    const [selectedCharacter, setSelectedCharacter] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // 設定値
    const [config, setConfig] = useState<CharacterImageGenConfig>({ ...DEFAULT_CONFIG });

    // LoRA一覧
    const [availableLoras, setAvailableLoras] = useState<string[]>([]);
    const [availableOutfitLoras, setAvailableOutfitLoras] = useState<string[]>([]);
    const [loraDropdownIdx, setLoraDropdownIdx] = useState<number | null>(null);
    const [loraSearchQuery, setLoraSearchQuery] = useState('');
    const [outfitLoraDropdown, setOutfitLoraDropdown] = useState<{ outfitIndex: number; loraIndex: number } | null>(null);
    const [outfitLoraSearchQuery, setOutfitLoraSearchQuery] = useState('');
    const loraDropdownRef = useRef<HTMLDivElement>(null);
    const outfitLoraDropdownRef = useRef<HTMLDivElement>(null);

    // トリガーワード
    const [triggerWords, setTriggerWords] = useState<Record<string, string[]>>({});
    const [triggerLines, setTriggerLines] = useState<Record<string, string[]>>({});
    const [triggerWordsLoading, setTriggerWordsLoading] = useState<Record<number, boolean>>({});

    // エイリアス入力用（入力中は生テキスト保持）
    const [aliasesText, setAliasesText] = useState('');

    // Danbooruタグ検索
    const [danbooruQuery, setDanbooruQuery] = useState('');
    const [danbooruResults, setDanbooruResults] = useState<DanbooruTagResult[]>([]);
    const [danbooruLoading, setDanbooruLoading] = useState(false);
    const [danbooruCopied, setDanbooruCopied] = useState<string | null>(null);
    const [danbooruCharaFilter, setDanbooruCharaFilter] = useState(true);

    // 状態
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isDirty, setIsDirty] = useState(false);
    const [saveMessage, setSaveMessage] = useState<string | null>(null);
    const effectiveDanbooruTagFormat = useDanbooruTagFormat(backendUrl, isOpen, danbooruTagFormat);
    const effectiveTriggerWordFormat = useTriggerWordFormat(backendUrl, isOpen);

    // キャラ一覧 + LoRA一覧取得
    useEffect(() => {
        if (!isOpen) return;
        (async () => {
            try {
                const [charResult, loras, outfitLoras] = await Promise.all([
                    getCharacterTags(),
                    getLorasByCategory(backendUrl, 'character'),
                    getLorasByCategory(backendUrl, 'outfit'),
                ]);
                setCharacters(charResult.characters);
                setAvailableLoras(loras);
                setAvailableOutfitLoras(outfitLoras);
            } catch (error) {
                console.error('[ComfyUICharacterSettingsModal] character list load failed:', error);
            }
        })();
    }, [isOpen, backendUrl]);

    // キャラドロップダウン外クリックで閉じる
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setIsDropdownOpen(false);
            }
        };
        if (isDropdownOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isDropdownOpen]);

    // LoRAドロップダウン外クリックで閉じる
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

    // フィルタ済みキャラ一覧
    const filteredCharacters = searchQuery.trim()
        ? characters.filter(c => c.name.toLowerCase().includes(searchQuery.trim().toLowerCase()))
        : characters;

    // キャラ名 → ディレクトリ名変換
    const getCharDirName = useCallback((name: string) => {
        return characters.find(c => c.name === name)?.dirName || name;
    }, [characters]);

    const resolveCharacterName = useCallback((name: string) => {
        const normalized = name.trim();
        if (!normalized) return '';
        return characters.find(c => c.name === normalized || c.dirName === normalized)?.name || normalized;
    }, [characters]);

    // キャラ変更時に設定読み込み
    const loadConfig = useCallback(async (name: string) => {
        if (!name) {
            setConfig({ ...DEFAULT_CONFIG });
            setAliasesText('');
            setIsDirty(false);
            return;
        }
        setIsLoading(true);
        try {
            const loaded = await getCharacterImageGenConfig(backendUrl, getCharDirName(name));
            // LoRAが空なら空行1つを追加しておく
            if (!loaded.lora || loaded.lora.length === 0) {
                loaded.lora = [{ name: '', strengthModel: 1.0, strengthClip: 1.0 }];
            }
            if (!loaded.outfits) {
                loaded.outfits = [];
            }
            loaded.outfits = loaded.outfits.map(outfit => ({
                ...outfit,
                lora: outfit.lora && outfit.lora.length > 0 ? outfit.lora : [createEmptyLora()],
            }));
            setConfig(loaded);
            setAliasesText((loaded.aliases || []).join(', '));
            setLoraDetailMode({});
            setIsDirty(false);
        } catch {
            setConfig({ ...DEFAULT_CONFIG });
            setAliasesText('');
        } finally {
            setIsLoading(false);
        }
    }, [backendUrl, getCharDirName]);

    const handleCharacterChange = (name: string) => {
        setSelectedCharacter(name);
        setSaveMessage(null);
        loadConfig(name);
    };

    useEffect(() => {
        if (!isOpen || !initialSelectedCharacter || characters.length === 0) return;
        const resolvedName = resolveCharacterName(initialSelectedCharacter);
        if (resolvedName && selectedCharacter !== resolvedName) {
            handleCharacterChange(resolvedName);
        }
    }, [isOpen, initialSelectedCharacter, characters, resolveCharacterName, selectedCharacter]);

    // フィールド更新
    const updateField = <K extends keyof CharacterImageGenConfig>(key: K, value: CharacterImageGenConfig[K]) => {
        setConfig(prev => ({ ...prev, [key]: value }));
        setIsDirty(true);
        setSaveMessage(null);
    };

    // LoRA操作
    const [loraDetailMode, setLoraDetailMode] = useState<Record<number, boolean>>({});

    const removeLora = (index: number) => {
        const remaining = config.lora.filter((_, i) => i !== index);
        // 全部消えた場合は空行を1つ残す（LoRA追加UIを維持するため）
        updateField('lora', remaining.length > 0 ? remaining : [{ name: '', strengthModel: 1.0, strengthClip: 1.0 }]);
        setLoraDetailMode(prev => {
            const next = { ...prev };
            delete next[index];
            return next;
        });
    };
    const updateLora = (index: number, field: string, value: string | number) => {
        const newLora = [...config.lora];
        if (!loraDetailMode[index] && (field === 'strengthModel' || field === 'strengthClip')) {
            // 簡易モード: M/C両方同じ値に
            newLora[index] = { ...newLora[index], strengthModel: value as number, strengthClip: value as number };
        } else {
            newLora[index] = { ...newLora[index], [field]: value };
        }
        updateField('lora', newLora);
    };

    // Danbooruタグ検索（Enter or ボタン押下時）
    const handleDanbooruSearch = useCallback(async () => {
        const q = danbooruQuery.trim();
        if (!q) return;
        setDanbooruLoading(true);
        setDanbooruResults([]);
        setDanbooruCopied(null);
        try {
            const result = await searchDanbooruTags(backendUrl, q, danbooruCharaFilter ? [3, 4] : []);
            if (result.success) {
                setDanbooruResults(result.results);
            }
        } catch { /* 無視 */ }
        setDanbooruLoading(false);
    }, [backendUrl, danbooruQuery, danbooruCharaFilter]);

    const handleDanbooruCopy = useCallback(async (value: string) => {
        const formatted = formatDanbooruTag(value, effectiveDanbooruTagFormat);
        try {
            await navigator.clipboard.writeText(formatted);
            setDanbooruCopied(formatted);
            setTimeout(() => setDanbooruCopied(null), 1500);
        } catch {
            setDanbooruCopied(null);
        }
    }, [effectiveDanbooruTagFormat]);

    // トリガーワード取得（ボタン押下時）
    const handleFetchTriggerWords = useCallback(async (idx: number, loraName: string) => {
        if (!loraName) return;
        if (triggerWords[loraName]) {
            return;
        }
        setTriggerWordsLoading(prev => ({ ...prev, [idx]: true }));
        try {
            const result = await getLoraTriggerWords(backendUrl, loraName);
            if (result.success) {
                setTriggerWords(prev => ({ ...prev, [loraName]: result.triggerWords }));
                const lines = (result.triggerLines && result.triggerLines.length > 0)
                    ? result.triggerLines
                    : (result.triggerWords.length > 0 ? [result.triggerWords.join(', ')] : []);
                setTriggerLines(prev => ({ ...prev, [loraName]: lines }));
            }
        } catch { /* 無視 */ }
        setTriggerWordsLoading(prev => ({ ...prev, [idx]: false }));
    }, [backendUrl, triggerWords]);

    // トリガーワードの「1行（グループ）」を LoRA の triggerWords フィールドに追加（ワード単位で重複除去）
    const addTriggerLineToLora = useCallback((loraIdx: number, line: string) => {
        const newLora = [...config.lora];
        const current = newLora[loraIdx].triggerWords || '';
        newLora[loraIdx] = { ...newLora[loraIdx], triggerWords: appendTriggerLineDedup(current, line, effectiveTriggerWordFormat) };
        updateField('lora', newLora);
    }, [config.lora, effectiveTriggerWordFormat, updateField]);

    // LoRA選択時に空行を自動追加
    const selectLora = (index: number, loraName: string) => {
        updateLora(index, 'name', loraName);
        setLoraDropdownIdx(null);
        setLoraSearchQuery('');
        // 最後の行で選択された場合、新しい空行を追加
        if (index === config.lora.length - 1 && loraName) {
            setTimeout(() => {
                updateField('lora', [...config.lora.map((l, i) => i === index ? { ...l, name: loraName } : l), { name: '', strengthModel: 1.0, strengthClip: 1.0 }]);
            }, 0);
        }
    };

    // 服装設定
    const updateOutfit = (
        outfitIndex: number,
        field: keyof CharacterImageGenConfig['outfits'][number],
        value: any
    ) => {
        const newOutfits = [...config.outfits];
        newOutfits[outfitIndex] = { ...newOutfits[outfitIndex], [field]: value };
        updateField('outfits', newOutfits);
    };

    const addOutfit = () => {
        updateField('outfits', [...config.outfits, createEmptyOutfit()]);
    };

    const removeOutfit = (outfitIndex: number) => {
        updateField('outfits', config.outfits.filter((_, i) => i !== outfitIndex));
    };

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
        updateField('outfits', newOutfits);
    };

    const selectOutfitLora = (outfitIndex: number, loraIndex: number, loraName: string) => {
        const newOutfits = [...config.outfits];
        const outfit = newOutfits[outfitIndex];
        const newLora = [...outfit.lora];
        newLora[loraIndex] = { ...newLora[loraIndex], name: loraName };
        if (loraIndex === newLora.length - 1 && loraName) {
            newLora.push(createEmptyLora());
        }
        newOutfits[outfitIndex] = { ...outfit, lora: newLora };
        updateField('outfits', newOutfits);
        setOutfitLoraDropdown(null);
        setOutfitLoraSearchQuery('');
    };

    const removeOutfitLora = (outfitIndex: number, loraIndex: number) => {
        const newOutfits = [...config.outfits];
        const outfit = newOutfits[outfitIndex];
        const newLora = outfit.lora.filter((_, i) => i !== loraIndex);
        newOutfits[outfitIndex] = {
            ...outfit,
            lora: newLora.length > 0 ? newLora : [createEmptyLora()],
        };
        updateField('outfits', newOutfits);
    };

    // 保存
    const handleSave = async () => {
        if (!selectedCharacter) return;
        setIsSaving(true);
        try {
            // 保存時に空行のLoRAを除外
            const cleanConfig = {
                ...config,
                lora: config.lora.filter(l => l.name),
                outfits: config.outfits
                    .map(outfit => ({
                        ...outfit,
                        name: outfit.name.trim(),
                        prompt: outfit.prompt.trim(),
                        lora: outfit.lora.filter(l => l.name),
                    }))
                    .filter(outfit => outfit.name || outfit.prompt || outfit.lora.length > 0),
            };
            await saveCharacterImageGenConfig(backendUrl, getCharDirName(selectedCharacter), cleanConfig);
            setIsDirty(false);
            setSaveMessage(COMMON.MESSAGES.SAVED);
            setTimeout(() => setSaveMessage(null), 3000);
        } catch (error) {
            console.error('[ComfyUICharacterSettingsModal] save failed:', error);
            setSaveMessage(COMMON.MESSAGES.SAVE_FAILED);
        } finally {
            setIsSaving(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
        >
            <div className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-xl border border-gray-700 overflow-hidden">
                {/* ヘッダー */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 bg-gray-800">
                    <h3 className="font-semibold text-gray-100 text-lg flex items-center gap-2">
                        <Users size={20} className="text-pink-400" />
                        {SECTION_NAMES.CHARACTER_SETTINGS}
                    </h3>
                    <button
                        onClick={onClose}
                        className="p-1.5 hover:bg-gray-700 rounded text-gray-400 hover:text-gray-200 transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* 本体 */}
                <div className="p-5 space-y-5 max-h-[60vh] overflow-y-auto custom-scrollbar">
                    {/* キャラクター選択（検索付き・インライン展開） */}
                    <div className="space-y-2" ref={dropdownRef}>
                        <label className="text-sm font-medium text-gray-400">{CHARACTER.LABELS.CHARACTER}</label>

                        {/* 選択表示ボタン */}
                        <div
                            onClick={() => { setIsDropdownOpen(!isDropdownOpen); setSearchQuery(''); }}
                            className="w-full bg-gray-800 border border-pink-600 rounded-lg px-3 py-2 text-sm text-gray-200 cursor-pointer hover:border-pink-400 transition-colors flex items-center justify-between"
                        >
                            <span className={selectedCharacter ? 'text-gray-200' : 'text-gray-500'}>
                                {selectedCharacter || CHARACTER.PLACEHOLDERS.SELECT_CHARACTER}
                            </span>
                            <Search size={14} className="text-gray-500" />
                        </div>

                        {/* インライン展開の検索+候補リスト */}
                        {isDropdownOpen && (
                            <div className="bg-gray-800 border border-gray-600 rounded-lg overflow-hidden">
                                <div className="p-2 border-b border-gray-700">
                                    <div className="relative">
                                        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                                        <input
                                            type="text"
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            placeholder={CHARACTER.PLACEHOLDERS.SEARCH_CHARACTER}
                                            autoFocus
                                            className="w-full bg-gray-900 border border-gray-700 rounded pl-8 pr-3 py-1.5 text-sm text-gray-200 placeholder-gray-500 outline-none focus:border-pink-500"
                                        />
                                    </div>
                                </div>
                                <div className="max-h-48 overflow-y-auto custom-scrollbar">
                                    {filteredCharacters.length > 0 ? (
                                        filteredCharacters.map((c) => (
                                            <button
                                                key={c.path}
                                                onClick={() => {
                                                    handleCharacterChange(c.name);
                                                    setIsDropdownOpen(false);
                                                    setSearchQuery('');
                                                }}
                                                className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                                                    selectedCharacter === c.name
                                                        ? 'bg-pink-600/30 text-pink-200'
                                                        : 'text-gray-300 hover:bg-gray-700'
                                                }`}
                                            >
                                                {c.name}
                                            </button>
                                        ))
                                    ) : (
                                        <p className="px-3 py-2 text-sm text-gray-500">{CHARACTER.MESSAGES.NO_RESULTS}</p>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {isLoading ? (
                        <div className="flex justify-center py-8">
                            <Loader2 size={24} className="animate-spin text-gray-500" />
                        </div>
                    ) : selectedCharacter ? (
                        <>
                            {/* キャラクター名・作品名 */}
                            <div className="space-y-1">
                                <label className="text-sm font-medium text-gray-400">
                                    {CHARACTER.LABELS.CHARACTER_AND_WORK}
                                    <span className="text-xs text-gray-600 ml-2">{CHARACTER.HELP.CHARACTER_JOINED}</span>
                                </label>
                                <div className="flex gap-2">
                                    <div className="flex-1 space-y-0.5">
                                        <span className="text-xs text-gray-500">{CHARACTER.LABELS.CHARACTER_NAME}</span>
                                        <input
                                            type="text"
                                            value={config.characterName}
                                            onChange={(e) => updateField('characterName', e.target.value)}
                                            placeholder={CHARACTER.PLACEHOLDERS.CHARACTER_NAME}
                                            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 outline-none focus:border-green-500 transition-colors"
                                        />
                                    </div>
                                    <div className="flex-1 space-y-0.5">
                                        <span className="text-xs text-gray-500">{CHARACTER.LABELS.WORK_NAME}</span>
                                        <input
                                            type="text"
                                            value={config.workName}
                                            onChange={(e) => updateField('workName', e.target.value)}
                                            placeholder={CHARACTER.PLACEHOLDERS.WORK_NAME}
                                            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 outline-none focus:border-green-500 transition-colors"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Danbooruタグ検索 */}
                            <div className="space-y-1.5">
                                <div className="flex items-center justify-between">
                                    <label className="text-sm font-medium text-gray-400">
                                        {DANBOORU.LABELS.TAG_SEARCH}
                                        <span className="text-xs text-gray-600 ml-2">{danbooruCharaFilter ? DANBOORU.LABELS.FILTER_ON_DESC : DANBOORU.LABELS.FILTER_OFF_DESC}</span>
                                    </label>
                                    <ToggleSwitch
                                        checked={danbooruCharaFilter}
                                        onChange={setDanbooruCharaFilter}
                                        label={DANBOORU.LABELS.CHARA_WORK_ONLY}
                                        labelClassName="text-xs text-gray-500"
                                        accent="green"
                                        size="sm"
                                    />
                                </div>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={danbooruQuery}
                                        onChange={(e) => setDanbooruQuery(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === 'Enter') handleDanbooruSearch(); }}
                                        placeholder={DANBOORU.PLACEHOLDERS.SEARCH_CHARA}
                                        className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 outline-none focus:border-green-500 transition-colors"
                                    />
                                    <button
                                        onClick={handleDanbooruSearch}
                                        disabled={danbooruLoading || !danbooruQuery.trim()}
                                        className="px-3 py-1.5 bg-gray-800 border border-green-700 rounded text-xs text-green-400 hover:bg-green-900/30 hover:text-green-300 disabled:opacity-50 transition-colors flex items-center gap-1"
                                    >
                                        <Search size={12} />
                                        {danbooruLoading ? COMMON.BUTTONS.SEARCHING : COMMON.BUTTONS.SEARCH}
                                    </button>
                                </div>
                                {danbooruResults.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5 pl-1">
                                        {danbooruResults.map((tag, i) => {
                                            const formattedValue = formatDanbooruTag(tag.value, effectiveDanbooruTagFormat);
                                            return (
                                                <span
                                                    key={i}
                                                    onClick={() => handleDanbooruCopy(tag.value)}
                                                    className={`border rounded px-2 py-1 text-xs cursor-pointer transition-colors ${
                                                        danbooruCopied === formattedValue
                                                            ? 'bg-green-700/40 border-green-500 text-green-200'
                                                            : 'bg-gray-800 border-gray-600 text-green-300 hover:bg-gray-700'
                                                    }`}
                                                    title={`${DANBOORU.MESSAGES.CLICK_TO_COPY}${tag.antecedent ? ` (${tag.antecedent})` : ''} [${tag.category === 4 ? DANBOORU.CATEGORY_NAMES[4] : DANBOORU.CATEGORY_NAMES[3]}] ${DANBOORU.MESSAGES.POST_COUNT}: ${tag.postCount}`}
                                                >
                                                    {formattedValue}
                                                    {danbooruCopied === formattedValue && <span className="ml-1 text-green-400">✓</span>}
                                                </span>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            {/* エイリアス（別名） */}
                            <div className="space-y-1">
                                <label className="text-sm font-medium text-gray-400">
                                    {CHARACTER.LABELS.ALIASES}
                                </label>
                                <input
                                    type="text"
                                    value={aliasesText}
                                    onChange={(e) => {
                                        setAliasesText(e.target.value);
                                        setIsDirty(true);
                                        setSaveMessage(null);
                                    }}
                                    onBlur={() => {
                                        const parsed = aliasesText.split(/[,、]/).map(s => s.trim()).filter(Boolean);
                                        updateField('aliases', parsed);
                                        setAliasesText(parsed.join(', '));
                                    }}
                                    placeholder={CHARACTER.PLACEHOLDERS.ALIASES}
                                    className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 outline-none focus:border-green-500 transition-colors"
                                />
                                <p className="text-xs text-gray-600">{CHARACTER.HELP.ALIASES_DESC}</p>
                            </div>

                            {/* キャラクタープロンプト */}
                            <div className="space-y-1">
                                <label className="text-sm font-medium text-gray-400">
                                    {CHARACTER.LABELS.CHARACTER_PROMPT}
                                    <span className="text-xs text-gray-600 ml-2">{CHARACTER.HELP.CHARACTER_JOINED}</span>
                                </label>
                                <textarea
                                    value={config.characterPrompt}
                                    onChange={(e) => updateField('characterPrompt', e.target.value)}
                                    placeholder={CHARACTER.PLACEHOLDERS.CHARACTER_PROMPT}
                                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-green-500 resize-y transition-colors"
                                    rows={2}
                                />
                                <p className="text-xs text-gray-600">{CHARACTER.HELP.CHARACTER_PROMPT_DESC}</p>
                            </div>

                            {/* 身体的特徴 */}
                            <div className="space-y-1">
                                <label className="text-sm font-medium text-gray-400">
                                    {CHARACTER.LABELS.PHYSICAL_FEATURES}
                                    <span className="text-xs text-gray-600 ml-2">→ {'__FEATURES__'}</span>
                                </label>
                                <textarea
                                    value={config.physicalFeatures}
                                    onChange={(e) => updateField('physicalFeatures', e.target.value)}
                                    placeholder={CHARACTER.PLACEHOLDERS.PHYSICAL_FEATURES}
                                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-green-500 resize-y transition-colors"
                                    rows={2}
                                />
                                <p className="text-xs text-gray-600">{CHARACTER.HELP.PHYSICAL_FEATURES_DESC}</p>
                            </div>

                            {/* LoRA */}
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <label className="text-sm font-medium text-gray-400">{CHARACTER.LABELS.LORA}</label>
                                    <button
                                        onClick={async () => {
                                            await refreshComfyUILoras(backendUrl);
                                            const loras = await getLorasByCategory(backendUrl, 'character');
                                            setAvailableLoras(loras);
                                        }}
                                        className="flex items-center gap-1 text-xs text-gray-500 hover:text-green-400 transition-colors"
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
                                        {/* 横並び: コンボ + 強度 + 詳細 + ゴミ箱 */}
                                        <div className="flex items-center gap-1.5">
                                            {/* LoRA選択ボタン */}
                                            <div
                                                onClick={() => {
                                                    setLoraDropdownIdx(loraDropdownIdx === idx ? null : idx);
                                                    setLoraSearchQuery('');
                                                }}
                                                className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm cursor-pointer hover:border-green-500 transition-colors flex items-center justify-between"
                                            >
                                                <span className={`truncate ${lora.name ? 'text-gray-200' : 'text-gray-500'}`}>
                                                    {lora.name || LORA.PLACEHOLDERS.SELECT_LORA}
                                                </span>
                                                <Search size={12} className="text-gray-500 shrink-0 ml-1" />
                                            </div>

                                            {/* 強度（選択済みのみ） */}
                                            {lora.name && (
                                                <>
                                                    {isDetail ? (
                                                        <>
                                                            <div className="flex items-center gap-0.5">
                                                                <span className="text-xs text-gray-500">M</span>
                                                                <input type="number" value={lora.strengthModel}
                                                                    onChange={(e) => updateLora(idx, 'strengthModel', parseFloat(e.target.value) || 0)}
                                                                    step={0.05} min={-2} max={2}
                                                                    className="w-14 bg-gray-800 border border-gray-700 rounded px-1 py-1 text-xs text-gray-200 outline-none focus:border-green-500" />
                                                            </div>
                                                            <div className="flex items-center gap-0.5">
                                                                <span className="text-xs text-gray-500">C</span>
                                                                <input type="number" value={lora.strengthClip}
                                                                    onChange={(e) => updateLora(idx, 'strengthClip', parseFloat(e.target.value) || 0)}
                                                                    step={0.05} min={-2} max={2}
                                                                    className="w-14 bg-gray-800 border border-gray-700 rounded px-1 py-1 text-xs text-gray-200 outline-none focus:border-green-500" />
                                                            </div>
                                                        </>
                                                    ) : (
                                                        <input type="number" value={lora.strengthModel}
                                                            onChange={(e) => updateLora(idx, 'strengthModel', parseFloat(e.target.value) || 0)}
                                                            step={0.05} min={-2} max={2}
                                                            className="w-14 bg-gray-800 border border-gray-700 rounded px-1 py-1 text-xs text-gray-200 outline-none focus:border-green-500"
                                                            title={LORA.LABELS.STRENGTH} />
                                                    )}
                                                    <button
                                                        onClick={() => setLoraDetailMode(prev => ({ ...prev, [idx]: !isDetail }))}
                                                        className={`px-1 py-0.5 rounded text-xs transition-colors shrink-0 ${isDetail ? 'bg-blue-600/30 text-blue-300' : 'bg-gray-800 text-gray-500 hover:text-gray-300'}`}
                                                        title={isDetail ? LORA.HELP.SIMPLE_MODE_TOOLTIP : LORA.HELP.DETAIL_MODE_TOOLTIP}
                                                    >
                                                        {isDetail ? LORA.LABELS.SIMPLE_MODE : LORA.LABELS.DETAIL_MODE}
                                                    </button>
                                                    <button onClick={() => removeLora(idx)}
                                                        className="p-0.5 text-gray-500 hover:text-red-400 transition-colors shrink-0" title={COMMON.BUTTONS.DELETE}>
                                                        <Trash2 size={14} />
                                                    </button>
                                                </>
                                            )}
                                            {/* 空行で最後でない場合のみ削除 */}
                                            {!lora.name && !isEmptyLast && (
                                                <button onClick={() => removeLora(idx)}
                                                    className="p-0.5 text-gray-500 hover:text-red-400 transition-colors shrink-0">
                                                    <Trash2 size={14} />
                                                </button>
                                            )}
                                        </div>

                                        {/* インライン展開の検索+候補リスト */}
                                        {loraDropdownIdx === idx && (
                                            <div className="bg-gray-800 border border-gray-600 rounded-lg overflow-hidden">
                                                <div className="p-2 border-b border-gray-700">
                                                    <div className="relative">
                                                        <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                                                        <input type="text" value={loraSearchQuery}
                                                            onChange={(e) => setLoraSearchQuery(e.target.value)}
                                                            placeholder={LORA.PLACEHOLDERS.SEARCH_LORA} autoFocus
                                                            className="w-full bg-gray-900 border border-gray-700 rounded pl-7 pr-3 py-1 text-xs text-gray-200 placeholder-gray-500 outline-none focus:border-green-500" />
                                                    </div>
                                                </div>
                                                <div className="max-h-40 overflow-y-auto custom-scrollbar">
                                                    {(() => {
                                                        const q = loraSearchQuery.trim().toLowerCase();
                                                        const filtered = q ? availableLoras.filter(l => l.toLowerCase().includes(q)) : availableLoras;
                                                        return filtered.length > 0 ? (
                                                            filtered.map(loraName => (
                                                                <button key={loraName} onClick={() => selectLora(idx, loraName)}
                                                                    className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                                                                        lora.name === loraName ? 'bg-green-600/30 text-green-200' : 'text-gray-300 hover:bg-gray-700'
                                                                    }`}>
                                                                    {loraName}
                                                                </button>
                                                            ))
                                                        ) : (
                                                            <p className="px-3 py-2 text-xs text-gray-500">{LORA.MESSAGES.NO_RESULTS}</p>
                                                        );
                                                    })()}
                                                </div>
                                            </div>
                                        )}
                                        {/* トリガーワード欄（LoRAごと） */}
                                        {lora.name && (
                                            <div className="space-y-1.5">
                                                {/* トリガーワード用テキストボックス */}
                                                <input
                                                    type="text"
                                                    value={lora.triggerWords || ''}
                                                    onChange={(e) => updateLora(idx, 'triggerWords', e.target.value)}
                                                    placeholder={TRIGGER_WORDS.PLACEHOLDERS.INPUT}
                                                    className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 outline-none focus:border-green-500 transition-colors"
                                                />
                                                {/* トリガーワード取得ボタン */}
                                                <button
                                                    onClick={() => handleFetchTriggerWords(idx, lora.name)}
                                                    className="px-2 py-1 bg-gray-800 border border-green-700 rounded text-xs text-green-400 hover:bg-green-900/30 hover:text-green-300 transition-colors"
                                                >
                                                    {triggerWordsLoading[idx] ? TRIGGER_WORDS.LABELS.FETCHING : triggerWords[lora.name] ? TRIGGER_WORDS.LABELS.FETCHED : TRIGGER_WORDS.LABELS.FETCH}
                                                </button>
                                                {triggerWords[lora.name] && (
                                                    <div className="space-y-1 pl-1">
                                                        {(triggerLines[lora.name] && triggerLines[lora.name].length > 0) ? triggerLines[lora.name].map((line, li) => {
                                                            const formattedLine = formatTriggerLine(line, effectiveTriggerWordFormat);
                                                            return (
                                                                <div key={li} className="flex items-center gap-1">
                                                                    <span
                                                                        onClick={() => { navigator.clipboard.writeText(formattedLine); }}
                                                                        className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-green-300 cursor-pointer hover:bg-gray-700 transition-colors break-words"
                                                                        title={COMMON.MESSAGES.COPY_ROW_TOOLTIP}
                                                                    >
                                                                        {formattedLine}
                                                                    </span>
                                                                    <button
                                                                        onClick={() => addTriggerLineToLora(idx, line)}
                                                                        className="px-1.5 py-0.5 bg-green-800/40 border border-green-700 rounded text-xs text-green-300 hover:bg-green-700/50 transition-colors shrink-0"
                                                                        title={TRIGGER_WORDS.MESSAGES.ADD_TOOLTIP}
                                                                    >
                                                                        {TRIGGER_WORDS.LABELS.ADD}
                                                                    </button>
                                                                </div>
                                                            );
                                                        }) : (
                                                            <span className="text-xs text-gray-600">{TRIGGER_WORDS.MESSAGES.NONE}</span>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                    );
                                })}
                                </div>
                                <p className="text-xs text-gray-600">{LORA.HELP.SELECT_AUTO_ADD} / {LORA.HELP.DETAIL_DESC}</p>
                            </div>

                            {/* 服装設定 */}
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <label className="text-sm font-medium text-gray-400">{CHARACTER.LABELS.OUTFIT_SETTINGS}</label>
                                    <div className="flex items-center gap-3">
                                        <button
                                            onClick={async () => {
                                                await refreshComfyUILoras(backendUrl);
                                                const loras = await getLorasByCategory(backendUrl, 'outfit');
                                                setAvailableOutfitLoras(loras);
                                            }}
                                            className="flex items-center gap-1 text-xs text-gray-500 hover:text-green-400 transition-colors"
                                            title={COMMON.MESSAGES.REFRESH_OUTFIT_TOOLTIP}
                                        >
                                            <RefreshCw size={12} />
                                            {COMMON.BUTTONS.REFRESH_LORA}
                                        </button>
                                        <button
                                            onClick={addOutfit}
                                            className="px-2 py-1 bg-gray-800 border border-green-700 rounded text-xs text-green-400 hover:bg-green-900/30 transition-colors"
                                        >
                                            {COMMON.BUTTONS.ADD}
                                        </button>
                                    </div>
                                </div>
                                <div className="space-y-3" ref={outfitLoraDropdownRef}>
                                    {config.outfits.length === 0 ? (
                                        <button
                                            onClick={addOutfit}
                                            className="w-full border border-dashed border-gray-700 rounded-lg px-3 py-3 text-sm text-gray-500 hover:border-green-700 hover:text-green-400 transition-colors"
                                        >
                                            {COMMON.BUTTONS.ADD_OUTFIT}
                                        </button>
                                    ) : (
                                        config.outfits.map((outfit, outfitIdx) => (
                                            <div key={outfitIdx} className="bg-gray-800/60 border border-gray-700 rounded-lg p-3 space-y-2">
                                                <div className="flex items-center gap-2">
                                                    <input
                                                        type="text"
                                                        value={outfit.name}
                                                        onChange={(e) => updateOutfit(outfitIdx, 'name', e.target.value)}
                                                        placeholder={CHARACTER.PLACEHOLDERS.OUTFIT_NAME}
                                                        className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 outline-none focus:border-green-500"
                                                    />
                                                    <button
                                                        onClick={() => removeOutfit(outfitIdx)}
                                                        className="p-1 text-gray-500 hover:text-red-400 transition-colors"
                                                        title={COMMON.MESSAGES.DELETE_OUTFIT_TOOLTIP}
                                                    >
                                                        <Trash2 size={15} />
                                                    </button>
                                                </div>
                                                <textarea
                                                    value={outfit.prompt}
                                                    onChange={(e) => updateOutfit(outfitIdx, 'prompt', e.target.value)}
                                                    placeholder={CHARACTER.PLACEHOLDERS.OUTFIT_PROMPT}
                                                    className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 outline-none focus:border-green-500 resize-y"
                                                    rows={2}
                                                />
                                                <div className="space-y-1">
                                                    <span className="text-xs text-gray-500">{CHARACTER.LABELS.OUTFIT_LORA}</span>
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
                                                                        className="flex-1 min-w-0 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs cursor-pointer hover:border-green-500 transition-colors flex items-center justify-between"
                                                                    >
                                                                        <span className={`truncate ${lora.name ? 'text-gray-200' : 'text-gray-500'}`}>
                                                                            {lora.name || LORA.PLACEHOLDERS.SELECT_LORA}
                                                                        </span>
                                                                        <Search size={12} className="text-gray-500 shrink-0 ml-1" />
                                                                    </div>
                                                                    {lora.name && (
                                                                        <>
                                                                            <input
                                                                                type="number"
                                                                                value={lora.strengthModel}
                                                                                onChange={(e) => {
                                                                                    const v = parseFloat(e.target.value) || 0;
                                                                                    updateOutfitLora(outfitIdx, loraIdx, 'strengthModel', v);
                                                                                }}
                                                                                step={0.05}
                                                                                min={-2}
                                                                                max={2}
                                                                                className="w-14 bg-gray-900 border border-gray-700 rounded px-1 py-1 text-xs text-gray-200 outline-none focus:border-green-500"
                                                                                title={LORA.LABELS.STRENGTH}
                                                                            />
                                                                            <button
                                                                                onClick={() => removeOutfitLora(outfitIdx, loraIdx)}
                                                                                className="p-0.5 text-gray-500 hover:text-red-400 transition-colors"
                                                                                title={COMMON.BUTTONS.DELETE}
                                                                            >
                                                                                <Trash2 size={14} />
                                                                            </button>
                                                                        </>
                                                                    )}
                                                                    {!lora.name && !isEmptyLast && (
                                                                        <button
                                                                            onClick={() => removeOutfitLora(outfitIdx, loraIdx)}
                                                                            className="p-0.5 text-gray-500 hover:text-red-400 transition-colors"
                                                                        >
                                                                            <Trash2 size={14} />
                                                                        </button>
                                                                    )}
                                                                </div>
                                                                {dropdownOpen && (
                                                                    <div className="bg-gray-900 border border-gray-600 rounded-lg overflow-hidden">
                                                                        <div className="p-2 border-b border-gray-700">
                                                                            <div className="relative">
                                                                                <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                                                                                <input
                                                                                    type="text"
                                                                                    value={outfitLoraSearchQuery}
                                                                                    onChange={(e) => setOutfitLoraSearchQuery(e.target.value)}
                                                                                    placeholder={LORA.PLACEHOLDERS.SEARCH_LORA}
                                                                                    autoFocus
                                                                                    className="w-full bg-gray-950 border border-gray-700 rounded pl-7 pr-3 py-1 text-xs text-gray-200 placeholder-gray-500 outline-none focus:border-green-500"
                                                                                />
                                                                            </div>
                                                                        </div>
                                                                        <div className="max-h-36 overflow-y-auto custom-scrollbar">
                                                                            {filtered.length > 0 ? (
                                                                                filtered.map(loraName => (
                                                                                    <button
                                                                                        key={loraName}
                                                                                        onClick={() => selectOutfitLora(outfitIdx, loraIdx, loraName)}
                                                                                        className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                                                                                            lora.name === loraName ? 'bg-green-600/30 text-green-200' : 'text-gray-300 hover:bg-gray-700'
                                                                                        }`}
                                                                                    >
                                                                                        {loraName}
                                                                                    </button>
                                                                                ))
                                                                            ) : (
                                                                                <p className="px-3 py-2 text-xs text-gray-500">{LORA.MESSAGES.NO_RESULTS}</p>
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
                                <p className="text-xs text-gray-600">{CHARACTER.HELP.OUTFIT_DESC}</p>
                            </div>

                            {/* 追加ポジティブ */}
                            <div className="space-y-1">
                                <label className="text-sm font-medium text-gray-400">
                                    {CHARACTER.LABELS.EXTRA_POSITIVE}
                                    <span className="text-xs text-gray-600 ml-2">→ {'__EXTRA_POSITIVE__'}</span>
                                </label>
                                <input
                                    type="text"
                                    value={config.extraPositive}
                                    onChange={(e) => updateField('extraPositive', e.target.value)}
                                    placeholder={CHARACTER.PLACEHOLDERS.EXTRA_POSITIVE}
                                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-green-500 transition-colors"
                                />
                            </div>

                            {/* 追加ネガティブ */}
                            <div className="space-y-1">
                                <label className="text-sm font-medium text-gray-400">
                                    {CHARACTER.LABELS.EXTRA_NEGATIVE}
                                    <span className="text-xs text-gray-600 ml-2">→ {'__EXTRA_NEGATIVE__'}</span>
                                </label>
                                <input
                                    type="text"
                                    value={config.extraNegative}
                                    onChange={(e) => updateField('extraNegative', e.target.value)}
                                    placeholder={CHARACTER.PLACEHOLDERS.EXTRA_NEGATIVE}
                                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-green-500 transition-colors"
                                />
                            </div>
                        </>
                    ) : (
                        <p className="text-sm text-gray-600 text-center py-4">
                            {CHARACTER.MESSAGES.SELECT_CHARACTER}
                        </p>
                    )}
                </div>

                {/* フッター */}
                <div className="flex items-center justify-between px-5 py-4 border-t border-gray-700 bg-gray-800/50">
                    <div className="flex items-center gap-3">
                        <div className="text-sm">
                            {saveMessage && (
                                <span className={saveMessage === COMMON.MESSAGES.SAVE_FAILED ? 'text-red-400' : 'text-green-400'}>
                                    {saveMessage}
                                </span>
                            )}
                        </div>
                        {onOpenIntegrated && (
                            <button
                                onClick={() => { onClose(); onOpenIntegrated(); }}
                                className="px-3 py-1.5 text-xs text-purple-300 border border-purple-600/50 rounded hover:bg-purple-900/30 transition-colors"
                            >
                                {INTEGRATED.OPEN_BUTTON_LABEL}
                            </button>
                        )}
                    </div>
                    <div className="flex gap-3">
                        <button
                            onClick={onClose}
                            className="px-5 py-2 text-sm text-gray-300 hover:text-gray-100 hover:bg-gray-700 rounded-lg transition-colors"
                        >
                            {COMMON.BUTTONS.CLOSE}
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={isSaving || !selectedCharacter || !isDirty}
                            className="px-5 py-2 text-sm text-white bg-green-600 hover:bg-green-500 disabled:opacity-40 rounded-lg transition-colors flex items-center gap-1.5"
                        >
                            <Save size={14} />
                            {isSaving ? COMMON.BUTTONS.SAVING : COMMON.BUTTONS.SAVE}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
