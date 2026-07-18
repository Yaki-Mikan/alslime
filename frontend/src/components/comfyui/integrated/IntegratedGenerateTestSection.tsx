/**
 * IntegratedGenerateTestSection.tsx - 統合設定画面用テスト生成セクション
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
    getComfyUIConfig,
    saveComfyUIConfig,
    listPlaceholderPresets,
} from '../../../api/comfyui';
import type {
    TagCategory,
    TagMappingFile,
    GenerateResult,
    CharacterImageGenConfig,
    PlaceholderPreset,
    PlaceholderEntry,
} from '../../../api/comfyui';
import type { CharacterTagInfo } from '../../../api/files';
import { createComfyUIText } from '../i18n';
import type { I18NCatalog } from '../../../api/i18n';
import { ToggleSwitch } from '../../common/ToggleSwitch';
import { PlaceholderEntriesEditor } from '../PlaceholderEntriesEditor';
import { PlaceholderPresetModal } from '../PlaceholderPresetModal';

interface Props {
    backendUrl: string;
    // 使用ワークフロー（ワークフロー選択セクションで選択されたテンプレート名）
    selectedTemplate: string;
    useLeftCharacter: boolean;
    onToggleUseLeftCharacter: () => void;
    leftCharacterName: string;
    leftCharConfig: CharacterImageGenConfig;
    characters: CharacterTagInfo[];
    uiCatalog?: I18NCatalog | null;
}

// placeholderEntriesToRecord はエントリ配列を directReplacements（変換元→変換先）へ
// 変換する。有効な行が無ければ undefined（リクエストにキー自体を載せない）。
const placeholderEntriesToRecord = (entries: PlaceholderEntry[]): Record<string, string> | undefined => {
    const out: Record<string, string> = {};
    let found = false;
    for (const entry of entries) {
        const from = entry.from.trim();
        const to = entry.to.trim();
        if (!from || !to) continue;
        out[from] = to;
        found = true;
    }
    return found ? out : undefined;
};

export const IntegratedGenerateTestSection: React.FC<Props> = ({
    backendUrl,
    selectedTemplate,
    useLeftCharacter,
    onToggleUseLeftCharacter,
    leftCharacterName,
    leftCharConfig: _leftCharConfig,
    characters,
    uiCatalog = null,
}) => {
    const { SECTION_NAMES, INTEGRATED, CHARACTER, GENERATE_TEST, COMMON, PLACEHOLDER_PRESET } = createComfyUIText(uiCatalog);
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

    // 生成
    const handleGenerate = useCallback(async () => {
        if (!selectedTemplate) return;
        setIsGenerating(true);
        setResult(null);
        setGeneratedImage(null);
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
            const parsedReplacements = placeholderEntriesToRecord(sourceEntries);
            const charReplacement: Record<string, string> | undefined =
                (!useLeftCharacter && charDirectMode && charDirectText.trim())
                    ? { CHARACTER: charDirectText.trim() }
                    : undefined;
            const directReplacements: Record<string, string> | undefined =
                (parsedReplacements || charReplacement)
                    ? { ...(parsedReplacements || {}), ...(charReplacement || {}) }
                    : undefined;

            const res = await generateImage(backendUrl, {
                templateName: selectedTemplate,
                characterName: effectiveCharacterName,
                tagSelections: filteredTagSelections,
                ...(Object.keys(directTags).length > 0 ? { directTags } : {}),
                ...(directReplacements ? { directReplacements } : {}),
            });
            setResult(res);
            if (res.success && res.imageBase64 && res.mimeType) {
                setGeneratedImage(`data:${res.mimeType};base64,${res.imageBase64}`);
            }
        } catch (e: any) {
            setResult({ success: false, error: e.message || GENERATE_TEST.MESSAGES.GENERATE_FAILED });
        } finally {
            setIsGenerating(false);
        }
    }, [backendUrl, selectedTemplate, effectiveCharacterName, tagSelections, tagDirectMode, tagDirectTexts, charDirectMode, charDirectText, placeholderDirectMode, directEntries, placeholderPresets, selectedPresetName, useLeftCharacter]);

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
            <h3 className="flex items-center gap-2 text-sm font-semibold text-purple-300">
                <Palette size={16} className="text-purple-400" />
                {SECTION_NAMES.GENERATE_TEST}
            </h3>

            {/* キャラクター連動トグル */}
            <div className="flex items-center gap-3 p-2 bg-gray-800/50 border border-purple-600/30 rounded-lg">
                <ToggleSwitch
                    checked={useLeftCharacter}
                    onChange={onToggleUseLeftCharacter}
                    label={INTEGRATED.USE_LEFT_CHARACTER_TOGGLE}
                    labelPosition="right"
                    labelClassName="text-sm text-purple-300"
                    accent="purple"
                    size="sm"
                />
                {useLeftCharacter && leftCharacterName && (
                    <span className="text-xs text-gray-400">({leftCharacterName})</span>
                )}
            </div>

            {/* 独立キャラクター選択（トグルOFF時） */}
            {!useLeftCharacter && (
                <div className="space-y-1" ref={charDropdownRef}>
                    <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-gray-400">{GENERATE_TEST.LABELS.CHARACTER}</label>
                        <ToggleSwitch
                            checked={charDirectMode}
                            onChange={setCharDirectMode}
                            label={GENERATE_TEST.LABELS.DIRECT_TEXT}
                            labelClassName="text-xs text-gray-500"
                            accent="purple"
                            size="sm"
                        />
                    </div>
                    {charDirectMode ? (
                        <textarea
                            value={charDirectText}
                            onChange={e => setCharDirectText(e.target.value)}
                            placeholder={GENERATE_TEST.PLACEHOLDERS.DIRECT_TEXT_CHARACTER}
                            className="w-full bg-gray-800 border border-purple-600/50 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-purple-500 resize-y transition-colors"
                            rows={3}
                        />
                    ) : (
                        <>
                            <div
                                onClick={() => { setIsCharDropdownOpen(!isCharDropdownOpen); setCharSearchQuery(''); }}
                                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm cursor-pointer hover:border-purple-500 transition-colors flex items-center justify-between"
                            >
                                <span className={selectedCharacter ? 'text-gray-200' : 'text-gray-500'}>
                                    {selectedCharacter || CHARACTER.PLACEHOLDERS.SELECT_CHARACTER}
                                </span>
                                <Search size={14} className="text-gray-500" />
                            </div>
                            {isCharDropdownOpen && (
                                <div className="bg-gray-800 border border-gray-600 rounded-lg overflow-hidden">
                                    <div className="p-2 border-b border-gray-700">
                                        <input
                                            type="text"
                                            value={charSearchQuery}
                                            onChange={e => setCharSearchQuery(e.target.value)}
                                            placeholder={CHARACTER.PLACEHOLDERS.SEARCH_CHARACTER}
                                            className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200 outline-none focus:border-purple-500"
                                            autoFocus
                                        />
                                    </div>
                                    <div className="max-h-48 overflow-y-auto custom-scrollbar">
                                        <button
                                            onClick={() => { setSelectedCharacter(''); setIsCharDropdownOpen(false); }}
                                            className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-700 transition-colors ${
                                                !selectedCharacter ? 'bg-purple-600/30 text-purple-200' : 'text-gray-500'
                                            }`}
                                        >
                                            {GENERATE_TEST.PLACEHOLDERS.NOT_SELECTED}
                                        </button>
                                        {filteredCharacters.map(c => (
                                            <button key={c.path}
                                                onClick={() => { setSelectedCharacter(c.name); setIsCharDropdownOpen(false); }}
                                                className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-700 transition-colors ${
                                                    selectedCharacter === c.name ? 'bg-purple-600/30 text-purple-200' : 'text-gray-300'
                                                }`}>
                                                {c.name}
                                            </button>
                                        ))}
                                        {filteredCharacters.length === 0 && (
                                            <p className="text-xs text-gray-600 text-center py-3">{GENERATE_TEST.MESSAGES.NO_CHARACTER_FOUND}</p>
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
                <label className="text-sm font-medium text-gray-400">{GENERATE_TEST.LABELS.TAG_SELECTION}</label>
                <div className="border border-gray-700 rounded-lg p-3 space-y-2">
                    {categories.map(cat => {
                        const mapping = tagMappings[cat.id];
                        const hasTags = mapping && mapping.tags.length > 0;
                        const isDirect = tagDirectMode[cat.id] || false;
                        return (
                            <div key={cat.id} className="space-y-1">
                                <div className="flex items-center gap-2">
                                    <span className="text-sm text-gray-400 w-24 shrink-0">{cat.label}</span>
                                    {isDirect ? (
                                        <textarea
                                            value={tagDirectTexts[cat.id] || ''}
                                            onChange={e => setTagDirectTexts(prev => ({ ...prev, [cat.id]: e.target.value }))}
                                            placeholder={GENERATE_TEST.PLACEHOLDERS.DIRECT_TAG_PROMPT.replace('{{label}}', cat.label)}
                                            className="flex-1 bg-gray-800 border border-purple-600/50 rounded px-2 py-1.5 text-sm text-gray-200 outline-none focus:border-purple-500 resize-y transition-colors"
                                            rows={2}
                                        />
                                    ) : (
                                        <select
                                            value={tagSelections[cat.id] || ''}
                                            onChange={e => updateTagSelection(cat.id, e.target.value)}
                                            disabled={!hasTags}
                                            className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 outline-none focus:border-purple-500 disabled:opacity-40"
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
                                        labelClassName="text-[10px] text-gray-500"
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
                        <p className="text-xs text-gray-600 text-center">{GENERATE_TEST.MESSAGES.NO_CATEGORY}</p>
                    )}
                </div>
            </div>

            {/* プレースホルダ変換（プリセット選択 / 直接指定） */}
            <div className="space-y-1">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                        <label className="text-sm font-medium text-gray-400">{PLACEHOLDER_PRESET.LABELS.SECTION}</label>
                        <span
                            title={PLACEHOLDER_PRESET.MESSAGES.SECTION_INFO}
                            className="text-gray-500 hover:text-cyan-400 cursor-help"
                        >
                            <Info size={13} />
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <ToggleSwitch
                            checked={placeholderDirectMode}
                            onChange={setPlaceholderDirectMode}
                            label={PLACEHOLDER_PRESET.LABELS.DIRECT_MODE}
                            labelClassName="text-xs text-gray-500"
                            accent="purple"
                            size="sm"
                        />
                        <button
                            type="button"
                            onClick={() => setIsPlaceholderModalOpen(true)}
                            title={PLACEHOLDER_PRESET.MESSAGES.OPEN_SETTINGS_TOOLTIP}
                            className="p-1.5 rounded text-gray-500 hover:text-gray-200 hover:bg-gray-700 transition-colors"
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
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-purple-500"
                    >
                        <option value="">{PLACEHOLDER_PRESET.PLACEHOLDERS.NO_PRESET}</option>
                        {placeholderPresets.map(p => (
                            <option key={p.name} value={p.name}>{p.name}</option>
                        ))}
                    </select>
                )}
            </div>

            {/* 生成ボタン */}
            <div className="flex items-center gap-2">
                <button
                    onClick={handleGenerate}
                    disabled={isGenerating || !selectedTemplate}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded-lg text-sm text-white transition-colors"
                >
                    {isGenerating ? (
                        <>
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                            {GENERATE_TEST.MESSAGES.GENERATING}
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
                        disabled={isGenerating}
                        className="flex items-center gap-1 px-3 py-2.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded-lg text-sm text-gray-300 transition-colors"
                        title={GENERATE_TEST.MESSAGES.RESEED_TOOLTIP}
                    >
                        <RefreshCw size={14} />
                        {COMMON.BUTTONS.REGENERATE}
                    </button>
                )}
            </div>

            {/* エラー表示 */}
            {result && !result.success && (
                <div className="bg-red-900/30 border border-red-700 rounded-lg px-3 py-2 text-sm text-red-300">
                    {result.error}
                </div>
            )}

            {/* 生成結果画像 */}
            {generatedImage && (
                <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-400">{SECTION_NAMES.GENERATE_RESULT}</label>
                    <div className="border border-gray-700 rounded-lg overflow-hidden bg-gray-800 flex items-center justify-center">
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
                        className="absolute right-5 top-5 p-2 rounded-lg bg-gray-900/90 border border-gray-700 text-gray-300 hover:text-gray-100 hover:bg-gray-800 transition-colors"
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
                        className="absolute right-16 top-5 p-2 rounded-lg bg-gray-900/90 border border-gray-700 text-gray-300 hover:text-gray-100 hover:bg-gray-800 transition-colors"
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
                    <label className="text-sm font-medium text-gray-400">{SECTION_NAMES.RESOLVED_PROMPT}</label>
                    <div className="border border-gray-700 rounded-lg overflow-hidden text-xs">
                        <button
                            onClick={() => setShowPositive(!showPositive)}
                            className="w-full flex items-center gap-1 px-3 py-1.5 bg-gray-800/70 hover:bg-gray-800 text-gray-400 transition-colors border-b border-gray-700"
                        >
                            {showPositive ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                            {GENERATE_TEST.LABELS.POSITIVE_PROMPT}
                        </button>
                        {showPositive && (
                            <div className="px-3 py-2 text-gray-300 bg-gray-800/30 border-b border-gray-700 break-all">
                                {result.resolvedPrompt.positive || GENERATE_TEST.PLACEHOLDERS.NONE}
                            </div>
                        )}
                        <button
                            onClick={() => setShowNegative(!showNegative)}
                            className="w-full flex items-center gap-1 px-3 py-1.5 bg-gray-800/70 hover:bg-gray-800 text-gray-400 transition-colors border-b border-gray-700"
                        >
                            {showNegative ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                            {GENERATE_TEST.LABELS.NEGATIVE_PROMPT}
                        </button>
                        {showNegative && (
                            <div className="px-3 py-2 text-gray-300 bg-gray-800/30 border-b border-gray-700 break-all">
                                {result.resolvedPrompt.negative || GENERATE_TEST.PLACEHOLDERS.NONE}
                            </div>
                        )}
                        <button
                            onClick={() => setShowLoras(!showLoras)}
                            className="w-full flex items-center gap-1 px-3 py-1.5 bg-gray-800/70 hover:bg-gray-800 text-gray-400 transition-colors"
                        >
                            {showLoras ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                            {GENERATE_TEST.MESSAGES.APPLIED_LORA} ({result.resolvedPrompt.lorasApplied.length}{COMMON.MESSAGES.COUNT_SUFFIX})
                        </button>
                        {showLoras && (
                            <div className="px-3 py-2 text-gray-300 bg-gray-800/30 break-all">
                                {result.resolvedPrompt.lorasApplied.length > 0
                                    ? result.resolvedPrompt.lorasApplied.join(', ')
                                    : GENERATE_TEST.PLACEHOLDERS.NONE}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
