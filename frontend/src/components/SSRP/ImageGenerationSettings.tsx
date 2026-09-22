import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Palette } from 'lucide-react';
import { resolveMessage, type I18NCatalog } from '../../api/i18n';
import { getComfyUIConfig, listApiServicePresets, listComfyUITemplates } from '../../api/comfyui';
import type { ImageBackend } from '../../api/comfyui';
import { normalizeApiService, normalizeImageBackend } from '../comfyui/apiservice/services';
import { listComfyDirectives, type ComfyDirective } from '../../api/config-editor';

/**
 * 会話設定の「画像生成設定」欄の状態。
 * 空文字は「Default」＝グローバル設定（ComfyUI設定側の選択）を適用する。
 */
export interface ImageGenSettingsState {
    /** 使用ワークフローテンプレート名（'' = Default。ComfyUI 連携のとき） */
    workflowId: string;
    /** API サービスの生成プリセット名（'' = Default。API サービスのとき） */
    apiPresetId: string;
    /** 分析指示の directiveMode 値（'' = Default。ComfyUI 連携のとき） */
    directiveMode: string;
    /** API サービス用の分析指示の値（'' = Default。API サービスのとき）。ComfyUI 用とは別に持つ */
    apiDirectiveMode: string;
}

export const getDefaultImageGenSettings = (): ImageGenSettingsState => ({
    workflowId: '',
    apiPresetId: '',
    directiveMode: '',
    apiDirectiveMode: '',
});

interface ImageGenerationSettingsProps {
    settings: ImageGenSettingsState;
    onChange: (settings: ImageGenSettingsState) => void;
    backendUrl: string;
    uiCatalog: I18NCatalog | null;
}

const I18N_KEYS = {
    title: 'ssrp.imageGenSettings.title',
    workflow: 'ssrp.imageGenSettings.workflow',
    preset: 'ssrp.imageGenSettings.preset',
    directive: 'ssrp.imageGenSettings.directive',
    defaultOption: 'ssrp.imageGenSettings.defaultOption',
    loadFailed: 'ssrp.imageGenSettings.loadFailed',
    customBadge: 'ssrp.imageGenSettings.customBadge',
} as const;

const FALLBACK_JA: Record<string, string> = {
    [I18N_KEYS.title]: '画像生成設定',
    [I18N_KEYS.workflow]: 'ワークフロー',
    [I18N_KEYS.preset]: '生成プリセット',
    [I18N_KEYS.directive]: '画像生成時の分析指示',
    [I18N_KEYS.defaultOption]: 'Default（グローバル設定に従う）',
    [I18N_KEYS.loadFailed]: '選択肢の取得に失敗しました。',
    [I18N_KEYS.customBadge]: '個別指定',
};

/**
 * 会話設定メニューの「画像生成設定」欄。
 * このプリセット/セッションで使うワークフローと分析指示を選択する。
 * 表示条件（ComfyUI機能が有効な支援レベル かつ モジュール連携済み）の判定は
 * 親側で行い、条件を満たす場合のみマウントされる（選択肢取得APIが非対象者へ
 * 403 を返すため、マウント制御が先）。
 */
export const ImageGenerationSettings: React.FC<ImageGenerationSettingsProps> = ({
    settings,
    onChange,
    backendUrl,
    uiCatalog,
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [templateNames, setTemplateNames] = useState<string[]>([]);
    const [presetNames, setPresetNames] = useState<string[]>([]);
    // 画像生成バックエンド（全画面共用の選択）。ワークフロー／プリセットの欄を切り替える。
    const [imageBackend, setImageBackend] = useState<ImageBackend>('comfyui');
    const [directives, setDirectives] = useState<ComfyDirective[]>([]);
    const [loadError, setLoadError] = useState(false);

    const t = (key: string) => resolveMessage(uiCatalog, key, FALLBACK_JA[key] || key);

    useEffect(() => {
        let canceled = false;
        (async () => {
            try {
                // 分析指示の選択は ComfyUI 用と API サービス用で別に持つ。選択肢も、使っている
                // バックエンドの側の指示ファイルの一覧から出す。
                const [templates, config] = await Promise.all([
                    listComfyUITemplates(backendUrl),
                    getComfyUIConfig(backendUrl).catch(() => null),
                ]);
                if (canceled) return;
                const backend = normalizeImageBackend(config?.imageBackend);
                const directiveList = await listComfyDirectives(backendUrl, backend);
                if (canceled) return;
                setTemplateNames(templates.filter(tpl => tpl.hasWorkflow).map(tpl => tpl.name));
                setDirectives(directiveList);
                setLoadError(false);
                if (config) {
                    setImageBackend(backend);
                    if (backend === 'api') {
                        try {
                            const presets = await listApiServicePresets(backendUrl, normalizeApiService(config.apiService));
                            if (!canceled) setPresetNames(presets.map(p => p.name));
                        } catch {
                            if (!canceled) setLoadError(true);
                        }
                    }
                }
            } catch {
                if (!canceled) setLoadError(true);
            }
        })();
        return () => { canceled = true; };
    }, [backendUrl]);

    const hasCustom = settings.workflowId !== '' || settings.apiPresetId !== '' || settings.directiveMode !== '' || settings.apiDirectiveMode !== '';
    // 使っているバックエンドの側の選択だけを読み書きする（片方を変えても他方は変わらない）。
    const isApi = imageBackend === 'api';
    const selectedDirective = isApi ? settings.apiDirectiveMode : settings.directiveMode;
    const changeDirective = (value: string) => onChange(isApi ? { ...settings, apiDirectiveMode: value } : { ...settings, directiveMode: value });

    // 保存済みの選択が一覧から消えている場合（テンプレート削除等）も選択肢として
    // 表示し、選択状態を維持する（消すと保存内容が意図せず書き換わるため。
    // 実行時はバックエンド側でグローバル既定へフォールバックする）。
    const workflowOptions = settings.workflowId && !templateNames.includes(settings.workflowId)
        ? [...templateNames, settings.workflowId]
        : templateNames;
    const presetOptions = settings.apiPresetId && !presetNames.includes(settings.apiPresetId)
        ? [...presetNames, settings.apiPresetId]
        : presetNames;
    const directiveModeValues = directives.map(d => directiveModeForDirectiveId(d.id));
    const directiveOptions = selectedDirective && !directiveModeValues.includes(selectedDirective)
        ? [...directives, null]
        : directives;

    return (
        <div className="border border-gray-700 rounded-lg overflow-hidden">
            {/* ヘッダー */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between px-4 py-3 bg-gray-800/50 hover:bg-gray-800 transition-colors"
            >
                <div className="flex items-center gap-2">
                    {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    <Palette size={14} className="text-purple-400" />
                    <span className="text-sm font-medium text-gray-300">{t(I18N_KEYS.title)}</span>
                </div>
                {hasCustom && (
                    <span className="text-xs text-purple-400 bg-purple-900/30 px-2 py-0.5 rounded">
                        {t(I18N_KEYS.customBadge)}
                    </span>
                )}
            </button>

            {/* 本体 */}
            {isOpen && (
                <div className="p-4 space-y-4 bg-gray-900/30 animate-fade-in">
                    {loadError && (
                        <p className="text-xs text-red-400">{t(I18N_KEYS.loadFailed)}</p>
                    )}
                    {imageBackend === 'api' ? (
                        <label className="space-y-1 block">
                            <span className="text-xs text-gray-500">{t(I18N_KEYS.preset)}</span>
                            <select
                                value={settings.apiPresetId}
                                onChange={(e) => onChange({ ...settings, apiPresetId: e.target.value })}
                                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-purple-500 transition-colors"
                            >
                                <option value="">{t(I18N_KEYS.defaultOption)}</option>
                                {presetOptions.map(name => (
                                    <option key={name} value={name}>{name}</option>
                                ))}
                            </select>
                        </label>
                    ) : (
                        <label className="space-y-1 block">
                            <span className="text-xs text-gray-500">{t(I18N_KEYS.workflow)}</span>
                            <select
                                value={settings.workflowId}
                                onChange={(e) => onChange({ ...settings, workflowId: e.target.value })}
                                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-purple-500 transition-colors"
                            >
                                <option value="">{t(I18N_KEYS.defaultOption)}</option>
                                {workflowOptions.map(name => (
                                    <option key={name} value={name}>{name}</option>
                                ))}
                            </select>
                        </label>
                    )}
                    <label className="space-y-1 block">
                        <span className="text-xs text-gray-500">{t(I18N_KEYS.directive)}</span>
                        <select
                            value={selectedDirective}
                            onChange={(e) => changeDirective(e.target.value)}
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-purple-500 transition-colors"
                        >
                            <option value="">{t(I18N_KEYS.defaultOption)}</option>
                            {directiveOptions.map(d => (
                                d === null ? (
                                    <option key={selectedDirective} value={selectedDirective}>{selectedDirective}</option>
                                ) : (
                                    <option key={d.id} value={directiveModeForDirectiveId(d.id)}>{d.label}</option>
                                )
                            ))}
                        </select>
                    </label>
                </div>
            )}
        </div>
    );
};

/**
 * 設定ファイルエディタ等の directive ID（danbooru / natural / danbooru_third /
 * natural_third / natural_short / natural_third_short）を、実行時に使う
 * directiveMode 値へ対応付ける。
 * バックエンド comfyui.DirectiveFileForMode の対応表と一致させること。
 * API サービス用の ID（api_ 接頭辞）も同じ形式値へ写す（形式の値の種類は両側で同じ。
 * どの形式を選んでいるかは、ComfyUI 用と API サービス用で別の項目に保存する）。
 */
export const directiveModeForDirectiveId = (id: string): string => {
    const base = id.startsWith('api_') ? id.slice(4) : id;
    switch (base) {
        case 'danbooru': return 'danbooru_only';
        case 'natural': return 'natural_language';
        case 'danbooru_third': return 'danbooru_third_person';
        case 'natural_third': return 'natural_language_third_person';
        case 'natural_short': return 'natural_language_short';
        case 'natural_third_short': return 'natural_language_third_person_short';
        default: return id;
    }
};
