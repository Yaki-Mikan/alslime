/**
 * TagJudgeWorkflowDrawerPanel.tsx - 左メニュー用タグ判定・ワークフロー設定パネル
 *
 * StatusDrawer 内で開閉するパネルの器（デフォルト閉）。開いた時に
 * TagJudgeWorkflowPanel をマウントして設定を読み込むため、
 * 閉→開で他画面での変更を拾う。表示条件（支援者機能・モジュール連携）は
 * Chat 側で判定して渡す。
 */

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Workflow } from 'lucide-react';
import { TagJudgeWorkflowPanel } from './TagJudgeWorkflowPanel';
import { createComfyUIText } from './i18n';
import type { I18NCatalog } from '../../api/i18n';

interface Props {
    backendUrl: string;
    uiCatalog?: I18NCatalog | null;
}

export const TagJudgeWorkflowDrawerPanel: React.FC<Props> = ({ backendUrl, uiCatalog = null }) => {
    const { SECTION_NAMES } = createComfyUIText(uiCatalog);
    const [isOpen, setIsOpen] = useState(false);

    return (
        <div className="border border-gray-700/60 rounded-lg overflow-hidden bg-gray-800/40">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-200 hover:bg-gray-700/60 transition-colors text-left"
            >
                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <Workflow size={14} className="text-green-400" />
                <span>{SECTION_NAMES.TAG_JUDGE_WORKFLOW_SETTINGS}</span>
            </button>
            {isOpen && (
                <div className="p-3 border-t border-gray-700/60">
                    <TagJudgeWorkflowPanel
                        backendUrl={backendUrl}
                        uiCatalog={uiCatalog}
                        showHeading={false}
                    />
                </div>
            )}
        </div>
    );
};
