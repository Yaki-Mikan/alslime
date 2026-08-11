/**
 * IntegratedDirectiveSection.tsx - タグ判定指示ファイル編集セクション
 *
 * 画像生成統合設定からタグ判定用指示ファイル（directive 2種）を編集する
 * （設定インポートエクスポート_設計.md §9。backend は config-editor の
 * 固定ファイル機構＋FeatureComfyUI ゲート）。
 * 固定ファイルのため編集・上書き保存のみ（新規作成・削除・リネームなし）。
 */

import React, { useEffect, useState } from 'react';
import { Save, FileText, RotateCcw, ExternalLink } from 'lucide-react';
import {
    listComfyDirectives,
    getComfyDirective,
    saveComfyDirective,
    resetComfyDirective,
    type ComfyDirective,
} from '../../../api/config-editor';
import { getComfyUIConfig } from '../../../api/comfyui';
import { directiveModeForDirectiveId } from '../../SSRP/ImageGenerationSettings';
import { resolveMessage, type I18NCatalog } from '../../../api/i18n';

interface Props {
    backendUrl: string;
    uiCatalog?: I18NCatalog | null;
    // 選択中の指示ファイルを設定ファイルエディタで開く（Hub が config タブへ
    // 切り替えて該当ファイルを開く。未指定ならボタンは表示しない）。
    onOpenInEditor?: (directiveId: string) => void;
}

const FALLBACK_JA: Record<string, string> = {
    'comfyDirective.hint': '会話からタグを判定するAIへの指示ファイルです。生成プロファイル（profiles）とセットで機能します。',
    'comfyDirective.loadFailed': '指示ファイルの読み込みに失敗しました',
    'comfyDirective.saved': '保存しました',
    'comfyDirective.saveFailed': '保存に失敗しました',
    'comfyDirective.saving': '保存中...',
    'comfyDirective.save': '上書き保存',
    'comfyDirective.placeholder': '指示内容を入力...',
    'comfyDirective.inUseBadge': 'グローバル設定で使用中',
    'comfyDirective.reset': 'デフォルトに戻す',
    'comfyDirective.resetConfirm': '指示ファイルを同梱デフォルトの内容に戻します。現在の内容は失われます。よろしいですか？',
    'comfyDirective.resetDone': 'デフォルトに戻しました',
    'comfyDirective.resetFailed': 'デフォルトへの復元に失敗しました',
    'comfyDirective.openInEditor': '設定ファイルエディタで開く',
};

export const IntegratedDirectiveSection: React.FC<Props> = ({ backendUrl, uiCatalog = null, onOpenInEditor }) => {
    const t = (key: string) => resolveMessage(uiCatalog, key, FALLBACK_JA[key] || key);

    const [directives, setDirectives] = useState<ComfyDirective[]>([]);
    const [selectedId, setSelectedId] = useState('');
    const [content, setContent] = useState('');
    const [isDirty, setIsDirty] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isResetting, setIsResetting] = useState(false);
    const [notice, setNotice] = useState('');
    // グローバル設定で実行時に使われている directiveMode（「使用中」表示用。
    // 編集対象の選択とは独立のため、どれが実際に使われるかを明示する）
    const [activeDirectiveMode, setActiveDirectiveMode] = useState('');

    useEffect(() => {
        let cancelled = false;
        listComfyDirectives(backendUrl)
            .then(list => {
                if (cancelled) return;
                setDirectives(list);
                if (list.length > 0) {
                    setSelectedId(prev => prev || list[0].id);
                }
            })
            .catch(() => setNotice(t('comfyDirective.loadFailed')));
        getComfyUIConfig(backendUrl)
            .then(cfg => { if (!cancelled) setActiveDirectiveMode(cfg.directiveMode); })
            .catch(() => { /* バッジ表示のみのため失敗は無視 */ });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [backendUrl]);

    useEffect(() => {
        if (!selectedId) return;
        let cancelled = false;
        getComfyDirective(backendUrl, selectedId)
            .then(c => {
                if (cancelled) return;
                setContent(c);
                setIsDirty(false);
                setNotice('');
            })
            .catch(() => setNotice(t('comfyDirective.loadFailed')));
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [backendUrl, selectedId]);

    const showNotice = (msg: string) => {
        setNotice(msg);
        setTimeout(() => setNotice(''), 2500);
    };

    const handleSave = async () => {
        if (!selectedId) return;
        setIsSaving(true);
        try {
            await saveComfyDirective(backendUrl, selectedId, content);
            setIsDirty(false);
            showNotice(t('comfyDirective.saved'));
        } catch {
            showNotice(t('comfyDirective.saveFailed'));
        } finally {
            setIsSaving(false);
        }
    };

    // 同梱デフォルトへの復元。利用者の編集内容を破棄するため確認を挟む。
    const handleReset = async () => {
        if (!selectedId) return;
        if (!confirm(t('comfyDirective.resetConfirm'))) return;
        setIsResetting(true);
        try {
            const restored = await resetComfyDirective(backendUrl, selectedId);
            setContent(restored);
            setIsDirty(false);
            showNotice(t('comfyDirective.resetDone'));
        } catch {
            showNotice(t('comfyDirective.resetFailed'));
        } finally {
            setIsResetting(false);
        }
    };

    return (
        <div className="space-y-3">
            <p className="text-xs text-gray-500">{t('comfyDirective.hint')}</p>

            {/* directive 切り替え（形式×視点の4件のためプルダウン） */}
            <div className="flex items-center gap-2">
                <select
                    value={selectedId}
                    onChange={e => setSelectedId(e.target.value)}
                    className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-200 outline-none focus:border-amber-600 transition-colors"
                >
                    {directives.map(d => (
                        <option key={d.id} value={d.id}>{d.label}</option>
                    ))}
                </select>
                {selectedId && activeDirectiveMode === directiveModeForDirectiveId(selectedId) && (
                    <span className="text-xs text-green-400 bg-green-900/30 px-2 py-0.5 rounded whitespace-nowrap">
                        {t('comfyDirective.inUseBadge')}
                    </span>
                )}
                {onOpenInEditor && selectedId && (
                    <button
                        onClick={() => onOpenInEditor(selectedId)}
                        className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-300 border border-gray-600 rounded hover:bg-gray-700 transition-colors whitespace-nowrap"
                    >
                        <ExternalLink size={12} />
                        {t('comfyDirective.openInEditor')}
                    </button>
                )}
            </div>

            <textarea
                value={content}
                onChange={e => { setContent(e.target.value); setIsDirty(true); }}
                placeholder={t('comfyDirective.placeholder')}
                className="w-full h-56 bg-gray-800/60 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-amber-600 resize-y font-mono"
            />

            <div className="flex items-center gap-3">
                <button
                    onClick={handleSave}
                    disabled={isSaving || isResetting || !selectedId || !isDirty}
                    className="flex items-center gap-2 px-4 py-1.5 text-sm text-white bg-amber-700 hover:bg-amber-600 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <Save size={14} />
                    {isSaving ? t('comfyDirective.saving') : t('comfyDirective.save')}
                </button>
                <button
                    onClick={handleReset}
                    disabled={isSaving || isResetting || !selectedId}
                    className="flex items-center gap-2 px-4 py-1.5 text-sm text-gray-300 border border-gray-600 rounded hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <RotateCcw size={14} />
                    {t('comfyDirective.reset')}
                </button>
                {selectedId && (
                    <span className="flex items-center gap-1 text-xs text-gray-500">
                        <FileText size={12} />
                        {directives.find(d => d.id === selectedId)?.file}
                    </span>
                )}
                {notice && <span className="text-xs text-amber-300">{notice}</span>}
            </div>
        </div>
    );
};
