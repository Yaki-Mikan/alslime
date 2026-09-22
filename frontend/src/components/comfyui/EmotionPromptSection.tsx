/**
 * EmotionPromptSection - 表情画像生成モーダルの「表情設定」エリア。
 *
 * 対象表情の選択と、表情ごとに保存できる複数プロンプト（タイトル＋本文）の
 * 選択・編集・保存・削除を担う。生成に使う本文は編集欄の内容（未保存でも可）。
 */

import React, { useEffect, useRef, useState } from 'react';
import { Save, Trash2, Download, Loader2 } from 'lucide-react';
import { EmotionDropdown } from '../common/EmotionDropdown';
import { ConfirmDialog } from '../ConfirmDialog';
import type { EmotionCatalogEntry } from '../../api/emotion-catalog';
import { saveEmotionPrompts, downloadEmotionPromptSample, emotionPromptTargetsOf, type EmotionPrompts, type EmotionPromptTargets } from '../../api/characters';
import type { ImageBackend } from '../../api/comfyui';
import { resolveMessage, type I18NCatalog } from '../../api/i18n';
import {
    DEFAULT_UI_LANGUAGE,
    EMOTION_IMAGE_GEN_I18N_KEYS,
    EMOTION_IMAGE_GEN_TEXT_FALLBACK_JA,
    EMOTION_CATALOG_I18N_KEYS,
    EMOTION_CATALOG_TEXT_FALLBACK_JA,
    CHARACTER_IMAGE_I18N_KEYS,
    CHARACTER_IMAGE_TEXT_FALLBACK_JA,
} from '../../constants/i18n';

interface Props {
    backendUrl: string;
    emotions: EmotionCatalogEntry[];
    selectedEmotion: string;
    onEmotionChange: (name: string) => void;
    prompts: EmotionPrompts;
    onPromptsChange: (next: EmotionPrompts) => void;
    /** 生成に使う本文（親が保持。編集欄と同じ値） */
    expressionText: string;
    onExpressionTextChange: (text: string) => void;
    uiCatalog?: I18NCatalog | null;
    /** 生成に使うバックエンド。指定すると、その側に適用チェックが付いた行だけを候補にする */
    backend?: ImageBackend;
}

const NEW_PROMPT = '';
const BOTH_TARGETS: EmotionPromptTargets = { comfyui: true, api: true };

export const EmotionPromptSection: React.FC<Props> = ({
    backendUrl,
    emotions,
    selectedEmotion,
    onEmotionChange,
    prompts,
    onPromptsChange,
    expressionText,
    onExpressionTextChange,
    uiCatalog = null,
    backend,
}) => {
    const t = (key: string) => resolveMessage(
        uiCatalog,
        key,
        EMOTION_IMAGE_GEN_TEXT_FALLBACK_JA[key] || EMOTION_CATALOG_TEXT_FALLBACK_JA[key] || CHARACTER_IMAGE_TEXT_FALLBACK_JA[key] || key,
    );
    const formatText = (template: string, values: Record<string, string | number>) =>
        Object.entries(values).reduce((text, [k, v]) => text.split(`{{${k}}}`).join(String(v)), template);

    const allEntries = prompts.emotions[selectedEmotion] || [];
    // 候補はバックエンドの適用チェックで絞る（保存・削除は全行を対象にする）
    const entries = backend
        ? allEntries.filter(e => (backend === 'api' ? emotionPromptTargetsOf(e).api : emotionPromptTargetsOf(e).comfyui))
        : allEntries;
    const [selectedTitle, setSelectedTitle] = useState<string>(NEW_PROMPT);
    const [title, setTitle] = useState('');
    const [targets, setTargets] = useState<EmotionPromptTargets>(BOTH_TARGETS);
    const [isSaving, setIsSaving] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);
    const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);

    // 表情切替、およびプロンプト一覧の読込完了時に、その表情の先頭プロンプトを選択する
    // （無ければ新規・本文空）。一覧は開いた後に非同期で届くため、表情切替だけに
    // 反応すると開いた直後は本文が空のまま残る。読込完了時は、利用者がまだ何も
    // 選択・入力していないときだけ適用し、編集中の内容は上書きしない。
    const appliedEmotionRef = useRef<string | null>(null);
    useEffect(() => {
        const emotionChanged = appliedEmotionRef.current !== selectedEmotion;
        const untouched = selectedTitle === NEW_PROMPT && title === '' && expressionText === '';
        if (!emotionChanged && !untouched) return;
        appliedEmotionRef.current = selectedEmotion;
        const first = entries[0];
        if (first) {
            setSelectedTitle(first.title);
            setTitle(first.title);
            setTargets(emotionPromptTargetsOf(first));
            onExpressionTextChange(first.prompt);
        } else {
            setSelectedTitle(NEW_PROMPT);
            setTitle('');
            setTargets(BOTH_TARGETS);
            onExpressionTextChange('');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedEmotion, prompts]);

    const handleSelectPrompt = (value: string) => {
        setSelectedTitle(value);
        if (value === NEW_PROMPT) {
            setTitle('');
            setTargets(BOTH_TARGETS);
            onExpressionTextChange('');
            return;
        }
        const entry = entries.find(e => e.title === value);
        setTitle(entry?.title || '');
        setTargets(entry ? emotionPromptTargetsOf(entry) : BOTH_TARGETS);
        onExpressionTextChange(entry?.prompt || '');
    };

    const persist = async (next: EmotionPrompts, noticeKey: string) => {
        setIsSaving(true);
        try {
            const saved = await saveEmotionPrompts(backendUrl, next);
            onPromptsChange(saved);
            setNotice(t(noticeKey));
        } catch (error) {
            console.error('[EmotionPromptSection] save failed:', error);
            setNotice(t(CHARACTER_IMAGE_I18N_KEYS.uploadFailed));
        } finally {
            setIsSaving(false);
            setTimeout(() => setNotice(null), 3000);
        }
    };

    const handleSave = async () => {
        const trimmed = title.trim();
        if (!trimmed) return;
        const others = allEntries.filter(e => e.title !== trimmed);
        // 両方に適用は項目を持たない形に揃える（既存データと同じ形）
        const savedTargets = targets.comfyui && targets.api ? undefined : targets;
        const next: EmotionPrompts = {
            ...prompts,
            emotions: { ...prompts.emotions, [selectedEmotion]: [...others, { title: trimmed, prompt: expressionText.trim(), ...(savedTargets ? { targets: savedTargets } : {}) }] },
        };
        await persist(next, EMOTION_IMAGE_GEN_I18N_KEYS.promptSaved);
        setSelectedTitle(trimmed);
    };

    const handleDelete = async () => {
        setIsDeleteConfirmOpen(false);
        if (selectedTitle === NEW_PROMPT) return;
        const remaining = allEntries.filter(e => e.title !== selectedTitle);
        const nextEmotions = { ...prompts.emotions };
        if (remaining.length > 0) nextEmotions[selectedEmotion] = remaining;
        else delete nextEmotions[selectedEmotion];
        await persist({ ...prompts, emotions: nextEmotions }, EMOTION_IMAGE_GEN_I18N_KEYS.promptSaved);
        setSelectedTitle(NEW_PROMPT);
        setTitle('');
        onExpressionTextChange('');
    };

    const canDelete = selectedTitle !== NEW_PROMPT && entries.some(e => e.title === selectedTitle);

    // サンプルプロンプトパックの取得（認証サーバーから。無いタイトルだけ追加される）
    const [isFetchingSample, setIsFetchingSample] = useState(false);
    const handleFetchSample = async () => {
        setIsFetchingSample(true);
        setNotice(null);
        try {
            const result = await downloadEmotionPromptSample(backendUrl, uiCatalog?.lang || DEFAULT_UI_LANGUAGE);
            onPromptsChange(result.prompts);
            setNotice(formatText(t(EMOTION_IMAGE_GEN_I18N_KEYS.sampleDone), { added: result.added, skipped: result.skipped }));
        } catch (error) {
            const messageKey = (error as { response?: { data?: { messageKey?: string } } })?.response?.data?.messageKey;
            console.error('[EmotionPromptSection] sample fetch failed:', error);
            setNotice(t(messageKey || EMOTION_IMAGE_GEN_I18N_KEYS.sampleFailed));
        } finally {
            setIsFetchingSample(false);
            setTimeout(() => setNotice(null), 5000);
        }
    };

    return (
        <div className="space-y-3">
            {/* 表情 */}
            <div>
                <label className="block text-xs text-gray-400 mb-1">{t(CHARACTER_IMAGE_I18N_KEYS.emotion)}</label>
                <EmotionDropdown
                    emotions={emotions}
                    value={selectedEmotion}
                    onChange={onEmotionChange}
                    disabledSuffix={t(EMOTION_CATALOG_I18N_KEYS.disabledSuffix)}
                />
            </div>

            {/* サンプルプロンプトパック取得（認証サーバーから。既存タイトルは保持） */}
            <div className="flex justify-end">
                <button
                    type="button"
                    onClick={handleFetchSample}
                    disabled={isFetchingSample || isSaving}
                    className="px-3 py-1.5 text-xs text-purple-200 border border-purple-700 hover:border-purple-400 hover:bg-purple-900/30 disabled:opacity-40 rounded-lg transition-colors flex items-center gap-1.5"
                >
                    {isFetchingSample ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                    {t(EMOTION_IMAGE_GEN_I18N_KEYS.sampleButton)}
                </button>
            </div>

            {/* 保存済みプロンプトの選択 */}
            <div>
                <label className="block text-xs text-gray-400 mb-1">{t(EMOTION_IMAGE_GEN_I18N_KEYS.promptSelect)}</label>
                <select
                    value={selectedTitle}
                    onChange={e => handleSelectPrompt(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 text-gray-200 rounded-lg p-2 text-sm outline-none focus:border-blue-500"
                >
                    <option value={NEW_PROMPT}>{t(EMOTION_IMAGE_GEN_I18N_KEYS.promptNew)}</option>
                    {entries.map(e => <option key={e.title} value={e.title}>{e.title}</option>)}
                </select>
            </div>

            {/* タイトル＋削除 */}
            <div>
                <label className="block text-xs text-gray-400 mb-1">{t(EMOTION_IMAGE_GEN_I18N_KEYS.promptTitle)}</label>
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={title}
                        onChange={e => setTitle(e.target.value)}
                        className="flex-1 bg-gray-800 border border-gray-700 text-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
                    />
                    <button
                        type="button"
                        onClick={() => setIsDeleteConfirmOpen(true)}
                        disabled={!canDelete || isSaving}
                        title={t(EMOTION_IMAGE_GEN_I18N_KEYS.promptDeleteTitle)}
                        className="p-2 rounded-lg border border-gray-700 text-gray-400 hover:text-red-300 hover:border-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                        <Trash2 size={16} />
                    </button>
                </div>
            </div>

            {/* 本文 */}
            <div>
                <label className="block text-xs text-gray-400 mb-1">{t(EMOTION_IMAGE_GEN_I18N_KEYS.promptBody)}</label>
                <textarea
                    value={expressionText}
                    onChange={e => onExpressionTextChange(e.target.value)}
                    rows={4}
                    className="w-full bg-gray-800 border border-gray-700 text-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 resize-y font-mono"
                />
            </div>

            {/* 適用先（画像生成バックエンドごとのチェック） */}
            <div className="flex flex-wrap items-center gap-4 text-xs text-gray-400">
                <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" checked={targets.comfyui}
                        onChange={e => setTargets(prev => ({ ...prev, comfyui: e.target.checked }))}
                        className="accent-blue-500" />
                    {t(EMOTION_IMAGE_GEN_I18N_KEYS.promptTargetComfyui)}
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" checked={targets.api}
                        onChange={e => setTargets(prev => ({ ...prev, api: e.target.checked }))}
                        className="accent-blue-500" />
                    {t(EMOTION_IMAGE_GEN_I18N_KEYS.promptTargetApi)}
                </label>
            </div>

            <div className="flex items-center justify-between">
                <span className="text-xs text-green-400">{notice || ''}</span>
                <button
                    type="button"
                    onClick={handleSave}
                    disabled={!title.trim() || isSaving}
                    className="px-3 py-1.5 text-sm text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded-lg transition-colors flex items-center gap-1.5"
                >
                    <Save size={14} />
                    {t(EMOTION_IMAGE_GEN_I18N_KEYS.promptSave)}
                </button>
            </div>

            {isDeleteConfirmOpen && (
                <ConfirmDialog
                    isOpen={true}
                    title={t(EMOTION_IMAGE_GEN_I18N_KEYS.promptDeleteTitle)}
                    message={formatText(t(EMOTION_IMAGE_GEN_I18N_KEYS.promptDeleteMessage), { title: selectedTitle })}
                    onYes={handleDelete}
                    onNo={() => setIsDeleteConfirmOpen(false)}
                    onCancel={() => setIsDeleteConfirmOpen(false)}
                    uiCatalog={uiCatalog}
                />
            )}
        </div>
    );
};
