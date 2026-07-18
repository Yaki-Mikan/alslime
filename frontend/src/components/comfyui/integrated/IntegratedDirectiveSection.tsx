/**
 * IntegratedDirectiveSection.tsx - タグ判定指示ファイル編集セクション
 *
 * 画像生成統合設定からタグ判定用指示ファイル（directive 2種）を編集する
 * （設定インポートエクスポート_設計.md §9。backend は config-editor の
 * 固定ファイル機構＋FeatureComfyUI ゲート）。
 * 固定ファイルのため編集・上書き保存のみ（新規作成・削除・リネームなし）。
 */

import React, { useEffect, useState } from 'react';
import { Save, FileText } from 'lucide-react';
import {
    listComfyDirectives,
    getComfyDirective,
    saveComfyDirective,
    type ComfyDirective,
} from '../../../api/config-editor';
import { resolveMessage, type I18NCatalog } from '../../../api/i18n';

interface Props {
    backendUrl: string;
    uiCatalog?: I18NCatalog | null;
}

const FALLBACK_JA: Record<string, string> = {
    'comfyDirective.hint': '会話からタグを判定するAIへの指示ファイルです。生成プロファイル（profiles）とセットで機能します。',
    'comfyDirective.loadFailed': '指示ファイルの読み込みに失敗しました',
    'comfyDirective.saved': '保存しました',
    'comfyDirective.saveFailed': '保存に失敗しました',
    'comfyDirective.saving': '保存中...',
    'comfyDirective.save': '上書き保存',
    'comfyDirective.placeholder': '指示内容を入力...',
};

export const IntegratedDirectiveSection: React.FC<Props> = ({ backendUrl, uiCatalog = null }) => {
    const t = (key: string) => resolveMessage(uiCatalog, key, FALLBACK_JA[key] || key);

    const [directives, setDirectives] = useState<ComfyDirective[]>([]);
    const [selectedId, setSelectedId] = useState('');
    const [content, setContent] = useState('');
    const [isDirty, setIsDirty] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [notice, setNotice] = useState('');

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

    return (
        <div className="space-y-3">
            <p className="text-xs text-gray-500">{t('comfyDirective.hint')}</p>

            {/* directive 切り替え（Danbooru形式 / 自然文形式） */}
            <div className="inline-flex rounded-lg border border-gray-700 bg-gray-800 p-1">
                {directives.map(d => (
                    <button
                        key={d.id}
                        type="button"
                        onClick={() => setSelectedId(d.id)}
                        className={`px-3 py-1 text-xs rounded transition-colors ${selectedId === d.id
                            ? 'bg-amber-700 text-white'
                            : 'text-gray-300 hover:bg-gray-700'}`}
                        title={d.file}
                    >
                        {d.label}
                    </button>
                ))}
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
                    disabled={isSaving || !selectedId || !isDirty}
                    className="flex items-center gap-2 px-4 py-1.5 text-sm text-white bg-amber-700 hover:bg-amber-600 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <Save size={14} />
                    {isSaving ? t('comfyDirective.saving') : t('comfyDirective.save')}
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
