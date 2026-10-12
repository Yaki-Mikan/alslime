/**
 * IntegratedGenerateTestSection.tsx - テスト生成（素材づくりのキャラ画像の「試しに生成」で使う）
 *
 * キャラクター・タグを選択して画像生成テストを行う。
 * 使用ワークフローは独立したワークフロー選択セクション（親から props で受領）に従う。
 * 「左のキャラ設定を使用」トグルで左側のキャラクター設定（未保存含む）と連動可能。
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Search, Palette, RefreshCw, ChevronDown, ChevronRight, Download, X, Info, Settings2 } from 'lucide-react';
import {
    getTagCategories,
    getTagMapping,
    generateImage,
    generateApiServiceTest,
    imageDataUrlFromBase64,
    getComfyUIConfig,
    saveComfyUIConfig,
    listPlaceholderPresets,
    listApiServicePresets,
    tagTargetsOf,
} from '../../../api/comfyui';
import type {
    TagCategory,
    TagMappingFile,
    GenerateResult,
    CharacterImageGenConfig,
    PlaceholderPreset,
    PlaceholderEntry,
    ImageBackend,
    NovelAIPreset,
} from '../../../api/comfyui';
import type { CharacterTagInfo } from '../../../api/files';
import { createComfyUIText, formatComfyText } from '../i18n';
import { resolveBackendError, resolveMessage, type I18NCatalog } from '../../../api/i18n';
import { normalizeApiService, normalizeImageBackend } from '../apiservice/services';
import { ApiGenerateResultDetails } from '../apiservice/ApiGenerateResultDetails';
import { ToggleSwitch } from '../../common/ToggleSwitch';
import { PlaceholderEntriesEditor } from '../PlaceholderEntriesEditor';
import { PlaceholderPresetModal } from '../PlaceholderPresetModal';

interface Props {
    backendUrl: string;
    // 使用ワークフロー（ワークフロー選択セクションで選択されたテンプレート名）
    selectedTemplate: string;
    // API サービスで使う生成プリセット名（親が持っていれば渡す。無ければこのセクション内で選ぶ）
    selectedPreset?: string;
    useLeftCharacter: boolean;
    onToggleUseLeftCharacter: () => void;
    leftCharacterName: string;
    leftCharConfig: CharacterImageGenConfig;
    characters: CharacterTagInfo[];
    uiCatalog?: I18NCatalog | null;
    // 親の都合で生成を押せなくする（使用モデルの保存中など。表示のモデルと生成のモデルを食い違わせない）
    generateDisabled?: boolean;
}

// placeholderEntriesToRecord はエントリ配列を directReplacements（変換元→変換先）へ
// 変換する。適用先チェックが backend に付いていない行は外す。有効な行が無ければ
// undefined（リクエストにキー自体を載せない）。
const placeholderEntriesToRecord = (entries: PlaceholderEntry[], backend: ImageBackend): Record<string, string> | undefined => {
    const out: Record<string, string> = {};
    let found = false;
    for (const entry of entries) {
        const from = entry.from.trim();
        const to = entry.to.trim();
        if (!from || !to) continue;
        const targets = tagTargetsOf(entry);
        if (backend === 'api' ? !targets.api : !targets.comfyui) continue;
        out[from] = to;
        found = true;
    }
    return found ? out : undefined;
};

export const IntegratedGenerateTestSection: React.FC<Props> = ({
    backendUrl,
    selectedTemplate,
    selectedPreset,
    useLeftCharacter,
    onToggleUseLeftCharacter,
    leftCharacterName,
    leftCharConfig: _leftCharConfig,
    characters,
    uiCatalog = null,
    generateDisabled = false,
}) => {
    const { SECTION_NAMES, INTEGRATED, CHARACTER, GENERATE_TEST, COMMON, PLACEHOLDER_PRESET } = createComfyUIText(uiCatalog);
    // 画像生成バックエンド（全画面共用の選択）。API サービスでは生成プリセットを使う。
    const [imageBackend, setImageBackend] = useState<ImageBackend>('comfyui');
    const [apiPresets, setApiPresets] = useState<NovelAIPreset[]>([]);
    const [ownPreset, setOwnPreset] = useState('');
    const [intermediateStep, setIntermediateStep] = useState<number | null>(null);
    // その回の生成にだけ使う追加プロンプト（API サービス用のテスト生成のみ）
    const [extraPrompt, setExtraPrompt] = useState('');
    const isApi = imageBackend === 'api';
    const effectivePreset = selectedPreset ?? ownPreset;
    // 独立キャラクター選択（トグルOFF時）
    const [selectedCharacter, setSelectedCharacter] = useState('');
    const [isCharDropdownOpen, setIsCharDropdownOpen] = useState(false);
    const [charSearchQuery, setCharSearchQuery] = useState('');
    const charDropdownRef = useRef<HTMLDivElement>(null);

    // タグカテゴリ + 各カテゴリのタグ一覧
    const [categories, setCategories] = useState<TagCategory[]>([]);
    const [tagMappings, setTagMappings] = useState<Record<string, TagMappingFile>>({});
    const [tagSelections, setTagSelections] = useState<Record<string, string>>({});

    // 直テキストモード（タグ）
    const [tagDirectMode, setTagDirectMode] = useState<Record<string, boolean>>({});
    const [tagDirectTexts, setTagDirectTexts] = useState<Record<string, string>>({});

    // 直テキストモード（キャラクター）— useLeftCharacter OFF 時のみ有効
    const [charDirectMode, setCharDirectMode] = useState(false);
    const [charDirectText, setCharDirectText] = useState('');

    // プレースホルダ変換（プリセット選択は config に永続化して本番生成と共有。
    // 直接指定トグルON時はインライン編集の内容を一時的に使う）
    const [placeholderPresets, setPlaceholderPresets] = useState<PlaceholderPreset[]>([]);
    const [selectedPresetName, setSelectedPresetName] = useState('');
    const [placeholderDirectMode, setPlaceholderDirectMode] = useState(false);
    const [directEntries, setDirectEntries] = useState<PlaceholderEntry[]>([]);
    const [isPlaceholderModalOpen, setIsPlaceholderModalOpen] = useState(false);

    // 生成
    const [isGenerating, setIsGenerating] = useState(false);
    const [result, setResult] = useState<GenerateResult | null>(null);
    const [generatedImage, setGeneratedImage] = useState<string | null>(null);
    const [isImagePreviewOpen, setIsImagePreviewOpen] = useState(false);

    // 解決済みプロンプト表示
    const [showPositive, setShowPositive] = useState(false);
    const [showNegative, setShowNegative] = useState(false);
    const [showLoras, setShowLoras] = useState(false);

    // 初回読み込み
    useEffect(() => {
        (async () => {
            try {
                const catDef = await getTagCategories(backendUrl);
                setCategories(catDef.categories || []);

                const mappings: Record<string, TagMappingFile> = {};
                await Promise.all(
                    (catDef.categories || []).map(async (cat) => {
                        const m = await getTagMapping(backendUrl, cat.id);
                        mappings[cat.id] = m;
                    })
                );
                setTagMappings(mappings);
            } catch (e) {
                console.error('[IntegratedGenerateTestSection] initialization failed:', e);
            }
        })();
    }, [backendUrl]);

    // プレースホルダプリセット一覧 + 選択状態（config）の読み込み
    useEffect(() => {
        (async () => {
            try {
                const [list, config] = await Promise.all([
                    listPlaceholderPresets(backendUrl),
                    getComfyUIConfig(backendUrl),
                ]);
                setPlaceholderPresets(list);
                setSelectedPresetName(config.placeholderPresetName || '');
                const backend = normalizeImageBackend(config.imageBackend);
                setImageBackend(backend);
                if (backend === 'api') {
                    try {
                        const presets = await listApiServicePresets(backendUrl, normalizeApiService(config.apiService));
                        setApiPresets(presets);
                        setOwnPreset(prev => (prev && presets.some(p => p.name === prev)) ? prev : (config.apiPresetDefault || presets[0]?.name || ''));
                    } catch (e) {
                        console.error('[IntegratedGenerateTestSection] api presets load failed:', e);
                    }
                }
            } catch (e) {
                console.error('[IntegratedGenerateTestSection] placeholder preset load failed:', e);
            }
        })();
    }, [backendUrl]);

    // プリセット選択の即時保存（本番生成のタグ判定AIも同じ選択を参照する）
    const handlePresetChange = useCallback(async (name: string) => {
        setSelectedPresetName(name);
        try {
            const config = await getComfyUIConfig(backendUrl);
            await saveComfyUIConfig(backendUrl, { ...config, placeholderPresetName: name });
        } catch { /* 保存失敗は握りつぶし（UI状態は維持） */ }
    }, [backendUrl]);

    // 設定モーダルでの保存・削除後の一覧再読込（消えた選択名は未選択へ戻す）
    const reloadPlaceholderPresets = useCallback(async () => {
        try {
            const list = await listPlaceholderPresets(backendUrl);
            setPlaceholderPresets(list);
            setSelectedPresetName(prev => (prev && list.some(p => p.name === prev)) ? prev : '');
        } catch (e) {
            console.error('[IntegratedGenerateTestSection] placeholder preset reload failed:', e);
        }
    }, [backendUrl]);

    // キャラドロップダウン外クリック
    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (charDropdownRef.current && !charDropdownRef.current.contains(e.target as Node)) {
                setIsCharDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    const filteredCharacters = charSearchQuery.trim()
        ? characters.filter(c => c.name.toLowerCase().includes(charSearchQuery.trim().toLowerCase()))
        : characters;

    const updateTagSelection = useCallback((categoryId: string, value: string) => {
        setTagSelections(prev => ({ ...prev, [categoryId]: value }));
    }, []);

    // キャラ名 → ディレクトリ名変換
    const getCharDirName = useCallback((name: string) => {
        return characters.find(c => c.name === name)?.dirName || name;
    }, [characters]);

    // 実際に使用するキャラクター名（直テキストモード時は空文字）
    const effectiveCharacterName = useLeftCharacter
        ? leftCharacterName
        : (charDirectMode ? '' : getCharDirName(selectedCharacter));

    // 生成（API サービスでは途中経過を受けて画像を差し替え、final で確定する）
    const handleGenerate = useCallback(async () => {
        if (!isApi && !selectedTemplate) return;
        setIsGenerating(true);
        setResult(null);
        setGeneratedImage(null);
        setIntermediateStep(null);
        setIsImagePreviewOpen(false);
        try {
            // 直テキストモードのタグをdirectTagsに収集
            const directTags: Record<string, string> = {};
            const filteredTagSelections: Record<string, string> = {};
            for (const catId of Object.keys(tagSelections)) {
                if (tagDirectMode[catId]) {
                    directTags[catId] = tagDirectTexts[catId] || '';
                } else {
                    filteredTagSelections[catId] = tagSelections[catId];
                }
            }
            // 直テキストモードだがtagSelectionsに含まれないカテゴリも収集
            for (const catId of Object.keys(tagDirectMode)) {
                if (tagDirectMode[catId] && !(catId in directTags)) {
                    directTags[catId] = tagDirectTexts[catId] || '';
                }
            }

            // プレースホルダ変換（直接指定 or 選択プリセットの全項目）
            // ＋キャラクター直テキストモード時の上書きを合成
            const sourceEntries = placeholderDirectMode
                ? directEntries
                : (placeholderPresets.find(p => p.name === selectedPresetName)?.entries || []);
            const parsedReplacements = placeholderEntriesToRecord(sourceEntries, imageBackend);
            const charReplacement: Record<string, string> | undefined =
                (!useLeftCharacter && charDirectMode && charDirectText.trim())
                    ? { CHARACTER: charDirectText.trim() }
                    : undefined;
            const directReplacements: Record<string, string> | undefined =
                (parsedReplacements || charReplacement)
                    ? { ...(parsedReplacements || {}), ...(charReplacement || {}) }
                    : undefined;

            const request = {
                templateName: isApi ? '' : selectedTemplate,
                characterName: effectiveCharacterName,
                tagSelections: filteredTagSelections,
                ...(Object.keys(directTags).length > 0 ? { directTags } : {}),
                ...(directReplacements ? { directReplacements } : {}),
                ...(isApi ? { presetName: effectivePreset, backend: 'api' as ImageBackend } : {}),
                // 自由入力は API サービス用のテスト生成の、その回にだけ使う。
                ...(isApi && extraPrompt.trim() ? { extraPrompt } : {}),
            };
            const res = isApi
                ? await generateApiServiceTest(backendUrl, request, (stepIx, image) => {
                    setIntermediateStep(stepIx);
                    setGeneratedImage(imageDataUrlFromBase64(image));
                })
                : await generateImage(backendUrl, request);
            setResult(res);
            setIntermediateStep(null);
            if (res.success && res.imageBase64 && res.mimeType) {
                setGeneratedImage(`data:${res.mimeType};base64,${res.imageBase64}`);
            } else if (!res.success) {
                setGeneratedImage(null);
            }
        } catch (e: any) {
            setResult({ success: false, error: e.message || GENERATE_TEST.MESSAGES.GENERATE_FAILED });
            setGeneratedImage(null);
        } finally {
            setIsGenerating(false);
        }
    }, [backendUrl, isApi, imageBackend, selectedTemplate, effectivePreset, effectiveCharacterName, tagSelections, tagDirectMode, tagDirectTexts, charDirectMode, charDirectText, placeholderDirectMode, directEntries, placeholderPresets, selectedPresetName, useLeftCharacter, extraPrompt]);

    const handleRegenerate = useCallback(() => {
        handleGenerate();
    }, [handleGenerate]);

    const handleDownloadImage = useCallback(() => {
        if (!generatedImage) return;

        const now = new Date();
        const timestamp = [
            now.getFullYear(),
            String(now.getMonth() + 1).padStart(2, '0'),
            String(now.getDate()).padStart(2, '0'),
            '_',
            String(now.getHours()).padStart(2, '0'),
            String(now.getMinutes()).padStart(2, '0'),
            String(now.getSeconds()).padStart(2, '0'),
        ].join('');

        const mimeMatch = generatedImage.match(/^data:image\/([^;]+);base64,/);
        const extension = mimeMatch?.[1] === 'jpeg' ? 'jpg' : (mimeMatch?.[1] || 'png');
        const link = document.createElement('a');
        link.href = generatedImage;
        link.download = `comfyui_${timestamp}.${extension}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }, [generatedImage]);

    return (
        <div className="space-y-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-accent">
                <Palette size={16} className="text-accent" />
                {SECTION_NAMES.GENERATE_TEST}
            </h3>

            {/* 生成プリセット（API サービスで、親がプリセットを持たないときだけこのセクション内で選ぶ） */}
            {isApi && selectedPreset === undefined && (
                <div className="space-y-1">
                    <label className="text-sm font-medium text-fg-muted">{GENERATE_TEST.LABELS.PRESET}</label>
                    <select
                        value={ownPreset}
                        onChange={e => setOwnPreset(e.target.value)}
                        className="w-full bg-surface border border-line-strong rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-accent"
                    >
                        <option value="">{GENERATE_TEST.MESSAGES.COMMON_PRESET_OPTION}</option>
                        {apiPresets.map(p => (
                            <option key={p.name} value={p.name}>{p.name}</option>
                        ))}
                    </select>
                </div>
            )}

            {/* キャラクター連動トグル */}
            <div className="flex items-center gap-3 p-2 bg-surface border border-line-strong rounded-lg">
                <ToggleSwitch
                    checked={useLeftCharacter}
                    onChange={onToggleUseLeftCharacter}
                    label={INTEGRATED.USE_LEFT_CHARACTER_TOGGLE}
                    labelPosition="right"
                    labelClassName="text-sm text-accent"
                    accent="purple"
                    size="sm"
                />
                {useLeftCharacter && leftCharacterName && (
                    <span className="text-xs text-fg-muted">({leftCharacterName})</span>
                )}
            </div>

            {/* 独立キャラクター選択（トグルOFF時） */}
            {!useLeftCharacter && (
                <div className="space-y-1" ref={charDropdownRef}>
                    <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-fg-muted">{GENERATE_TEST.LABELS.CHARACTER}</label>
                        <ToggleSwitch
                            checked={charDirectMode}
                            onChange={setCharDirectMode}
                            label={GENERATE_TEST.LABELS.DIRECT_TEXT}
                            labelClassName="text-xs text-fg-muted"
                            accent="purple"
                            size="sm"
                        />
                    </div>
                    {charDirectMode ? (
                        <textarea
                            value={charDirectText}
                            onChange={e => setCharDirectText(e.target.value)}
                            placeholder={GENERATE_TEST.PLACEHOLDERS.DIRECT_TEXT_CHARACTER}
                            className="w-full bg-surface border border-line-strong rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-accent resize-y transition-colors"
                            rows={3}
                        />
                    ) : (
                        <>
                            <div
                                onClick={() => { setIsCharDropdownOpen(!isCharDropdownOpen); setCharSearchQuery(''); }}
                                className="w-full bg-surface border border-line-strong rounded-lg px-3 py-2 text-sm cursor-pointer hover:border-accent transition-colors flex items-center justify-between"
                            >
                                <span className={selectedCharacter ? 'text-fg' : 'text-fg-muted'}>
                                    {selectedCharacter || CHARACTER.PLACEHOLDERS.SELECT_CHARACTER}
                                </span>
                                <Search size={14} className="text-fg-muted" />
                            </div>
                            {isCharDropdownOpen && (
                                <div className="bg-surface border border-line-strong rounded-lg overflow-hidden">
                                    <div className="p-2 border-b border-line-strong">
                                        <input
                                            type="text"
                                            value={charSearchQuery}
                                            onChange={e => setCharSearchQuery(e.target.value)}
                                            placeholder={CHARACTER.PLACEHOLDERS.SEARCH_CHARACTER}
                                            className="w-full bg-surface border border-line-strong rounded px-2 py-1 text-sm text-fg outline-none focus:border-accent"
                                            autoFocus
                                        />
                                    </div>
                                    <div className="max-h-48 overflow-y-auto custom-scrollbar">
                                        <button
                                            onClick={() => { setSelectedCharacter(''); setIsCharDropdownOpen(false); }}
                                            className={`w-full text-left px-3 py-1.5 text-sm hover:bg-surface-2 transition-colors ${
                                                !selectedCharacter ? 'bg-accent-soft text-fg' : 'text-fg-muted'
                                            }`}
                                        >
                                            {GENERATE_TEST.PLACEHOLDERS.NOT_SELECTED}
                                        </button>
                                        {filteredCharacters.map(c => (
                                            <button key={c.path}
                                                onClick={() => { setSelectedCharacter(c.name); setIsCharDropdownOpen(false); }}
                                                className={`w-full text-left px-3 py-1.5 text-sm hover:bg-surface-2 transition-colors ${
                                                    selectedCharacter === c.name ? 'bg-accent-soft text-fg' : 'text-fg-muted'
                                                }`}>
                                                {c.name}
                                            </button>
                                        ))}
                                        {filteredCharacters.length === 0 && (
                                            <p className="text-xs text-fg-muted text-center py-3">{GENERATE_TEST.MESSAGES.NO_CHARACTER_FOUND}</p>
                                        )}
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}

            {/* タグ選択 */}
            <div className="space-y-2">
                <label className="text-sm font-medium text-fg-muted">{GENERATE_TEST.LABELS.TAG_SELECTION}</label>
                <div className="border border-line-strong rounded-lg p-3 space-y-2">
                    {categories.map(cat => {
                        const mapping = tagMappings[cat.id];
                        const hasTags = mapping && mapping.tags.length > 0;
                        const isDirect = tagDirectMode[cat.id] || false;
                        // 分類名は表示言語の訳を引く（利用者が足した分類は訳が無いので保存された名前を出す）
                        const categoryLabel = resolveMessage(uiCatalog, `comfyui.tagCategory.${cat.id}`, cat.label);
                        return (
                            <div key={cat.id} className="space-y-1">
                                <div className="flex items-center gap-2">
                                    <span className="text-sm text-fg-muted w-24 shrink-0">{categoryLabel}</span>
                                    {isDirect ? (
                                        <textarea
                                            value={tagDirectTexts[cat.id] || ''}
                                            onChange={e => setTagDirectTexts(prev => ({ ...prev, [cat.id]: e.target.value }))}
                                            placeholder={GENERATE_TEST.PLACEHOLDERS.DIRECT_TAG_PROMPT.replace('{{label}}', categoryLabel)}
                                            className="flex-1 min-w-0 bg-surface border border-line-strong rounded px-2 py-1.5 text-sm text-fg outline-none focus:border-accent resize-y transition-colors"
                                            rows={2}
                                        />
                                    ) : (
                                        <select
                                            value={tagSelections[cat.id] || ''}
                                            onChange={e => updateTagSelection(cat.id, e.target.value)}
                                            disabled={!hasTags}
                                            className="flex-1 min-w-0 bg-surface border border-line-strong rounded px-2 py-1.5 text-sm text-fg outline-none focus:border-accent disabled:opacity-40"
                                        >
                                            <option value="">{GENERATE_TEST.PLACEHOLDERS.NONE}</option>
                                            {hasTags && mapping.tags.map(tag => (
                                                <option key={tag.key} value={tag.key}>{tag.key}</option>
                                            ))}
                                        </select>
                                    )}
                                    <ToggleSwitch
                                        checked={isDirect}
                                        onChange={(on) => setTagDirectMode(prev => ({ ...prev, [cat.id]: on }))}
                                        label={GENERATE_TEST.LABELS.DIRECT_SHORT}
                                        labelPosition="right"
                                        labelClassName="text-xs text-fg-muted"
                                        accent="purple"
                                        size="sm"
                                        className="shrink-0"
                                        title={GENERATE_TEST.MESSAGES.DIRECT_TEXT_INPUT}
                                    />
                                </div>
                            </div>
                        );
                    })}
                    {categories.length === 0 && (
                        <p className="text-xs text-fg-muted text-center">{GENERATE_TEST.MESSAGES.NO_CATEGORY}</p>
                    )}
                </div>
            </div>

            {/* プレースホルダ変換（プリセット選択 / 直接指定） */}
            <div className="space-y-1">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                        <label className="text-sm font-medium text-fg-muted">{PLACEHOLDER_PRESET.LABELS.SECTION}</label>
                        <span
                            title={PLACEHOLDER_PRESET.MESSAGES.SECTION_INFO}
                            className="text-fg-muted hover:text-accent cursor-help"
                        >
                            <Info size={13} />
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <ToggleSwitch
                            checked={placeholderDirectMode}
                            onChange={setPlaceholderDirectMode}
                            label={PLACEHOLDER_PRESET.LABELS.DIRECT_MODE}
                            labelClassName="text-xs text-fg-muted"
                            accent="purple"
                            size="sm"
                        />
                        <button
                            type="button"
                            onClick={() => setIsPlaceholderModalOpen(true)}
                            title={PLACEHOLDER_PRESET.MESSAGES.OPEN_SETTINGS_TOOLTIP}
                            className="p-1.5 rounded text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors"
                        >
                            <Settings2 size={14} />
                        </button>
                    </div>
                </div>
                {placeholderDirectMode ? (
                    <PlaceholderEntriesEditor
                        entries={directEntries}
                        onChange={setDirectEntries}
                        uiCatalog={uiCatalog}
                    />
                ) : (
                    <select
                        value={selectedPresetName}
                        onChange={e => handlePresetChange(e.target.value)}
                        className="w-full bg-surface border border-line-strong rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-accent"
                    >
                        <option value="">{PLACEHOLDER_PRESET.PLACEHOLDERS.NO_PRESET}</option>
                        {placeholderPresets.map(p => (
                            <option key={p.name} value={p.name}>{p.name}</option>
                        ))}
                    </select>
                )}
            </div>

            {/* 追加プロンプト（自由入力。API サービス用のテスト生成のみ） */}
            {isApi && (
                <div className="space-y-1">
                    <label className="text-sm font-medium text-fg-muted" htmlFor="integrated-extra-prompt">{GENERATE_TEST.LABELS.EXTRA_PROMPT}</label>
                    <textarea
                        id="integrated-extra-prompt"
                        rows={3}
                        value={extraPrompt}
                        onChange={e => setExtraPrompt(e.target.value)}
                        className="w-full bg-surface border border-line-strong rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-accent resize-y"
                    />
                    <p className="text-xs text-fg-muted">{GENERATE_TEST.MESSAGES.EXTRA_PROMPT_DESC}</p>
                </div>
            )}

            {/* 生成ボタン */}
            <div className="flex items-center gap-2">
                <button
                    onClick={handleGenerate}
                    disabled={isGenerating || generateDisabled || (!isApi && !selectedTemplate)}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-accent hover:brightness-110 disabled:opacity-50 rounded-lg text-sm text-on-accent transition-colors"
                >
                    {isGenerating ? (
                        <>
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                            {intermediateStep !== null
                                ? formatComfyText(GENERATE_TEST.MESSAGES.INTERMEDIATE, { step: intermediateStep + 1 })
                                : GENERATE_TEST.MESSAGES.GENERATING}
                        </>
                    ) : (
                        <>
                            <Palette size={14} />
                            {COMMON.BUTTONS.GENERATE}
                        </>
                    )}
                </button>
                {generatedImage && (
                    <button
                        onClick={handleRegenerate}
                        disabled={isGenerating || generateDisabled}
                        className="flex items-center gap-1 px-3 py-2.5 bg-surface-2 hover:bg-surface-2 disabled:opacity-50 rounded-lg text-sm text-fg-muted transition-colors"
                        title={GENERATE_TEST.MESSAGES.RESEED_TOOLTIP}
                    >
                        <RefreshCw size={14} />
                        {COMMON.BUTTONS.REGENERATE}
                    </button>
                )}
            </div>

            {/* エラー表示 */}
            {result && !result.success && (
                <div className="bg-danger/10 border border-danger/40 rounded-lg px-3 py-2 text-sm text-danger">
                    {resolveBackendError(uiCatalog, result.error)}
                </div>
            )}

            {/* 生成結果画像 */}
            {generatedImage && (
                <div className="space-y-2">
                    <label className="text-sm font-medium text-fg-muted">{SECTION_NAMES.GENERATE_RESULT}</label>
                    <div className="border border-line-strong rounded-lg overflow-hidden bg-surface flex items-center justify-center">
                        <img
                            src={generatedImage}
                            alt={SECTION_NAMES.GENERATE_RESULT}
                            className="max-h-[400px] object-contain cursor-pointer"
                            onClick={() => setIsImagePreviewOpen(true)}
                            title={GENERATE_TEST.MESSAGES.CLICK_TO_ZOOM}
                        />
                    </div>
                </div>
            )}

            <PlaceholderPresetModal
                isOpen={isPlaceholderModalOpen}
                onClose={() => setIsPlaceholderModalOpen(false)}
                backendUrl={backendUrl}
                uiCatalog={uiCatalog}
                onPresetsChanged={reloadPlaceholderPresets}
            />

            {isImagePreviewOpen && generatedImage && (
                <div
                    className="fixed inset-0 z-[120] flex items-center justify-center bg-black/85 p-4"
                    onClick={() => setIsImagePreviewOpen(false)}
                >
                    <button
                        type="button"
                        onClick={() => setIsImagePreviewOpen(false)}
                        className="absolute right-5 top-5 p-2 rounded-lg bg-panel/90 border border-line-strong text-fg-muted hover:text-fg hover:bg-surface transition-colors"
                        title={COMMON.BUTTONS.CLOSE}
                    >
                        <X size={20} />
                    </button>
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            handleDownloadImage();
                        }}
                        className="absolute right-16 top-5 p-2 rounded-lg bg-panel/90 border border-line-strong text-fg-muted hover:text-fg hover:bg-surface transition-colors"
                        title={COMMON.MESSAGES.DOWNLOAD}
                    >
                        <Download size={20} />
                    </button>
                    <img
                        src={generatedImage}
                        alt={SECTION_NAMES.GENERATE_RESULT}
                        className="max-h-[92vh] max-w-[92vw] object-contain"
                        onClick={e => e.stopPropagation()}
                    />
                </div>
            )}

            {/* 解決済みプロンプト */}
            {result?.success && result.resolvedPrompt && (
                <div className="space-y-1">
                    <label className="text-sm font-medium text-fg-muted">{SECTION_NAMES.RESOLVED_PROMPT}</label>
                    <div className="border border-line-strong rounded-lg overflow-hidden text-xs">
                        <button
                            onClick={() => setShowPositive(!showPositive)}
                            className="w-full flex items-center gap-1 px-3 py-1.5 bg-surface hover:bg-surface text-fg-muted transition-colors border-b border-line-strong"
                        >
                            {showPositive ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                            {GENERATE_TEST.LABELS.POSITIVE_PROMPT}
                        </button>
                        {showPositive && (
                            <div className="px-3 py-2 text-fg-muted bg-surface border-b border-line-strong break-all">
                                {result.resolvedPrompt.positive || GENERATE_TEST.PLACEHOLDERS.NONE}
                            </div>
                        )}
                        <button
                            onClick={() => setShowNegative(!showNegative)}
                            className="w-full flex items-center gap-1 px-3 py-1.5 bg-surface hover:bg-surface text-fg-muted transition-colors border-b border-line-strong"
                        >
                            {showNegative ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                            {GENERATE_TEST.LABELS.NEGATIVE_PROMPT}
                        </button>
                        {showNegative && (
                            <div className="px-3 py-2 text-fg-muted bg-surface border-b border-line-strong break-all">
                                {result.resolvedPrompt.negative || GENERATE_TEST.PLACEHOLDERS.NONE}
                            </div>
                        )}
                        {result.backend !== 'api' && (
                            <>
                                <button
                                    onClick={() => setShowLoras(!showLoras)}
                                    className="w-full flex items-center gap-1 px-3 py-1.5 bg-surface hover:bg-surface text-fg-muted transition-colors"
                                >
                                    {showLoras ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                    {GENERATE_TEST.MESSAGES.APPLIED_LORA} ({result.resolvedPrompt.lorasApplied.length}{COMMON.MESSAGES.COUNT_SUFFIX})
                                </button>
                                {showLoras && (
                                    <div className="px-3 py-2 text-fg-muted bg-surface break-all">
                                        {result.resolvedPrompt.lorasApplied.length > 0
                                            ? result.resolvedPrompt.lorasApplied.join(', ')
                                            : GENERATE_TEST.PLACEHOLDERS.NONE}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                    {result.backend === 'api' && (
                        <ApiGenerateResultDetails result={result} uiCatalog={uiCatalog} />
                    )}
                </div>
            )}
        </div>
    );
};
