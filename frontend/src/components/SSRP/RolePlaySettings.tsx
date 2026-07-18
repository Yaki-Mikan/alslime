import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { X, Check, Save, Plus, ChevronDown, ChevronRight, Trash2, RotateCcw, Pin, PinOff, Search, Image, MessageSquare, FolderOpen, SlidersHorizontal, Users, Globe, FileText } from 'lucide-react';
import { ToggleSwitch } from '../common/ToggleSwitch';
import { listFiles, getCharacterTags, getCharacterFilters } from '../../api/files';
import type { CharacterTagInfo } from '../../api/files';
import {
    listPresets,
    savePreset,
    loadPreset,
    getRelationshipOptions
} from '../../api/ssrp';
import type { RelationshipOption } from '../../api/ssrp';
import {
    getParameterSchemas,
    getParameterSchema,
    initializeParameterGroups
} from '../../api/parameters';
import type { ParameterSchema, ParameterGroupState } from '../../types/Parameter';
import { RenderGroup } from '../common/ParameterElements';
import { DateTimeSettings } from './DateTimeSettings';
import { CharacterImagePanel } from './CharacterImagePanel';
import { ComfyUICharacterSettingsModal } from '../comfyui/ComfyUICharacterSettingsModal';
import { ComfyUIIntegratedSettingsModal } from '../comfyui/ComfyUIIntegratedSettingsModal';
import { INTEGRATED } from '../comfyui/constants';
import type { DateTimeSettingsState } from '../../types/datetime';
import { getDefaultDateTimeSettings } from '../../types/datetime';
import { getGlobalSettings, updateGlobalSettings } from '../../api/global-settings';
import { WORKSPACE_PATHS, CHARACTER_SUBDIRS } from '../../constants/workspacePaths';
import {
    listSSRPAllPresets,
    getSSRPAllPreset,
    saveSSRPAllPreset,
    deleteSSRPAllPreset,
    listSSRPParamPresets,
    getSSRPParamPreset,
    saveSSRPParamPreset,
    deleteSSRPParamPreset
} from '../../api/datetime-presets';
import type { SSRPAllPreset, SSRPParamPreset } from '../../api/datetime-presets';
import { resolveMessage, type I18NCatalog } from '../../api/i18n';
import { SSRP_I18N_KEYS, SSRP_TEXT_FALLBACK_JA } from '../../constants/i18n';


interface RolePlaySettingsProps {
    isOpen: boolean;
    onClose: () => void;
    onStartSession: (settings: any) => void;
    initialSettings?: any;
    backendUrl: string;
    canRestoreSessionSettings?: boolean;
    onConversationPresetChanged?: () => void;
    onRestoreSessionSettings?: () => void;
    /** 既存セッションで設定が未反映変更ありのとき、会話開始ボタンの上に反映ボタンを表示する */
    canApplyToSession?: boolean;
    onApplyToSession?: () => void;
    applyToSessionState?: 'idle' | 'applying' | 'done';
    /** SSRP設定でdirectiveModeが未指定の場合に使用するデフォルト値（通常設定から） */
    fallbackDirectiveMode?: 'A' | 'B' | 'C';
    /** 基本チャット設定のデフォルトユーザー名（空なら言語別デフォルト名を使用） */
    defaultUserNameSetting?: string;
    uiCatalog: I18NCatalog | null;
}

export interface RolePlaySettingsHandlers {
    getCurrentSettings: () => any;
    loadPreset: (name: string) => Promise<void>;
    applySettings: (settings: any) => void;
}

// 汎用的な選択肢型
interface Option {
    label: string;
    value: string;
}

/**
 * ディレクトリを再帰的に探索して .md ファイルの一覧を返す。
 * サブディレクトリにあるファイルは「ディレクトリ名/ファイル名」形式でラベルを付ける。
 * サブディレクトリの探索は並列実行し、結果は元の走査順を維持して結合する。
 */
async function loadDirRecursive(dirPath: string, prefix: string = ''): Promise<Option[]> {
    try {
        const res = await listFiles(dirPath);
        const parts = await Promise.all(res.files.map(async (f): Promise<Option[]> => {
            if (f.isDirectory) {
                const subPrefix = prefix ? `${prefix}/${f.name}` : f.name;
                return loadDirRecursive(f.path, subPrefix);
            }
            if (f.name.endsWith('.md')) {
                const baseName = f.name.replace('.md', '');
                const label = prefix ? `${prefix}/${baseName}` : baseName;
                return [{ label, value: f.path }];
            }
            return [];
        }));
        return parts.flat();
    } catch {
        // アクセスできないディレクトリは無視
        return [];
    }
}

// SSRPオプション一式（キャラ・カテゴリ・フィルタ・関係性）
interface SSRPOptionsData {
    charOptions: Option[];
    tagMap: Record<string, { work: string | null; tags: string[] }>;
    filterWorks: string[];
    filterTags: string[];
    situations: Option[];
    users: Option[];
    worlds: Option[];
    stages: Option[];
    writingStyles: Option[];
    relationshipOptions: RelationshipOption[];
}

// メニューを開くたびに全カテゴリの再帰スキャン（数十リクエスト）が走るのを防ぐキャッシュ。
// キャッシュがあれば即時表示し、TTL経過後はバックグラウンドで再取得して差し替える。
let ssrpOptionsCache: { data: SSRPOptionsData; fetchedAt: number } | null = null;
const SSRP_OPTIONS_CACHE_TTL_MS = 30_000;

async function fetchSSRPOptions(backendUrl: string): Promise<SSRPOptionsData> {
    // 各取得は互いに独立しているため全て並列で実行する
    const [charTagsResult, filtersResult, situations, users, worlds, stages, writingStyles, relationshipOptions] = await Promise.all([
        getCharacterTags(),
        getCharacterFilters(),
        loadDirRecursive(WORKSPACE_PATHS.SITUATIONS),
        loadDirRecursive(WORKSPACE_PATHS.USERS),
        loadDirRecursive(WORKSPACE_PATHS.WORLDVIEWS),
        loadDirRecursive(WORKSPACE_PATHS.STAGES),
        loadDirRecursive(WORKSPACE_PATHS.WRITING_STYLES),
        getRelationshipOptions(backendUrl)
    ]);
    const tagMap: Record<string, { work: string | null; tags: string[] }> = {};
    for (const c of charTagsResult.characters) {
        tagMap[c.path] = { work: c.work, tags: c.tags };
    }
    return {
        charOptions: charTagsResult.characters.map((c: CharacterTagInfo) => ({
            label: c.name,
            value: c.path
        })),
        tagMap,
        filterWorks: filtersResult.works || [],
        filterTags: filtersResult.tags || [],
        situations,
        users,
        worlds,
        stages,
        writingStyles,
        relationshipOptions
    };
}

// キャラクター詳細設定型
interface Correlation {
    targetId: string;
    targetName: string;
    relationship: string;
    details: string;
    favorability?: number;
}

interface CharacterDetail {
    individualBackground?: string; // 後方互換性
    individualBackgrounds?: string[];
    individualOutfits?: string[];
    individualPersonalities?: string[];
    correlations: Correlation[];
    // 外部化されたパラメータグループ（動的スキーマベース）
    parameterGroups?: ParameterGroupState[];
    isOpen?: boolean; // UI用: 詳細設定の開閉状態
    isCorrelationOpen?: boolean; // UI用: 相関関係の開閉状態
    isIndividualOpen?: boolean; // UI用: 個別設定（性格・服装・背景）の開閉状態
    // 追加服装設定
    additionalOutfitEnabled?: boolean;
    additionalOutfitText?: string;
    // 追加背景設定
    additionalBackgroundEnabled?: boolean;
    additionalBackgroundText?: string;
    // 追加性格設定
    additionalPersonalityEnabled?: boolean;
    additionalPersonalityText?: string;
}

// 選択リスト操作の共通ヘルパー（最後の要素を選択したら空スロットを追加、最大5件）
function listWithChange(idx: number, val: string, list: string[]): string[] {
    const next = [...list];
    next[idx] = val;
    if (val && idx === next.length - 1 && next.length < 5) next.push('');
    return next;
}

function listWithDelete(idx: number, list: string[]): string[] {
    const next = list.filter((_, i) => i !== idx);
    if (next.length === 0) next.push('');
    return next;
}

function getCharacterNameFromPath(charPath: string): string {
    return charPath.split('/').pop()?.replace(/\.md$/, '') || charPath;
}

// React.memo の props 安定用の空配列（毎レンダー `|| []` で新配列を作らない）
const EMPTY_OPTIONS: Option[] = [];

// 汎用グリッド選択モーダル
const GridSelectionModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onSelect: (value: string) => void;
    options: { label: string; value: string; description?: string }[];
    title: string;
    emptyLabel?: string;
    searchable?: boolean;
    searchPlaceholder: string;
    noMatchTemplate: string;
    // 現在選択中の値。該当カードを選択状態で表示し、開いた時に見える位置へスクロールする
    selectedValue?: string;
    // 横広・列少なめレイアウト（キャラクター選択用。スマホ幅では1列）
    wide?: boolean;
}> = ({ isOpen, onClose, onSelect, options, title, emptyLabel, searchable = false, searchPlaceholder, noMatchTemplate, selectedValue, wide = false }) => {
    // 入力中の値（debounce対象）
    const [searchInput, setSearchInput] = useState('');
    // 実際に絞り込みに使う値
    const [searchTerm, setSearchTerm] = useState('');
    // IME変換中フラグ（変換中のEnterで検索が走らないようにする）
    const isComposingRef = useRef(false);
    // 選択中カードへの参照（開いた時のスクロール用）
    const selectedRef = useRef<HTMLButtonElement | null>(null);

    // モーダルが閉じたら検索状態を初期化
    useEffect(() => {
        if (!isOpen) {
            setSearchInput('');
            setSearchTerm('');
        }
    }, [isOpen]);

    // 開いた時に選択中カードが見えるようスクロール
    useEffect(() => {
        if (isOpen) {
            selectedRef.current?.scrollIntoView({ block: 'center' });
        }
    }, [isOpen]);

    // 入力から1秒経過で自動検索
    useEffect(() => {
        if (!searchable) return;
        const timer = setTimeout(() => {
            setSearchTerm(searchInput);
        }, 1000);
        return () => clearTimeout(timer);
    }, [searchInput, searchable]);

    if (!isOpen) return null;

    const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        // IME変換中のEnterは確定操作なので検索をトリガーしない
        // - isComposingRef: compositionstart/end で管理
        // - e.nativeEvent.isComposing: Chromium系のフォールバック
        // - keyCode === 229: Safari等のフォールバック
        if (e.key !== 'Enter') return;
        if (isComposingRef.current) return;
        if (e.nativeEvent.isComposing) return;
        if (e.keyCode === 229) return;
        e.preventDefault();
        setSearchTerm(searchInput);
    };

    const normalizedTerm = searchTerm.trim().toLowerCase();
    const filteredOptions = normalizedTerm
        ? options.filter(opt => opt.label.toLowerCase().includes(normalizedTerm))
        : options;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fade-in">
            <div className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-4xl border border-gray-700 max-h-[80vh] flex flex-col overflow-hidden">
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700 bg-gray-800">
                    <h3 className="text-lg font-semibold text-gray-100">{title}</h3>
                    <button onClick={onClose} className="p-1.5 hover:bg-gray-700 rounded text-gray-400 hover:text-gray-200 transition-colors">
                        <X size={20} />
                    </button>
                </div>
                {searchable && (
                    <div className="p-3 border-b border-gray-700 bg-gray-800/60">
                        <div className="relative">
                            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                            <input
                                type="text"
                                value={searchInput}
                                onChange={(e) => setSearchInput(e.target.value)}
                                onCompositionStart={() => { isComposingRef.current = true; }}
                                onCompositionEnd={() => { isComposingRef.current = false; }}
                                onKeyDown={handleSearchKeyDown}
                                placeholder={searchPlaceholder}
                                className="w-full bg-gray-900 border border-gray-700 rounded pl-9 pr-3 py-2 text-sm text-gray-200 placeholder-gray-500 outline-none focus:border-blue-500 transition-colors"
                            />
                        </div>
                    </div>
                )}
                <div className="overflow-y-auto p-4 flex-1 custom-scrollbar">
                    <div className={wide ? 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3' : 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3'}>
                        {emptyLabel !== undefined && (
                            <button
                                onClick={() => onSelect('')}
                                className="text-left p-3 rounded hover:bg-gray-700 transition-colors border border-gray-700/50 hover:border-gray-500 h-full flex items-center justify-center min-h-[80px]"
                            >
                                <div className="font-bold text-gray-400 text-center">{emptyLabel}</div>
                            </button>
                        )}
                        {filteredOptions.map(opt => {
                            const isSelected = selectedValue !== undefined && selectedValue !== '' && opt.value === selectedValue;
                            return (
                                <button
                                    key={opt.value}
                                    ref={isSelected ? selectedRef : undefined}
                                    onClick={() => onSelect(opt.value)}
                                    className={`text-left p-3 rounded transition-colors border group h-full flex flex-col justify-center min-h-[80px] ${isSelected
                                        ? 'bg-blue-600/20 border-blue-500'
                                        : 'border-gray-700/50 hover:bg-gray-700 hover:border-blue-500/50'}`}
                                >
                                    <div className={`font-bold break-words w-full text-center ${isSelected ? 'text-blue-300' : 'text-gray-200 group-hover:text-blue-400'}`}>{opt.label}</div>
                                    {opt.description && (
                                        <div className={`text-xs mt-1 text-center ${isSelected ? 'text-blue-200/70' : 'text-gray-500 group-hover:text-gray-400'}`}>{opt.description}</div>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                    {searchable && normalizedTerm && filteredOptions.length === 0 && (
                        <div className="text-center text-gray-500 text-sm mt-6">
                            {noMatchTemplate.split('{{searchTerm}}').join(searchTerm)}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

// 選択セクション（世界観・舞台・シチュエーション・ユーザー・文体）。
// 巨大な親の再レンダーから切り離すため React.memo で包む。
// setter は useState の dispatch（参照不変）を直接受けるため、
// 自セクションの selected / options が変わらない限り再レンダーされない。
const SelectSection = React.memo<{
    title: string;
    options: Option[];
    selected: string[];
    setter: React.Dispatch<React.SetStateAction<string[]>>;
    placeholder: string;
}>(({ title, options, selected, setter, placeholder }) => (
    <div className="space-y-2">
        <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">{title}</h3>
        {selected.map((val, idx) => (
            <div key={idx} className="flex flex-col gap-2 animate-fade-in">
                <div className="flex gap-2">
                    <select
                        value={val}
                        onChange={(e) => setter(prev => listWithChange(idx, e.target.value, prev))}
                        className="flex-1 min-w-0 bg-gray-800 border-gray-700 text-gray-200 rounded-md p-2 text-sm outline-none focus:border-blue-500 border outline-none transition-all"
                    >
                        <option value="">{placeholder}</option>
                        {options.map((opt) => (
                            <option key={opt.value} value={opt.value} disabled={selected.includes(opt.value) && val !== opt.value}>
                                {opt.label}
                            </option>
                        ))}
                    </select>
                    {(val || (idx !== selected.length - 1 && selected.length > 1)) && (
                        <button
                            onClick={() => setter(prev => listWithDelete(idx, prev))}
                            className="text-gray-500 hover:text-red-400 p-2 rounded hover:bg-gray-800 transition-colors"
                        >
                            <Trash2 size={16} />
                        </button>
                    )}
                </div>
            </div>
        ))}
    </div>
));
SelectSection.displayName = 'SelectSection';

// キャラクター詳細設定パネル（1キャラ分）。
// 旧 renderCharacterDetail の抽出。親（RolePlaySettings）は state 64 個を持ち
// どれか 1 つの変更で全体が再レンダーされるため、ここを React.memo で切り離す。
// updateDetail は `{...prev, [charPath]: ...}` 形式なので、他キャラの編集や
// 追加設定テキスト入力では detail の参照が変わらず再レンダーがスキップされる。
interface CharacterDetailPanelProps {
    charPath: string;
    detail: CharacterDetail;
    parameterSchema: ParameterSchema | null;
    uiCatalog: I18NCatalog | null;
    backendUrl: string;
    ssrpParamPresets: string[];
    userName: string;
    relationshipOptions: RelationshipOption[];
    personalityOptions: Option[];
    outfitOptions: Option[];
    backgroundOptions: Option[];
    onUpdateDetail: (charPath: string, updater: (d: CharacterDetail) => CharacterDetail) => void;
    /** ユーザー名入力（全キャラの user 相関 targetName も同期する） */
    onUserNameInput: (name: string) => void;
    /** ユーザー名の単純セット（プリセット復元用。相関同期はプリセット適用側で行う） */
    onUserNameSet: (name: string) => void;
    onParamPresetsChange: (presets: string[]) => void;
    onFetchRelationshipOptions: () => void;
    onSelectRelation: (charPath: string, targetIdx: number) => void;
    onOpenImageSettings: (charPath: string) => void;
    onUpdateCorrelation: (charPath: string, idx: number, field: keyof Correlation, val: any) => void;
    onUpdateParamGroup: (charPath: string, groupId: string, updates: Partial<ParameterGroupState>) => void;
    onUpdateParamValue: (charPath: string, groupId: string, elementId: string, value: any) => void;
}

const CharacterDetailPanel = React.memo<CharacterDetailPanelProps>(({
    charPath,
    detail,
    parameterSchema,
    uiCatalog,
    backendUrl,
    ssrpParamPresets,
    userName,
    relationshipOptions,
    personalityOptions,
    outfitOptions,
    backgroundOptions,
    onUpdateDetail,
    onUserNameInput,
    onUserNameSet,
    onParamPresetsChange,
    onFetchRelationshipOptions,
    onSelectRelation,
    onOpenImageSettings,
    onUpdateCorrelation,
    onUpdateParamGroup,
    onUpdateParamValue,
}) => {
    const t = (key: string) => resolveMessage(uiCatalog, key, SSRP_TEXT_FALLBACK_JA[key] || key);
    const formatText = (template: string, values: Record<string, string | number>) => {
        return Object.entries(values).reduce((text, [key, value]) => {
            return text.split(`{{${key}}}`).join(String(value));
        }, template);
    };

    // プリセット名入力への参照。複数キャラの詳細パネルが同時に開いていても、
    // 保存ボタンが必ず自パネルの入力欄を読むようにする（document.querySelector だと
    // 文書順で最初のパネルの入力欄を拾ってしまう）。
    const presetNameInputRef = useRef<HTMLInputElement | null>(null);

    // 詳細設定をデフォルト値にリセットする関数
    const resetToDefault = () => {
        onUpdateDetail(charPath, d => ({
            individualBackground: '',
            individualBackgrounds: [''],
            individualOutfits: [''],
            individualPersonalities: [''],
            correlations: d.correlations.map(c => ({
                ...c,
                relationship: '',
                details: '',
                favorability: 0
            })),
            parameterGroups: parameterSchema ? initializeParameterGroups(parameterSchema) : undefined,
            isOpen: d.isOpen
        }));
    };

    const saveParamPreset = async (name: string) => {
        const userCorrelation = detail.correlations.find(c => c.targetId === 'user');
        const preset: SSRPParamPreset = {
            userName, // ユーザー名を保存
            individualBackground: detail.individualBackgrounds?.filter(Boolean)[0] || '',
            individualBackgrounds: detail.individualBackgrounds?.filter(Boolean) || [],
            individualOutfits: detail.individualOutfits?.filter(Boolean) || [],
            individualPersonalities: detail.individualPersonalities?.filter(Boolean) || [],
            parameterGroups: detail.parameterGroups,
            userCorrelation: userCorrelation ? {
                relationship: userCorrelation.relationship,
                details: userCorrelation.details,
                favorability: userCorrelation.favorability ?? 0
            } : undefined,
            // 追加服装・追加背景・追加性格設定
            additionalOutfitEnabled: detail.additionalOutfitEnabled,
            additionalOutfitText: detail.additionalOutfitText,
            additionalBackgroundEnabled: detail.additionalBackgroundEnabled,
            additionalBackgroundText: detail.additionalBackgroundText,
            additionalPersonalityEnabled: detail.additionalPersonalityEnabled,
            additionalPersonalityText: detail.additionalPersonalityText,
        };
        await saveSSRPParamPreset(backendUrl, name, preset);
        onParamPresetsChange(await listSSRPParamPresets(backendUrl));
    };

    return (
        <div className="ml-2 pl-3 border-l-2 border-gray-700 space-y-4 mb-4 mt-1 bg-gray-800/30 rounded-r p-3 relative group">
            <div className="flex items-center justify-between">
                <button
                    onClick={() => onUpdateDetail(charPath, d => ({ ...d, isOpen: !d.isOpen }))}
                    className="flex-1 flex items-center text-xs text-gray-400 hover:text-white text-left font-medium outline-none py-2 -ml-2 pl-2 hover:bg-gray-700/30 rounded"
                >
                    {detail.isOpen ? <ChevronDown size={16} className="mr-1.5" /> : <ChevronRight size={16} className="mr-1.5" />}
                    {t(SSRP_I18N_KEYS.characterDetail)}
                </button>
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onOpenImageSettings(charPath);
                    }}
                    className="p-1.5 text-gray-500 hover:text-pink-300 hover:bg-gray-700/50 rounded transition-colors ml-2"
                    title={t(SSRP_I18N_KEYS.characterImageSettingsTitle)}
                >
                    <Image size={14} />
                </button>
                {detail.isOpen && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            resetToDefault();
                        }}
                        className="flex items-center gap-1 text-xs text-gray-500 hover:text-orange-400 hover:bg-gray-700/50 px-2 py-1.5 rounded transition-colors ml-2"
                        title={t(SSRP_I18N_KEYS.resetToDefaultTitle)}
                    >
                        <RotateCcw size={14} />
                        {t(SSRP_I18N_KEYS.reset)}
                    </button>
                )}
            </div>

            {detail.isOpen && (
                <div className="space-y-5 animate-fade-in pl-1">
                    {/* 詳細設定プリセット */}
                    <div className="space-y-2 pb-3 border-b border-gray-700/50">
                        <label className="text-xs text-gray-500 font-medium">{t(SSRP_I18N_KEYS.characterDetailPreset)}</label>
                        <div className="flex gap-2">
                            <select
                                className="flex-1 bg-gray-900 border-gray-700 text-gray-200 rounded text-xs p-2 appearance-none outline-none focus:border-blue-500 transition-colors"
                                onChange={async (e) => {
                                    const name = e.target.value;
                                    if (!name) return;
                                    const preset = await getSSRPParamPreset(backendUrl, name);
                                    if (preset) {
                                        // ユーザー名を復元
                                        if (preset.userName) {
                                            onUserNameSet(preset.userName);
                                        }
                                        onUpdateDetail(charPath, d => ({
                                            ...d,
                                            individualBackground: preset.individualBackground || d.individualBackground,
                                            individualBackgrounds: (preset.individualBackgrounds && preset.individualBackgrounds.length > 0) ? [...preset.individualBackgrounds, ''] : (preset.individualBackground ? [preset.individualBackground, ''] : d.individualBackgrounds || ['']),
                                            individualOutfits: (preset.individualOutfits && preset.individualOutfits.length > 0) ? [...preset.individualOutfits, ''] : d.individualOutfits || [''],
                                            individualPersonalities: (preset.individualPersonalities && preset.individualPersonalities.length > 0) ? [...preset.individualPersonalities, ''] : d.individualPersonalities || [''],
                                            parameterGroups: preset.parameterGroups ? JSON.parse(JSON.stringify(preset.parameterGroups)) : d.parameterGroups,
                                            // 追加服装・追加背景・追加性格設定の復元
                                            additionalOutfitEnabled: preset.additionalOutfitEnabled ?? d.additionalOutfitEnabled,
                                            additionalOutfitText: preset.additionalOutfitText ?? d.additionalOutfitText,
                                            additionalBackgroundEnabled: preset.additionalBackgroundEnabled ?? d.additionalBackgroundEnabled,
                                            additionalBackgroundText: preset.additionalBackgroundText ?? d.additionalBackgroundText,
                                            additionalPersonalityEnabled: preset.additionalPersonalityEnabled ?? d.additionalPersonalityEnabled,
                                            additionalPersonalityText: preset.additionalPersonalityText ?? d.additionalPersonalityText,
                                            correlations: d.correlations.map(c => {
                                                if (c.targetId === 'user') {
                                                    return {
                                                        ...c,
                                                        // ユーザー名をtargetNameに反映
                                                        targetName: preset.userName || c.targetName,
                                                        ...(preset.userCorrelation ? {
                                                            relationship: preset.userCorrelation.relationship,
                                                            details: preset.userCorrelation.details,
                                                            favorability: preset.userCorrelation.favorability
                                                        } : {})
                                                    };
                                                }
                                                return c;
                                            })
                                        }));
                                    }
                                    e.target.value = '';
                                }}
                            >
                                <option value="">{t(SSRP_I18N_KEYS.presetLoadPlaceholder)}</option>
                                {ssrpParamPresets.map(p => (
                                    <option key={p} value={p}>{p}</option>
                                ))}
                            </select>
                            {ssrpParamPresets.length > 0 && (
                                <select
                                    className="bg-gray-900 border-gray-700 text-gray-200 rounded text-xs p-2 appearance-none outline-none focus:border-red-500 transition-colors"
                                    onChange={async (e) => {
                                        const name = e.target.value;
                                        if (!name) return;
                                        await deleteSSRPParamPreset(backendUrl, name);
                                        onParamPresetsChange(await listSSRPParamPresets(backendUrl));
                                        e.target.value = '';
                                    }}
                                >
                                    <option value="">{t(SSRP_I18N_KEYS.presetDeletePlaceholder)}</option>
                                    {ssrpParamPresets.map(p => (
                                        <option key={p} value={p}>{p}</option>
                                    ))}
                                </select>
                            )}
                        </div>
                        <div className="flex gap-2">
                            <input
                                ref={presetNameInputRef}
                                type="text"
                                placeholder={t(SSRP_I18N_KEYS.presetNameSavePlaceholder)}
                                className="flex-1 bg-gray-900 border-gray-700 text-gray-200 rounded text-xs p-2 outline-none focus:border-blue-500 transition-colors"
                                onKeyDown={async (e) => {
                                    if (e.key === 'Enter') {
                                        const name = (e.target as HTMLInputElement).value.trim();
                                        if (!name) return;
                                        await saveParamPreset(name);
                                        (e.target as HTMLInputElement).value = '';
                                    }
                                }}
                            />
                            <button
                                onClick={async () => {
                                    const input = presetNameInputRef.current;
                                    const name = input?.value.trim();
                                    if (!name) return;
                                    await saveParamPreset(name);
                                    if (input) input.value = '';
                                }}
                                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-xs font-medium transition-colors flex items-center gap-1"
                            >
                                <Save size={12} />
                                {t(SSRP_I18N_KEYS.save)}
                            </button>
                        </div>
                    </div>

                    {/* 個別性格・個別服装・個別背景（開閉可能、デフォルト閉） */}
                    <div className="space-y-2">
                        <button
                            onClick={() => onUpdateDetail(charPath, d => ({ ...d, isIndividualOpen: !d.isIndividualOpen }))}
                            className="w-full flex items-center text-xs text-gray-400 hover:text-white font-medium transition-colors py-2 -ml-2 pl-2 hover:bg-gray-700/30 rounded text-left"
                        >
                            {detail.isIndividualOpen ? <ChevronDown size={16} className="mr-1.5" /> : <ChevronRight size={16} className="mr-1.5" />}
                            {t(SSRP_I18N_KEYS.individualSettingsTitle)}
                        </button>
                        {detail.isIndividualOpen && (
                            <div className="space-y-3">
                                {([
                                    { field: 'individualPersonalities' as const, label: t(SSRP_I18N_KEYS.individualPersonality), options: personalityOptions, additionalEnabledField: 'additionalPersonalityEnabled' as const, additionalTextField: 'additionalPersonalityText' as const, additionalLabel: t(SSRP_I18N_KEYS.additionalPersonality) },
                                    { field: 'individualOutfits' as const, label: t(SSRP_I18N_KEYS.individualOutfit), options: outfitOptions, additionalEnabledField: 'additionalOutfitEnabled' as const, additionalTextField: 'additionalOutfitText' as const, additionalLabel: t(SSRP_I18N_KEYS.additionalOutfit) },
                                    { field: 'individualBackgrounds' as const, label: t(SSRP_I18N_KEYS.individualBackground), options: backgroundOptions, additionalEnabledField: 'additionalBackgroundEnabled' as const, additionalTextField: 'additionalBackgroundText' as const, additionalLabel: t(SSRP_I18N_KEYS.additionalBackground) },
                                ]).map(({ field, label, options, additionalEnabledField, additionalTextField, additionalLabel }) => (
                                    <div key={field} className="space-y-1">
                                        <label className="text-xs text-gray-500 font-medium">{label}</label>
                                        {((detail[field] as string[] | undefined) || ['']).map((itemVal, idx, arr) => (
                                            <div key={idx} className="flex gap-2 relative mt-1">
                                                <div className="relative flex-1">
                                                    <select
                                                        value={itemVal}
                                                        onChange={(e) => {
                                                            onUpdateDetail(charPath, d => {
                                                                const next = [...((d[field] as string[] | undefined) || arr)];
                                                                next[idx] = e.target.value;
                                                                if (e.target.value && idx === next.length - 1 && next.length < 5) next.push('');
                                                                return { ...d, [field]: next };
                                                            });
                                                        }}
                                                        className="w-full bg-gray-900 border-gray-700 text-gray-200 rounded text-xs p-2 appearance-none outline-none focus:border-blue-500 transition-colors pr-6"
                                                    >
                                                        <option value="">{t(SSRP_I18N_KEYS.none)}</option>
                                                        {options.map(opt => (
                                                            <option key={opt.value} value={opt.value} disabled={arr.includes(opt.value) && itemVal !== opt.value}>{opt.label}</option>
                                                        ))}
                                                    </select>
                                                    <ChevronDown size={12} className="absolute right-2 top-2.5 text-gray-500 pointer-events-none" />
                                                </div>
                                                {(itemVal || (idx !== arr.length - 1 && arr.length > 1)) && (
                                                    <button
                                                        onClick={() => {
                                                            onUpdateDetail(charPath, d => {
                                                                const next = ((d[field] as string[] | undefined) || arr).filter((_, i) => i !== idx);
                                                                if (next.length === 0) next.push('');
                                                                return { ...d, [field]: next };
                                                            });
                                                        }}
                                                        className="text-gray-500 hover:text-red-400 p-2 rounded hover:bg-gray-800 transition-colors"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                )}
                                            </div>
                                        ))}
                                        {/* 追加設定テキストエリア（各カテゴリの直下） */}
                                        <div className="mt-2 space-y-1.5">
                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={() => onUpdateDetail(charPath, d => ({ ...d, [additionalEnabledField]: !d[additionalEnabledField] }))}
                                                    className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors ${detail[additionalEnabledField] ? 'bg-blue-600' : 'bg-gray-700'}`}
                                                >
                                                    <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${detail[additionalEnabledField] ? 'translate-x-4' : 'translate-x-0.5'}`} />
                                                </button>
                                                <span className="text-[10px] text-gray-500">{additionalLabel}</span>
                                            </div>
                                            {detail[additionalEnabledField] && (
                                                <textarea
                                                    value={(detail[additionalTextField] as string) || ''}
                                                    onChange={(e) => onUpdateDetail(charPath, d => ({ ...d, [additionalTextField]: e.target.value }))}
                                                    placeholder={formatText(t(SSRP_I18N_KEYS.additionalInput), { label: additionalLabel })}
                                                    className="w-full bg-gray-900 border border-gray-700 text-gray-200 rounded text-xs p-2 outline-none focus:border-blue-500 transition-colors resize-y"
                                                    style={{ minHeight: '60px' }}
                                                />
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* 相関関係（開閉可能、デフォルト閉） */}
                    <div className="space-y-2">
                        <button
                            onClick={() => onUpdateDetail(charPath, d => ({ ...d, isCorrelationOpen: !d.isCorrelationOpen }))}
                            className="w-full flex items-center text-xs text-gray-400 hover:text-white font-medium transition-colors py-2 -ml-2 pl-2 hover:bg-gray-700/30 rounded text-left"
                        >
                            {detail.isCorrelationOpen ? <ChevronDown size={16} className="mr-1.5" /> : <ChevronRight size={16} className="mr-1.5" />}
                            {t(SSRP_I18N_KEYS.correlationTitle)}
                        </button>
                        {detail.isCorrelationOpen && (
                            <div className="space-y-3">
                                {detail.correlations.map((rel, relIdx) => (
                                    <div key={relIdx} className="bg-gray-900/60 p-3 rounded border border-gray-700/50 space-y-2">
                                        <div className="text-xs font-bold text-gray-300 border-b border-gray-700/50 pb-1 flex justify-between items-center">
                                            {rel.targetId === 'user' ? (
                                                <div className="flex items-center gap-1.5 flex-1">
                                                    <input
                                                        type="text"
                                                        value={userName}
                                                        onChange={(e) => onUserNameInput(e.target.value)}
                                                        placeholder={t(SSRP_I18N_KEYS.userNamePlaceholder)}
                                                        className="bg-transparent border-b border-gray-600 text-gray-300 text-xs w-20 outline-none focus:border-blue-500 px-0.5"
                                                    />
                                                    <span>{t(SSRP_I18N_KEYS.relationWithUser)}</span>
                                                </div>
                                            ) : (
                                                <span>{formatText(t(SSRP_I18N_KEYS.relationWithTarget), { target: rel.targetName })}</span>
                                            )}
                                        </div>
                                        <div className="flex gap-2 items-center">
                                            <span className="text-[10px] text-gray-500 w-12 flex-shrink-0">{t(SSRP_I18N_KEYS.relationship)}</span>
                                            <button
                                                onClick={() => {
                                                    onFetchRelationshipOptions();
                                                    onSelectRelation(charPath, relIdx);
                                                }}
                                                className="flex-1 bg-gray-800 border border-gray-600 text-gray-200 rounded text-xs p-1.5 text-left hover:border-blue-500 transition-colors flex items-center justify-between group"
                                            >
                                                <span className={!rel.relationship ? "text-gray-500" : ""}>
                                                    {relationshipOptions.find(o => o.value === rel.relationship)?.label || rel.relationship || t(SSRP_I18N_KEYS.notSelected)}
                                                </span>
                                                <ChevronDown size={14} className="text-gray-500 group-hover:text-blue-400" />
                                            </button>
                                        </div>
                                        <textarea
                                            placeholder={t(SSRP_I18N_KEYS.detailsPlaceholder)}
                                            value={rel.details}
                                            onChange={(e) => onUpdateCorrelation(charPath, relIdx, 'details', e.target.value)}
                                            className="w-full bg-gray-800 border-gray-600 text-gray-200 rounded text-xs p-2 h-16 outline-none focus:border-blue-500 resize-none"
                                        />
                                        <div className="flex gap-2 items-center pt-1">
                                            <span className="text-[10px] text-gray-500 w-12 flex-shrink-0">{t(SSRP_I18N_KEYS.favorability)}</span>
                                            <input
                                                type="range"
                                                min="-100" max="100"
                                                value={rel.favorability || 0}
                                                onChange={(e) => onUpdateCorrelation(charPath, relIdx, 'favorability', parseInt(e.target.value))}
                                                className="flex-1 h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                                            />
                                            <span className={`text-xs w-8 text-right font-mono ${(rel.favorability || 0) < 0 ? 'text-red-400' : 'text-blue-400'}`}>
                                                {rel.favorability || 0}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="pt-3 border-t border-gray-700 space-y-3">
                        <label className="text-xs text-gray-500 font-medium block">{t(SSRP_I18N_KEYS.individualParameters)}</label>

                        {/* スキーマベースの動的パラメータ */}
                        {parameterSchema && detail.parameterGroups && (
                            <div className="space-y-4">
                                {detail.parameterGroups.map((groupState) => {
                                    const groupDef = parameterSchema.groups.find(g => g.id === groupState.id);
                                    if (!groupDef) return null;
                                    return (
                                        <RenderGroup
                                            key={groupState.id}
                                            groupDef={groupDef}
                                            groupState={groupState}
                                            onGroupStateChange={(updates) => onUpdateParamGroup(charPath, groupState.id, updates)}
                                            onValueChange={(elementId, value) => onUpdateParamValue(charPath, groupState.id, elementId, value)}
                                            uiCatalog={uiCatalog}
                                        />
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* キャラクター画像管理パネル */}
                    <CharacterImagePanel
                        characterName={getCharacterNameFromPath(charPath)}
                        backendUrl={backendUrl}
                        uiCatalog={uiCatalog}
                    />
                </div>
            )}
        </div>
    );
});
CharacterDetailPanel.displayName = 'CharacterDetailPanel';

export const RolePlaySettings = React.forwardRef<RolePlaySettingsHandlers, RolePlaySettingsProps>(({
    isOpen,
    onClose,
    onStartSession,
    initialSettings,
    backendUrl,
    canRestoreSessionSettings = false,
    onConversationPresetChanged,
    onRestoreSessionSettings,
    canApplyToSession = false,
    onApplyToSession,
    applyToSessionState = 'idle',
    fallbackDirectiveMode: _fallbackDirectiveMode,
    defaultUserNameSetting,
    uiCatalog
}, ref) => {
    const t = (key: string) => resolveMessage(uiCatalog, key, SSRP_TEXT_FALLBACK_JA[key] || key);
    const formatText = (template: string, values: Record<string, string | number>) => {
        return Object.entries(values).reduce((text, [key, value]) => {
            return text.split(`{{${key}}}`).join(String(value));
        }, template);
    };
    // 基本チャット設定のデフォルトユーザー名を優先し、未設定なら言語別デフォルト名。
    const defaultUserName = defaultUserNameSetting?.trim() || t(SSRP_I18N_KEYS.defaultUserName);
    // 選択肢データ
    const [characterOptions, setCharacterOptions] = useState<Option[]>([]);
    const [situationOptions, setSituationOptions] = useState<Option[]>([]);
    const [userOptions, setUserOptions] = useState<Option[]>([]);
    const [worldOptions, setWorldOptions] = useState<Option[]>([]);
    const [stageOptions, setStageOptions] = useState<Option[]>([]);
    const [writingStyleOptions, setWritingStyleOptions] = useState<Option[]>([]);

    // 個別背景の選択肢キャッシュ
    const [backgroundOptionsCache, setBackgroundOptionsCache] = useState<Record<string, Option[]>>({});
    // 個別服装の選択肢キャッシュ
    const [outfitOptionsCache, setOutfitOptionsCache] = useState<Record<string, Option[]>>({});
    // 個別性格の選択肢キャッシュ
    const [personalityOptionsCache, setPersonalityOptionsCache] = useState<Record<string, Option[]>>({});

    // キャラクターフィルタリング
    const [charWorkFilters, setCharWorkFilters] = useState<Record<number, string>>({});       // idx → 作品フィルタ
    const [charTagFilters, setCharTagFilters] = useState<Record<number, string[]>>({});        // idx → タグフィルタ
    const [charDropdownOpenIdx, setCharDropdownOpenIdx] = useState<number | null>(null);       // キャラクター選択モーダルを開いているidx
    const [filterWorks, setFilterWorks] = useState<string[]>([]);
    const [filterTags, setFilterTags] = useState<string[]>([]);
    const [characterTagMap, setCharacterTagMap] = useState<Record<string, { work: string | null; tags: string[] }>>({});

    // 選択状態
    const [selectedCharacters, setSelectedCharacters] = useState<string[]>(['']);
    const [selectedSituations, setSelectedSituations] = useState<string[]>(['']);
    const [selectedUsers, setSelectedUsers] = useState<string[]>(['']);
    const [selectedWorlds, setSelectedWorlds] = useState<string[]>(['']);
    const [selectedStages, setSelectedStages] = useState<string[]>(['']);
    const [selectedWritingStyles, setSelectedWritingStyles] = useState<string[]>(['']);

    // キャラクター詳細設定状態
    const [characterDetails, setCharacterDetails] = useState<Record<string, CharacterDetail>>({});

    // パラメータスキーマ
    const [parameterSchema, setParameterSchema] = useState<ParameterSchema | null>(null);
    // スキーマ一覧と選択用
    const [schemaList, setSchemaList] = useState<Array<{ id: string, name: { ja: string, en?: string } }>>([]);
    const [selectedSchemaId, setSelectedSchemaId] = useState<string>('');

    // 方式C固定（旧方式A/B廃止済み）
    const [selectedDirectiveMode, setSelectedDirectiveMode] = useState<'A' | 'B' | 'C'>('C');

    // 日付時刻設定
    const [dateTimeSettings, setDateTimeSettings] = useState<DateTimeSettingsState>(() => getDefaultDateTimeSettings());
    const [dateTimeLocked, setDateTimeLocked] = useState(false);

    // プリセット関連
    const [presets, setPresets] = useState<string[]>([]);
    const [isPresetModalOpen, setIsPresetModalOpen] = useState(false);
    const [newPresetName, setNewPresetName] = useState('');
    const [isSavingPreset, setIsSavingPreset] = useState(false);

    // SSRP全体プリセット関連
    const [ssrpAllPresets, setSSRPAllPresets] = useState<string[]>([]);
    const [selectedSSRPAllPreset, setSelectedSSRPAllPreset] = useState<string>('');
    const [newSSRPAllPresetName, setNewSSRPAllPresetName] = useState('');
    const [isSavingSSRPAllPreset, setIsSavingSSRPAllPreset] = useState(false);
    const [isPresetSelectionOpen, setIsPresetSelectionOpen] = useState(false);
    const [isSaveSSRPPresetOpen, setIsSaveSSRPPresetOpen] = useState(false);

    // SSRPパラメータプリセット関連（キャラクター詳細設定）
    const [ssrpParamPresets, setSSRPParamPresets] = useState<string[]>([]);

    // UI開閉状態
    const [isCharacterSectionOpen, setIsCharacterSectionOpen] = useState(true); // キャラクター欄（デフォルト開）
    const [isEnvironmentSectionOpen, setIsEnvironmentSectionOpen] = useState(false); // 環境グループ（デフォルト閉）

    // グローバル追加設定
    const [additionalWorldEnabled, setAdditionalWorldEnabled] = useState(false);
    const [additionalWorldText, setAdditionalWorldText] = useState('');
    const [additionalStageEnabled, setAdditionalStageEnabled] = useState(false);
    const [additionalStageText, setAdditionalStageText] = useState('');
    const [additionalWritingStyleEnabled, setAdditionalWritingStyleEnabled] = useState(false);
    const [additionalWritingStyleText, setAdditionalWritingStyleText] = useState('');
    const [imageGenerationNotes, setImageGenerationNotes] = useState('');
    const [additionalSituationEnabled, setAdditionalSituationEnabled] = useState(false);
    const [additionalSituationText, setAdditionalSituationText] = useState('');
    const [additionalUserEnabled, setAdditionalUserEnabled] = useState(false);
    const [additionalUserText, setAdditionalUserText] = useState('');
    // 全体の追加設定
    const [additionalOverallEnabled, setAdditionalOverallEnabled] = useState(false);
    const [additionalOverallText, setAdditionalOverallText] = useState('');

    // 関係性選択ステート
    const [selectingRelation, setSelectingRelation] = useState<{
        charPath: string;
        targetIdx: number;
    } | null>(null);

    // ユーザー名（相関関係のtargetId='user'で使用）
    const [userName, setUserName] = useState<string>(defaultUserName);
    // uiCatalog は非同期到着のため、初期レンダー時のデフォルト名（JAフォールバック）のまま
    // 固定されないよう、ユーザーが変更していない場合のみ新しいデフォルト名へ追従させる（04調査 低#10）。
    const prevDefaultUserNameRef = React.useRef(defaultUserName);
    useEffect(() => {
        if (userName === prevDefaultUserNameRef.current && userName !== defaultUserName) {
            setUserName(defaultUserName);
        }
        prevDefaultUserNameRef.current = defaultUserName;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [defaultUserName]);

    // ピン留め状態
    const [isPinned, setIsPinned] = useState(false);
    const [imageSettingsTargetCharacter, setImageSettingsTargetCharacter] = useState('');
    const [isCharacterImageSettingsOpen, setIsCharacterImageSettingsOpen] = useState(false);
    const [isIntegratedImageSettingsOpen, setIsIntegratedImageSettingsOpen] = useState(false);
    // コンテナ参照
    const containerRef = React.useRef<HTMLDivElement>(null);

    // 外側クリック検知 (ピン留めOFFかつデスクトップ時)
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            // 画面幅1024px未満の場合は従来通り(Backdropがないのでfixed全体がコンテナになるが、スマホUIは仕様未定義。今回はデスクトップの挙動のみ対応)
            // このロジックは「横並びモードだがピン留めされていない」とき用
            if (window.innerWidth < 1024) return;

            // コンテナ外かつ、ピン留めされておらず、開いている場合
            if (isOpen && !isPinned && containerRef.current && !containerRef.current.contains(event.target as Node)) {
                // 関係性選択モーダルが開いている場合は閉じない
                if (selectingRelation) return;

                onClose();
            }
        };

        // マウスダウンで判定（クリック開始時点で外なら閉じる）
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen, isPinned, onClose, selectingRelation]);

    // 関係性の選択肢 (APIから取得)
    const [relationshipOptions, setRelationshipOptions] = useState<RelationshipOption[]>([]);
    const lastFetchTimeRef = React.useRef<number>(0);

    // スキーマリストの動的フェッチ用タイムスタンプ
    const lastSchemaFetchTimeRef = React.useRef<number>(0);

    // スキーマリストを動的にフェッチ（項目設定エディターで保存後も反映されるように）
    const fetchSchemaList = async () => {
        const now = Date.now();
        // 1秒以内の連打は無視
        if (now - lastSchemaFetchTimeRef.current < 1000) {
            return;
        }
        lastSchemaFetchTimeRef.current = now;

        try {
            const schemas = await getParameterSchemas();
            setSchemaList(schemas.map(s => ({ id: s.id, name: s.name })));
        } catch (error) {
            console.warn('[RolePlaySettings] Failed to refresh schema list:', error);
        }
    };

    const fetchRelationshipOptions = useCallback(async () => {
        const now = Date.now();
        // 0.3秒以内の連打は無視
        if (now - lastFetchTimeRef.current < 300) {
            return;
        }
        lastFetchTimeRef.current = now;

        try {
            // 関係性編集ボタン押下時はバックエンド側ファイルの手編集を反映するため最新を取り直す
            const relOpts = await getRelationshipOptions(backendUrl, true);
            setRelationshipOptions(relOpts);
            if (ssrpOptionsCache) {
                ssrpOptionsCache.data.relationshipOptions = relOpts;
            }
        } catch (error) {
            console.error('Failed to load relationship options:', error);
        }
    }, [backendUrl]);

    const normalizeUserName = (value?: string) => value?.trim() || defaultUserName;

    const findUserNameFromDetails = (details?: Record<string, CharacterDetail>): string | undefined => {
        if (!details) return undefined;
        for (const detail of Object.values(details)) {
            const userCorrelation = detail.correlations?.find(c => c.targetId === 'user' && c.targetName?.trim());
            if (userCorrelation?.targetName) {
                return userCorrelation.targetName;
            }
        }
        return undefined;
    };

    // 設定適用ヘルパー
    const applySettings = (settings: any) => {
        // 配列の末尾に空文字列がなければ追加（新規追加用セレクト表示のため）
        const ensureTrailingEmpty = (arr: string[]): string[] => {
            if (arr.length === 0 || arr[arr.length - 1] !== '') {
                return [...arr, ''];
            }
            return arr;
        };

        if (settings.characters?.length > 0) {
            setSelectedCharacters(ensureTrailingEmpty(settings.characters));
        } else {
            setSelectedCharacters(['']);
        }

        if (settings.situations?.length > 0) {
            setSelectedSituations(ensureTrailingEmpty(settings.situations));
        } else {
            setSelectedSituations(['']);
        }

        if (settings.users?.length > 0) {
            setSelectedUsers(ensureTrailingEmpty(settings.users));
        } else {
            setSelectedUsers(['']);
        }

        if (settings.worlds?.length > 0) {
            setSelectedWorlds(ensureTrailingEmpty(settings.worlds));
        } else {
            setSelectedWorlds(['']);
        }

        if (settings.stages?.length > 0) {
            setSelectedStages(ensureTrailingEmpty(settings.stages));
        } else {
            setSelectedStages(['']);
        }

        if (settings.writingStyles?.length > 0) {
            setSelectedWritingStyles(ensureTrailingEmpty(settings.writingStyles));
        } else {
            setSelectedWritingStyles(['']);
        }

        const restoredUserName = normalizeUserName(settings.userName || findUserNameFromDetails(settings.characterDetails));
        setUserName(restoredUserName);

        if (settings.characterDetails) {
            const details = { ...settings.characterDetails };
            for (const key in details) {
                const detail = { ...details[key] };
                if (detail.individualBackground && (!detail.individualBackgrounds || detail.individualBackgrounds.length === 0)) {
                    detail.individualBackgrounds = [detail.individualBackground];
                }
                detail.individualBackgrounds = ensureTrailingEmpty(detail.individualBackgrounds || []);
                detail.individualOutfits = ensureTrailingEmpty(detail.individualOutfits || []);
                detail.individualPersonalities = ensureTrailingEmpty(detail.individualPersonalities || []);
                detail.correlations = (detail.correlations || []).map((correlation: Correlation) =>
                    correlation.targetId === 'user'
                        ? { ...correlation, targetName: restoredUserName }
                        : correlation
                );
                details[key] = detail;
            }
            setCharacterDetails(details);
        } else {
            setCharacterDetails({});
        }
        // セッション復元時はスキーマも復元
        if (settings.parameterSchemaId) {
            setSelectedSchemaId(settings.parameterSchemaId);
        }
        // セッション復元時は方式も復元（A/B/Cすべて対応）
        if (settings.directiveMode === 'A' || settings.directiveMode === 'B' || settings.directiveMode === 'C') {
            setSelectedDirectiveMode(settings.directiveMode);
        }
        // セッション復元時は日付時刻設定も復元
        if (settings.dateTimeSettings) {
            setDateTimeSettings(settings.dateTimeSettings);
        }
        // セッション復元時はプリセット名も復元
        setSelectedSSRPAllPreset(settings.presetName || '');

        // グローバル追加設定の復元
        if (settings.additionalWorldEnabled !== undefined) setAdditionalWorldEnabled(settings.additionalWorldEnabled);
        if (settings.additionalWorldText !== undefined) setAdditionalWorldText(settings.additionalWorldText);
        if (settings.additionalStageEnabled !== undefined) setAdditionalStageEnabled(settings.additionalStageEnabled);
        if (settings.additionalStageText !== undefined) setAdditionalStageText(settings.additionalStageText);
        if (settings.additionalWritingStyleEnabled !== undefined) setAdditionalWritingStyleEnabled(settings.additionalWritingStyleEnabled);
        if (settings.additionalWritingStyleText !== undefined) setAdditionalWritingStyleText(settings.additionalWritingStyleText);
        setImageGenerationNotes(settings.imageGenerationNotes || '');
        if (settings.additionalSituationEnabled !== undefined) setAdditionalSituationEnabled(settings.additionalSituationEnabled);
        if (settings.additionalSituationText !== undefined) setAdditionalSituationText(settings.additionalSituationText);
        if (settings.additionalUserEnabled !== undefined) setAdditionalUserEnabled(settings.additionalUserEnabled);
        if (settings.additionalUserText !== undefined) setAdditionalUserText(settings.additionalUserText);
        if (settings.additionalOverallEnabled !== undefined) setAdditionalOverallEnabled(settings.additionalOverallEnabled);
        if (settings.additionalOverallText !== undefined) setAdditionalOverallText(settings.additionalOverallText);
    };

    // 初期化
    useEffect(() => {
        const init = async () => {
            // パラメータスキーマを読み込み
            try {
                const schemas = await getParameterSchemas();
                setSchemaList(schemas.map(s => ({ id: s.id, name: s.name })));
                if (schemas.length > 0) {
                    // 初期設定またはセッション復元時のスキーマを選択
                    const targetSchemaId = initialSettings?.parameterSchemaId || schemas[0].id;
                    setSelectedSchemaId(targetSchemaId);
                    const schema = await getParameterSchema(targetSchemaId);
                    setParameterSchema(schema);
                }
            } catch (error) {
                console.warn('[RolePlaySettings] Failed to load parameter schema:', error);
            }

            // グローバル設定からロック状態を読み込み
            const globalSettings = await getGlobalSettings(backendUrl);
            if (globalSettings.dateTimeEnabledLocked !== undefined) {
                setDateTimeLocked(globalSettings.dateTimeEnabledLocked);
                // ロックが有効な場合、enabled状態を復元
                if (globalSettings.dateTimeEnabledLocked && !initialSettings?.dateTimeSettings) {
                    setDateTimeSettings(prev => ({ ...prev, enabled: true }));
                }
            }
            if (globalSettings.isMenuPinned !== undefined) {
                setIsPinned(globalSettings.isMenuPinned);
            }

            if (initialSettings) {
                applySettings(initialSettings);
            }

            const presetList = await listPresets(backendUrl);
            setPresets(presetList);

            // SSRP全体プリセット一覧を読み込み
            const ssrpAllPresetList = await listSSRPAllPresets(backendUrl);
            setSSRPAllPresets(ssrpAllPresetList);

            // SSRPパラメータプリセット一覧を読み込み
            // SSRPパラメータプリセット一覧を読み込み
            const ssrpParamPresetList = await listSSRPParamPresets(backendUrl);
            setSSRPParamPresets(ssrpParamPresetList);
        };
        if (isOpen) {
            init();
        }
    }, [isOpen, initialSettings, backendUrl]);

    // データロード
    useEffect(() => {
        if (!isOpen) return;

        const applyOptions = (data: SSRPOptionsData) => {
            setCharacterOptions(data.charOptions);
            setCharacterTagMap(data.tagMap);
            setFilterWorks(data.filterWorks);
            setFilterTags(data.filterTags);
            setSituationOptions(data.situations);
            setUserOptions(data.users);
            setWorldOptions(data.worlds);
            setStageOptions(data.stages);
            setWritingStyleOptions(data.writingStyles);
            setRelationshipOptions(data.relationshipOptions);
        };

        let cancelled = false;
        const loadOptions = async () => {
            // キャッシュがあれば即時表示し、TTL内なら再取得を省略する
            if (ssrpOptionsCache) {
                applyOptions(ssrpOptionsCache.data);
                if (Date.now() - ssrpOptionsCache.fetchedAt < SSRP_OPTIONS_CACHE_TTL_MS) {
                    return;
                }
            }
            try {
                const data = await fetchSSRPOptions(backendUrl);
                ssrpOptionsCache = { data, fetchedAt: Date.now() };
                if (!cancelled) {
                    applyOptions(data);
                }
            } catch (error) {
                console.error('Failed to load options:', error);
            }
        };
        loadOptions();
        return () => { cancelled = true; };
    }, [isOpen, backendUrl]);

    // キャラパス→表示名の索引（選択表示ボタンでのスロット数×キャラ数の線形検索を避ける）
    const characterLabelMap = useMemo(
        () => new Map(characterOptions.map(o => [o.value, o.label])),
        [characterOptions]
    );

    // キャラクターフィルタリング（インデックスごと）
    const getFilteredCharacterOptions = (idx: number) => {
        const workFilter = charWorkFilters[idx] || '';
        const tagFilters = charTagFilters[idx] || [];

        return characterOptions.filter(opt => {
            // 既に選択済みのキャラは常に表示（自分自身の選択は除く）
            if (selectedCharacters.includes(opt.value) && selectedCharacters[idx] !== opt.value) return false;
            // 自分自身が選択中なら表示
            if (selectedCharacters[idx] === opt.value) return true;

            const meta = characterTagMap[opt.value];
            const isUnclassified = !meta || !meta.work;

            // 作品フィルタ
            if (workFilter === '__unclassified__') {
                if (!isUnclassified) return false;
            } else if (workFilter) {
                if (!meta || meta.work !== workFilter) return false;
            }

            // タグフィルタ（AND条件）
            if (tagFilters.length > 0) {
                if (!meta || !tagFilters.every((tag: string) => meta.tags.includes(tag))) return false;
            }

            return true;
        });
    };

    // 個別背景 & 同期
    useEffect(() => {
        const syncDetails = async () => {
            const activeCharIds = selectedCharacters.filter(Boolean);
            const newDetails = { ...characterDetails };
            let hasChange = false;

            // 選択されていないキャラクターの設定を、新しいキャラクターに付け替える
            // プリセット読み込み後にキャラクターを変更した場合、古いキャラクターの設定が残らないようにする
            const removedDetails: CharacterDetail[] = [];
            const removedCharPaths: string[] = []; // 削除されたキャラクターのパスを記録
            for (const existingCharPath of Object.keys(newDetails)) {
                if (!activeCharIds.includes(existingCharPath)) {
                    removedDetails.push(newDetails[existingCharPath]);
                    removedCharPaths.push(existingCharPath);
                    delete newDetails[existingCharPath];
                    hasChange = true;
                    console.log(`[RolePlaySettings] Removed details for deselected character: ${existingCharPath}`);
                }
            }

            // 削除されたキャラクター → 新しいキャラクターのマッピングを作成
            const charPathMapping: Record<string, string> = {};

            // ループ1: 設定の付け替えとマッピング作成
            for (let i = 0; i < activeCharIds.length; i++) {
                const charPath = activeCharIds[i];

                // 個別服装・個別背景のオプション取得（共通処理）
                const individualDirs = [
                    { localDir: CHARACTER_SUBDIRS.PERSONALITIES, globalDir: WORKSPACE_PATHS.PERSONALITIES, cache: personalityOptionsCache, setCache: setPersonalityOptionsCache },
                    { localDir: CHARACTER_SUBDIRS.OUTFITS_HAIR, globalDir: WORKSPACE_PATHS.OUTFITS_HAIR, cache: outfitOptionsCache, setCache: setOutfitOptionsCache },
                    { localDir: CHARACTER_SUBDIRS.BACKGROUNDS, globalDir: WORKSPACE_PATHS.BACKGROUNDS, cache: backgroundOptionsCache, setCache: setBackgroundOptionsCache },
                ];
                // 性格・服装・背景の3種は互いに独立のため並列で取得する
                // （setCacheは関数型更新のため並列実行でも安全）
                await Promise.all(individualDirs.map(async ({ localDir, globalDir, cache, setCache }) => {
                    if (cache[charPath]) return;
                    try {
                        let basePath = charPath;
                        if (charPath.endsWith('.md')) {
                            const pathParts = charPath.split('/');
                            pathParts.pop();
                            pathParts.pop();
                            basePath = pathParts.join('/');
                        }
                        const [localFiles, globalOptions] = await Promise.all([
                            listFiles(`${basePath}/${localDir}`).catch(() => ({ files: [] })),
                            loadDirRecursive(globalDir).catch(() => [] as Option[])
                        ]);
                        const options: Option[] = [
                            ...localFiles.files.filter(f => !f.isDirectory && f.name.endsWith('.md')).map(f => ({ label: `[${t(SSRP_I18N_KEYS.localOptionPrefix)}] ${f.name.replace('.md', '')}`, value: f.path })),
                            ...globalOptions.map(o => ({ label: `[${t(SSRP_I18N_KEYS.sharedOptionPrefix)}] ${o.label}`, value: o.value }))
                        ];
                        setCache(prev => ({ ...prev, [charPath]: options }));
                    } catch (e) {
                        console.warn(`Failed to load ${localDir} for ${charPath}`, e);
                    }
                }));

                // 初期化（削除されたキャラクターの設定を付け替える、または新規追加）
                if (!newDetails[charPath]) {
                    // 削除された設定があればそれを使用（切り替え）、なければデフォルト値（新規追加）
                    const sourceDetail = removedDetails.shift();
                    const removedPath = removedCharPaths.shift();
                    if (sourceDetail) {
                        // 切り替え: マッピングを記録し、削除された設定を付け替え
                        if (removedPath) {
                            charPathMapping[removedPath] = charPath;
                        }
                        newDetails[charPath] = { ...sourceDetail };
                    } else {
                        // 新規追加: デフォルト値を使用
                        newDetails[charPath] = {
                            individualBackground: '',
                            individualBackgrounds: [''],
                            individualOutfits: [''],
                            individualPersonalities: [''],
                            correlations: [],
                            parameterGroups: parameterSchema ? initializeParameterGroups(parameterSchema) : undefined,
                            isOpen: false
                        };
                    }
                    hasChange = true;
                } else if (!newDetails[charPath].parameterGroups && parameterSchema) {
                    // 既存のdetailにparameterGroupsがない場合、他のキャラクターから引き継ぐか初期化
                    const existingCharDetails = Object.values(newDetails).find(d => d !== newDetails[charPath] && d.parameterGroups) as CharacterDetail | undefined;
                    newDetails[charPath] = {
                        ...newDetails[charPath],
                        parameterGroups: existingCharDetails?.parameterGroups
                            ? JSON.parse(JSON.stringify(existingCharDetails.parameterGroups))
                            : initializeParameterGroups(parameterSchema)
                    };
                    hasChange = true;
                }
            }

            // ループ2: 相関関係の更新（マッピング作成後に全キャラクターを処理）
            for (const charPath of activeCharIds) {
                const requiredTargets = ['user', ...activeCharIds.filter(id => id !== charPath)];
                const currentCorrelations = newDetails[charPath].correlations || [];
                let correlationsChanged = false;
                const nextCorrelations = [...currentCorrelations];
                const effectiveUserName = normalizeUserName(userName);

                // 既存の相関でマッピングがあるものは付け替え
                for (let j = 0; j < nextCorrelations.length; j++) {
                    const c = nextCorrelations[j];
                    if (c.targetId === 'user' && c.targetName !== effectiveUserName) {
                        nextCorrelations[j] = {
                            ...c,
                            targetName: effectiveUserName
                        };
                        correlationsChanged = true;
                    } else if (charPathMapping[c.targetId]) {
                        const newTargetId = charPathMapping[c.targetId];
                        const newTargetName = characterOptions.find(opt => opt.value === newTargetId)?.label || 'Unknown';
                        nextCorrelations[j] = {
                            ...c,
                            targetId: newTargetId,
                            targetName: newTargetName
                        };
                        correlationsChanged = true;
                    }
                }

                requiredTargets.forEach(targetId => {
                    if (!nextCorrelations.some(c => c.targetId === targetId)) {
                        const targetName = targetId === 'user'
                            ? effectiveUserName
                            : characterOptions.find(opt => opt.value === targetId)?.label || 'Unknown';

                        nextCorrelations.push({
                            targetId,
                            targetName,
                            relationship: '',
                            details: '',
                            favorability: 0
                        });
                        correlationsChanged = true;
                    }
                });

                for (let j = nextCorrelations.length - 1; j >= 0; j--) {
                    const c = nextCorrelations[j];
                    if (c.targetId !== 'user' && !requiredTargets.includes(c.targetId)) {
                        nextCorrelations.splice(j, 1);
                        correlationsChanged = true;
                    }
                }

                if (correlationsChanged) {
                    newDetails[charPath] = { ...newDetails[charPath], correlations: nextCorrelations };
                    hasChange = true;
                }
            }

            if (hasChange) {
                setCharacterDetails(newDetails);
            }
        };
        // parameterSchema が更新されたら実行して初期値を適用したいので依存に入れる
        syncDetails();
    }, [selectedCharacters, backgroundOptionsCache, outfitOptionsCache, characterOptions, parameterSchema, userName]);

    // 親コンポーネントから現在の設定を取得するためのハンドラ
    React.useImperativeHandle(ref, () => ({
        loadPreset: async (name: string) => {
            await handleLoadSSRPAllPreset(name);
        },
        applySettings: (settings: any) => {
            applySettings(settings);
            // メニューを開いていない状態でも、パラメータスキーマ本体をUIへ反映しておく
            if (settings?.parameterSchemaId) {
                getParameterSchema(settings.parameterSchemaId)
                    .then(schema => {
                        if (schema) {
                            setParameterSchema(schema);
                        }
                    })
                    .catch(error => {
                        console.warn('[RolePlaySettings] Failed to load parameter schema on applySettings:', error);
                    });
            }
        },
        getCurrentSettings: () => {
            // SSRPモードでは、UI上で選択された方式を使用
            const mode = selectedDirectiveMode;

            return {
                characters: selectedCharacters.filter(Boolean),
                characterDetails,
                situations: selectedSituations.filter(Boolean),
                users: selectedUsers.filter(Boolean),
                worlds: selectedWorlds.filter(Boolean),
                stages: selectedStages.filter(Boolean),
                writingStyles: selectedWritingStyles.filter(Boolean),
                parameterSchemaId: selectedSchemaId,
                directiveMode: mode,
                dateTimeSettings,
                userName,
                presetName: selectedSSRPAllPreset || undefined,
                // グローバル追加設定
                additionalWorldEnabled,
                additionalWorldText,
                additionalStageEnabled,
                additionalStageText,
                additionalWritingStyleEnabled,
                additionalWritingStyleText,
                imageGenerationNotes,
                additionalSituationEnabled,
                additionalSituationText,
                additionalUserEnabled,
                additionalUserText,
                // 全体の追加設定
                additionalOverallEnabled,
                additionalOverallText,
            };
        }
    }));

    // ハンドラ類
    const handleStart = () => {
        // SSRPモードでは、UI上で選択された方式を使用
        const mode = selectedDirectiveMode;
        console.log('[RolePlaySettings] handleStart:', {
            selectedDirectiveMode,
            resolved: mode
        });

        onStartSession({
            characters: selectedCharacters.filter(Boolean),
            characterDetails,
            situations: selectedSituations.filter(Boolean),
            users: selectedUsers.filter(Boolean),
            worlds: selectedWorlds.filter(Boolean),
            stages: selectedStages.filter(Boolean),
            writingStyles: selectedWritingStyles.filter(Boolean),
            // パラメータスキーマを設定に含める
            parameterSchemaId: selectedSchemaId,
            // UI上で選択された方式を適用
            directiveMode: mode,
            // 日付時刻設定を含める
            dateTimeSettings,
            // ユーザー名
            userName,
            // 会話設定プリセットの選択状態（applySettingsでの復元用。getCurrentSettingsと整合）
            presetName: selectedSSRPAllPreset || undefined,
            // グローバル追加設定
            additionalWorldEnabled,
            additionalWorldText,
            additionalStageEnabled,
            additionalStageText,
            additionalWritingStyleEnabled,
            additionalWritingStyleText,
            imageGenerationNotes,
            additionalSituationEnabled,
            additionalSituationText,
            additionalUserEnabled,
            additionalUserText,
            // 全体の追加設定
            additionalOverallEnabled,
            additionalOverallText,
        });
    };

    const handleSavePreset = async () => {
        if (!newPresetName) return;
        setIsSavingPreset(true);
        try {
            // UI状態(isOpen)を除外して保存
            const cleanDetails = Object.fromEntries(
                Object.entries(characterDetails).map(([k, v]) => [k, { ...v, isOpen: false }])
            );
            await savePreset(backendUrl, newPresetName, {
                characters: selectedCharacters.filter(Boolean),
                characterDetails: cleanDetails,
                situations: selectedSituations.filter(Boolean),
                users: selectedUsers.filter(Boolean),
                worlds: selectedWorlds.filter(Boolean),
                stages: selectedStages.filter(Boolean),
                writingStyles: selectedWritingStyles.filter(Boolean),
                directiveMode: selectedDirectiveMode,
                parameterSchemaId: selectedSchemaId,
                imageGenerationNotes
            });
            setPresets(await listPresets(backendUrl));
            setNewPresetName('');
            setIsPresetModalOpen(false);
        } finally {
            setIsSavingPreset(false);
        }
    };

    const handleLoadPreset = async (name: string) => {
        const settings = await loadPreset(backendUrl, name);
        if (settings) {
            // 強制的に詳細を閉じる
            if (settings.characterDetails) {
                settings.characterDetails = Object.fromEntries(
                    Object.entries(settings.characterDetails).map(([k, v]: [string, any]) => [k, { ...v, isOpen: false }])
                );
            }
            applySettings(settings);
            setNewPresetName(name);
        }
    };

    // SSRP全体プリセット（会話設定全体）の保存
    const handleSaveSSRPAllPreset = async () => {
        if (!newSSRPAllPresetName.trim()) return;
        setIsSavingSSRPAllPreset(true);
        try {
            const preset: SSRPAllPreset = {
                characters: selectedCharacters.filter(c => c),
                situations: selectedSituations.filter(s => s),
                users: selectedUsers.filter(u => u),
                worlds: selectedWorlds.filter(w => w),
                stages: selectedStages.filter(s => s),
                writingStyles: selectedWritingStyles.filter(ws => ws),
                characterDetails,
                directiveMode: selectedDirectiveMode,
                parameterSchemaId: selectedSchemaId,
                dateTimeSettings,
                userName, // ユーザー名を保存
                // グローバル追加設定
                additionalWorldEnabled,
                additionalWorldText,
                additionalStageEnabled,
                additionalStageText,
                additionalWritingStyleEnabled,
                additionalWritingStyleText,
                imageGenerationNotes,
                additionalSituationEnabled,
                additionalSituationText,
                additionalUserEnabled,
                additionalUserText,
                // 全体の追加設定
                additionalOverallEnabled,
                additionalOverallText,
            };
            const savedName = newSSRPAllPresetName.trim();
            await saveSSRPAllPreset(backendUrl, savedName, preset);
            setSSRPAllPresets(await listSSRPAllPresets(backendUrl));
            // 保存後は選択状態を保存したプリセットに変更
            setSelectedSSRPAllPreset(savedName);
        } finally {
            setIsSavingSSRPAllPreset(false);
        }
    };

    // SSRP全体プリセット（会話設定全体）の読み込み
    const handleLoadSSRPAllPreset = async (name: string) => {
        const preset = await getSSRPAllPreset(backendUrl, name);
        if (preset) {
            // parameterSchemaIdに対応するスキーマを読み込んでUIに反映
            if (preset.parameterSchemaId) {
                try {
                    const schema = await getParameterSchema(preset.parameterSchemaId);
                    if (schema) {
                        setParameterSchema(schema);
                        setSelectedSchemaId(preset.parameterSchemaId);
                    }
                } catch (error) {
                    console.warn('[RolePlaySettings] Failed to load parameter schema from preset:', error);
                }
            }
            // 強制的に詳細を閉じる
            if (preset.characterDetails) {
                preset.characterDetails = Object.fromEntries(
                    Object.entries(preset.characterDetails).map(([k, v]: [string, any]) => [k, { ...v, isOpen: false }])
                );
            }
            applySettings(preset);
            // 日付時刻設定も適用
            if (preset.dateTimeSettings) {
                setDateTimeSettings(preset.dateTimeSettings);
            }
            // ユーザー名を復元
            if (preset.userName) {
                setUserName(preset.userName);
            }
            setSelectedSSRPAllPreset(name);
            // 入力エリアにもプリセット名を反映
            setNewSSRPAllPresetName(name);
            onConversationPresetChanged?.();
        }
    };

    // SSRP全体プリセットの削除
    const handleDeleteSSRPAllPreset = async (name: string) => {
        if (!confirm(formatText(t(SSRP_I18N_KEYS.deletePresetConfirm), { name }))) return;
        await deleteSSRPAllPreset(backendUrl, name);
        setSSRPAllPresets(await listSSRPAllPresets(backendUrl));
        if (selectedSSRPAllPreset === name) {
            setSelectedSSRPAllPreset('');
            setNewSSRPAllPresetName('');
        }
    };

    // ロック変更時にグローバル設定に保存
    const handleDateTimeLockChange = async (locked: boolean) => {
        setDateTimeLocked(locked);
        await updateGlobalSettings(backendUrl, { dateTimeEnabledLocked: locked });
    };

    // 以下のハンドラ群は CharacterDetailPanel（React.memo）へ props で渡すため
    // useCallback で参照を安定させる（不安定だと memo が効かず分割の意味がなくなる）。
    const updateDetail = useCallback((charPath: string, updater: (d: CharacterDetail) => CharacterDetail) => {
        setCharacterDetails(prev => ({ ...prev, [charPath]: updater(prev[charPath]) }));
    }, []);

    const openImageSettingsForCharacter = useCallback((charPath: string) => {
        setImageSettingsTargetCharacter(getCharacterNameFromPath(charPath));
        if (window.innerWidth >= INTEGRATED.MIN_SCREEN_WIDTH) {
            setIsIntegratedImageSettingsOpen(true);
        } else {
            setIsCharacterImageSettingsOpen(true);
        }
    }, []);

    const updateCorrelation = useCallback((charPath: string, idx: number, field: keyof Correlation, val: any) => {
        updateDetail(charPath, d => {
            const nextCorr = [...d.correlations];
            nextCorr[idx] = { ...nextCorr[idx], [field]: val };
            return { ...d, correlations: nextCorr };
        });
    }, [updateDetail]);

    // parameterGroupsの更新ヘルパー
    const updateCharacterParamGroup = useCallback((charPath: string, groupId: string, updates: Partial<ParameterGroupState>) => {
        updateDetail(charPath, d => {
            const groups = d.parameterGroups || [];
            return {
                ...d,
                parameterGroups: groups.map(g =>
                    g.id === groupId ? { ...g, ...updates } : g
                )
            };
        });
    }, [updateDetail]);

    const updateCharacterParamValue = useCallback((charPath: string, groupId: string, elementId: string, value: any) => {
        updateDetail(charPath, d => {
            const groups = d.parameterGroups || [];
            return {
                ...d,
                parameterGroups: groups.map(g =>
                    g.id === groupId
                        ? { ...g, values: { ...g.values, [elementId]: value } }
                        : g
                )
            };
        });
    }, [updateDetail]);

    // ユーザー名入力: 全キャラクターの targetId=user の相関 targetName も同期する
    const handleUserNameInput = useCallback((value: string) => {
        const newName = value || defaultUserName;
        setUserName(value);
        setCharacterDetails(prev => {
            const updated = { ...prev };
            for (const charPath of Object.keys(updated)) {
                const d = updated[charPath];
                if (d.correlations) {
                    updated[charPath] = {
                        ...d,
                        correlations: d.correlations.map(c =>
                            c.targetId === 'user'
                                ? { ...c, targetName: newName }
                                : c
                        )
                    };
                }
            }
            return updated;
        });
    }, [defaultUserName]);

    const handleSelectRelation = useCallback((charPath: string, targetIdx: number) => {
        setSelectingRelation({ charPath, targetIdx });
    }, []);


    return (
        <>
            <div
                ref={containerRef}
                className={`
                    fixed inset-y-0 right-0 z-40 w-full sm:w-96 bg-gray-950 border-l border-gray-800 
                    transform transition-all duration-300 ease-in-out shadow-2xl flex flex-col
                    ${isOpen ? 'translate-x-0' : 'translate-x-full'}
                    
                    lg:relative lg:transform-none lg:shadow-none lg:z-auto
                    ${isOpen ? 'lg:w-96 lg:min-w-[24rem]' : 'lg:w-0 lg:min-w-0 lg:border-l-0'}
                `}
            >
                {/* ヘッダー */}
                <div className="flex items-center justify-between p-4 border-b border-gray-800 bg-gray-900/80 backdrop-blur-md min-w-0 lg:min-w-[24rem]">
                    <h2 className="font-semibold text-lg text-gray-100 flex items-center gap-2">
                        <MessageSquare size={20} className="text-purple-400" />
                        {t(SSRP_I18N_KEYS.menuTitle)}
                    </h2>
                    <div className="flex items-center gap-1">
                        {/* ピン留めボタン (Large画面のみ表示) */}
                        <button
                            onClick={() => {
                                const next = !isPinned;
                                setIsPinned(next);
                                updateGlobalSettings(backendUrl, { isMenuPinned: next });
                            }}
                            className={`hidden lg:flex p-1.5 rounded-full transition-colors ${isPinned ? 'text-blue-400 bg-blue-500/10' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'}`}
                            title={isPinned ? t(SSRP_I18N_KEYS.menuPinOn) : t(SSRP_I18N_KEYS.menuPinOff)}
                        >
                            {isPinned ? <Pin size={18} fill="currentColor" /> : <PinOff size={18} />}
                        </button>
                        <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 rounded-full transition-colors">
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* スクロールエリア */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar min-w-0 lg:min-w-[24rem]">

                    {/* SSRP全体プリセット（会話設定全体） */}
                    <div className="bg-gray-900 rounded-lg p-3 border border-gray-800 shadow-sm">
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="flex items-center gap-2 text-xs font-bold text-gray-500 uppercase tracking-wider">
                                <FolderOpen size={14} className="text-blue-400" />
                                {t(SSRP_I18N_KEYS.presetTitle)}
                            </h3>
                            <div className="flex items-center gap-1">
                                {canRestoreSessionSettings && (
                                    <button
                                        onClick={onRestoreSessionSettings}
                                        className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1 font-medium px-2 py-1 rounded hover:bg-emerald-500/10 transition-colors"
                                        title={t(SSRP_I18N_KEYS.restoreSessionTitle)}
                                    >
                                        <RotateCcw size={12} /> {t(SSRP_I18N_KEYS.restoreSession)}
                                    </button>
                                )}
                                <button
                                    onClick={() => {
                                        setIsSaveSSRPPresetOpen((prev) => {
                                            if (!prev) {
                                                setNewSSRPAllPresetName(selectedSSRPAllPreset);
                                            }
                                            return !prev;
                                        });
                                    }}
                                    className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 font-medium px-2 py-1 rounded hover:bg-blue-500/10 transition-colors"
                                >
                                    <Plus size={12} /> {t(SSRP_I18N_KEYS.newSave)}
                                </button>
                            </div>
                        </div>
                        <div className="flex gap-2 mb-2">
                            <button
                                onClick={() => setIsPresetSelectionOpen(true)}
                                className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-left hover:border-blue-500 hover:bg-gray-700 transition-colors flex items-center justify-between group"
                            >
                                <span className={!selectedSSRPAllPreset ? 'text-gray-400' : 'text-gray-200'}>
                                    {selectedSSRPAllPreset || t(SSRP_I18N_KEYS.selectPreset)}
                                </span>
                                <ChevronDown size={14} className="text-gray-500 group-hover:text-blue-400" />
                            </button>
                            {selectedSSRPAllPreset && (
                                <button
                                    onClick={() => handleDeleteSSRPAllPreset(selectedSSRPAllPreset)}
                                    className="px-2 py-1 text-red-400 hover:text-red-300 hover:bg-red-900/30 rounded transition-colors"
                                    title={t(SSRP_I18N_KEYS.deletePreset)}
                                >
                                    <Trash2 size={16} />
                                </button>
                            )}
                        </div>
                        {/* プリセット名入力と保存ボタン（トグル表示） */}
                        {isSaveSSRPPresetOpen && (
                            <div className="flex gap-2 animate-slide-down">
                                <input
                                    type="text"
                                    value={newSSRPAllPresetName}
                                    onChange={(e) => setNewSSRPAllPresetName(e.target.value)}
                                    placeholder={t(SSRP_I18N_KEYS.presetNamePlaceholder)}
                                    className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:border-blue-500 outline-none transition-colors"
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') handleSaveSSRPAllPreset();
                                    }}
                                />
                                <button
                                    onClick={handleSaveSSRPAllPreset}
                                    disabled={!newSSRPAllPresetName.trim() || isSavingSSRPAllPreset}
                                    className="px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm font-medium transition-colors flex items-center gap-1"
                                >
                                    {isSavingSSRPAllPreset ? (
                                        <span className="animate-pulse">{t(SSRP_I18N_KEYS.saving)}</span>
                                    ) : (
                                        <>
                                            <Save size={14} />
                                            {t(SSRP_I18N_KEYS.save)}
                                        </>
                                    )}
                                </button>
                            </div>
                        )}
                    </div>

                    {/* パラメータ項目設定選択 */}
                    <div className="bg-gray-900 rounded-lg p-3 border border-gray-800 shadow-sm">
                        <h3 className="flex items-center gap-2 text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                            <SlidersHorizontal size={14} className="text-purple-400" />
                            {t(SSRP_I18N_KEYS.parameterSchemaTitle)}
                        </h3>
                        <select
                            value={selectedSchemaId}
                            onFocus={fetchSchemaList}
                            onChange={async (e) => {
                                const newSchemaId = e.target.value;
                                setSelectedSchemaId(newSchemaId);
                                // 新しいスキーマを読み込み
                                const schema = await getParameterSchema(newSchemaId);
                                setParameterSchema(schema);
                                // キャラクター詳細のparameterGroupsをリセット
                                if (schema) {
                                    setCharacterDetails(prev => {
                                        const updated: Record<string, CharacterDetail> = {};
                                        for (const [key, detail] of Object.entries(prev)) {
                                            updated[key] = {
                                                ...detail,
                                                parameterGroups: initializeParameterGroups(schema)
                                            };
                                        }
                                        return updated;
                                    });
                                }
                            }}
                            disabled={!!initialSettings}
                            className={`w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm ${initialSettings ? 'opacity-60 cursor-not-allowed' : 'focus:border-blue-500'} outline-none transition-colors`}
                        >
                            {schemaList.length === 0 && <option value="">{t(SSRP_I18N_KEYS.loading)}</option>}
                            {schemaList.map(s => (
                                <option key={s.id} value={s.id}>{s.name.ja}</option>
                            ))}
                        </select>
                        {initialSettings && (
                            <p className="text-xs text-gray-500 mt-1">{t(SSRP_I18N_KEYS.notChangeableAfterStart)}</p>
                        )}
                    </div>

                    {/* キャラ設定プリセット */}
                    <div className="bg-gray-900 rounded-lg p-3 border border-gray-800 shadow-sm">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="flex items-center gap-2 text-xs font-bold text-gray-500 uppercase tracking-wider">
                                <FolderOpen size={14} className="text-pink-400" />
                                {t(SSRP_I18N_KEYS.characterPresetTitle)}
                            </h3>
                            <button
                                onClick={() => setIsPresetModalOpen(!isPresetModalOpen)}
                                className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 font-medium px-2 py-1 rounded hover:bg-blue-500/10 transition-colors"
                            >
                                <Plus size={12} /> {t(SSRP_I18N_KEYS.newSave)}
                            </button>
                        </div>

                        {isPresetModalOpen && (
                            <div className="mb-3 flex gap-2 animate-slide-down">
                                <input
                                    type="text"
                                    value={newPresetName}
                                    onChange={(e) => setNewPresetName(e.target.value)}
                                    placeholder={t(SSRP_I18N_KEYS.presetNameShortPlaceholder)}
                                    className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-white focus:border-blue-500 outline-none placeholder-gray-600"
                                />
                                <button
                                    onClick={handleSavePreset}
                                    disabled={isSavingPreset}
                                    className="bg-blue-600 hover:bg-blue-500 text-white px-3 rounded text-xs font-medium transition-colors disabled:opacity-50 flex items-center gap-1"
                                >
                                    <Save size={12} /> {t(SSRP_I18N_KEYS.save)}
                                </button>
                            </div>
                        )}

                        <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto custom-scrollbar">
                            {presets.length === 0 && <span className="text-xs text-gray-600 italic px-1">{t(SSRP_I18N_KEYS.noPresets)}</span>}
                            {presets.map(p => (
                                <button
                                    key={p}
                                    onClick={() => handleLoadPreset(p)}
                                    className="px-3 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white rounded text-xs border border-gray-700 transition-colors"
                                >
                                    {p}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* メイン設定フォーム */}
                    <div className="space-y-4">
                        {/* キャラクター欄（開閉可能、デフォルト開） */}
                        <div className="bg-gray-900 rounded-lg border border-gray-800 shadow-sm overflow-hidden">
                            <button
                                onClick={() => setIsCharacterSectionOpen(!isCharacterSectionOpen)}
                                className="w-full flex items-center justify-between p-3 hover:bg-gray-800/50 transition-colors"
                            >
                                <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider flex items-center gap-2">
                                    {isCharacterSectionOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                    <Users size={16} className="text-pink-400" />
                                    {t(SSRP_I18N_KEYS.characterSectionTitle)}
                                </h3>
                                <span className="text-xs text-gray-500">
                                    {formatText(t(SSRP_I18N_KEYS.selectedCount), { count: selectedCharacters.filter(c => c).length })}
                                </span>
                            </button>
                            {isCharacterSectionOpen && (
                                <div className="p-3 pt-0 border-t border-gray-800/50 space-y-2">
                                    {selectedCharacters.map((val, idx) => {
                                        const workFilter = charWorkFilters[idx] || '';
                                        const tagFiltersForIdx = charTagFilters[idx] || [];
                                        return (
                                            <div key={idx} className="flex flex-col gap-2 animate-fade-in">
                                                {/* フィルタUI（各ドロップダウンごと） */}
                                                <div className="space-y-1">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-xs text-gray-500 whitespace-nowrap">{t(SSRP_I18N_KEYS.characterWorkFilter)}</span>
                                                        <select
                                                            value={workFilter}
                                                            onChange={(e) => setCharWorkFilters(prev => ({ ...prev, [idx]: e.target.value }))}
                                                            className="flex-1 bg-gray-800 border-gray-700 text-gray-200 rounded text-xs p-1 border outline-none focus:border-blue-500"
                                                        >
                                                            <option value="">ALL</option>
                                                            <option value="__unclassified__">{t(SSRP_I18N_KEYS.characterUnclassified)}</option>
                                                            {filterWorks.map(w => (
                                                                <option key={w} value={w}>{w}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                    {filterTags.length > 0 && (
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-xs text-gray-500 whitespace-nowrap">{t(SSRP_I18N_KEYS.characterTagFilter)}</span>
                                                            <div className="flex flex-wrap gap-1">
                                                                {filterTags.map(tag => {
                                                                    const isActive = tagFiltersForIdx.includes(tag);
                                                                    return (
                                                                        <button
                                                                            key={tag}
                                                                            onClick={() => setCharTagFilters(prev => {
                                                                                const current = prev[idx] || [];
                                                                                return { ...prev, [idx]: isActive ? current.filter((t: string) => t !== tag) : [...current, tag] };
                                                                            })}
                                                                            className={`px-2 py-0.5 rounded-full text-xs transition-colors ${
                                                                                isActive
                                                                                    ? 'bg-blue-600 text-white'
                                                                                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                                                                            }`}
                                                                        >
                                                                            {tag}
                                                                        </button>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                                {/* キャラクター選択（プリセットと同様のグリッド選択モーダルを開く） + 削除ボタン */}
                                                <div className="flex gap-2">
                                                    <div className="flex-1 min-w-0 space-y-1">
                                                        {/* 選択表示ボタン */}
                                                        <div
                                                            onClick={() => setCharDropdownOpenIdx(idx)}
                                                            className="w-full bg-gray-800 border border-gray-700 rounded-md p-2 text-sm text-gray-200 cursor-pointer hover:border-blue-500 transition-colors flex items-center justify-between"
                                                        >
                                                            <span className={val ? 'text-gray-200 truncate' : 'text-gray-500'}>
                                                                {val ? (characterLabelMap.get(val) || val) : t(SSRP_I18N_KEYS.characterSelect)}
                                                            </span>
                                                            <Search size={12} className="text-gray-500 shrink-0 ml-1" />
                                                        </div>
                                                    </div>
                                                    {(val || (idx !== selectedCharacters.length - 1 && selectedCharacters.length > 1)) && (
                                                        <button
                                                            onClick={() => setSelectedCharacters(prev => listWithDelete(idx, prev))}
                                                            className="text-gray-500 hover:text-red-400 p-2 rounded hover:bg-gray-800 transition-colors"
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    )}
                                                </div>
                                                {val && characterDetails[val] && (
                                                    <CharacterDetailPanel
                                                        charPath={val}
                                                        detail={characterDetails[val]}
                                                        parameterSchema={parameterSchema}
                                                        uiCatalog={uiCatalog}
                                                        backendUrl={backendUrl}
                                                        ssrpParamPresets={ssrpParamPresets}
                                                        userName={userName}
                                                        relationshipOptions={relationshipOptions}
                                                        personalityOptions={personalityOptionsCache[val] ?? EMPTY_OPTIONS}
                                                        outfitOptions={outfitOptionsCache[val] ?? EMPTY_OPTIONS}
                                                        backgroundOptions={backgroundOptionsCache[val] ?? EMPTY_OPTIONS}
                                                        onUpdateDetail={updateDetail}
                                                        onUserNameInput={handleUserNameInput}
                                                        onUserNameSet={setUserName}
                                                        onParamPresetsChange={setSSRPParamPresets}
                                                        onFetchRelationshipOptions={fetchRelationshipOptions}
                                                        onSelectRelation={handleSelectRelation}
                                                        onOpenImageSettings={openImageSettingsForCharacter}
                                                        onUpdateCorrelation={updateCorrelation}
                                                        onUpdateParamGroup={updateCharacterParamGroup}
                                                        onUpdateParamValue={updateCharacterParamValue}
                                                    />
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* 環境グループ（開閉可能、デフォルト閉） */}
                        <div className="bg-gray-900 rounded-lg border border-gray-800 shadow-sm overflow-hidden">
                            <button
                                onClick={() => setIsEnvironmentSectionOpen(!isEnvironmentSectionOpen)}
                                className="w-full flex items-center justify-between p-3 hover:bg-gray-800/50 transition-colors"
                            >
                                <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider flex items-center gap-2">
                                    {isEnvironmentSectionOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                    <Globe size={16} className="text-green-400" />
                                    {t(SSRP_I18N_KEYS.environmentTitle)}
                                </h3>
                                <span className="text-xs text-gray-500">
                                    {formatText(t(SSRP_I18N_KEYS.selectedCount), { count: [...selectedWorlds, ...selectedStages, ...selectedSituations, ...selectedUsers].filter(v => v).length })}
                                </span>
                            </button>
                            {isEnvironmentSectionOpen && (
                                <div className="p-3 pt-0 border-t border-gray-800/50 space-y-6">
                                    <SelectSection title={t(SSRP_I18N_KEYS.worldSection)} options={worldOptions} selected={selectedWorlds} setter={setSelectedWorlds} placeholder={t(SSRP_I18N_KEYS.worldSelect)} />
                                    {/* 追加世界観設定 */}
                                    <div className="ml-2 flex items-center gap-2">
                                        <button onClick={() => setAdditionalWorldEnabled(!additionalWorldEnabled)} className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors ${additionalWorldEnabled ? 'bg-blue-600' : 'bg-gray-700'}`}>
                                            <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${additionalWorldEnabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                                        </button>
                                        <span className="text-[10px] text-gray-500">{t(SSRP_I18N_KEYS.additionalWorld)}</span>
                                    </div>
                                    {additionalWorldEnabled && (
                                        <textarea value={additionalWorldText} onChange={(e) => setAdditionalWorldText(e.target.value)} placeholder={formatText(t(SSRP_I18N_KEYS.additionalInput), { label: t(SSRP_I18N_KEYS.additionalWorld) })} className="w-full bg-gray-900 border border-gray-700 text-gray-200 rounded text-xs p-2 outline-none focus:border-blue-500 transition-colors resize-y ml-2" style={{ minHeight: '60px' }} />
                                    )}

                                    <SelectSection title={t(SSRP_I18N_KEYS.stageSection)} options={stageOptions} selected={selectedStages} setter={setSelectedStages} placeholder={t(SSRP_I18N_KEYS.stageSelect)} />
                                    {/* 追加舞台設定 */}
                                    <div className="ml-2 flex items-center gap-2">
                                        <button onClick={() => setAdditionalStageEnabled(!additionalStageEnabled)} className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors ${additionalStageEnabled ? 'bg-blue-600' : 'bg-gray-700'}`}>
                                            <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${additionalStageEnabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                                        </button>
                                        <span className="text-[10px] text-gray-500">{t(SSRP_I18N_KEYS.additionalStage)}</span>
                                    </div>
                                    {additionalStageEnabled && (
                                        <textarea value={additionalStageText} onChange={(e) => setAdditionalStageText(e.target.value)} placeholder={formatText(t(SSRP_I18N_KEYS.additionalInput), { label: t(SSRP_I18N_KEYS.additionalStage) })} className="w-full bg-gray-900 border border-gray-700 text-gray-200 rounded text-xs p-2 outline-none focus:border-blue-500 transition-colors resize-y ml-2" style={{ minHeight: '60px' }} />
                                    )}

                                    <SelectSection title={t(SSRP_I18N_KEYS.situationSection)} options={situationOptions} selected={selectedSituations} setter={setSelectedSituations} placeholder={t(SSRP_I18N_KEYS.situationSelect)} />
                                    {/* 追加シチュエーション設定 */}
                                    <div className="ml-2 flex items-center gap-2">
                                        <button onClick={() => setAdditionalSituationEnabled(!additionalSituationEnabled)} className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors ${additionalSituationEnabled ? 'bg-blue-600' : 'bg-gray-700'}`}>
                                            <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${additionalSituationEnabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                                        </button>
                                        <span className="text-[10px] text-gray-500">{t(SSRP_I18N_KEYS.additionalSituation)}</span>
                                    </div>
                                    {additionalSituationEnabled && (
                                        <textarea value={additionalSituationText} onChange={(e) => setAdditionalSituationText(e.target.value)} placeholder={formatText(t(SSRP_I18N_KEYS.additionalInput), { label: t(SSRP_I18N_KEYS.additionalSituation) })} className="w-full bg-gray-900 border border-gray-700 text-gray-200 rounded text-xs p-2 outline-none focus:border-blue-500 transition-colors resize-y ml-2" style={{ minHeight: '60px' }} />
                                    )}

                                    <SelectSection title={t(SSRP_I18N_KEYS.userSection)} options={userOptions} selected={selectedUsers} setter={setSelectedUsers} placeholder={t(SSRP_I18N_KEYS.userSelect)} />
                                    {/* 追加ユーザー設定 */}
                                    <div className="ml-2 flex items-center gap-2">
                                        <button onClick={() => setAdditionalUserEnabled(!additionalUserEnabled)} className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors ${additionalUserEnabled ? 'bg-blue-600' : 'bg-gray-700'}`}>
                                            <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${additionalUserEnabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                                        </button>
                                        <span className="text-[10px] text-gray-500">{t(SSRP_I18N_KEYS.additionalUser)}</span>
                                    </div>
                                    {additionalUserEnabled && (
                                        <textarea value={additionalUserText} onChange={(e) => setAdditionalUserText(e.target.value)} placeholder={formatText(t(SSRP_I18N_KEYS.additionalInput), { label: t(SSRP_I18N_KEYS.additionalUser) })} className="w-full bg-gray-900 border border-gray-700 text-gray-200 rounded text-xs p-2 outline-none focus:border-blue-500 transition-colors resize-y ml-2" style={{ minHeight: '60px' }} />
                                    )}
                                </div>
                            )}
                        </div>

                        {/* 全体の追加設定（新規セクション） */}
                        <div className="bg-gray-900 rounded-lg border border-gray-800 shadow-sm overflow-hidden">
                            <div className="p-3 flex items-center gap-3">
                                <ToggleSwitch
                                    checked={additionalOverallEnabled}
                                    onChange={setAdditionalOverallEnabled}
                                    accent="amber"
                                    size="sm"
                                />
                                <h3 className="flex items-center gap-2 text-sm font-bold text-gray-300 uppercase tracking-wider">
                                    <FileText size={16} className="text-amber-400" />
                                    {t(SSRP_I18N_KEYS.overallAdditional)}
                                </h3>
                            </div>
                            {additionalOverallEnabled && (
                                <div className="px-3 pb-3">
                                    <textarea
                                        value={additionalOverallText}
                                        onChange={(e) => setAdditionalOverallText(e.target.value)}
                                        placeholder={t(SSRP_I18N_KEYS.overallAdditionalPlaceholder)}
                                        className="w-full bg-gray-800 border border-gray-700 text-gray-200 rounded text-xs p-2 outline-none focus:border-blue-500 transition-colors resize-y"
                                        style={{ minHeight: '80px' }}
                                    />
                                </div>
                            )}
                        </div>

                        {/* 文体設定 */}
                        <div className="bg-gray-900 rounded-lg border border-gray-800 shadow-sm overflow-hidden">
                            <div className="p-3 space-y-3">
                                <SelectSection title={t(SSRP_I18N_KEYS.writingStyleSection)} options={writingStyleOptions} selected={selectedWritingStyles} setter={setSelectedWritingStyles} placeholder={t(SSRP_I18N_KEYS.writingStyleSelect)} />
                                {/* 追加文体設定 */}
                                <div className="ml-2 flex items-center gap-2">
                                    <button onClick={() => setAdditionalWritingStyleEnabled(!additionalWritingStyleEnabled)} className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors ${additionalWritingStyleEnabled ? 'bg-blue-600' : 'bg-gray-700'}`}>
                                        <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${additionalWritingStyleEnabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                                    </button>
                                    <span className="text-[10px] text-gray-500">{t(SSRP_I18N_KEYS.additionalWritingStyle)}</span>
                                </div>
                                {additionalWritingStyleEnabled && (
                                    <textarea value={additionalWritingStyleText} onChange={(e) => setAdditionalWritingStyleText(e.target.value)} placeholder={formatText(t(SSRP_I18N_KEYS.additionalInput), { label: t(SSRP_I18N_KEYS.additionalWritingStyle) })} className="w-full bg-gray-900 border border-gray-700 text-gray-200 rounded text-xs p-2 outline-none focus:border-blue-500 transition-colors resize-y ml-2" style={{ minHeight: '60px' }} />
                                )}
                                <div className="ml-2 space-y-1">
                                    <span className="text-[10px] text-gray-500">{t(SSRP_I18N_KEYS.imageGenerationNotes)}</span>
                                    <textarea
                                        value={imageGenerationNotes}
                                        onChange={(e) => setImageGenerationNotes(e.target.value)}
                                        placeholder={t(SSRP_I18N_KEYS.imageGenerationNotesPlaceholder)}
                                        className="w-full bg-gray-900 border border-gray-700 text-gray-200 rounded text-xs p-2 outline-none focus:border-blue-500 transition-colors resize-y"
                                        style={{ minHeight: '70px' }}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* 日付時刻設定 */}
                        <div className="border-t border-gray-800 pt-4">
                            <DateTimeSettings
                                settings={dateTimeSettings}
                                onChange={setDateTimeSettings}
                                isLocked={dateTimeLocked}
                        onLockChange={handleDateTimeLockChange}
                        backendUrl={backendUrl}
                        uiCatalog={uiCatalog}
                    />
                        </div>

                    </div>
                </div>

                {/* 固定フッター */}
                <div className="p-4 border-t border-gray-800 space-y-2">
                    {/* 現セッションに反映（既存セッションで未反映変更があるときのみ表示） */}
                    {(canApplyToSession || applyToSessionState === 'done') && onApplyToSession && (
                        <button
                            onClick={onApplyToSession}
                            disabled={applyToSessionState === 'applying'}
                            className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg font-semibold tracking-wide transition-colors text-sm ${applyToSessionState === 'done'
                                ? 'bg-emerald-700 text-white cursor-default'
                                : 'bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-60'}`}
                            title={t(SSRP_I18N_KEYS.applyToSessionTitle)}
                        >
                            <RotateCcw size={16} className={applyToSessionState === 'applying' ? 'animate-spin' : ''} />
                            {applyToSessionState === 'done'
                                ? t(SSRP_I18N_KEYS.applyToSession) + ' ✓'
                                : t(SSRP_I18N_KEYS.applyToSession)}
                        </button>
                    )}
                    <button
                        onClick={handleStart}
                        className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white py-3.5 rounded-lg font-semibold tracking-wide transition-colors text-sm"
                    >
                        <Check size={18} /> {t(SSRP_I18N_KEYS.startConversation)}
                    </button>
                </div>
            </div>

            {/* キャラクター選択モーダル（プリセットより横広・列少なめ。スマホ幅では1列） */}
            <GridSelectionModal
                isOpen={charDropdownOpenIdx !== null}
                onClose={() => setCharDropdownOpenIdx(null)}
                title={t(SSRP_I18N_KEYS.characterSelect)}
                searchPlaceholder={t(SSRP_I18N_KEYS.characterSearch)}
                noMatchTemplate={t(SSRP_I18N_KEYS.noMatch)}
                searchable
                wide
                selectedValue={charDropdownOpenIdx !== null ? (selectedCharacters[charDropdownOpenIdx] || undefined) : undefined}
                options={charDropdownOpenIdx !== null
                    ? getFilteredCharacterOptions(charDropdownOpenIdx).filter(opt =>
                        // 他スロットで選択済みのキャラは候補から除外（自スロットの選択中は残す）
                        !(selectedCharacters.includes(opt.value) && selectedCharacters[charDropdownOpenIdx] !== opt.value))
                    : []}
                onSelect={(val) => {
                    if (charDropdownOpenIdx !== null && val) {
                        setSelectedCharacters(prev => listWithChange(charDropdownOpenIdx, val, prev));
                    }
                    setCharDropdownOpenIdx(null);
                }}
            />

            {/* 関係性選択モーダル */}
            <GridSelectionModal
                isOpen={!!selectingRelation}
                onClose={() => setSelectingRelation(null)}
                title={t(SSRP_I18N_KEYS.selectRelationship)}
                emptyLabel={t(SSRP_I18N_KEYS.notSelected)}
                searchPlaceholder={t(SSRP_I18N_KEYS.searchPlaceholder)}
                noMatchTemplate={t(SSRP_I18N_KEYS.noMatch)}
                options={relationshipOptions}
                onSelect={(val) => {
                    if (selectingRelation) {
                        updateCorrelation(selectingRelation.charPath, selectingRelation.targetIdx, 'relationship', val);
                        setSelectingRelation(null);
                    }
                }}
            />

            {/* プリセット選択モーダル */}
            <GridSelectionModal
                isOpen={isPresetSelectionOpen}
                onClose={() => setIsPresetSelectionOpen(false)}
                title={t(SSRP_I18N_KEYS.presetDialogTitle)}
                emptyLabel={t(SSRP_I18N_KEYS.notSelected)}
                searchPlaceholder={t(SSRP_I18N_KEYS.searchPlaceholder)}
                noMatchTemplate={t(SSRP_I18N_KEYS.noMatch)}
                searchable
                options={ssrpAllPresets.map(p => ({ label: p, value: p }))}
                onSelect={(val) => {
                    if (val) {
                        handleLoadSSRPAllPreset(val);
                        setIsPresetSelectionOpen(false);
                    } else {
                        setSelectedSSRPAllPreset('');
                        onConversationPresetChanged?.();
                        setIsPresetSelectionOpen(false);
                    }
                }}
            />

            <ComfyUICharacterSettingsModal
                isOpen={isCharacterImageSettingsOpen}
                onClose={() => setIsCharacterImageSettingsOpen(false)}
                backendUrl={backendUrl}
                initialSelectedCharacter={imageSettingsTargetCharacter}
            />

            <ComfyUIIntegratedSettingsModal
                isOpen={isIntegratedImageSettingsOpen}
                onClose={() => setIsIntegratedImageSettingsOpen(false)}
                backendUrl={backendUrl}
                initialSelectedCharacter={imageSettingsTargetCharacter}
            />
        </>
    );
});

RolePlaySettings.displayName = 'RolePlaySettings';
