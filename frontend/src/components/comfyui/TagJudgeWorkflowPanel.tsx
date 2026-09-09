/**
 * TagJudgeWorkflowPanel.tsx - タグ判定 AI・形式と使用ワークフローの設定部品
 *
 * 分析AI とモデル（TagJudgeProviderFields）、形式×ワークフロー対応表（ラジオが
 * 使用形式 directiveMode、各行のセレクトがその形式に紐づくワークフロー
 * workflowByDirectiveMode）、共通ワークフロー（defaultTemplateId）の選択を提供する。
 * 変更は即時保存（config 全体を読み直して該当キーだけ差し替えて PUT。統合設定の
 * フォーマット設定と同方式・後勝ち）。連続した変更で古い読み直しが新しい保存を
 * 上書きしないよう、保存は直列化する。
 * 画像生成統合設定のワークフローセクションと、左メニューの
 * タグ判定・ワークフロー設定パネルの両方で使う。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Workflow, CheckCircle, AlertCircle } from 'lucide-react';
import {
    getComfyUIConfig,
    saveComfyUIConfig,
    listComfyUITemplates,
} from '../../api/comfyui';
import type { ComfyUIConfig, DirectiveMode, TemplateInfo } from '../../api/comfyui';
import { TagJudgeProviderFields, type TagJudgeProviderValues } from './TagJudgeProviderFields';
import { normalizeClaudeEffort } from '../../constants/claude';
import { DEFAULT_ANTIGRAVITY_THINKING, normalizeAntigravityThinking } from '../../constants/antigravity';
import { createComfyUIText } from './i18n';
import type { I18NCatalog } from '../../api/i18n';

/** config の tagJudge* 欄と部品の値の相互変換。 */
const tagJudgeValuesFromConfig = (config: ComfyUIConfig): TagJudgeProviderValues => ({
    provider: config.tagJudgeProvider || 'gemini',
    geminiModel: config.tagJudgeGeminiModel || 'gemini-3-flash-preview',
    claudeModel: config.tagJudgeClaudeModel || 'claude-sonnet-4-6',
    claudeEffort: normalizeClaudeEffort(config.tagJudgeClaudeEffort),
    antigravityModel: config.tagJudgeAntigravityModel || 'antigravity',
    antigravityThinking: normalizeAntigravityThinking(config.tagJudgeAntigravityThinking),
    openAICompatModel: config.tagJudgeOpenAICompatModel || '',
});

const tagJudgeConfigPatch = (values: TagJudgeProviderValues): Partial<ComfyUIConfig> => ({
    tagJudgeProvider: values.provider,
    tagJudgeGeminiModel: values.geminiModel,
    tagJudgeClaudeModel: values.claudeModel,
    tagJudgeClaudeEffort: values.claudeEffort,
    tagJudgeAntigravityModel: values.antigravityModel,
    tagJudgeAntigravityThinking: values.antigravityThinking,
    tagJudgeOpenAICompatModel: values.openAICompatModel,
});

const defaultTagJudgeValues: TagJudgeProviderValues = {
    provider: 'gemini',
    geminiModel: 'gemini-3-flash-preview',
    claudeModel: 'claude-sonnet-4-6',
    claudeEffort: '',
    antigravityModel: 'antigravity',
    antigravityThinking: DEFAULT_ANTIGRAVITY_THINKING,
    openAICompatModel: '',
};

interface Props {
    backendUrl: string;
    uiCatalog?: I18NCatalog | null;
    // テンプレート一覧を親が保持している場合に渡す（未指定なら自前で取得する）
    templates?: TemplateInfo[];
    // 見出し行を出すか（左メニューのようにパネル器側が見出しを持つ場合は false）
    showHeading?: boolean;
    // 幅の狭い場所向けに、ラジオ文字列の下・ラベルの下へプルダウンを縦積みする
    stacked?: boolean;
}

export const TagJudgeWorkflowPanel: React.FC<Props> = ({
    backendUrl,
    uiCatalog = null,
    templates,
    showHeading = true,
    stacked = false,
}) => {
    const { COMMON, DIRECTIVE_MODE_OPTIONS } = createComfyUIText(uiCatalog);

    const [directiveMode, setDirectiveMode] = useState<DirectiveMode>('danbooru_only');
    const [workflowByDirectiveMode, setWorkflowByDirectiveMode] = useState<Record<string, string>>({});
    const [defaultTemplateId, setDefaultTemplateId] = useState('');
    const [tagJudgeValues, setTagJudgeValues] = useState<TagJudgeProviderValues>(defaultTagJudgeValues);
    // 設定の読み込みが終わるまで分析AI 部品の自動補正（先頭自動選択等）で保存が走らないようにする。
    const [configLoaded, setConfigLoaded] = useState(false);
    const [ownTemplates, setOwnTemplates] = useState<TemplateInfo[]>([]);
    const [notice, setNotice] = useState<{ kind: 'saved' | 'error'; text: string } | null>(null);
    // 保存の直列化（読み直し→書き込みの組が交差しないようにする）
    const saveChain = useRef<Promise<void>>(Promise.resolve());

    const effectiveTemplates = templates ?? ownTemplates;

    // マウント時に現在の設定（と、親から未受領ならテンプレート一覧）を読み込む。
    // パネル器側が閉→開でアンマウント/再マウントするため、他画面での変更はここで拾う。
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const config = await getComfyUIConfig(backendUrl);
                if (cancelled) return;
                setDirectiveMode((config.directiveMode || 'danbooru_only') as DirectiveMode);
                setWorkflowByDirectiveMode(config.workflowByDirectiveMode || {});
                setDefaultTemplateId(config.defaultTemplateId || '');
                setTagJudgeValues(tagJudgeValuesFromConfig(config));
                setConfigLoaded(true);
            } catch (error) {
                console.error('[TagJudgeWorkflowPanel] config load failed:', error);
            }
            if (templates === undefined) {
                try {
                    const list = await listComfyUITemplates(backendUrl);
                    if (!cancelled) setOwnTemplates(list);
                } catch (error) {
                    console.error('[TagJudgeWorkflowPanel] template list load failed:', error);
                }
            }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [backendUrl]);

    const showNotice = (kind: 'saved' | 'error', text: string) => {
        setNotice({ kind, text });
        window.setTimeout(() => setNotice(null), 2500);
    };

    // 即時保存（config 全体を読み直して該当キーだけ差し替えて PUT）。
    // 直前の保存が終わるまで次の読み直しを待たせ、古い config で上書きしないようにする。
    const persistPatch = useCallback((patch: Partial<ComfyUIConfig>) => {
        const run = async () => {
            try {
                const config = await getComfyUIConfig(backendUrl);
                await saveComfyUIConfig(backendUrl, { ...config, ...patch });
                showNotice('saved', COMMON.MESSAGES.SAVED);
            } catch (error) {
                console.error('[TagJudgeWorkflowPanel] save failed:', error);
                showNotice('error', COMMON.MESSAGES.SAVE_FAILED);
            }
        };
        saveChain.current = saveChain.current.then(run, run);
        return saveChain.current;
    }, [backendUrl, COMMON.MESSAGES.SAVED, COMMON.MESSAGES.SAVE_FAILED]);

    // 分析AI・モデルの変更（部品の自動補正も含む）。tagJudge* の 7 キーは常にまとめて書く。
    const handleChangeTagJudge = useCallback((patch: Partial<TagJudgeProviderValues>) => {
        setTagJudgeValues((prev) => {
            const next = { ...prev, ...patch };
            if (configLoaded) {
                void persistPatch(tagJudgeConfigPatch(next));
            }
            return next;
        });
    }, [configLoaded, persistPatch]);

    const handleChangeDirectiveMode = (mode: DirectiveMode) => {
        setDirectiveMode(mode);
        void persistPatch({ directiveMode: mode });
    };

    const handleChangeRowWorkflow = (mode: DirectiveMode, templateName: string) => {
        const next = { ...workflowByDirectiveMode };
        if (templateName === '') {
            delete next[mode];
        } else {
            next[mode] = templateName;
        }
        setWorkflowByDirectiveMode(next);
        void persistPatch({ workflowByDirectiveMode: next });
    };

    const handleChangeDefaultTemplate = (name: string) => {
        setDefaultTemplateId(name);
        void persistPatch({ defaultTemplateId: name });
    };

    const rows: { value: DirectiveMode; label: string }[] = [
        { value: 'natural_language', label: DIRECTIVE_MODE_OPTIONS.NATURAL_LANGUAGE },
        { value: 'natural_language_short', label: DIRECTIVE_MODE_OPTIONS.NATURAL_SHORT },
        { value: 'natural_language_third_person', label: DIRECTIVE_MODE_OPTIONS.NATURAL_THIRD },
        { value: 'natural_language_third_person_short', label: DIRECTIVE_MODE_OPTIONS.NATURAL_THIRD_SHORT },
        { value: 'danbooru_only', label: DIRECTIVE_MODE_OPTIONS.DANBOORU_ONLY },
        { value: 'danbooru_third_person', label: DIRECTIVE_MODE_OPTIONS.DANBOORU_THIRD },
    ];

    const templateNames = effectiveTemplates.filter(t => t.hasWorkflow).map(t => t.name);

    return (
        <div className="space-y-2">
            {showHeading && (
                <h4 className="flex items-center gap-2 text-sm font-medium text-gray-400">
                    <Workflow size={16} className="text-green-400" />
                    {COMMON.MESSAGES.FORMAT_WORKFLOW_HEADING}
                </h4>
            )}
            {/* 分析AI・モデル（画像生成設定モーダルと同じ部品。変更は即時保存） */}
            <TagJudgeProviderFields
                backendUrl={backendUrl}
                uiCatalog={uiCatalog}
                active={configLoaded}
                values={tagJudgeValues}
                onChange={handleChangeTagJudge}
                stacked={stacked}
            />

            <p className="text-xs text-gray-500 pt-1">{COMMON.MESSAGES.FORMAT_WORKFLOW_DESC}</p>
            <p className="text-xs text-gray-500">{COMMON.MESSAGES.DIRECTIVE_MODE_DESC}</p>

            {rows.map((row) => {
                const mappedName = workflowByDirectiveMode[row.value] ?? '';
                // 保存済みの紐づけ先が一覧から消えている場合（削除済み等）も選択肢に
                // 出して選択状態を維持する（実行時はバックエンドが共通へフォールバック）。
                const rowOptions = mappedName && !templateNames.includes(mappedName)
                    ? [...templateNames, mappedName]
                    : templateNames;
                return (
                    <div key={row.value} className={stacked ? 'flex flex-col gap-1' : 'flex items-center gap-2'}>
                        <label className={`flex items-center gap-2 min-w-0 cursor-pointer ${stacked ? '' : 'flex-1'}`}>
                            <input
                                type="radio"
                                name="tagJudgeWorkflowDirectiveMode"
                                checked={directiveMode === row.value}
                                onChange={() => handleChangeDirectiveMode(row.value)}
                                className="accent-green-500 shrink-0"
                            />
                            <span className="text-sm text-gray-300">{row.label}</span>
                        </label>
                        <select
                            value={mappedName}
                            onChange={(e) => handleChangeRowWorkflow(row.value, e.target.value)}
                            className={`${stacked ? 'w-full min-w-0' : 'w-40 shrink-0'} bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-gray-200 outline-none focus:border-green-500 transition-colors`}
                        >
                            <option value="">{COMMON.MESSAGES.COMMON_WORKFLOW_OPTION}</option>
                            {rowOptions.map(name => (
                                <option key={name} value={name}>{name}</option>
                            ))}
                        </select>
                    </div>
                );
            })}

            {/* 共通ワークフロー（「共通」を選んだ形式が使う既定） */}
            <div className={stacked ? 'flex flex-col gap-1 pt-1' : 'flex items-center gap-2 pt-1'}>
                <span className="text-xs text-gray-400 shrink-0">{COMMON.MESSAGES.COMMON_WORKFLOW_LABEL}</span>
                <select
                    value={defaultTemplateId}
                    onChange={(e) => handleChangeDefaultTemplate(e.target.value)}
                    className={`${stacked ? 'w-full min-w-0' : 'flex-1'} bg-gray-800 border border-green-600 rounded-lg px-3 py-2 text-sm text-gray-200 focus:border-green-400 outline-none`}
                >
                    {effectiveTemplates.map((t) => (
                        <option key={t.name} value={t.name}>{t.name}</option>
                    ))}
                </select>
            </div>

            <div className="flex items-center gap-2">
                <p className="text-xs text-gray-500">{COMMON.MESSAGES.TAG_JUDGE_WORKFLOW_AUTO_SAVE}</p>
                {notice && (
                    <span className={`flex items-center gap-1 text-xs ${notice.kind === 'saved' ? 'text-green-400' : 'text-red-300'}`}>
                        {notice.kind === 'saved' ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
                        {notice.text}
                    </span>
                )}
            </div>
        </div>
    );
};
