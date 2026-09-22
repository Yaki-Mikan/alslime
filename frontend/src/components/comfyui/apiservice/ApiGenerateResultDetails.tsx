/**
 * ApiGenerateResultDetails.tsx - API サービス生成の結果詳細（テスト生成の 2 画面で共用）
 *
 * 注意（i18n キー）・Anlas 概算・モデルとシード・生成へ指定した効果音・人物ごとの解決済みプロンプトを出す。
 * ベースとネガティブは既存の折りたたみ（ポジティブ／ネガティブ）が担う。
 */

import React, { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import type { GenerateResult } from '../../../api/comfyui';
import { resolveMessage, type I18NCatalog } from '../../../api/i18n';
import { createComfyUIText } from '../i18n';
import { SoundEffectsSummary } from './SoundEffectsSummary';

interface Props {
    result: GenerateResult;
    uiCatalog?: I18NCatalog | null;
}

export const ApiGenerateResultDetails: React.FC<Props> = ({ result, uiCatalog = null }) => {
    const { GENERATE_TEST } = createComfyUIText(uiCatalog);
    const [showPersons, setShowPersons] = useState(true);
    const persons = result.resolvedPrompt?.persons ?? [];
    const warnings = result.warnings ?? [];

    return (
        <div className="space-y-2">
            {warnings.length > 0 && (
                <div className="bg-amber-900/30 border border-amber-700/60 rounded-lg px-3 py-2 text-xs text-amber-200 space-y-1">
                    <div className="flex items-center gap-1 font-medium">
                        <AlertTriangle size={12} />
                        {GENERATE_TEST.LABELS.WARNINGS}
                    </div>
                    {warnings.map((key) => (
                        <p key={key}>{resolveMessage(uiCatalog, key, key)}</p>
                    ))}
                </div>
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
                {result.anlasEstimated !== undefined && (
                    <span>{GENERATE_TEST.LABELS.ANLAS_ESTIMATE}: <span className="text-gray-200">{result.anlasEstimated}</span></span>
                )}
                {result.model && <span>Model: <span className="text-gray-200">{result.model}</span></span>}
                {result.seed !== undefined && <span>Seed: <span className="text-gray-200">{result.seed}</span></span>}
                {result.presetName && <span>{GENERATE_TEST.LABELS.PRESET}: <span className="text-gray-200">{result.presetName}</span></span>}
            </div>
            <SoundEffectsSummary soundEffects={result.soundEffects} status={result.soundEffectsStatus} uiCatalog={uiCatalog} />
            {persons.length > 0 && (
                <div className="border border-gray-700 rounded-lg overflow-hidden text-xs">
                    <button
                        onClick={() => setShowPersons(!showPersons)}
                        className="w-full flex items-center gap-1 px-3 py-1.5 bg-gray-800/70 hover:bg-gray-800 text-gray-400 transition-colors"
                    >
                        {showPersons ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        {GENERATE_TEST.LABELS.PERSON_PROMPTS} ({persons.length})
                    </button>
                    {showPersons && persons.map((person, idx) => (
                        <div key={idx} className="px-3 py-2 bg-gray-800/30 border-t border-gray-700 space-y-0.5">
                            {person.label && <p className="text-gray-400 font-medium">{person.label}</p>}
                            <p className="text-gray-300 break-all">{person.positive || GENERATE_TEST.PLACEHOLDERS.NONE}</p>
                            {person.negative && <p className="text-red-300/80 break-all">{person.negative}</p>}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
