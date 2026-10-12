import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { X, Check, Save, Plus, ChevronDown, ChevronLeft, ChevronRight, Trash2, RotateCcw, Pin, PinOff, Image, FileText, AudioLines, UserPlus, FolderPlus, ArrowLeftRight } from 'lucide-react';
import { Button, Chip, IconButton, Segmented, cn } from '../ui';
import { ToggleSwitch } from '../common/ToggleSwitch';
import { GridSelectionModal } from '../common/GridSelectionModal';
import { ConfirmDialog } from '../ConfirmDialog';
import { TempCharacterImportModal } from './TempCharacterImportModal';
import { TempCharacterEditorModal } from './TempCharacterEditorModal';
import { isTempCharacterPath } from '../../lib/characterName';
import type { SpeakerSourceMessage } from '../../lib/tempCharacterSpeakers';
import type { TempCharacterImportHandle } from '../../hooks/useTempCharacterImport';
import type { TempCharacter } from '../../api/datetime-presets';
import { updateTempCharacter, removeTempCharacter, registerTempCharacter } from '../../api/temp-characters';
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
import { getLocalizedText, parameterLangOf } from '../../types/Parameter';
import { RenderGroup } from '../common/ParameterElements';
import { DateTimeSettings } from './DateTimeSettings';
import { CharacterImagePanel } from './CharacterImagePanel';
import { CharacterVoicePanel } from './CharacterVoicePanel';
import type { DateTimeSettingsState } from '../../types/datetime';
import { getDefaultDateTimeSettings } from '../../types/datetime';
import { getGlobalSettings, updateGlobalSettings } from '../../api/global-settings';
import { WORKSPACE_PATHS, CHARACTER_SUBDIRS } from '../../constants/workspacePaths';
import { extractCharacterDirectoryName } from '../chat/characterImagePath';
import { loadDirRecursive } from './individualOptions';
import { getLinkedSettings, type LinkedSettings } from '../../api/characters';
import { CHARACTER_IMAGES_UPDATED_EVENT } from '../../lib/characterImageEvents';
import { notifyConfigFilesChanged, subscribeConfigFilesChanged } from '../../lib/configFilesChanged';
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
import { formatLabelValue, joinNames, resolveMessage, type I18NCatalog } from '../../api/i18n';
import { PREPARE_PANEL_I18N_KEYS, PREPARE_PANEL_TEXT_FALLBACK_JA, SETTINGS_VIEW_I18N_KEYS, SETTINGS_VIEW_TEXT_FALLBACK_JA, SSRP_I18N_KEYS, SSRP_TEXT_FALLBACK_JA } from '../../constants/i18n';
import { ImageGenerationSettings, getDefaultImageGenSettings, type ImageGenSettingsState } from './ImageGenerationSettings';
import { ParameterSchemaEditorModal } from '../settings/ParameterSchemaEditorModal';


interface RolePlaySettingsProps {
    isOpen: boolean;
    onClose: () => void;
    onStartSession: (settings: any) => void;
    initialSettings?: any;
    /** 初期設定と選択肢の反映が終わったときに呼ぶ。更新復旧内容を最後に重ねるために使う。 */
    onInitialized?: () => void;
    backendUrl: string;
    canRestoreSessionSettings?: boolean;
    onConversationPresetChanged?: () => void;
    onRestoreSessionSettings?: () => void;
    /** 既存セッションで設定が未反映変更ありのとき、会話開始ボタンの上に反映ボタンを表示する */
    canApplyToSession?: boolean;
    /** 既存セッションと比べて話す相手（キャラ）が替わっているか。替わっていれば「新しく始める」を主ボタンにする */
    charactersChangedFromSession?: boolean;
    onApplyToSession?: () => void;
    applyToSessionState?: 'idle' | 'applying' | 'done';
    /** SSRP設定でdirectiveModeが未指定の場合に使用するデフォルト値（通常設定から） */
    fallbackDirectiveMode?: 'A' | 'B' | 'C';
    /** 基本チャット設定のデフォルトユーザー名（空なら言語別デフォルト名を使用） */
    defaultUserNameSetting?: string;
    /**
     * 画像生成設定欄の表示可否。判定（ComfyUI機能が有効な支援レベル かつ
     * ComfyUI連携モジュール連携済み）は Chat 側で行い結果だけを受け取る。
     */
    imageGenSettingsVisible?: boolean;
    /**
     * キャラ詳細の画像の設定を、素材づくりのキャラ画像のタブで開く導線（引数は初期選択キャラクター名。
     * 画像生成が使えるときだけ渡す。表示条件の判定は Chat 側で行う）。
     */
    onOpenIntegratedImageSettings?: (characterName: string) => void;
    /**
     * 音声設定欄（CharacterVoicePanel）と音声設定アイコンの表示可否。
     * 判定（TTS機能が有効な支援レベル かつ TTSモジュール連携済み）は Chat 側で行う。
     */
    ttsSettingsVisible?: boolean;
    /**
     * キャラ詳細の声の設定を素材づくりの声のタブで開く導線
     * （引数は初期選択キャラクター名。読み上げが使えるときだけ渡す）。
     */
    onOpenIntegratedTTSSettings?: (characterName: string) => void;
    /**
     * キャラ詳細設定横アイコンから、設定ファイルエディタでそのキャラクター本体を開く導線
     * （引数は保存先ディレクトリ名と設定ファイル名）。未指定ならアイコンを出さない。
     */
    onOpenCharacterEditor?: (target: { dirName: string; fileName: string }) => void;
    /** セッションからの一時キャラクター取り込み用：現在のセッション ID（無ければ取り込み不可） */
    sessionId?: string | null;
    /** 同上：会話のメッセージ（話者一覧の作成に使う） */
    messages?: SpeakerSourceMessage[];
    /** 同上：取り込みの進行状態と操作（Chat 側で保持し、小窓を閉じても続く） */
    tempImport?: TempCharacterImportHandle;
    /** サーバー側で会話設定が更新されたとき（一時キャラの本文更新・削除・キャラ設定登録）に Chat 側の保持値を差し替える */
    onSessionSettingsUpdated?: (ssrpSettings: any) => void;
    /** 選択中のキャラクター一覧（空枠を除く）が変わるたびに Chat 側へ伝える。発言前の見出しの参加者表示に使う */
    onCharactersChange?: (characters: string[]) => void;
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
    /** キャラクター設定だけが持つ、画像等の保存先となる物理ディレクトリ名。 */
    dirName?: string;
    /** キャラクター設定だけが持つ、キャラカード用の default 表情アイコン URL。 */
    imageUrl?: string;
}

// loadDirRecursive（.md の再帰探索）は設定ファイルエディタの設定紐づけタブと共用するため
// individualOptions.ts へ移した。

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

// 設定パック取り込み等、メニュー外の操作でワークスペース内容が変わった際に呼ぶ。
// 破棄しておくと次回メニューを開いたときに必ず再取得される。加えて、設定ファイルの変更を
// 全画面へ知らせ、開きっぱなしのメニューや素材づくりの一覧にもその場で再取得させる。
export function invalidateSSRPOptionsCache(): void {
    ssrpOptionsCache = null;
    notifyConfigFilesChanged();
}

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
            value: c.path,
            dirName: c.dirName,
            // キャラカード（default 表情アイコン）。iconUrl はハッシュ付きで返るためそのまま使う
            imageUrl: c.iconUrl ? `${backendUrl}${c.iconUrl}` : undefined,
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
    // 応答時の自動画像生成でこのキャラクターのチャットバブルを対象にするか。
    // 未指定は対象（過去のセッション・プリセットは項目を持たないため）。
    autoImageGenEnabled?: boolean;
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

// キャラクター設定パスから、画像・画像生成設定の保存先となる
// 物理キャラクターディレクトリ名を得る。
// 設定ファイル名は `キャラ名_v3.md` のように版が付くことがあり、
// ファイル名をそのまま渡すと存在しないキャラクターディレクトリが作られる。
function getCharacterNameFromPath(charPath: string): string {
    const directoryName = extractCharacterDirectoryName(charPath);
    if (directoryName) return directoryName;

    return charPath.split('/').pop()?.replace(/\.md$/, '') || charPath;
}

// キャラクター設定パスから設定名（`キャラ名_v3` のようにファイル名そのもの）を得る。
// 画像生成・音声の設定画面へ「どの設定を選んだか」を伝える用途。同じキャラクター
// ディレクトリに版違いの設定が複数あると、ディレクトリ名で渡した場合は名前順で先の版
// （`_v2` 等）が選ばれて見えるため、設定名で渡して選んだ版そのものを初期選択にする。
// 設定画面側は一覧の name → dirName の対応で保存先ディレクトリを解決する。
function getCharacterSettingNameFromPath(charPath: string): string {
    return charPath.replace(/\\/g, '/').split('/').pop()?.replace(/\.md$/i, '') || charPath;
}

// React.memo の props 安定用の空配列（毎レンダー `|| []` で新配列を作らない）
const EMPTY_OPTIONS: Option[] = [];

// 欄の入力欄・見出しの見た目
const PANEL_FIELD_CLASS = 'w-full bg-surface border border-line-strong text-fg rounded-ui text-sm px-3 py-2 outline-none focus:border-accent transition-colors';
const PANEL_HEADING_CLASS = 'font-head text-xs font-bold tracking-wider text-fg-muted';
// 会話に入れられるキャラの数の上限
const MAX_CHARACTERS = 5;
// キャラ選択の窓を「キャラを追加」で開いたときの印（差し替えのときは枠の位置を入れる）
const ADD_CHARACTER_SLOT = -1;

type PrepareTab = 'characters' | 'scene' | 'style' | 'preset';

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
        <h3 className={PANEL_HEADING_CLASS}>{title}</h3>
        {selected.map((val, idx) => (
            <div key={idx} className="flex flex-col gap-2 animate-fade-in">
                <div className="flex gap-2">
                    <select
                        value={val}
                        onChange={(e) => setter(prev => listWithChange(idx, e.target.value, prev))}
                        className={cn(PANEL_FIELD_CLASS, 'flex-1 min-w-0')}
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
                            className="text-fg-muted hover:text-danger p-2 rounded-ui hover:bg-surface transition-colors"
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

// キャラクター詳細（1キャラ分）。準備・調整欄の上に重ねて出し、区切り（状態・個別設定・相関関係・画像と声）を切り替えて見せる。
// 親（RolePlaySettings）は state が多く、どれか1つの変更で全体が再描画されるため React.memo で切り離す。
// updateDetail は `{...prev, [charPath]: ...}` 形式なので、他キャラの編集では detail の参照が変わらず再描画を飛ばせる。
interface CharacterDetailPanelProps {
    charPath: string;
    characterDirName: string;
    /** 見出しに出す名前 */
    label: string;
    /** 一時キャラクター（実ファイルを持たない） */
    isTemp: boolean;
    /** 一覧へ戻る */
    onClose: () => void;
    /** 別のキャラに替える（キャラ選択の窓を開く） */
    onReplace: () => void;
    /** この会話から外す */
    onRemove: () => void;
    /** 一時キャラクターの本文を編集する */
    onEditTemp?: () => void;
    /** 一時キャラクターをキャラ設定に登録する（会話が保存されているときだけ） */
    onRegisterTemp?: () => void;
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
    // 自動画像生成の対象トグルを出すか（画像生成設定と同じ表示条件）
    imageGenSettingsVisible: boolean;
    // キャラクター側の設定紐づけ（追加設定の追記／置換バッジ表示用。プリセットには保存しない）
    linkedSettings?: LinkedSettings;
    // 設定ファイルエディタでこのキャラクター本体を開く（未指定ならアイコンを出さない）
    onOpenEditor?: (charPath: string) => void;
    // 音声設定（TTS）。アイコンとパネルは onOpenTTSSettings / canUseTTS が有効な時だけ出す。
    canUseTTS: boolean;
    onOpenTTSSettings?: (charPath: string) => void;
    // 会話設定側VoiceDesign（値の正本は RolePlaySettings の voiceDesignByCharacter state。要件6.5）
    presetVoiceDesign?: { mode: 'append' | 'replace'; text: string };
    onPresetVoiceDesignChange?: (charPath: string, value: { mode: 'append' | 'replace'; text: string }) => void;
    onUpdateCorrelation: (charPath: string, idx: number, field: keyof Correlation, val: any) => void;
    onUpdateParamGroup: (charPath: string, groupId: string, updates: Partial<ParameterGroupState>) => void;
    onUpdateParamValue: (charPath: string, groupId: string, elementId: string, value: any) => void;
}

type DetailSection = 'status' | 'individual' | 'correlation' | 'media';

const DETAIL_FIELD_CLASS = 'w-full bg-surface border border-line-strong text-fg rounded-ui text-xs p-2 outline-none focus:border-accent transition-colors';

const CharacterDetailPanel = React.memo<CharacterDetailPanelProps>(({
    charPath,
    characterDirName,
    label,
    isTemp,
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
    imageGenSettingsVisible,
    linkedSettings,
    onOpenEditor,
    canUseTTS,
    onOpenTTSSettings,
    presetVoiceDesign,
    onPresetVoiceDesignChange,
    onUpdateCorrelation,
    onUpdateParamGroup,
    onUpdateParamValue,
    onClose,
    onReplace,
    onRemove,
    onEditTemp,
    onRegisterTemp,
}) => {
    const t = (key: string) => resolveMessage(uiCatalog, key, PREPARE_PANEL_TEXT_FALLBACK_JA[key] || SSRP_TEXT_FALLBACK_JA[key] || key);
    const formatText = (template: string, values: Record<string, string | number>) => {
        return Object.entries(values).reduce((text, [key, value]) => {
            return text.split(`{{${key}}}`).join(String(value));
        }, template);
    };
    // どの区切りを見ているか（詳細 → 区切りの2段まで）
    const [section, setSection] = useState<DetailSection>('status');

    // プリセット名入力への参照（保存ボタンが自分の入力欄を読むため）
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
            autoImageGenEnabled: detail.autoImageGenEnabled,
        };
        await saveSSRPParamPreset(backendUrl, name, preset);
        onParamPresetsChange(await listSSRPParamPresets(backendUrl));
    };

    const loadParamPreset = async (name: string) => {
        const preset = await getSSRPParamPreset(backendUrl, name);
        if (!preset) return;
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
            autoImageGenEnabled: preset.autoImageGenEnabled ?? d.autoImageGenEnabled,
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
    };

    const sections: { value: DetailSection; label: string }[] = [
        { value: 'status', label: t(PREPARE_PANEL_I18N_KEYS.detailStatus) },
        { value: 'individual', label: t(PREPARE_PANEL_I18N_KEYS.detailIndividual) },
        { value: 'correlation', label: t(PREPARE_PANEL_I18N_KEYS.detailCorrelation) },
        { value: 'media', label: t(PREPARE_PANEL_I18N_KEYS.detailMedia) },
    ];

    // 操作（一覧のカードの横にあったアイコン列を、文字付きでここへ移した）。
    // 相手だけを替えて始めるのが基本の使い方なので、入れ替えを先頭に枠付きで出す
    const actions: { key: string; label: string; icon: React.ReactNode; onClick: () => void; danger?: boolean; primary?: boolean }[] = [];
    actions.push({ key: 'replace', label: t(PREPARE_PANEL_I18N_KEYS.detailReplace), icon: <ArrowLeftRight size={14} />, onClick: onReplace, primary: true });
    if (isTemp && onRegisterTemp) actions.push({ key: 'register', label: t(PREPARE_PANEL_I18N_KEYS.detailRegisterTemp), icon: <FolderPlus size={14} />, onClick: onRegisterTemp });
    if (isTemp && onEditTemp) actions.push({ key: 'editTemp', label: t(PREPARE_PANEL_I18N_KEYS.detailEditTemp), icon: <FileText size={14} />, onClick: onEditTemp });
    if (!isTemp && onOpenEditor) actions.push({ key: 'editor', label: t(PREPARE_PANEL_I18N_KEYS.detailOpenEditor), icon: <FileText size={14} />, onClick: () => onOpenEditor(charPath) });
    if (!isTemp && imageGenSettingsVisible) actions.push({ key: 'image', label: t(PREPARE_PANEL_I18N_KEYS.detailImage), icon: <Image size={14} />, onClick: () => onOpenImageSettings(charPath) });
    if (!isTemp && canUseTTS && onOpenTTSSettings) actions.push({ key: 'voice', label: t(PREPARE_PANEL_I18N_KEYS.detailVoice), icon: <AudioLines size={14} />, onClick: () => onOpenTTSSettings(charPath) });
    actions.push({ key: 'remove', label: t(PREPARE_PANEL_I18N_KEYS.detailRemove), icon: <Trash2 size={14} />, onClick: onRemove, danger: true });

    return (
        <div className="absolute inset-0 z-20 flex flex-col bg-panel-solid animate-fade-in">
            {/* 見出し：戻る・名前・既定に戻す */}
            <div className="flex items-center gap-1 px-2 h-14 shrink-0 border-b border-line">
                <IconButton label={t(PREPARE_PANEL_I18N_KEYS.detailBack)} onClick={onClose}>
                    <ChevronLeft size={18} />
                </IconButton>
                <h3 className="flex-1 min-w-0 font-head text-base font-bold truncate">
                    {label}
                    {isTemp && (
                        <span className="ml-2 align-middle text-xs font-normal px-1 py-0.5 rounded border border-warn text-warn">
                            {t(SSRP_I18N_KEYS.tempCharacterBadge)}
                        </span>
                    )}
                </h3>
                <Button size="sm" variant="ghost" onClick={resetToDefault} title={t(SSRP_I18N_KEYS.resetToDefaultTitle)}>
                    <RotateCcw size={13} />
                    {t(SSRP_I18N_KEYS.reset)}
                </Button>
            </div>

            <div className="flex flex-wrap gap-1 px-3 py-2 border-b border-line">
                {actions.map(action => (
                    <Button
                        key={action.key}
                        size="sm"
                        variant={action.danger ? 'danger' : action.primary ? 'secondary' : 'ghost'}
                        onClick={action.onClick}
                    >
                        {action.icon}
                        {action.label}
                    </Button>
                ))}
            </div>

            <div className="px-3 pt-3">
                <Segmented<DetailSection> label={label} value={section} onChange={setSection} options={sections} block />
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-5 custom-scrollbar">
                {section === 'status' && (
                    <>
                        {/* 詳細設定プリセット */}
                        <div className="space-y-2 pb-4 border-b border-line">
                            <label className="text-xs text-fg-muted font-medium">{t(SSRP_I18N_KEYS.characterDetailPreset)}</label>
                            <div className="flex gap-2">
                                <select
                                    className={cn(DETAIL_FIELD_CLASS, 'flex-1')}
                                    onChange={async (e) => {
                                        const name = e.target.value;
                                        if (!name) return;
                                        await loadParamPreset(name);
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
                                        className={cn(DETAIL_FIELD_CLASS, 'w-auto')}
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
                                    className={cn(DETAIL_FIELD_CLASS, 'flex-1')}
                                    onKeyDown={async (e) => {
                                        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                                            const name = (e.target as HTMLInputElement).value.trim();
                                            if (!name) return;
                                            await saveParamPreset(name);
                                            (e.target as HTMLInputElement).value = '';
                                        }
                                    }}
                                />
                                <Button
                                    size="sm"
                                    variant="primary"
                                    className="h-auto"
                                    onClick={async () => {
                                        const input = presetNameInputRef.current;
                                        const name = input?.value.trim();
                                        if (!name) return;
                                        await saveParamPreset(name);
                                        if (input) input.value = '';
                                    }}
                                >
                                    <Save size={12} />
                                    {t(SSRP_I18N_KEYS.save)}
                                </Button>
                            </div>
                        </div>

                        {/* 個別パラメータ（スキーマベースの動的パラメータ） */}
                        <div className="space-y-3">
                            <label className="text-xs text-fg-muted font-medium block">{t(SSRP_I18N_KEYS.individualParameters)}</label>
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
                    </>
                )}

                {section === 'individual' && (
                    <div className="space-y-5">
                        {([
                            { field: 'individualPersonalities' as const, label: t(SSRP_I18N_KEYS.individualPersonality), options: personalityOptions, additionalEnabledField: 'additionalPersonalityEnabled' as const, additionalTextField: 'additionalPersonalityText' as const, additionalLabel: t(SSRP_I18N_KEYS.additionalPersonality), linkedAdditional: linkedSettings?.personalities.additional },
                            { field: 'individualOutfits' as const, label: t(SSRP_I18N_KEYS.individualOutfit), options: outfitOptions, additionalEnabledField: 'additionalOutfitEnabled' as const, additionalTextField: 'additionalOutfitText' as const, additionalLabel: t(SSRP_I18N_KEYS.additionalOutfit), linkedAdditional: linkedSettings?.outfits.additional },
                            { field: 'individualBackgrounds' as const, label: t(SSRP_I18N_KEYS.individualBackground), options: backgroundOptions, additionalEnabledField: 'additionalBackgroundEnabled' as const, additionalTextField: 'additionalBackgroundText' as const, additionalLabel: t(SSRP_I18N_KEYS.additionalBackground), linkedAdditional: linkedSettings?.backgrounds.additional },
                        ]).map(({ field, label: fieldLabel, options, additionalEnabledField, additionalTextField, additionalLabel, linkedAdditional }) => (
                            <div key={field} className="space-y-1.5">
                                <label className="text-xs text-fg-muted font-medium">{fieldLabel}</label>
                                {((detail[field] as string[] | undefined) || ['']).map((itemVal, idx, arr) => (
                                    <div key={idx} className="flex gap-2">
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
                                            className={cn(DETAIL_FIELD_CLASS, 'flex-1')}
                                        >
                                            <option value="">{t(SSRP_I18N_KEYS.none)}</option>
                                            {options.map(opt => (
                                                <option key={opt.value} value={opt.value} disabled={arr.includes(opt.value) && itemVal !== opt.value}>{opt.label}</option>
                                            ))}
                                        </select>
                                        {(itemVal || (idx !== arr.length - 1 && arr.length > 1)) && (
                                            <IconButton
                                                label={t(SSRP_I18N_KEYS.deletePreset)}
                                                size="sm"
                                                className="self-center hover:text-danger"
                                                onClick={() => {
                                                    onUpdateDetail(charPath, d => {
                                                        const next = ((d[field] as string[] | undefined) || arr).filter((_, i) => i !== idx);
                                                        if (next.length === 0) next.push('');
                                                        return { ...d, [field]: next };
                                                    });
                                                }}
                                            >
                                                <Trash2 size={14} />
                                            </IconButton>
                                        )}
                                    </div>
                                ))}
                                {/* 追加設定（各項目の直下） */}
                                <div className="pt-1 space-y-1.5">
                                    <div className="flex items-center gap-2">
                                        <ToggleSwitch
                                            checked={!!detail[additionalEnabledField]}
                                            onChange={(on) => onUpdateDetail(charPath, d => ({ ...d, [additionalEnabledField]: on }))}
                                            label={additionalLabel}
                                            labelPosition="right"
                                            labelClassName="text-xs text-fg-muted"
                                            size="sm"
                                        />
                                        {/* キャラクター側の追加設定（設定ファイルエディタで紐づけたもの）。合成はプロンプト生成時に Go 側で行う */}
                                        {linkedAdditional && linkedAdditional.text.trim() && (
                                            <span
                                                className={cn('text-xs rounded px-1.5 py-0.5 border', linkedAdditional.mode === 'replace' ? 'border-warn text-warn' : 'border-ok text-ok')}
                                                title={linkedAdditional.text.slice(0, 80)}
                                            >
                                                {t(linkedAdditional.mode === 'replace' ? SSRP_I18N_KEYS.linkedBadgeReplace : SSRP_I18N_KEYS.linkedBadgeAppend)}
                                            </span>
                                        )}
                                    </div>
                                    {detail[additionalEnabledField] && (
                                        <textarea
                                            value={(detail[additionalTextField] as string) || ''}
                                            onChange={(e) => onUpdateDetail(charPath, d => ({ ...d, [additionalTextField]: e.target.value }))}
                                            placeholder={formatText(t(SSRP_I18N_KEYS.additionalInput), { label: additionalLabel })}
                                            className={cn(DETAIL_FIELD_CLASS, 'resize-y')}
                                            style={{ minHeight: '60px' }}
                                        />
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {section === 'correlation' && (
                    <div className="space-y-3">
                        {detail.correlations.map((rel, relIdx) => (
                            <div key={relIdx} className="bg-surface p-3 rounded-ui-lg border border-line space-y-2">
                                <div className="text-xs font-bold text-fg border-b border-line pb-1.5 flex justify-between items-center">
                                    {rel.targetId === 'user' ? (
                                        <div className="flex items-center gap-1.5 flex-1">
                                            <input
                                                type="text"
                                                value={userName}
                                                onChange={(e) => onUserNameInput(e.target.value)}
                                                placeholder={t(SSRP_I18N_KEYS.userNamePlaceholder)}
                                                className="bg-transparent border-b border-line-strong text-fg text-xs w-24 outline-none focus:border-accent px-0.5"
                                            />
                                            <span>{t(SSRP_I18N_KEYS.relationWithUser)}</span>
                                        </div>
                                    ) : (
                                        <span>{formatText(t(SSRP_I18N_KEYS.relationWithTarget), { target: rel.targetName })}</span>
                                    )}
                                </div>
                                <div className="flex gap-2 items-center">
                                    <span className="text-xs text-fg-muted w-12 flex-shrink-0">{t(SSRP_I18N_KEYS.relationship)}</span>
                                    <button
                                        onClick={() => {
                                            onFetchRelationshipOptions();
                                            onSelectRelation(charPath, relIdx);
                                        }}
                                        className={cn(DETAIL_FIELD_CLASS, 'flex-1 p-1.5 text-left flex items-center justify-between hover:border-accent')}
                                    >
                                        <span className={!rel.relationship ? 'text-fg-muted' : ''}>
                                            {relationshipOptions.find(o => o.value === rel.relationship)?.label || rel.relationship || t(SSRP_I18N_KEYS.notSelected)}
                                        </span>
                                        <ChevronDown size={14} className="text-fg-muted" />
                                    </button>
                                </div>
                                <textarea
                                    placeholder={t(SSRP_I18N_KEYS.detailsPlaceholder)}
                                    value={rel.details}
                                    onChange={(e) => onUpdateCorrelation(charPath, relIdx, 'details', e.target.value)}
                                    className={cn(DETAIL_FIELD_CLASS, 'h-16 resize-none')}
                                />
                                <div className="flex gap-2 items-center pt-1">
                                    <span className="text-xs text-fg-muted w-12 flex-shrink-0">{t(SSRP_I18N_KEYS.favorability)}</span>
                                    <input
                                        type="range"
                                        min="-100" max="100"
                                        value={rel.favorability || 0}
                                        onChange={(e) => onUpdateCorrelation(charPath, relIdx, 'favorability', parseInt(e.target.value))}
                                        className="flex-1 accent-[var(--c-accent)]"
                                    />
                                    <span className={cn('text-xs w-8 text-right font-mono', (rel.favorability || 0) < 0 ? 'text-danger' : 'text-fg')}>
                                        {rel.favorability || 0}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {section === 'media' && (
                    <div className="space-y-4">
                        {/* そのキャラを素材づくりで開く（画像生成が使えるならキャラ画像、読み上げだけなら声） */}
                        {!isTemp && (imageGenSettingsVisible || (canUseTTS && onOpenTTSSettings)) && (
                            <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => (imageGenSettingsVisible ? onOpenImageSettings(charPath) : onOpenTTSSettings?.(charPath))}
                            >
                                {t(PREPARE_PANEL_I18N_KEYS.detailOpenInMaterial)}
                            </Button>
                        )}
                        {/* 自動画像生成の対象（自動画像生成が ON のとき、このキャラのバブルへ予約するか） */}
                        {imageGenSettingsVisible && (
                            <div className="space-y-1">
                                <ToggleSwitch
                                    checked={detail.autoImageGenEnabled !== false}
                                    onChange={value => onUpdateDetail(charPath, d => ({ ...d, autoImageGenEnabled: value }))}
                                    label={t(SSRP_I18N_KEYS.autoImageGenTarget)}
                                    labelPosition="right"
                                    size="sm"
                                />
                                <p className="text-xs text-fg-muted pl-11">{t(SSRP_I18N_KEYS.autoImageGenTargetHint)}</p>
                            </div>
                        )}

                        {/* キャラクター音声設定パネル */}
                        {canUseTTS && (
                            <CharacterVoicePanel
                                characterName={characterDirName}
                                backendUrl={backendUrl}
                                uiCatalog={uiCatalog}
                                presetVoiceDesign={presetVoiceDesign}
                                onPresetVoiceDesignChange={onPresetVoiceDesignChange
                                    ? value => onPresetVoiceDesignChange(charPath, value)
                                    : undefined}
                            />
                        )}

                        {/* キャラクター画像管理パネル */}
                        <CharacterImagePanel
                            characterName={characterDirName}
                            backendUrl={backendUrl}
                            uiCatalog={uiCatalog}
                        />
                    </div>
                )}
            </div>
        </div>
    );
});
CharacterDetailPanel.displayName = 'CharacterDetailPanel';

export const RolePlaySettings = React.forwardRef<RolePlaySettingsHandlers, RolePlaySettingsProps>(({
    isOpen,
    onClose,
    onStartSession,
    initialSettings,
    onInitialized,
    backendUrl,
    canRestoreSessionSettings = false,
    onConversationPresetChanged,
    onRestoreSessionSettings,
    canApplyToSession = false,
    charactersChangedFromSession = false,
    onApplyToSession,
    applyToSessionState = 'idle',
    fallbackDirectiveMode: _fallbackDirectiveMode,
    defaultUserNameSetting,
    imageGenSettingsVisible = false,
    onOpenIntegratedImageSettings,
    ttsSettingsVisible = false,
    onOpenIntegratedTTSSettings,
    onOpenCharacterEditor,
    sessionId,
    messages,
    tempImport,
    onSessionSettingsUpdated,
    onCharactersChange,
    uiCatalog
}, ref) => {
    const t = (key: string) => resolveMessage(uiCatalog, key, PREPARE_PANEL_TEXT_FALLBACK_JA[key] || SSRP_TEXT_FALLBACK_JA[key] || key);
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
    const [charPickerWork, setCharPickerWork] = useState('');          // キャラ選択の窓の作品の絞り込み
    const [charPickerTags, setCharPickerTags] = useState<string[]>([]); // キャラ選択の窓のタグの絞り込み（AND）
    const [charDropdownOpenIdx, setCharDropdownOpenIdx] = useState<number | null>(null);       // キャラクター選択モーダルを開いている枠（追加は ADD_CHARACTER_SLOT）
    const [filterWorks, setFilterWorks] = useState<string[]>([]);
    const [filterTags, setFilterTags] = useState<string[]>([]);
    const [characterTagMap, setCharacterTagMap] = useState<Record<string, { work: string | null; tags: string[] }>>({});

    // 一時キャラクター（実ファイルを持たず会話設定に本文を抱える。キーは characters に入れる仮想パス）
    const [tempCharacters, setTempCharacters] = useState<Record<string, TempCharacter>>({});
    const [isTempImportOpen, setIsTempImportOpen] = useState(false);
    const [tempEditorPath, setTempEditorPath] = useState<string | null>(null);
    const [tempRegisterPath, setTempRegisterPath] = useState<string | null>(null);
    const [tempToast, setTempToast] = useState('');

    // 選択状態
    const [selectedCharacters, setSelectedCharacters] = useState<string[]>(['']);
    const [selectedSituations, setSelectedSituations] = useState<string[]>(['']);
    const [selectedUsers, setSelectedUsers] = useState<string[]>(['']);
    const [selectedWorlds, setSelectedWorlds] = useState<string[]>(['']);
    const [selectedStages, setSelectedStages] = useState<string[]>(['']);
    const [selectedWritingStyles, setSelectedWritingStyles] = useState<string[]>(['']);

    // 外す・足す・プリセット読み込みなど、どの経路の変更も選択状態を通るのでここで伝える
    useEffect(() => {
        onCharactersChange?.(selectedCharacters.filter(Boolean));
    }, [selectedCharacters, onCharactersChange]);

    // キャラクター詳細設定状態
    const [characterDetails, setCharacterDetails] = useState<Record<string, CharacterDetail>>({});

    // 会話設定側VoiceDesign（キーはキャラ.mdパス。キャラ差し替えでは初期化しない。要件6.5）
    const [voiceDesignByCharacter, setVoiceDesignByCharacter] = useState<Record<string, { mode: 'append' | 'replace'; text: string }>>({});

    // キャラクター側の設定紐づけ（linked_settings.json）。
    // ファイルの自動投入は「キャラクター選択モーダルで明示的に選んだ」ときだけ行うため、
    // onSelect で charPath を積み、syncDetails の末尾で消費する（プリセット読込・セッション復元では投入しない）。
    const pendingLinkedApplyRef = useRef<Set<string>>(new Set());
    // 表示用（「キャラ側の追加設定あり（追記／置換）」バッジ）。プリセットには保存しない。
    const [linkedSettingsByChar, setLinkedSettingsByChar] = useState<Record<string, LinkedSettings>>({});

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
    const [prepareTab, setPrepareTab] = useState<PrepareTab>('characters');
    // 詳細を開いているキャラ（欄の上に重ねて出す）
    const [detailCharPath, setDetailCharPath] = useState<string | null>(null);
    // パラメータ項目の管理画面（設定画面の「キャラパラメータ項目の管理」と同じもの）
    const [isSchemaEditorOpen, setIsSchemaEditorOpen] = useState(false);

    // グローバル追加設定
    const [additionalWorldEnabled, setAdditionalWorldEnabled] = useState(false);
    const [additionalWorldText, setAdditionalWorldText] = useState('');
    const [additionalStageEnabled, setAdditionalStageEnabled] = useState(false);
    const [additionalStageText, setAdditionalStageText] = useState('');
    const [additionalWritingStyleEnabled, setAdditionalWritingStyleEnabled] = useState(false);
    const [additionalWritingStyleText, setAdditionalWritingStyleText] = useState('');
    const [imageGenerationNotes, setImageGenerationNotes] = useState('');
    // 画像生成設定（ワークフロー・分析指示のセッション選択。空=Default）
    const [imageGenSettings, setImageGenSettings] = useState<ImageGenSettingsState>(() => getDefaultImageGenSettings());
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

    // 表情画像の差し替え（設定ファイルエディタ・画像管理パネル）をキャラカードへ即時反映する。
    // キャッシュを破棄すると購読側（このコンポーネント）が選択肢を再取得する。
    useEffect(() => {
        const handler = () => invalidateSSRPOptionsCache();
        window.addEventListener(CHARACTER_IMAGES_UPDATED_EVENT, handler);
        return () => window.removeEventListener(CHARACTER_IMAGES_UPDATED_EVENT, handler);
    }, []);

    // ピン留め状態
    const [isPinned, setIsPinned] = useState(false);
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
                // パラメータ項目の管理画面は欄の外に出しているため、開いている間は閉じない
                if (isSchemaEditorOpen) return;

                onClose();
            }
        };

        // マウスダウンで判定（クリック開始時点で外なら閉じる）
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen, isPinned, onClose, selectingRelation, isSchemaEditorOpen]);

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

        setVoiceDesignByCharacter(settings.voiceDesignByCharacter || {});
        setTempCharacters(settings.tempCharacters && typeof settings.tempCharacters === 'object' ? settings.tempCharacters : {});

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
        setImageGenSettings({
            workflowId: settings.imageGenWorkflowId || '',
            apiPresetId: settings.imageGenApiPresetId || '',
            directiveMode: settings.imageGenDirectiveMode || '',
            apiDirectiveMode: settings.imageGenApiDirectiveMode || '',
        });
        if (settings.additionalSituationEnabled !== undefined) setAdditionalSituationEnabled(settings.additionalSituationEnabled);
        if (settings.additionalSituationText !== undefined) setAdditionalSituationText(settings.additionalSituationText);
        if (settings.additionalUserEnabled !== undefined) setAdditionalUserEnabled(settings.additionalUserEnabled);
        if (settings.additionalUserText !== undefined) setAdditionalUserText(settings.additionalUserText);
        if (settings.additionalOverallEnabled !== undefined) setAdditionalOverallEnabled(settings.additionalOverallEnabled);
        if (settings.additionalOverallText !== undefined) setAdditionalOverallText(settings.additionalOverallText);
    };

    // 項目設定・各種プリセットの「一覧（プルダウン選択肢）」だけを取り直す。
    // 選択中の値・入力中の値・スキーマ本体は変更しない（編集中の状態を壊さないため）。
    const reloadPresetsAndSchemas = async () => {
        try {
            const schemas = await getParameterSchemas();
            setSchemaList(schemas.map(s => ({ id: s.id, name: s.name })));
        } catch (error) {
            console.warn('[RolePlaySettings] Failed to reload parameter schema list:', error);
        }
        try {
            setPresets(await listPresets(backendUrl));
            setSSRPAllPresets(await listSSRPAllPresets(backendUrl));
            setSSRPParamPresets(await listSSRPParamPresets(backendUrl));
        } catch (error) {
            console.warn('[RolePlaySettings] Failed to reload preset lists:', error);
        }
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

            await reloadPresetsAndSchemas();
            onInitialized?.();
        };
        if (isOpen) {
            init();
        }

        // 設定パック取り込み等（invalidateSSRPOptionsCache 呼び出し）で、メニューを
        // 閉じ直さなくても項目設定・各種プリセットの一覧を取り直す。選択中の値や
        // スキーマ本体は触らず、プルダウンの選択肢（一覧）だけを更新する。
        const unsubscribe = subscribeConfigFilesChanged(() => {
            if (isOpen) void reloadPresetsAndSchemas();
        });

        return () => { unsubscribe(); };
    }, [isOpen, initialSettings, backendUrl, onInitialized]);

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

        // メニューを開いている間にキャッシュ破棄（設定パック取り込み等）が起きたら、
        // 閉じ直さなくても即時再取得する。この時点でキャッシュは null なので必ずサーバへ取りに行く。
        // 併せて、キャラ別の個別背景・衣装・性格キャッシュ（cache[charPath] があると
        // スキップされる）を空にし、次の個別同期 useEffect で取り直させる。
        const unsubscribe = subscribeConfigFilesChanged(() => {
            setPersonalityOptionsCache({});
            setOutfitOptionsCache({});
            setBackgroundOptionsCache({});
            void loadOptions();
        });

        return () => {
            cancelled = true;
            unsubscribe();
        };
    }, [isOpen, backendUrl]);

    // キャラパス→表示名の索引（選択表示ボタンでのスロット数×キャラ数の線形検索を避ける）
    const characterLabelMap = useMemo(
        () => new Map(characterOptions.map(o => [o.value, o.label])),
        [characterOptions]
    );
    const characterDirNameMap = useMemo(
        () => new Map(characterOptions.map(o => [o.value, o.dirName])),
        [characterOptions]
    );
    // キャラカード（default 表情アイコン）。選択欄の左端に小さく出す
    const characterIconMap = useMemo(
        () => new Map(characterOptions.filter(o => o.imageUrl).map(o => [o.value, o.imageUrl as string])),
        [characterOptions]
    );

    // キャラ選択の窓の候補。ほかの枠で選んでいるキャラは除き、作品・タグで絞り込む
    const getPickerCharacterOptions = (idx: number) => {
        const current = idx === ADD_CHARACTER_SLOT ? '' : selectedCharacters[idx];
        return characterOptions.filter(opt => {
            if (opt.value === current) return true;
            if (selectedCharacters.includes(opt.value)) return false;

            const meta = characterTagMap[opt.value];
            const isUnclassified = !meta || !meta.work;

            // 作品フィルタ
            if (charPickerWork === '__unclassified__') {
                if (!isUnclassified) return false;
            } else if (charPickerWork) {
                if (!meta || meta.work !== charPickerWork) return false;
            }

            // タグフィルタ（AND条件）
            if (charPickerTags.length > 0) {
                if (!meta || !charPickerTags.every((tag: string) => meta.tags.includes(tag))) return false;
            }

            return true;
        });
    };

    // ユーザー名は新規相関の初期 targetName にだけ使うため ref で読む。
    // effect の依存に入れると 1 文字入力ごとに再実行され、全キャラの設定紐づけ取得が
    // 再発火する。既存相関の targetName 同期は handleUserNameInput が担っている。
    const userNameRef = useRef(userName);
    userNameRef.current = userName;

    // 個別背景 & 同期
    useEffect(() => {
        let cancelled = false;
        const syncDetails = async () => {
            const activeCharIds = selectedCharacters.filter(Boolean);

            // 1) ネットワーク取得（characterDetails に依存しない部分）を先に済ませる
            for (const charPath of activeCharIds) {
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
            }

            // キャラクター側の設定紐づけ：表示用に取得し、選択モーダル起点のキャラだけファイルを投入する。
            const linkedByChar: Record<string, LinkedSettings> = {};
            await Promise.all(activeCharIds.map(async (charPath) => {
                const dirName = characterDirNameMap.get(charPath) || getCharacterNameFromPath(charPath);
                try {
                    linkedByChar[charPath] = await getLinkedSettings(backendUrl, dirName);
                } catch {
                    // 取得失敗は「紐づけ無し」として扱う
                }
            }));
            // 取得中に選択が変わっていたら、この実行の結果は捨てる（新しい実行が引き継ぐ）
            if (cancelled) return;
            setLinkedSettingsByChar(linkedByChar);

            // 紐づけ投入の対象は state 更新の外で確定し、ここで持ち越し集合から外す
            // （updater 内で ref を書き換えると、StrictMode の二重実行で投入が抜けるため）。
            // 選択肢キャッシュは上の setCache（非同期）で入るため、3 種そろうまでは投入を持ち越す
            //（キャッシュ更新で本 effect が再実行される）。
            const linkedApplyTargets = activeCharIds.filter(charPath =>
                pendingLinkedApplyRef.current.has(charPath)
                && !!personalityOptionsCache[charPath] && !!outfitOptionsCache[charPath] && !!backgroundOptionsCache[charPath]
            );
            linkedApplyTargets.forEach(charPath => pendingLinkedApplyRef.current.delete(charPath));

            // 2) 詳細の付け替え・相関・紐づけ投入は、最新の state を基準に同期的に計算する。
            //    取得の await 中にユーザーが行った編集（相関・パラメータ・追加テキスト）を
            //    古いスナップショットで上書きしないため、関数型更新にしている。
            setCharacterDetails(prev => {
                const newDetails = { ...prev };
                let hasChange = false;
                const effectiveUserName = normalizeUserName(userNameRef.current);

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
                    }
                }

                // 削除されたキャラクター → 新しいキャラクターのマッピングを作成
                const charPathMapping: Record<string, string> = {};

                // ループ1: 設定の付け替えとマッピング作成
                for (const charPath of activeCharIds) {
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

                // 設定紐づけの投入は、付け替え（前キャラの detail 引き継ぎ）の後に重ね掛けする順序にしている。
                for (const charPath of linkedApplyTargets) {
                    const linked = linkedByChar[charPath];
                    if (!linked || !newDetails[charPath]) continue;
                    const groups: { field: 'individualPersonalities' | 'individualOutfits' | 'individualBackgrounds'; files: string[]; options: Option[] }[] = [
                        { field: 'individualPersonalities', files: linked.personalities.files, options: personalityOptionsCache[charPath] || [] },
                        { field: 'individualOutfits', files: linked.outfits.files, options: outfitOptionsCache[charPath] || [] },
                        { field: 'individualBackgrounds', files: linked.backgrounds.files, options: backgroundOptionsCache[charPath] || [] },
                    ];
                    let detail = newDetails[charPath];
                    for (const { field, files, options } of groups) {
                        const current = (detail[field] || []).filter(Boolean);
                        // 選択肢に無い（削除済み等）ファイルは投入せず、既に入っているものは重複させない。
                        // 上限 5 は掛けない（超過分の管理はユーザー責任）。
                        const additions = files.filter(f => options.some(o => o.value === f) && !current.includes(f));
                        if (additions.length === 0) continue;
                        detail = { ...detail, [field]: [...current, ...additions, ''] };
                        hasChange = true;
                    }
                    newDetails[charPath] = detail;
                }

                return hasChange ? newDetails : prev;
            });
        };
        // parameterSchema が更新されたら実行して初期値を適用したいので依存に入れる
        syncDetails();
        return () => { cancelled = true; };
    }, [selectedCharacters, personalityOptionsCache, backgroundOptionsCache, outfitOptionsCache, characterOptions, parameterSchema]);

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
                tempCharacters,
                characterDetails,
                voiceDesignByCharacter,
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
                imageGenWorkflowId: imageGenSettings.workflowId,
                imageGenApiPresetId: imageGenSettings.apiPresetId,
                imageGenDirectiveMode: imageGenSettings.directiveMode,
                imageGenApiDirectiveMode: imageGenSettings.apiDirectiveMode,
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
            tempCharacters,
            characterDetails,
            voiceDesignByCharacter,
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
            imageGenWorkflowId: imageGenSettings.workflowId,
            imageGenApiPresetId: imageGenSettings.apiPresetId,
            imageGenDirectiveMode: imageGenSettings.directiveMode,
            imageGenApiDirectiveMode: imageGenSettings.apiDirectiveMode,
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
        } catch (error) {
            // 名前の重複・使えない文字などで失敗したら、入力欄は残したまま失敗を知らせる
            console.error('[RolePlaySettings] Failed to save preset:', error);
            showTempToast(t(SSRP_I18N_KEYS.presetSaveFailed));
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
                tempCharacters,
                situations: selectedSituations.filter(s => s),
                users: selectedUsers.filter(u => u),
                worlds: selectedWorlds.filter(w => w),
                stages: selectedStages.filter(s => s),
                writingStyles: selectedWritingStyles.filter(ws => ws),
                characterDetails,
                voiceDesignByCharacter,
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
                imageGenWorkflowId: imageGenSettings.workflowId,
                imageGenApiPresetId: imageGenSettings.apiPresetId,
                imageGenDirectiveMode: imageGenSettings.directiveMode,
                imageGenApiDirectiveMode: imageGenSettings.apiDirectiveMode,
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

    // ---- 一時キャラクター（セッションからの取り込み） ----
    const showTempToast = (msg: string) => {
        setTempToast(msg);
        setTimeout(() => setTempToast(''), 3000);
    };
    // サーバー側で会話設定が更新された結果を UI と Chat 側の保持値へ反映する
    const applyServerSettings = (saved: any) => {
        if (!saved) return;
        applySettings(saved);
        onSessionSettingsUpdated?.(saved);
    };
    const canImportTempCharacters = !!sessionId && !!messages && messages.some(m => m.role === 'agent' && !m.errorType);
    const handleTempEditorSave = async (content: string) => {
        if (!tempEditorPath) return;
        if (!sessionId) {
            // セッション未開始（プリセットから読み込んだ一時キャラ）は UI 内だけで更新する
            setTempCharacters(prev => prev[tempEditorPath] ? { ...prev, [tempEditorPath]: { ...prev[tempEditorPath], content } } : prev);
            return;
        }
        const res = await updateTempCharacter(backendUrl, sessionId, tempEditorPath, content);
        applyServerSettings(res.ssrpSettings);
    };
    const handleTempRemove = async (idx: number, charPath: string) => {
        if (!sessionId) {
            setSelectedCharacters(prev => listWithDelete(idx, prev));
            setTempCharacters(prev => {
                const next = { ...prev };
                delete next[charPath];
                return next;
            });
            return;
        }
        try {
            const res = await removeTempCharacter(backendUrl, sessionId, charPath);
            applyServerSettings(res.ssrpSettings);
        } catch (error) {
            console.error('[RolePlaySettings] Failed to remove temp character:', error);
            showTempToast(t(SSRP_I18N_KEYS.tempCharacterRemoveFailed));
        }
    };
    const handleTempRegister = async () => {
        const charPath = tempRegisterPath;
        setTempRegisterPath(null);
        if (!sessionId || !charPath) return;
        const name = tempCharacters[charPath]?.name || getCharacterSettingNameFromPath(charPath);
        try {
            const res = await registerTempCharacter(backendUrl, sessionId, charPath);
            // 登録したキャラクターを一覧に載せる（キャッシュ破棄 → 購読で取り直し）
            invalidateSSRPOptionsCache();
            applyServerSettings(res.ssrpSettings);
            showTempToast(formatText(t(SSRP_I18N_KEYS.tempCharacterRegisterDone), { name }));
        } catch (error: any) {
            const key = error?.response?.data?.messageKey || error?.response?.data?.error || '';
            const reason = key ? resolveMessage(uiCatalog, key, key) : String(error?.message || '');
            showTempToast(formatText(t(SSRP_I18N_KEYS.tempCharacterRegisterFailed), { reason }));
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

    // 画像の設定は、素材づくりのキャラのタブでそのキャラを選んで開く
    const openImageSettingsForCharacter = useCallback((charPath: string) => {
        onOpenIntegratedImageSettings?.(getCharacterSettingNameFromPath(charPath));
    }, [onOpenIntegratedImageSettings]);

    // 会話設定側VoiceDesignの更新（キーはキャラ.mdパス。characterDetails と同じキー規約）。
    const updateVoiceDesignForCharacter = useCallback((charPath: string, value: { mode: 'append' | 'replace'; text: string }) => {
        setVoiceDesignByCharacter(prev => ({ ...prev, [charPath]: value }));
    }, []);

    // 声の紐づけも、素材づくりのキャラのタブでそのキャラを選んで開く
    const openTTSSettingsForCharacter = useCallback((charPath: string) => {
        onOpenIntegratedTTSSettings?.(getCharacterSettingNameFromPath(charPath));
    }, [onOpenIntegratedTTSSettings]);

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


    // 追加設定のスイッチと入力欄（世界観・舞台・シチュエーション・ユーザー・文体で共通）
    const renderAdditional = (enabled: boolean, setEnabled: (value: boolean) => void, text: string, setText: (value: string) => void, label: string) => (
        <div className="space-y-1.5">
            <ToggleSwitch
                checked={enabled}
                onChange={setEnabled}
                label={label}
                labelPosition="right"
                labelClassName="text-xs text-fg-muted"
                size="sm"
            />
            {enabled && (
                <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={formatText(t(SSRP_I18N_KEYS.additionalInput), { label })}
                    className={cn(PANEL_FIELD_CLASS, 'text-xs resize-y')}
                    style={{ minHeight: '60px' }}
                />
            )}
        </div>
    );

    // キャラのカードに出す主な状態（パラメータ項目の先頭のスライダー2つ）
    const characterSummary = (charPath: string): string => {
        const detail = characterDetails[charPath];
        if (!parameterSchema || !detail?.parameterGroups) return '';
        const parts: string[] = [];
        for (const groupState of detail.parameterGroups) {
            if (!groupState.enabled) continue;
            const groupDef = parameterSchema.groups.find(g => g.id === groupState.id);
            if (!groupDef) continue;
            for (const element of groupDef.elements) {
                if (element.type !== 'slider') continue;
                const value = groupState.values?.[element.id];
                if (value === undefined || value === null) continue;
                parts.push(`${getLocalizedText(element.displayName, parameterLangOf(uiCatalog?.lang))} ${value}`);
                if (parts.length >= 2) return joinNames(uiCatalog, parts);
            }
        }
        return joinNames(uiCatalog, parts);
    };

    const selectedCharacterList = selectedCharacters.filter(Boolean);
    // 詳細を開いているキャラが外れたら、詳細は出さない
    const detailTarget = detailCharPath && selectedCharacterList.includes(detailCharPath) && characterDetails[detailCharPath]
        ? detailCharPath
        : null;

    const removeCharacter = (charPath: string) => {
        const idx = selectedCharacters.indexOf(charPath);
        if (idx < 0) return;
        setDetailCharPath(null);
        if (isTempCharacterPath(charPath)) {
            // 一時キャラクターは会話設定内の本文も消す（サーバー側で削除）
            void handleTempRemove(idx, charPath);
            return;
        }
        setSelectedCharacters(prev => listWithDelete(idx, prev));
    };

    const tabs: { value: PrepareTab; label: string }[] = [
        { value: 'characters', label: t(PREPARE_PANEL_I18N_KEYS.tabCharacters) },
        { value: 'scene', label: t(PREPARE_PANEL_I18N_KEYS.tabScene) },
        { value: 'style', label: t(PREPARE_PANEL_I18N_KEYS.tabStyle) },
        { value: 'preset', label: t(PREPARE_PANEL_I18N_KEYS.tabPreset) },
    ];

    return (
        <>
            <div
                ref={containerRef}
                className={`
                    fixed inset-y-0 right-0 z-40 w-full sm:w-96 bg-panel-solid lg:bg-none lg:bg-panel text-fg border-l border-line
                    transform transition-all duration-300 ease-in-out shadow-2xl flex flex-col
                    ${isOpen ? 'translate-x-0' : 'translate-x-full'}

                    lg:relative lg:transform-none lg:shadow-none lg:z-auto
                    ${isOpen ? 'lg:w-96 lg:min-w-[24rem]' : 'lg:w-0 lg:min-w-0 lg:border-l-0'}
                `}
            >
                {/* 下のボタンの帯より上。キャラ詳細はこの範囲にだけ重ね、詳細を開いていても会話開始などを押せるようにする */}
                <div className="relative flex-1 min-h-0 flex flex-col">
                {/* 見出し */}
                <div className="flex items-center justify-between gap-2 pl-5 pr-3 h-14 shrink-0 border-b border-line min-w-0 lg:min-w-[24rem]">
                    <h2 className="font-head text-base font-bold tracking-wide truncate">{t(PREPARE_PANEL_I18N_KEYS.title)}</h2>
                    <div className="flex items-center gap-1">
                        {/* ピン留め（広い画面だけ。開いたままにしておく） */}
                        <IconButton
                            label={isPinned ? t(SSRP_I18N_KEYS.menuPinOn) : t(SSRP_I18N_KEYS.menuPinOff)}
                            active={isPinned}
                            className="hidden lg:inline-grid"
                            onClick={() => {
                                const next = !isPinned;
                                setIsPinned(next);
                                updateGlobalSettings(backendUrl, { isMenuPinned: next });
                            }}
                        >
                            {isPinned ? <Pin size={17} fill="currentColor" /> : <PinOff size={17} />}
                        </IconButton>
                        <IconButton label={resolveMessage(uiCatalog, 'common.close', '閉じる')} onClick={onClose}>
                            <X size={18} />
                        </IconButton>
                    </div>
                </div>

                {/* 会話設定全体のプリセット。キャラ・場面・文体・プリセットのタブの上に置く */}
                <div className="px-4 pt-3 min-w-0 lg:min-w-[24rem]">
                    <section className="space-y-2">
                        <div className="flex items-center justify-between">
                            <h3 className={PANEL_HEADING_CLASS}>{t(SSRP_I18N_KEYS.presetTitle)}</h3>
                            <div className="flex items-center gap-1">
                                {canRestoreSessionSettings && (
                                    <Button size="sm" variant="ghost" onClick={onRestoreSessionSettings} title={t(SSRP_I18N_KEYS.restoreSessionTitle)}>
                                        <RotateCcw size={12} /> {t(SSRP_I18N_KEYS.restoreSession)}
                                    </Button>
                                )}
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => {
                                        setIsSaveSSRPPresetOpen((prev) => {
                                            if (!prev) {
                                                setNewSSRPAllPresetName(selectedSSRPAllPreset);
                                            }
                                            return !prev;
                                        });
                                    }}
                                >
                                    <Plus size={12} /> {t(SSRP_I18N_KEYS.newSave)}
                                </Button>
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setIsPresetSelectionOpen(true)}
                                className={cn(PANEL_FIELD_CLASS, 'flex-1 text-left flex items-center justify-between hover:border-accent')}
                            >
                                <span className={!selectedSSRPAllPreset ? 'text-fg-muted' : 'text-fg'}>
                                    {selectedSSRPAllPreset || t(SSRP_I18N_KEYS.selectPreset)}
                                </span>
                                <ChevronDown size={14} className="text-fg-muted" />
                            </button>
                            {selectedSSRPAllPreset && (
                                <IconButton label={t(SSRP_I18N_KEYS.deletePreset)} className="hover:text-danger" onClick={() => handleDeleteSSRPAllPreset(selectedSSRPAllPreset)}>
                                    <Trash2 size={16} />
                                </IconButton>
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
                                    className={cn(PANEL_FIELD_CLASS, 'flex-1')}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !e.nativeEvent.isComposing) handleSaveSSRPAllPreset();
                                    }}
                                />
                                <Button
                                    variant="primary"
                                    onClick={handleSaveSSRPAllPreset}
                                    disabled={!newSSRPAllPresetName.trim() || isSavingSSRPAllPreset}
                                >
                                    {isSavingSSRPAllPreset ? (
                                        <span className="animate-pulse">{t(SSRP_I18N_KEYS.saving)}</span>
                                    ) : (
                                        <>
                                            <Save size={14} />
                                            {t(SSRP_I18N_KEYS.save)}
                                        </>
                                    )}
                                </Button>
                            </div>
                        )}
                    </section>
                </div>

                {/* タブ */}
                <div className="px-3 pt-3 min-w-0 lg:min-w-[24rem]">
                    <Segmented<PrepareTab> label={t(PREPARE_PANEL_I18N_KEYS.title)} value={prepareTab} onChange={setPrepareTab} options={tabs} block />
                </div>

                {/* スクロールエリア */}
                <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar min-w-0 lg:min-w-[24rem]">
                    {prepareTab === 'characters' && (
                        <>
                            <section className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <h3 className={PANEL_HEADING_CLASS}>
                                        {t(SSRP_I18N_KEYS.characterSectionTitle)}
                                        <span className="ml-2 font-normal tracking-normal">
                                            {formatText(t(PREPARE_PANEL_I18N_KEYS.characterCount), { count: selectedCharacterList.length })}
                                        </span>
                                    </h3>
                                    {tempImport && (
                                        <IconButton
                                            label={t(SSRP_I18N_KEYS.tempImportOpen)}
                                            size="sm"
                                            disabled={!canImportTempCharacters}
                                            onClick={() => setIsTempImportOpen(true)}
                                        >
                                            <UserPlus size={15} />
                                        </IconButton>
                                    )}
                                </div>
                                {selectedCharacterList.map(val => {
                                    // キャラカード：default 表情の画像を背景に敷き、名前と主な状態を重ねる
                                    const cardUrl = characterIconMap.get(val);
                                    // 一時キャラクター（キャラ設定登録前）は枠線の色で区別する
                                    const isTemp = isTempCharacterPath(val) && !tempCharacters[val]?.registeredPath;
                                    const summary = characterSummary(val);
                                    const cardLabel = characterLabelMap.get(val) || tempCharacters[val]?.name || val;
                                    return (
                                        // 同じ場面で相手だけを替えて始めるのが基本の使い方なので、入れ替えはカードから直接行う。
                                        // カードの左端の区画（高さいっぱい・幅は約2割）はキャラ選択の窓を開いて入れ替え、残りは個別の設定を開く
                                        <div
                                            key={val}
                                            className={cn(
                                                'relative flex h-16 overflow-hidden rounded-ui-lg border transition-colors',
                                                isTemp ? 'border-warn' : 'border-line hover:border-accent',
                                                cardUrl ? 'bg-black' : 'bg-surface',
                                            )}
                                        >
                                            {cardUrl && (
                                                <>
                                                    <img src={cardUrl} alt="" className="absolute inset-0 w-full h-full object-cover object-center opacity-70" />
                                                    <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/45 to-transparent" />
                                                </>
                                            )}
                                            {/* 入れ替えの区画。残りより濃くし、入れ替えの記号を出して押すと入れ替えだと分かるようにする */}
                                            <button
                                                type="button"
                                                title={formatLabelValue(uiCatalog, cardLabel, t(PREPARE_PANEL_I18N_KEYS.detailReplace))}
                                                aria-label={formatLabelValue(uiCatalog, cardLabel, t(PREPARE_PANEL_I18N_KEYS.detailReplace))}
                                                onClick={() => setCharDropdownOpenIdx(selectedCharacters.indexOf(val))}
                                                className={cn(
                                                    'relative z-10 shrink-0 w-[20%] min-w-14 flex flex-col items-center justify-center gap-1 border-r transition-colors',
                                                    cardUrl
                                                        // 画像の上は配色によらず暗く敷くので、記号は白で出す
                                                        ? 'bg-black/60 border-white/15 text-white hover:bg-black/75'
                                                        : 'bg-surface-2 border-line text-fg-muted hover:text-fg hover:bg-accent-soft',
                                                )}
                                            >
                                                <ArrowLeftRight size={18} />
                                                <span className="text-[10px] leading-none whitespace-nowrap">{t(PREPARE_PANEL_I18N_KEYS.cardReplace)}</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setDetailCharPath(val)}
                                                className="relative z-10 flex-1 min-w-0 flex items-center gap-3 px-3 text-left"
                                            >
                                            <span className="min-w-0 flex-1">
                                                <span className={cn('block truncate font-semibold', cardUrl ? 'text-fg drop-shadow' : 'text-fg')}>
                                                    {cardLabel}
                                                    {isTemp && (
                                                        <span className="ml-2 align-middle text-xs font-normal px-1 py-0.5 rounded border border-warn text-warn">
                                                            {t(SSRP_I18N_KEYS.tempCharacterBadge)}
                                                        </span>
                                                    )}
                                                </span>
                                                {summary && (
                                                    <span className={cn('block truncate text-xs', cardUrl ? 'text-fg/80' : 'text-fg-muted')}>{summary}</span>
                                                )}
                                            </span>
                                            <ChevronRight size={16} className={cn('shrink-0', cardUrl ? 'text-fg/80' : 'text-fg-muted')} />
                                            </button>
                                        </div>
                                    );
                                })}
                                {selectedCharacterList.length < MAX_CHARACTERS && (
                                    <Button block variant="secondary" onClick={() => setCharDropdownOpenIdx(ADD_CHARACTER_SLOT)}>
                                        <Plus size={15} />
                                        {t(PREPARE_PANEL_I18N_KEYS.addCharacter)}
                                    </Button>
                                )}
                            </section>

                            <section className="space-y-2">
                                <SelectSection title={t(SSRP_I18N_KEYS.userSection)} options={userOptions} selected={selectedUsers} setter={setSelectedUsers} placeholder={t(SSRP_I18N_KEYS.userSelect)} />
                                {renderAdditional(additionalUserEnabled, setAdditionalUserEnabled, additionalUserText, setAdditionalUserText, t(SSRP_I18N_KEYS.additionalUser))}
                            </section>

                            {imageGenSettingsVisible && (
                                <section className="space-y-3">
                                    <h3 className={PANEL_HEADING_CLASS}>{t(PREPARE_PANEL_I18N_KEYS.mediaThisConversation)}</h3>
                                    {/* その会話だけに効く画像生成設定（すべての会話に効く設定はクイック設定にある） */}
                                    <ImageGenerationSettings
                                        settings={imageGenSettings}
                                        onChange={setImageGenSettings}
                                        backendUrl={backendUrl}
                                        uiCatalog={uiCatalog}
                                    />
                                </section>
                            )}
                        </>
                    )}

                    {prepareTab === 'scene' && (
                        <>
                            <section className="space-y-2">
                                <SelectSection title={t(SSRP_I18N_KEYS.worldSection)} options={worldOptions} selected={selectedWorlds} setter={setSelectedWorlds} placeholder={t(SSRP_I18N_KEYS.worldSelect)} />
                                {renderAdditional(additionalWorldEnabled, setAdditionalWorldEnabled, additionalWorldText, setAdditionalWorldText, t(SSRP_I18N_KEYS.additionalWorld))}
                            </section>
                            <section className="space-y-2">
                                <SelectSection title={t(SSRP_I18N_KEYS.stageSection)} options={stageOptions} selected={selectedStages} setter={setSelectedStages} placeholder={t(SSRP_I18N_KEYS.stageSelect)} />
                                {renderAdditional(additionalStageEnabled, setAdditionalStageEnabled, additionalStageText, setAdditionalStageText, t(SSRP_I18N_KEYS.additionalStage))}
                            </section>
                            <section className="space-y-2">
                                <SelectSection title={t(SSRP_I18N_KEYS.situationSection)} options={situationOptions} selected={selectedSituations} setter={setSelectedSituations} placeholder={t(SSRP_I18N_KEYS.situationSelect)} />
                                {renderAdditional(additionalSituationEnabled, setAdditionalSituationEnabled, additionalSituationText, setAdditionalSituationText, t(SSRP_I18N_KEYS.additionalSituation))}
                            </section>
                            {/* 全体の追加設定（会話全体に効く補足。場面の選択の後に置く） */}
                            <section className="space-y-2">
                                <h3 className={PANEL_HEADING_CLASS}>{t(SSRP_I18N_KEYS.overallAdditional)}</h3>
                                <ToggleSwitch
                                    checked={additionalOverallEnabled}
                                    onChange={setAdditionalOverallEnabled}
                                    label={t(SSRP_I18N_KEYS.overallAdditional)}
                                    labelPosition="right"
                                    labelClassName="text-xs text-fg-muted"
                                    size="sm"
                                />
                                {additionalOverallEnabled && (
                                    <textarea
                                        value={additionalOverallText}
                                        onChange={(e) => setAdditionalOverallText(e.target.value)}
                                        placeholder={t(SSRP_I18N_KEYS.overallAdditionalPlaceholder)}
                                        className={cn(PANEL_FIELD_CLASS, 'text-xs resize-y')}
                                        style={{ minHeight: '80px' }}
                                    />
                                )}
                            </section>
                            {/* 日付時刻設定 */}
                            <section className="pt-4 border-t border-line">
                                <DateTimeSettings
                                    settings={dateTimeSettings}
                                    onChange={setDateTimeSettings}
                                    isLocked={dateTimeLocked}
                                    onLockChange={handleDateTimeLockChange}
                                    backendUrl={backendUrl}
                                    uiCatalog={uiCatalog}
                                />
                            </section>
                        </>
                    )}

                    {prepareTab === 'style' && (
                        <>
                            <section className="space-y-2">
                                <SelectSection title={t(SSRP_I18N_KEYS.writingStyleSection)} options={writingStyleOptions} selected={selectedWritingStyles} setter={setSelectedWritingStyles} placeholder={t(SSRP_I18N_KEYS.writingStyleSelect)} />
                                {renderAdditional(additionalWritingStyleEnabled, setAdditionalWritingStyleEnabled, additionalWritingStyleText, setAdditionalWritingStyleText, t(SSRP_I18N_KEYS.additionalWritingStyle))}
                            </section>
                            {/* 画像生成への補足 */}
                            <section className="space-y-2">
                                <h3 className={PANEL_HEADING_CLASS}>{t(SSRP_I18N_KEYS.imageGenerationNotes)}</h3>
                                <textarea
                                    value={imageGenerationNotes}
                                    onChange={(e) => setImageGenerationNotes(e.target.value)}
                                    placeholder={t(SSRP_I18N_KEYS.imageGenerationNotesPlaceholder)}
                                    className={cn(PANEL_FIELD_CLASS, 'text-xs resize-y')}
                                    style={{ minHeight: '70px' }}
                                />
                            </section>
                        </>
                    )}

                    {prepareTab === 'preset' && (
                        <>
                            {/* キャラ設定プリセット */}
                            <section className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <h3 className={PANEL_HEADING_CLASS}>{t(SSRP_I18N_KEYS.characterPresetTitle)}</h3>
                                    <Button size="sm" variant="ghost" onClick={() => setIsPresetModalOpen(!isPresetModalOpen)}>
                                        <Plus size={12} /> {t(SSRP_I18N_KEYS.newSave)}
                                    </Button>
                                </div>
                                {isPresetModalOpen && (
                                    <div className="flex gap-2 animate-slide-down">
                                        <input
                                            type="text"
                                            value={newPresetName}
                                            onChange={(e) => setNewPresetName(e.target.value)}
                                            placeholder={t(SSRP_I18N_KEYS.presetNameShortPlaceholder)}
                                            className={cn(PANEL_FIELD_CLASS, 'flex-1')}
                                        />
                                        <Button variant="primary" onClick={handleSavePreset} disabled={isSavingPreset}>
                                            <Save size={12} /> {t(SSRP_I18N_KEYS.save)}
                                        </Button>
                                    </div>
                                )}
                                <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto custom-scrollbar">
                                    {presets.length === 0 && <span className="text-xs text-fg-muted italic px-1">{t(SSRP_I18N_KEYS.noPresets)}</span>}
                                    {presets.map(p => (
                                        <Chip key={p} onClick={() => handleLoadPreset(p)}>{p}</Chip>
                                    ))}
                                </div>
                            </section>

                            {/* パラメータ項目設定 */}
                            <section className="space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                    <h3 className={PANEL_HEADING_CLASS}>{t(SSRP_I18N_KEYS.parameterSchemaTitle)}</h3>
                                    <Button size="sm" onClick={() => setIsSchemaEditorOpen(true)}>
                                        {resolveMessage(uiCatalog, SETTINGS_VIEW_I18N_KEYS.manage, SETTINGS_VIEW_TEXT_FALLBACK_JA[SETTINGS_VIEW_I18N_KEYS.manage])}
                                    </Button>
                                </div>
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
                                    className={cn(PANEL_FIELD_CLASS, initialSettings && 'opacity-60 cursor-not-allowed')}
                                >
                                    {schemaList.length === 0 && <option value="">{t(SSRP_I18N_KEYS.loading)}</option>}
                                    {schemaList.map(s => (
                                        <option key={s.id} value={s.id}>{getLocalizedText(s.name, parameterLangOf(uiCatalog?.lang))}</option>
                                    ))}
                                </select>
                                {initialSettings && (
                                    <p className="text-xs text-fg-muted">{t(SSRP_I18N_KEYS.notChangeableAfterStart)}</p>
                                )}
                            </section>
                        </>
                    )}
                </div>

                {/* キャラ詳細（下のボタンの帯より上に重ねて出す） */}
                {detailTarget && (
                    <CharacterDetailPanel
                        key={detailTarget}
                        charPath={detailTarget}
                        characterDirName={characterDirNameMap.get(detailTarget) || getCharacterNameFromPath(detailTarget)}
                        label={characterLabelMap.get(detailTarget) || tempCharacters[detailTarget]?.name || detailTarget}
                        isTemp={isTempCharacterPath(detailTarget)}
                        detail={characterDetails[detailTarget]}
                        parameterSchema={parameterSchema}
                        uiCatalog={uiCatalog}
                        backendUrl={backendUrl}
                        ssrpParamPresets={ssrpParamPresets}
                        userName={userName}
                        relationshipOptions={relationshipOptions}
                        personalityOptions={personalityOptionsCache[detailTarget] ?? EMPTY_OPTIONS}
                        outfitOptions={outfitOptionsCache[detailTarget] ?? EMPTY_OPTIONS}
                        backgroundOptions={backgroundOptionsCache[detailTarget] ?? EMPTY_OPTIONS}
                        onUpdateDetail={updateDetail}
                        onUserNameInput={handleUserNameInput}
                        onUserNameSet={setUserName}
                        onParamPresetsChange={setSSRPParamPresets}
                        onFetchRelationshipOptions={fetchRelationshipOptions}
                        onSelectRelation={handleSelectRelation}
                        onOpenImageSettings={openImageSettingsForCharacter}
                        imageGenSettingsVisible={imageGenSettingsVisible && !isTempCharacterPath(detailTarget)}
                        linkedSettings={linkedSettingsByChar[detailTarget]}
                        onOpenEditor={onOpenCharacterEditor
                            ? charPath => onOpenCharacterEditor({
                                dirName: characterDirNameMap.get(charPath) || getCharacterNameFromPath(charPath),
                                fileName: getCharacterSettingNameFromPath(charPath),
                            })
                            : undefined}
                        canUseTTS={ttsSettingsVisible && !isTempCharacterPath(detailTarget)}
                        onOpenTTSSettings={ttsSettingsVisible && !isTempCharacterPath(detailTarget) ? openTTSSettingsForCharacter : undefined}
                        presetVoiceDesign={voiceDesignByCharacter[detailTarget]}
                        onPresetVoiceDesignChange={ttsSettingsVisible && !isTempCharacterPath(detailTarget) ? updateVoiceDesignForCharacter : undefined}
                        onUpdateCorrelation={updateCorrelation}
                        onUpdateParamGroup={updateCharacterParamGroup}
                        onUpdateParamValue={updateCharacterParamValue}
                        onClose={() => setDetailCharPath(null)}
                        onReplace={() => setCharDropdownOpenIdx(selectedCharacters.indexOf(detailTarget))}
                        onRemove={() => removeCharacter(detailTarget)}
                        onEditTemp={isTempCharacterPath(detailTarget) ? () => setTempEditorPath(detailTarget) : undefined}
                        onRegisterTemp={isTempCharacterPath(detailTarget) && !tempCharacters[detailTarget]?.registeredPath && sessionId
                            ? () => setTempRegisterPath(detailTarget)
                            : undefined}
                    />
                )}
                </div>

                {/* 下のボタン。会話が無い：会話開始／会話中：変更があれば反映、いつでもこの設定で新しく始める。
                    会話中に話す相手を替えたときは、同じ会話へ反映するより新しく始める方が基本の使い方なので、そちらを主ボタンにする */}
                <div className="p-4 border-t border-line space-y-2 min-w-0 lg:min-w-[24rem]">
                    {!sessionId ? (
                        <Button block variant="primary" className="h-11" onClick={handleStart}>
                            <Check size={17} /> {t(SSRP_I18N_KEYS.startConversation)}
                        </Button>
                    ) : (
                        <>
                            {charactersChangedFromSession && (
                                <Button block variant="primary" className="h-11" onClick={handleStart}>
                                    <Check size={17} />
                                    <span className="truncate">
                                        {formatText(t(PREPARE_PANEL_I18N_KEYS.startNewWithCharacters), {
                                            names: joinNames(uiCatalog, selectedCharacterList.map(p => characterLabelMap.get(p) || tempCharacters[p]?.name || p)),
                                        })}
                                    </span>
                                </Button>
                            )}
                            {(canApplyToSession || applyToSessionState === 'done') && onApplyToSession && (
                                <Button
                                    block
                                    variant={charactersChangedFromSession ? 'secondary' : 'primary'}
                                    className={charactersChangedFromSession ? undefined : 'h-11'}
                                    onClick={onApplyToSession}
                                    disabled={applyToSessionState !== 'idle'}
                                    title={t(SSRP_I18N_KEYS.applyToSessionTitle)}
                                >
                                    {applyToSessionState === 'done' ? <Check size={16} /> : <RotateCcw size={16} className={applyToSessionState === 'applying' ? 'animate-spin' : ''} />}
                                    {applyToSessionState === 'done' ? t(PREPARE_PANEL_I18N_KEYS.applied) : t(PREPARE_PANEL_I18N_KEYS.applyChanges)}
                                </Button>
                            )}
                            {!charactersChangedFromSession && (
                                <Button block variant="ghost" onClick={handleStart}>
                                    {t(PREPARE_PANEL_I18N_KEYS.startNewWithSettings)}
                                </Button>
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* キャラクター選択モーダル（作品・タグの絞り込みは窓の中。スマホ幅では1列） */}
            <GridSelectionModal
                isOpen={charDropdownOpenIdx !== null}
                onClose={() => setCharDropdownOpenIdx(null)}
                title={t(SSRP_I18N_KEYS.characterSelect)}
                searchPlaceholder={t(SSRP_I18N_KEYS.characterSearch)}
                noMatchTemplate={t(SSRP_I18N_KEYS.noMatch)}
                searchable
                wide
                selectedValue={charDropdownOpenIdx !== null && charDropdownOpenIdx !== ADD_CHARACTER_SLOT
                    ? (selectedCharacters[charDropdownOpenIdx] || undefined)
                    : undefined}
                options={charDropdownOpenIdx !== null ? getPickerCharacterOptions(charDropdownOpenIdx) : []}
                filters={(
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-fg-muted whitespace-nowrap">{t(SSRP_I18N_KEYS.characterWorkFilter)}</span>
                            <select
                                value={charPickerWork}
                                onChange={(e) => setCharPickerWork(e.target.value)}
                                className={cn(PANEL_FIELD_CLASS, 'flex-1 py-1.5 text-xs')}
                            >
                                <option value="">ALL</option>
                                <option value="__unclassified__">{t(SSRP_I18N_KEYS.characterUnclassified)}</option>
                                {filterWorks.map(w => (
                                    <option key={w} value={w}>{w}</option>
                                ))}
                            </select>
                        </div>
                        {filterTags.length > 0 && (
                            <div className="flex items-start gap-2">
                                <span className="text-xs text-fg-muted whitespace-nowrap pt-0.5">{t(SSRP_I18N_KEYS.characterTagFilter)}</span>
                                <div className="flex flex-wrap gap-1">
                                    {filterTags.map(tag => {
                                        const isActive = charPickerTags.includes(tag);
                                        return (
                                            <Chip
                                                key={tag}
                                                selected={isActive}
                                                onClick={() => setCharPickerTags(prev => (isActive ? prev.filter(x => x !== tag) : [...prev, tag]))}
                                            >
                                                {tag}
                                            </Chip>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                )}
                onSelect={(val) => {
                    if (charDropdownOpenIdx !== null && val) {
                        // 明示的な選択（新規・差し替えとも）だけが設定紐づけの投入対象
                        pendingLinkedApplyRef.current.add(val);
                        if (charDropdownOpenIdx === ADD_CHARACTER_SLOT) {
                            setSelectedCharacters(prev => [...prev.filter(Boolean), val]);
                        } else {
                            const replaced = selectedCharacters[charDropdownOpenIdx];
                            setSelectedCharacters(prev => prev.map((v, i) => (i === charDropdownOpenIdx ? val : v)));
                            // 詳細を開いたまま差し替えたときは、新しいキャラの詳細へ移る
                            if (replaced && detailCharPath === replaced) setDetailCharPath(val);
                        }
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

            {/* セッションからの一時キャラクター取り込み */}
            {tempImport && (
                <TempCharacterImportModal
                    isOpen={isTempImportOpen}
                    onClose={() => setIsTempImportOpen(false)}
                    backendUrl={backendUrl}
                    sessionId={sessionId || null}
                    messages={messages || []}
                    tempCharacters={tempCharacters}
                    userName={userName}
                    tempImport={tempImport}
                    uiCatalog={uiCatalog}
                />
            )}
            <TempCharacterEditorModal
                key={tempEditorPath || 'closed'}
                isOpen={tempEditorPath !== null}
                characterName={tempEditorPath ? (tempCharacters[tempEditorPath]?.name || getCharacterSettingNameFromPath(tempEditorPath)) : ''}
                initialContent={tempEditorPath ? (tempCharacters[tempEditorPath]?.content || '') : ''}
                onSave={handleTempEditorSave}
                onClose={() => setTempEditorPath(null)}
                uiCatalog={uiCatalog}
            />
            <ConfirmDialog
                isOpen={tempRegisterPath !== null}
                title={t(SSRP_I18N_KEYS.tempCharacterRegisterConfirmTitle)}
                message={formatText(t(SSRP_I18N_KEYS.tempCharacterRegisterConfirm), {
                    name: tempRegisterPath ? (tempCharacters[tempRegisterPath]?.name || getCharacterSettingNameFromPath(tempRegisterPath)) : '',
                })}
                onYes={() => { void handleTempRegister(); }}
                onNo={() => setTempRegisterPath(null)}
                onCancel={() => setTempRegisterPath(null)}
                uiCatalog={uiCatalog}
            />
            {/* 欄は狭い画面で transform を持ち、内側の fixed が欄の幅に閉じ込められるため外に置く */}
            <ParameterSchemaEditorModal
                isOpen={isSchemaEditorOpen}
                onClose={() => {
                    setIsSchemaEditorOpen(false);
                    // 選んでいる項目設定の中身とキャラごとの値はそのままにし、選択肢の一覧だけを取り直す
                    getParameterSchemas()
                        .then(schemas => setSchemaList(schemas.map(s => ({ id: s.id, name: s.name }))))
                        .catch(error => console.warn('[RolePlaySettings] Failed to reload parameter schema list:', error));
                }}
                uiCatalog={uiCatalog}
            />
            {tempToast && (
                <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[70] bg-surface border border-accent/70 text-sm text-fg px-4 py-2 rounded shadow-lg">
                    {tempToast}
                </div>
            )}
        </>
    );
});

RolePlaySettings.displayName = 'RolePlaySettings';
